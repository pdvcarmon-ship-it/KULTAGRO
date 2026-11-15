-- =============================================================================
-- KULTAGRO × SIEX — Fase 2 · Catálogos oficiales SIEX
-- Ejecutar en Supabase (SQL editor). Idempotente.
--
-- Guarda TODOS los catálogos del portal SIEX en una única tabla genérica
-- (catalogo_id = idTabla oficial: PRODUCTOS, VARIEDAD_ESPECIE_TIPO, PLAGAS, ...).
-- La carga y actualización la hace el script `siex_catalogos.py` del backend (con clave de
-- servicio); la aplicación solo LEE, y solo para usuarios autenticados.
-- =============================================================================

-- Búsqueda por similitud (autocompletado rápido con `ilike '%texto%'` sobre ~90.000 variedades)
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.siex_catalogos (
  catalogo_id     text        not null,             -- idTabla oficial ('PRODUCTOS' = cultivos)
  codigo          text        not null,             -- código que se ENVÍA a SIEX
  descripcion     text        not null,             -- texto que ve el usuario
  padre           text        not null default '',  -- variedad -> código de cultivo; árboles (plagas...) -> código del nodo padre; '' = sin padre
  extra           jsonb       not null default '{}'::jsonb,  -- datos propios de cada catálogo (nombre científico, EPPO, ...)
  activo          boolean     not null default true,           -- false si tiene fecha de baja o ya no viene en el fichero oficial
  fecha_baja      date,
  orden           integer,                          -- orden original del fichero oficial
  busqueda        text        not null,             -- descripción + datos de búsqueda, en minúsculas y sin acentos
  actualizado_en  timestamptz not null default now(),
  -- `padre` forma parte de la clave: el código de variedad NO es único por sí solo
  -- (p. ej. '0' = SIN VARIEDAD existe en los 1.120 cultivos; se identifica con cultivo + variedad).
  primary key (catalogo_id, padre, codigo)
);

-- (la búsqueda de "variedades de un cultivo" o "hijos de un nodo" usa el prefijo de la clave primaria)

-- Índice trigram: se crea con el operador de la extensión sea cual sea el esquema donde esté instalada
do $$
declare esquema text;
begin
  select n.nspname into esquema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_siex_catalogos_busqueda') then
    execute format('create index idx_siex_catalogos_busqueda on public.siex_catalogos using gin (busqueda %I.gin_trgm_ops)', esquema);
  end if;
end $$;

-- Control de versiones de cada catálogo (para no recargar lo que no ha cambiado)
create table if not exists public.siex_catalogos_meta (
  catalogo_id     text primary key,
  fuente          text        not null,             -- 'xlsx:<fichero>' o 'api'
  fecha_origen    date,                             -- fecha de última actualización que publica SIEX (GET /catalogos/{id}/fecha)
  hash_fichero    text,                             -- SHA-256 del fichero cargado
  filas           integer     not null default 0,
  filas_activas   integer     not null default 0,
  actualizado_en  timestamptz not null default now()
);

-- Seguridad: lectura para usuarios autenticados; escritura solo con la clave de servicio
-- (la clave de servicio se salta RLS, por eso no hay políticas de escritura).
alter table public.siex_catalogos      enable row level security;
alter table public.siex_catalogos_meta enable row level security;

drop policy if exists siex_catalogos_lectura on public.siex_catalogos;
create policy siex_catalogos_lectura on public.siex_catalogos
  for select to authenticated using (true);

drop policy if exists siex_catalogos_meta_lectura on public.siex_catalogos_meta;
create policy siex_catalogos_meta_lectura on public.siex_catalogos_meta
  for select to authenticated using (true);

grant select on public.siex_catalogos, public.siex_catalogos_meta to authenticated;
