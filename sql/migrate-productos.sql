ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS category        text,
  ADD COLUMN IF NOT EXISTS retailer_price  numeric(12, 2),
  ADD COLUMN IF NOT EXISTS wholesaler_price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS unit_cost       numeric(12, 2),
  ADD COLUMN IF NOT EXISTS active          boolean;
