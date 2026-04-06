-- Tabla de mapeo manual: producto con Variante Única → color real
CREATE TABLE IF NOT EXISTS variante_color_manual (
  product_name TEXT PRIMARY KEY,
  color        TEXT NOT NULL
);

-- Registros iniciales
INSERT INTO variante_color_manual (product_name, color) VALUES
  ('TOP ALANI',    'Blanco'),
  ('TOP ALASKA',   'Marrón'),
  ('TOP ANGIE',    'Negro'),
  ('TOP APEX',     'Negro'),
  ('TOP ARTEMISA', 'Negro'),
  ('TOP ASH',      'Negro'),
  ('TOP CUORE',    'Negro'),
  ('TOP DRIP',     'Negro'),
  ('TOP FENI',     'Blanco'),
  ('TOP FURY',     'Negro'),
  ('TOP NAYA',     'Negro')
ON CONFLICT (product_name) DO UPDATE SET color = EXCLUDED.color;
