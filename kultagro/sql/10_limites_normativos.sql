-- Límites normativos del Plan de abonado (RD 1051/2022 y RD 47/2022).
-- Ejecutar en el SQL Editor de Supabase. Se puede ejecutar más de una vez.
-- Los valores de referencia (tablas A, B, C y nitrógeno) viven en app/lib/limitesNormativos.ts.

-- Parcelas: pendiente media (%) y zona vulnerable a nitratos
alter table public.parcelas add column if not exists pendiente_media numeric;
alter table public.parcelas add column if not exists zona_vulnerable boolean default false;
alter table public.parcelas add column if not exists zona_vulnerable_fuente text;

-- Análisis de suelo: metales pesados del suelo (mg/kg ms), p. ej. {"Cd":0.4,"Cu":35}
alter table public.analisis_suelo add column if not exists metales jsonb default '{}'::jsonb;

-- Catálogo de abonos: metales del producto (mg/kg ms) y % de materia seca
alter table public.catalogo_abonos add column if not exists metales jsonb default '{}'::jsonb;
alter table public.catalogo_abonos add column if not exists materia_seca_pct numeric;

-- Planes de abonado: fotografía fija de los datos normativos usados al guardar
-- (metales del abono, materia seca, método, pendiente, zona vulnerable, avisos)
alter table public.planes_abonado add column if not exists normativa jsonb;
