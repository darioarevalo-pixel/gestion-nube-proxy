-- =============================================================================
-- Vistas materializadas — BDI Monitor
-- Ejecutar en Supabase SQL Editor (en orden)
-- =============================================================================

-- ── Función auxiliar: normalizar modelo de iPhone desde size ─────────────────

CREATE OR REPLACE FUNCTION normalize_iphone_model(size text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  s text;
BEGIN
  IF size IS NULL THEN RETURN NULL; END IF;
  s := regexp_replace(trim(size), '^i?phone\s*', '', 'i');
  s := trim(split_part(s, ' - ', 1));
  s := trim(split_part(s, '/', 1));
  s := lower(trim(s));

  IF    s ~ '^17 pro max'  THEN RETURN 'iPhone 17 Pro Max';
  ELSIF s ~ '^17 air'      THEN RETURN 'iPhone 17 Air';
  ELSIF s ~ '^17 pro'      THEN RETURN 'iPhone 17 Pro';
  ELSIF s ~ '^17'          THEN RETURN 'iPhone 17';
  ELSIF s ~ '^16 pro max'  THEN RETURN 'iPhone 16 Pro Max';
  ELSIF s ~ '^16 plus'     THEN RETURN 'iPhone 16 Plus';
  ELSIF s ~ '^16 pro'      THEN RETURN 'iPhone 16 Pro';
  ELSIF s ~ '^16e'         THEN RETURN 'iPhone 16e';
  ELSIF s ~ '^16'          THEN RETURN 'iPhone 16';
  ELSIF s ~ '^15 pro max'  THEN RETURN 'iPhone 15 Pro Max';
  ELSIF s ~ '^15 plus'     THEN RETURN 'iPhone 15 Plus';
  ELSIF s ~ '^15 pro'      THEN RETURN 'iPhone 15 Pro';
  ELSIF s ~ '^15'          THEN RETURN 'iPhone 15';
  ELSIF s ~ '^14 pro max'  THEN RETURN 'iPhone 14 Pro Max';
  ELSIF s ~ '^14 plus'     THEN RETURN 'iPhone 14 Plus';
  ELSIF s ~ '^14 pro'      THEN RETURN 'iPhone 14 Pro';
  ELSIF s ~ '^14'          THEN RETURN 'iPhone 14';
  ELSIF s ~ '^13 pro max'  THEN RETURN 'iPhone 13 Pro Max';
  ELSIF s ~ '^13 mini'     THEN RETURN 'iPhone 13 Mini';
  ELSIF s ~ '^13 pro'      THEN RETURN 'iPhone 13 Pro';
  ELSIF s ~ '^13'          THEN RETURN 'iPhone 13';
  ELSIF s ~ '^12 pro max'  THEN RETURN 'iPhone 12 Pro Max';
  ELSIF s ~ '^12 mini'     THEN RETURN 'iPhone 12 Mini';
  ELSIF s ~ '^12 pro'      THEN RETURN 'iPhone 12 Pro';
  ELSIF s ~ '^12'          THEN RETURN 'iPhone 12';
  ELSIF s ~ '^11 pro max'  THEN RETURN 'iPhone 11 Pro Max';
  ELSIF s ~ '^11 pro'      THEN RETURN 'iPhone 11 Pro';
  ELSIF s ~ '^11'          THEN RETURN 'iPhone 11';
  ELSIF s ~ '^xs max'      THEN RETURN 'iPhone XS Max';
  ELSIF s ~ '^xs'          THEN RETURN 'iPhone XS';
  ELSIF s ~ '^xr'          THEN RETURN 'iPhone XR';
  ELSIF s ~ '^x(\s|$)'     THEN RETURN 'iPhone X';
  ELSIF s ~ '^se 3'        THEN RETURN 'iPhone SE 3';
  ELSIF s ~ '^se 2'        THEN RETURN 'iPhone SE 2';
  ELSIF s ~ '^se'          THEN RETURN 'iPhone SE';
  ELSIF s ~ '^8 plus'      THEN RETURN 'iPhone 8 Plus';
  ELSIF s ~ '^8'           THEN RETURN 'iPhone 8';
  ELSIF s ~ '^7 plus'      THEN RETURN 'iPhone 7 Plus';
  ELSIF s ~ '^7'           THEN RETURN 'iPhone 7';
  ELSIF s ~ '^6s plus'     THEN RETURN 'iPhone 6s Plus';
  ELSIF s ~ '^6s'          THEN RETURN 'iPhone 6s';
  ELSIF s ~ '^6 plus'      THEN RETURN 'iPhone 6 Plus';
  ELSIF s ~ '^6'           THEN RETURN 'iPhone 6';
  END IF;

  RETURN NULL;
END;
$$;


-- ── 1. ventas_por_mes ────────────────────────────────────────────────────────
-- Total de items vendidos, cantidad de ventas y promedio items/venta
-- agrupado por mes y canal de venta.

DROP MATERIALIZED VIEW IF EXISTS ventas_por_mes CASCADE;

CREATE MATERIALIZED VIEW ventas_por_mes AS
SELECT
  to_char(v.date_sale::date, 'YYYY-MM')      AS mes,
  v.channel,
  count(DISTINCT v.id)                        AS cantidad_ventas,
  sum(d.quantity)                             AS total_items,
  round(
    sum(d.quantity)::numeric /
    nullif(count(DISTINCT v.id), 0),
    2
  )                                           AS promedio_items_por_venta
FROM ventas v
JOIN venta_detalles d ON d.sale_id = v.id
WHERE v.date_sale IS NOT NULL
GROUP BY mes, v.channel
ORDER BY mes, v.channel;

CREATE INDEX ON ventas_por_mes (mes);


-- ── 2. ventas_por_categoria_mes ──────────────────────────────────────────────
-- Items vendidos por mes y categoría de producto.
-- Normalización: MAYORISTA / MINORISTA → FUNDAS; todo a mayúsculas.

DROP MATERIALIZED VIEW IF EXISTS ventas_por_categoria_mes CASCADE;

CREATE MATERIALIZED VIEW ventas_por_categoria_mes AS
SELECT
  to_char(v.date_sale::date, 'YYYY-MM')      AS mes,
  CASE
    WHEN upper(trim(p.category)) IN ('MAYORISTA', 'MINORISTA') THEN 'FUNDAS'
    WHEN p.category IS NULL OR trim(p.category) = ''           THEN 'SIN CATEGORÍA'
    ELSE upper(trim(p.category))
  END                                         AS categoria,
  sum(d.quantity)                             AS total_items
FROM ventas v
JOIN venta_detalles d ON d.sale_id = v.id
LEFT JOIN productos p ON p.id = d.product_id
WHERE v.date_sale IS NOT NULL
GROUP BY mes, categoria
ORDER BY mes, categoria;

CREATE INDEX ON ventas_por_categoria_mes (mes);


-- ── 3. fundas_por_modelo_mes ─────────────────────────────────────────────────
-- Items de fundas vendidos por mes, modelo de iPhone y nombre de producto.
-- Solo products con category IN ('FUNDAS', 'MAYORISTA', 'MINORISTA').

DROP MATERIALIZED VIEW IF EXISTS fundas_por_modelo_mes CASCADE;

CREATE MATERIALIZED VIEW fundas_por_modelo_mes AS
SELECT
  to_char(v.date_sale::date, 'YYYY-MM')      AS mes,
  normalize_iphone_model(d.size)             AS modelo,
  d.product_id,
  d.product_name,
  min(p.created_at)                          AS product_created_at,
  sum(d.quantity)                            AS total_items
FROM ventas v
JOIN venta_detalles d ON d.sale_id = v.id
LEFT JOIN productos p ON p.id = d.product_id
WHERE v.date_sale IS NOT NULL
  AND upper(trim(p.category)) IN ('FUNDAS', 'MAYORISTA', 'MINORISTA')
  AND normalize_iphone_model(d.size) IS NOT NULL
GROUP BY mes, modelo, d.product_id, d.product_name
ORDER BY mes, total_items DESC;

CREATE INDEX ON fundas_por_modelo_mes (mes);
CREATE INDEX ON fundas_por_modelo_mes (modelo);
CREATE INDEX ON fundas_por_modelo_mes (product_id);


-- ── RPC: refresco de las tres vistas ─────────────────────────────────────────
-- Llamado desde sync-diario.js con supabase.rpc('refresh_all_views')

CREATE OR REPLACE FUNCTION refresh_all_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW ventas_por_mes;
  REFRESH MATERIALIZED VIEW ventas_por_categoria_mes;
  REFRESH MATERIALIZED VIEW fundas_por_modelo_mes;
END;
$$;
