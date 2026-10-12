-- =============================================================================
-- KULTAGRO × SIEX — Fase 2 · Columnas de catálogo en los datos de Kampo + enlace de lo ya registrado
-- Ejecutar DESPUÉS de 01 y 03, y de cargar los catálogos (siex_catalogos.py).
-- Antes de desplegar el frontend de la Fase 2. Idempotente.
--
-- Los textos actuales (`cultivo`, `variedad`, `problema_fitosanitario`, `justificacion_actuacion`)
-- NO se tocan: siguen alimentando el cuaderno de campo y los PDF. Se añaden columnas con el CÓDIGO
-- oficial SIEX al lado. La aplicación rellena las dos cosas al elegir del catálogo.
-- =============================================================================

-- ── Columnas nuevas ──────────────────────────────────────────────────────────────────
alter table public.parcelas
  add column if not exists cultivo_codigo   text,      -- PRODUCTOS.codigo
  add column if not exists variedad_codigo  text;      -- VARIEDAD_ESPECIE_TIPO.codigo (dentro del cultivo)

alter table public.historico_cultivos_parcela
  add column if not exists cultivo_codigo   text,
  add column if not exists variedad_codigo  text;

alter table public.tratamientos
  add column if not exists cultivo_codigo      text,   -- foto del cultivo tratado al guardar
  add column if not exists variedad_codigo     text,
  add column if not exists justificaciones     jsonb,  -- ["1","5"]  (JUSTIFICACION_ACTUACION)
  add column if not exists problematica        jsonb,  -- {"malas_hierbas":["141"],"enfermedades":[],"plagas":[],"reguladores":[]}
  add column if not exists estado_fenologico   text;   -- EST_FENOLOGICO.codigo

-- ── Normalización idéntica a la de la aplicación y a siex_catalogos.py ───────────────
create extension if not exists unaccent with schema extensions;

create or replace function public.siex_normalizar(texto text) returns text
language sql immutable as $$
  select trim(regexp_replace(lower(extensions.unaccent(coalesce(texto, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;

-- ── Enlace de lo ya registrado: SOLO coincidencias exactas de nombre ─────────────────
-- «Olivo» -> OLIVO. Lo que no coincide exactamente («Trigo», «Viñedo»...) se deja sin código:
-- la aplicación lo marca y el usuario lo elige del catálogo. No se adivina nada.
update public.parcelas p
   set cultivo_codigo = c.codigo
  from public.siex_catalogos c
 where p.cultivo_codigo is null
   and c.catalogo_id = 'PRODUCTOS' and c.activo
   and public.siex_normalizar(c.descripcion) = public.siex_normalizar(p.cultivo);

update public.parcelas p
   set variedad_codigo = v.codigo
  from public.siex_catalogos v
 where p.variedad_codigo is null and p.cultivo_codigo is not null and coalesce(p.variedad, '') <> ''
   and v.catalogo_id = 'VARIEDAD_ESPECIE_TIPO' and v.activo and v.padre = p.cultivo_codigo
   and public.siex_normalizar(v.descripcion) = public.siex_normalizar(p.variedad);

update public.historico_cultivos_parcela h
   set cultivo_codigo = c.codigo
  from public.siex_catalogos c
 where h.cultivo_codigo is null
   and c.catalogo_id = 'PRODUCTOS' and c.activo
   and public.siex_normalizar(c.descripcion) = public.siex_normalizar(h.cultivo);

update public.historico_cultivos_parcela h
   set variedad_codigo = v.codigo
  from public.siex_catalogos v
 where h.variedad_codigo is null and h.cultivo_codigo is not null and coalesce(h.variedad, '') <> ''
   and v.catalogo_id = 'VARIEDAD_ESPECIE_TIPO' and v.activo and v.padre = h.cultivo_codigo
   and public.siex_normalizar(v.descripcion) = public.siex_normalizar(h.variedad);

-- ── Informe: qué se ha enlazado y qué queda por elegir a mano ────────────────────────
-- select 'parcelas' as tabla, count(*) as total, count(cultivo_codigo) as con_cultivo,
--        count(*) filter (where coalesce(variedad,'') <> '') as con_variedad_texto, count(variedad_codigo) as con_variedad_codigo
--   from public.parcelas;
-- Cultivos que quedan sin código (los más frecuentes primero):
-- select cultivo, count(*) from public.parcelas where cultivo_codigo is null group by 1 order by 2 desc;
