import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

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
  } catch { /* usa variables del sistema */ }
}

loadEnv();

const SUPABASE_URL = process.env.ZATTIA_SUPABASE_URL;
const SUPABASE_KEY = process.env.ZATTIA_SUPABASE_KEY;
const GN_TOKEN     = process.env.GN_TOKEN_ZATTIA;
const GN_BASE      = 'https://www.gestionnube.com/api/v1';
const LAST_SYNC_FILE = resolve(process.cwd(), '.last-sync-zattia');

if (!SUPABASE_URL || !SUPABASE_KEY || !GN_TOKEN) {
  console.error('Faltan variables de entorno: ZATTIA_SUPABASE_URL, ZATTIA_SUPABASE_KEY, GN_TOKEN_ZATTIA');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Helpers ───────────────────────────────────────────────────────────────────

function readLastSync() {
  try {
    const raw = JSON.parse(readFileSync(LAST_SYNC_FILE, 'utf8'));
    return {
      ventasDate:    raw.ventasDate    || null,
      productosDate: raw.productosDate || null,
    };
  } catch {
    return { ventasDate: null, productosDate: null };
  }
}

function writeLastSync(data) {
  writeFileSync(LAST_SYNC_FILE, JSON.stringify(data, null, 2));
}

function daysBetween(isoA, isoB) {
  return Math.abs(new Date(isoA) - new Date(isoB)) / 86400000;
}

async function gnFetch(path, retries = 4) {
  const url = `${GN_BASE}/${path}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${GN_TOKEN}`, 'Accept': 'application/json' }
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      if (attempt < retries) {
        process.stdout.write(` [retry ${attempt}/${retries - 1}]`);
        await sleep(3000 * attempt);
        continue;
      }
      throw new Error(`Respuesta no-JSON [${res.status}] en ${path}: ${text.substring(0, 200)}`);
    }
    if (!res.ok) {
      if (res.status >= 500 && attempt < retries) {
        process.stdout.write(` [retry ${attempt}/${retries - 1} status ${res.status}]`);
        await sleep(3000 * attempt);
        continue;
      }
      throw new Error(data.message || data.error || `Error ${res.status} en ${path}`);
    }
    return data;
  }
}

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

// ── Sync functions ────────────────────────────────────────────────────────────

async function syncProductos() {
  console.log('\n[productos] Descargando (sync semanal)...');
  const rows = await fetchAllPages('productos/obtener?per_page=50');
  const productos = rows.map(p => ({
    id:               p.id,
    name:             p.name,
    sku:              p.sku || p.code || null,
    category:         p.category || null,
    retailer_price:   p.retailer_price ?? null,
    wholesaler_price: p.wholesaler_price ?? null,
    unit_cost:        p.unit_cost ?? null,
    active:           p.active ?? null,
    created_at:       p.created_at || null,
    updated_at:       p.updated_at || null,
  }));
  console.log(`[productos] ${productos.length} registros. Guardando en Supabase...`);
  if (!productos.length) return 0;
  const BATCH = 500;
  for (let i = 0; i < productos.length; i += BATCH) {
    const lote = productos.slice(i, i + BATCH);
    process.stdout.write(`  upsert ${i + lote.length}/${productos.length}...\r`);
    const { error } = await supabase.from('productos').upsert(lote, { onConflict: 'id' });
    if (error) throw new Error(`Error guardando productos (lote ${i}): ${error.message}`);
  }
  process.stdout.write('\n');
  console.log(`[productos] OK`);
  return productos.length;
}

async function syncInventario() {
  console.log('\n[inventario] Descargando (siempre completo)...');
  const rows = await fetchAllPages('inventario/obtener?per_page=50');

  // Dedup: la API puede devolver filas duplicadas con misma clave compuesta
  const invMap = {};
  rows.forEach(r => {
    const key = `${r.product_id}|${r.size_id}|${r.store_name || r.store || ''}`;
    if (!invMap[key]) {
      invMap[key] = {
        product_id:         r.product_id,
        product_name:       r.product_name || null,
        size_id:            r.size_id,
        size_name:          r.size_name || null,
        store_name:         r.store_name || r.store || '',
        available_quantity: r.available_quantity ?? r.quantity ?? 0,
      };
    } else {
      invMap[key].available_quantity += r.available_quantity ?? r.quantity ?? 0;
    }
  });

  const inventario = Object.values(invMap);
  console.log(`[inventario] ${inventario.length} registros únicos (de ${rows.length} raw). Guardando en Supabase...`);
  if (!inventario.length) return 0;
  const { error } = await supabase.from('inventario').upsert(inventario, { onConflict: 'product_id,size_id,store_name' });
  if (error) throw new Error(`Error guardando inventario: ${error.message}`);
  console.log(`[inventario] OK`);
  return inventario.length;
}

async function syncVentas(fromDate) {
  const today = new Date().toISOString().substring(0, 10);
  const basePath = `ventas/obtener?from=${fromDate}&to=${today}&include_details=1&per_page=50`;
  console.log(`\n[ventas] Descargando desde ${fromDate} hasta ${today}...`);
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().substring(0, 10);
  const lastSync = readLastSync();

  console.log('=== Sincronización diaria — Zattia ===');
  console.log(`Supabase:            ${SUPABASE_URL}`);
  console.log(`Fecha actual:        ${today}`);
  console.log(`Último sync ventas:  ${lastSync.ventasDate || 'nunca'}`);
  console.log(`Último sync prods:   ${lastSync.productosDate || 'nunca'}`);

  // Ventas: desde el último sync (o 2025-01-01 si nunca se corrió)
  const ventasFrom = lastSync.ventasDate || '2025-01-01';

  // Productos: solo si pasaron más de 7 días desde el último sync de productos
  const productosPendiente = !lastSync.productosDate ||
    daysBetween(lastSync.productosDate, today) >= 7;

  if (productosPendiente) console.log('\nSync semanal de productos activado.');

  try {
    const inventario = await syncInventario();
    const ventas     = await syncVentas(ventasFrom);
    let productos    = 'omitido';

    if (productosPendiente) {
      productos = await syncProductos();
    }

    writeLastSync({
      ventasDate:    today,
      productosDate: productosPendiente ? today : lastSync.productosDate,
    });

    console.log('\n=== Resultado ===');
    console.log(`Inventario:     ${inventario}`);
    console.log(`Ventas:         ${ventas.ventas}`);
    console.log(`Venta detalles: ${ventas.detalles}`);
    console.log(`Productos:      ${productos}`);
    console.log('\nSincronización completada.');
  } catch (e) {
    console.error('\nERROR:', e.message);
    process.exit(1);
  }
}

main();
