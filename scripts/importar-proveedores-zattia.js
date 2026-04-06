import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

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

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan variables de entorno: ZATTIA_SUPABASE_URL, ZATTIA_SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Leer Excel ────────────────────────────────────────────────────────────────

const XLSX_PATH = resolve(process.cwd(), 'Proveedor Zattia.xlsx');
const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws);

// Agrupar por nombre normalizado → proveedor (última entrada gana si hay duplicados)
const proveedorPorNombre = {};
rows.forEach(r => {
  const nombre = String(r['Nombre Producto'] || '').toUpperCase().trim();
  const proveedor = String(r['Proveedor'] || '').trim();
  if (nombre && proveedor) proveedorPorNombre[nombre] = proveedor;
});

const nombresExcel = Object.keys(proveedorPorNombre);
console.log(`Excel: ${rows.length} filas → ${nombresExcel.length} nombres únicos de producto`);

// ── Cargar productos desde Supabase ──────────────────────────────────────────

console.log('\nCargando productos desde Supabase...');
const allProductos = [];
const BATCH = 1000;
let offset = 0;
while (true) {
  const { data, error } = await supabase
    .from('productos')
    .select('id, name')
    .range(offset, offset + BATCH - 1);
  if (error) { console.error('Error leyendo productos:', error.message); process.exit(1); }
  allProductos.push(...data);
  if (data.length < BATCH) break;
  offset += BATCH;
}
console.log(`Productos en Supabase: ${allProductos.length}`);

// ── Cruzar por nombre normalizado ─────────────────────────────────────────────

const updates = [];
const noEncontrados = [];

nombresExcel.forEach(nombreExcel => {
  const match = allProductos.find(p => p.name.toUpperCase().trim() === nombreExcel);
  if (match) {
    updates.push({ id: match.id, proveedor: proveedorPorNombre[nombreExcel] });
  } else {
    noEncontrados.push(nombreExcel);
  }
});

console.log(`\nCruces encontrados:  ${updates.length}`);
console.log(`Sin coincidencia:    ${noEncontrados.length}`);

if (noEncontrados.length) {
  console.log('\nProductos del Excel sin match en Supabase:');
  noEncontrados.forEach(n => console.log(`  - ${n}`));
}

if (!updates.length) {
  console.log('\nNada que actualizar.');
  process.exit(0);
}

// ── Actualizar en Supabase ────────────────────────────────────────────────────

console.log(`\nActualizando ${updates.length} productos...`);
let ok = 0, fail = 0;

for (const { id, proveedor } of updates) {
  const { error } = await supabase
    .from('productos')
    .update({ proveedor })
    .eq('id', id);
  if (error) {
    console.error(`  ERROR id=${id}: ${error.message}`);
    fail++;
  } else {
    ok++;
  }
}

console.log(`\n=== Resultado ===`);
console.log(`Actualizados OK: ${ok}`);
if (fail) console.log(`Errores:         ${fail}`);
console.log('Importación completada.');
