-- =============================================================================
-- GES/KULTAGRO × SIEX — Fase 3 · Código REA y código SIEX como columnas de `fincas`
-- Ejecutar en Supabase (mismo proyecto que KAMPO y GES). Idempotente.
--
-- Mismo criterio que ya se aplicó a `fincas.nif`: son datos que identifican la
-- explotación ante SIEX y los rellena GES al dar de alta la finca, así que viven
-- como columnas propias de `fincas`, no enterrados dentro del JSON de
-- `datos_explotacion` (que sigue existiendo, para el resto de datos del
-- cuaderno de campo que si edita el propio usuario: dirección, contacto, etc.).
-- =============================================================================

alter table public.fincas
  add column if not exists codigo_rea  text,   -- 'ES' + 12 dígitos (14 caracteres)
  add column if not exists codigo_siex text;   -- 14 caracteres, opcional

-- Backfill desde el JSON de datos_explotacion (Fase 2), por si alguna finca ya
-- los tenía rellenados a mano por el usuario antes de que existiera GES.
update public.fincas f
   set codigo_rea  = coalesce(f.codigo_rea,  d.datos->>'codigoRea'),
       codigo_siex = coalesce(f.codigo_siex, d.datos->>'codigoSiex')
  from public.datos_explotacion d
 where d.finca_id = f.id
   and (f.codigo_rea is null or f.codigo_siex is null)
   and (d.datos->>'codigoRea' is not null or d.datos->>'codigoSiex' is not null);

-- Formato: 'ES' + 12 dígitos. No se fuerza con un constraint (podría haber
-- valores heredados imperfectos); se valida en la aplicación al guardar.
create index if not exists idx_fincas_codigo_rea on public.fincas (codigo_rea);

-- Comprobación rápida:
-- select id, nombre, nif, codigo_rea, codigo_siex from public.fincas where nif is not null;
