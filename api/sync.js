import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://srqzzffmiiescffabtlc.supabase.co';
const GN_BASE = 'https://www.gestionnube.com/api/v1';

function getSupabase() {
  const key = process.env.SUPABASE_KEY;
  if (!key) throw new Error('Falta SUPABASE_KEY');
  return createClient(SUPABASE_URL, key);
}

async function gnFetch(path, token) {
  const res = await fetch(`${GN_BASE}/${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Respuesta inesperada de Gestión Nube'); }
  if (!res.ok) throw new Error(data.message || data.error || `Error ${res.status}`);
  return data;
}

async function fetchAllPages(basePath, token) {
  const results = [];
  let page = 1;
  while (true) {
    const sep = basePath.includes('?') ? '&' : '?';
    const data = await gnFetch(`${basePath}${sep}page=${page}`, token);
    results.push(...(data.data || []));
    if (!data.meta?.has_more_pages || (data.data || []).length === 0) break;
    page++;
  }
  return results;
}

async function syncProductos(supabase, token) {
  const data = await gnFetch('productos/obtener?per_page=200', token);
  const productos = (data.data || []).map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku || null,
    created_at: p.created_at || null,
    updated_at: p.updated_at || null,
  }));
  if (!productos.length) return 0;
  const { error } = await supabase.from('productos').upsert(productos, { onConflict: 'id' });
  if (error) throw new Error(`Error guardando productos: ${error.message}`);
  return productos.length;
}

async function syncInventario(supabase, token) {
  const rows = await fetchAllPages('inventario/obtener?per_page=50', token);
  const inventario = rows.map(r => ({
    product_id: r.product_id,
    product_name: r.product_name || null,
    size_id: r.size_id,
    size_name: r.size_name || null,
    store_name: r.store_name || r.store || '',
    available_quantity: r.available_quantity ?? r.quantity ?? 0,
  }));
  if (!inventario.length) return 0;
  const { error } = await supabase
    .from('inventario')
    .upsert(inventario, { onConflict: 'product_id,size_id,store_name' });
  if (error) throw new Error(`Error guardando inventario: ${error.message}`);
  return inventario.length;
}

async function syncVentas(supabase, token) {
  const today = new Date().toISOString().substring(0, 10);
  const basePath = `ventas/obtener?from=2025-01-01&to=${today}&include_details=1&per_page=50`;
  const rows = await fetchAllPages(basePath, token);

  const ventas = rows.map(v => ({
    id: v.id,
    number: v.number || null,
    date_sale: v.date_sale || null,
    total_price: v.total_price ?? null,
    channel: v.channel || null,
    sale_state: v.sale_state || null,
    payment_method: v.payment_method || null,
    store: v.store || null,
    client_name: v.client_name || null,
  }));

  const detalles = rows.flatMap(v =>
    (v.detalles || []).map(d => ({
      id: d.id,
      sale_id: v.id,
      product_id: d.product_id || null,
      product_name: d.product_name || null,
      size_id: d.size_id || null,
      size: d.size || null,
      quantity: d.quantity ?? null,
      unit_price: d.unit_price ?? null,
      total: d.total ?? null,
    }))
  );

  if (ventas.length) {
    const { error } = await supabase.from('ventas').upsert(ventas, { onConflict: 'id' });
    if (error) throw new Error(`Error guardando ventas: ${error.message}`);
  }

  if (detalles.length) {
    const { error } = await supabase.from('venta_detalles').upsert(detalles, { onConflict: 'id' });
    if (error) throw new Error(`Error guardando detalles: ${error.message}`);
  }

  return { ventas: ventas.length, detalles: detalles.length };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Falta Authorization: Bearer TOKEN' });

  try {
    const supabase = getSupabase();

    const [productos, inventario, ventas] = await Promise.all([
      syncProductos(supabase, token),
      syncInventario(supabase, token),
      syncVentas(supabase, token),
    ]);

    return res.status(200).json({
      ok: true,
      sincronizado: {
        productos,
        inventario,
        ventas: ventas.ventas,
        venta_detalles: ventas.detalles,
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
