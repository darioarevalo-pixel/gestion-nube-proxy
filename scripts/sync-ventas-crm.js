// Script focalizado: solo sincroniza ventas + venta_detalles + clientes.
// Sirve para el rebuild histórico del CRM sin tocar productos/inventario.
// Idempotente: usa upserts, se puede correr varias veces.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
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
  } catch {}
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GN_TOKEN     = process.env.GN_TOKEN;
const GN_BASE      = 'https://www.gestionnube.com/api/v1';
const FROM_DATE    = process.env.SYNC_FROM_DATE || '2025-01-01';

if (!SUPABASE_URL || !SUPABASE_KEY || !GN_TOKEN) {
  console.error('Faltan variables: SUPABASE_URL, SUPABASE_KEY, GN_TOKEN');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gnFetch(path, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`${GN_BASE}/${path}`, {
      headers: { 'Authorization': `Bearer ${GN_TOKEN}`, 'Accept': 'application/json' }
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      if (res.status >= 500 && attempt < retries) {
        console.warn(`  ⚠️  ${res.status} en ${path}, reintentando (${attempt}/${retries})...`);
        await sleep(2000 * attempt);
        continue;
      }
      throw new Error(`Respuesta no-JSON de GN [${res.status}] en ${path}: ${text.substring(0, 200)}`);
    }
    if (!res.ok) {
      if (res.status >= 500 && attempt < retries) {
        console.warn(`  ⚠️  ${res.status} en ${path}, reintentando (${attempt}/${retries})...`);
        await sleep(2000 * attempt);
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

function mapVentaRow(v) {
  return {
    id:             v.id,
    number:         v.number || null,
    date_sale:      v.date_sale || null,
    total_price:    v.total_price ?? null,
    channel:        v.channel || null,
    sale_state:     v.sale_state || null,
    payment_method: v.payment_method || null,
    store:          v.store || null,
    client_name:    v.client_name || null,
    client_id:       v.client_id || null,
    client_email:    v.client_email || null,
    client_phone:    v.client_phone || null,
    client_city:     v.client_city || null,
    client_province: v.client_province || null,
    channel_id:      v.channel_id ?? null,
    sale_type_id:    v.sale_type_id ?? null,
    total_cost:      v.total_cost ?? null,
    profit:          v.profit ?? null,
    items_sold:      v.items_sold ?? null,
  };
}

function extraerClientes(rows) {
  const map = new Map();
  for (const v of rows) {
    if (!v.client_id) continue;
    const ts = v.created_at || v.updated_at || v.date_sale || '';
    const prev = map.get(v.client_id);
    if (!prev || (ts && ts > prev._ts)) {
      map.set(v.client_id, {
        id:           v.client_id,
        name:         v.client_name || null,
        email:        v.client_email || null,
        phone:        v.client_phone || null,
        city:         v.client_city || null,
        province:     v.client_province || null,
        postal_code:  v.client_postal_code || null,
        address:      v.client_address || null,
        updated_at:   new Date().toISOString(),
        _ts: ts,
      });
    }
  }
  return [...map.values()].map(({ _ts, ...rest }) => rest);
}

async function main() {
  const today = new Date().toISOString().substring(0, 10);
  console.log(`=== Sync CRM (ventas + clientes) ===`);
  console.log(`Rango: ${FROM_DATE} → ${today}`);
  console.log(`Supabase: ${SUPABASE_URL}\n`);

  const basePath = `ventas/obtener?from=${FROM_DATE}&to=${today}&include_details=1&per_page=50`;
  console.log(`[ventas] Descargando...`);
  const rows = await fetchAllPages(basePath);

  const ventas = rows.map(mapVentaRow);
  const clientes = extraerClientes(rows);
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

  console.log(`\n[ventas] ${ventas.length} ventas, ${detalles.length} detalles, ${clientes.length} clientes únicos.`);

  // Upsert ventas (en lotes para no romper la URL)
  console.log(`[ventas] Guardando en Supabase...`);
  if (ventas.length) {
    const BATCH_V = 1000;
    for (let i = 0; i < ventas.length; i += BATCH_V) {
      const lote = ventas.slice(i, i + BATCH_V);
      const { error } = await supabase.from('ventas').upsert(lote, { onConflict: 'id' });
      if (error) throw new Error(`Error guardando ventas (lote ${i}): ${error.message}`);
    }
  }

  // Upsert clientes
  console.log(`[clientes] Guardando en Supabase...`);
  if (clientes.length) {
    const BATCH_C = 500;
    for (let i = 0; i < clientes.length; i += BATCH_C) {
      const lote = clientes.slice(i, i + BATCH_C);
      const { error } = await supabase.from('clientes').upsert(lote, { onConflict: 'id' });
      if (error) throw new Error(`Error guardando clientes (lote ${i}): ${error.message}`);
    }
  }

  // Upsert detalles
  if (detalles.length) {
    console.log(`[detalles] Guardando en Supabase...`);
    const BATCH = 2000;
    for (let i = 0; i < detalles.length; i += BATCH) {
      const lote = detalles.slice(i, i + BATCH);
      process.stdout.write(`  detalles ${i + lote.length}/${detalles.length}\r`);
      const { error } = await supabase.from('venta_detalles').upsert(lote, { onConflict: 'id' });
      if (error) throw new Error(`Error guardando detalles (lote ${i}): ${error.message}`);
    }
    process.stdout.write('\n');
  }

  // Resumen mayorista
  const mayoristas = ventas.filter(v => v.channel_id === 10);
  const idsMay = new Set(mayoristas.map(v => v.client_id).filter(Boolean));

  console.log('\n=== Resultado ===');
  console.log(`Ventas guardadas:        ${ventas.length}`);
  console.log(`Detalles guardados:      ${detalles.length}`);
  console.log(`Clientes guardados:      ${clientes.length}`);
  console.log(`Ventas canal Mayorista:  ${mayoristas.length}`);
  console.log(`Clientes mayoristas:     ${idsMay.size}`);
  console.log('\nSync completado ✓');
}

main().catch(e => { console.error('\nERROR:', e.message); process.exit(1); });
