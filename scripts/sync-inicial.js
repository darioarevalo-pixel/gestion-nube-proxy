import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Cargar .env manualmente (sin dependencia de dotenv)
function loadEnv() {
  try {
    const lines = readFileSync(resolve(process.cwd(), '.env'), 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env no encontrado, se usan las variables de entorno del sistema
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GN_TOKEN    = process.env.GN_TOKEN;
const GN_BASE     = 'https://www.gestionnube.com/api/v1';

if (!SUPABASE_URL || !SUPABASE_KEY || !GN_TOKEN) {
  console.error('Faltan variables de entorno: SUPABASE_URL, SUPABASE_KEY, GN_TOKEN');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function gnFetch(path) {
  const url = `${GN_BASE}/${path}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${GN_TOKEN}`, 'Accept': 'application/json' }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Respuesta no-JSON de Gestión Nube [${res.status}] en ${path}: ${text.substring(0, 200)}`);
  }
  if (!res.ok) throw new Error(data.message || data.error || `Error ${res.status} en ${path}`);
  return data;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAllPages(basePath) {
  const results = [];
  let page = 1;
  while (true) {
    const sep = basePath.includes('?') ? '&' : '?';
    process.stdout.write(`  página ${page}...`);
    const data = await gnFetch(`${basePath}${sep}page=${page}`);
    const items = data.data || [];
    results.push(...items);
    process.stdout.write(` ${items.length} registros\n`);
    if (!data.meta?.has_more_pages || items.length === 0) break;
    page++;
    await sleep(1100);
  }
  return results;
}

async function syncProductos() {
  console.log('\n[productos] Descargando...');
  const rows = await fetchAllPages('productos/obtener?per_page=50');
  const productos = rows.map(p => ({
    id:         p.id,
    name:       p.name,
    sku:        p.sku || null,
    created_at: p.created_at || null,
    updated_at: p.updated_at || null,
  }));
  console.log(`[productos] ${productos.length} registros. Guardando en Supabase...`);
  if (!productos.length) return 0;
  const { error } = await supabase.from('productos').upsert(productos, { onConflict: 'id' });
  if (error) throw new Error(`Error guardando productos: ${error.message}`);
  console.log(`[productos] OK`);
  return productos.length;
}

async function syncInventario() {
  console.log('\n[inventario] Descargando...');
  const rows = await fetchAllPages('inventario/obtener?per_page=50');
  const inventario = rows.map(r => ({
    product_id:         r.product_id,
    product_name:       r.product_name || null,
    size_id:            r.size_id,
    size_name:          r.size_name || null,
    store_name:         r.store_name || r.store || '',
    available_quantity: r.available_quantity ?? r.quantity ?? 0,
  }));
  console.log(`[inventario] ${inventario.length} registros. Guardando en Supabase...`);
  if (!inventario.length) return 0;
  const { error } = await supabase.from('inventario').upsert(inventario, { onConflict: 'product_id,size_id,store_name' });
  if (error) throw new Error(`Error guardando inventario: ${error.message}`);
  console.log(`[inventario] OK`);
  return inventario.length;
}

async function syncVentas() {
  const today = new Date().toISOString().substring(0, 10);
  const basePath = `ventas/obtener?from=2025-01-01&to=${today}&include_details=1&per_page=50`;
  console.log(`\n[ventas] Descargando desde 2025-01-01 hasta ${today}...`);
  const rows = await fetchAllPages(basePath);

  const ventas = rows.map(v => ({
    id:             v.id,
    number:         v.number || null,
    date_sale:      v.date_sale || null,
    total_price:    v.total_price ?? null,
    channel:        v.channel || null,
    sale_state:     v.sale_state || null,
    payment_method: v.payment_method || null,
    store:          v.store || null,
    client_name:    v.client_name || null,
  }));

  const detalles = rows.flatMap(v =>
    (v.detalles || []).map(d => ({
      id:           d.id,
      sale_id:      v.id,
      product_id:   d.product_id || null,
      product_name: d.product_name || null,
      size_id:      d.size_id || null,
      size:         d.size || null,
      quantity:     d.quantity ?? null,
      unit_price:   d.unit_price ?? null,
      total:        d.total ?? null,
    }))
  );

  console.log(`[ventas] ${ventas.length} ventas, ${detalles.length} detalles. Guardando en Supabase...`);

  if (ventas.length) {
    const { error } = await supabase.from('ventas').upsert(ventas, { onConflict: 'id' });
    if (error) throw new Error(`Error guardando ventas: ${error.message}`);
  }

  if (detalles.length) {
    const BATCH = 2000;
    for (let i = 0; i < detalles.length; i += BATCH) {
      const lote = detalles.slice(i, i + BATCH);
      process.stdout.write(`  detalles ${i + lote.length}/${detalles.length}...\r`);
      const { error } = await supabase.from('venta_detalles').upsert(lote, { onConflict: 'id' });
      if (error) throw new Error(`Error guardando detalles (lote ${i}): ${error.message}`);
    }
    process.stdout.write('\n');
  }

  console.log(`[ventas] OK`);
  return { ventas: ventas.length, detalles: detalles.length };
}

async function main() {
  console.log('=== Sincronización inicial con Gestión Nube ===');
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`GN token: ${GN_TOKEN.substring(0, 6)}...`);

  try {
    const productos  = await syncProductos();
    const inventario = await syncInventario();
    const ventas     = await syncVentas();

    console.log('\n=== Resultado ===');
    console.log(`Productos:      ${productos}`);
    console.log(`Inventario:     ${inventario}`);
    console.log(`Ventas:         ${ventas.ventas}`);
    console.log(`Venta detalles: ${ventas.detalles}`);
    console.log('\nSincronización completada.');
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }
}

main();
