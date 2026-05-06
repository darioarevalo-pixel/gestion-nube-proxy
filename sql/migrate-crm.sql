-- ============================================================================
-- Migración CRM: agrega datos de cliente a ventas y crea tabla clientes
-- Idempotente: se puede correr más de una vez sin romper nada.
-- ============================================================================

-- 1) Columnas nuevas en ventas
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS client_id        INTEGER,
  ADD COLUMN IF NOT EXISTS client_email     TEXT,
  ADD COLUMN IF NOT EXISTS client_phone     TEXT,
  ADD COLUMN IF NOT EXISTS client_city      TEXT,
  ADD COLUMN IF NOT EXISTS client_province  TEXT,
  ADD COLUMN IF NOT EXISTS channel_id       INTEGER,
  ADD COLUMN IF NOT EXISTS sale_type_id     INTEGER,
  ADD COLUMN IF NOT EXISTS total_cost       NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS profit           NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS items_sold       INTEGER;

-- 2) Tabla clientes
CREATE TABLE IF NOT EXISTS clientes (
  id              INTEGER PRIMARY KEY,
  name            TEXT,
  email           TEXT,
  phone           TEXT,
  city            TEXT,
  province        TEXT,
  postal_code     TEXT,
  address         TEXT,
  -- métricas materializadas (se actualizan en cada sync)
  first_sale_at   DATE,
  last_sale_at    DATE,
  total_sales     INTEGER DEFAULT 0,
  total_amount    NUMERIC(14, 2) DEFAULT 0,
  -- canales en los que compró (array de channel_id)
  channels        INTEGER[] DEFAULT '{}',
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 3) Índices para queries del CRM
CREATE INDEX IF NOT EXISTS idx_ventas_client_id    ON ventas(client_id);
CREATE INDEX IF NOT EXISTS idx_ventas_channel_id   ON ventas(channel_id);
CREATE INDEX IF NOT EXISTS idx_ventas_sale_type_id ON ventas(sale_type_id);
CREATE INDEX IF NOT EXISTS idx_clientes_last_sale  ON clientes(last_sale_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_clientes_total_amt  ON clientes(total_amount DESC);
