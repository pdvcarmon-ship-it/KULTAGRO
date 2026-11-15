-- STOCK: cada compra pasa a ser una entrada propia (fecha, albarán, comercializadora).
-- La campaña deja de usarse en Stock. Ejecutar en el SQL Editor de Supabase.
-- Es seguro ejecutarlo más de una vez.

alter table public.stock add column if not exists fecha_compra date;
alter table public.stock add column if not exists albaran text;
alter table public.stock add column if not exists comercializadora text;

-- Las entradas nuevas ya no llevan campaña: si la columna era NOT NULL, se permite NULL.
alter table public.stock alter column campana_id drop not null;
