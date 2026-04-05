CREATE TABLE IF NOT EXISTS productos (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  sku           TEXT,
  created_at    TIMESTAMP,
  updated_at    TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ventas (
  id             INTEGER PRIMARY KEY,
  number         TEXT,
  date_sale      DATE,
  total_price    NUMERIC(12, 2),
  channel        TEXT,
  sale_state     TEXT,
  payment_method TEXT,
  store          TEXT,
  client_name    TEXT
);

CREATE TABLE IF NOT EXISTS venta_detalles (
  id           INTEGER PRIMARY KEY,
  sale_id      INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  product_id   INTEGER,
  product_name TEXT,
  size_id      INTEGER,
  size         TEXT,
  quantity     INTEGER,
  unit_price   NUMERIC(12, 2),
  total        NUMERIC(12, 2)
);

CREATE TABLE IF NOT EXISTS inventario (
  product_id         INTEGER NOT NULL,
  product_name       TEXT,
  size_id            INTEGER NOT NULL,
  size_name          TEXT,
  store_name         TEXT NOT NULL,
  available_quantity INTEGER,
  PRIMARY KEY (product_id, size_id, store_name)
);

CREATE INDEX IF NOT EXISTS idx_ventas_date_sale ON ventas(date_sale);
CREATE INDEX IF NOT EXISTS idx_ventas_sale_state ON ventas(sale_state);
CREATE INDEX IF NOT EXISTS idx_venta_detalles_sale_id ON venta_detalles(sale_id);
CREATE INDEX IF NOT EXISTS idx_venta_detalles_product_id ON venta_detalles(product_id);
CREATE INDEX IF NOT EXISTS idx_inventario_product_id ON inventario(product_id);
