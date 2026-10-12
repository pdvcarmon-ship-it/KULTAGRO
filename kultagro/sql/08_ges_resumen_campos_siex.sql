-- =============================================================================
-- GES — panel de administración · añade codigo_rea/codigo_siex/ca_explotacion a ges_resumen()
-- Ejecutar en Supabase DESPUÉS de sql/06 y sql/07 de KULTAGRO (necesita esas columnas en `fincas`).
-- Idempotente (CREATE OR REPLACE).
-- =============================================================================

create or replace function public.ges_resumen()
returns table (
  cuenta_id        uuid,
  owner_user_id    uuid,
  nombre_empresa   text,
  email_contacto   text,
  cuenta_nif       text,
  finca_id         text,
  finca_nombre     text,
  finca_nif        text,
  finca_codigo_rea       text,
  finca_codigo_siex      text,
  finca_ca_explotacion   text,
  num_parcelas     bigint,
  hectareas        numeric,
  num_tratamientos_anio bigint,
  peso_bytes       bigint
)
language sql
stable
as $$
  select
    c.id as cuenta_id,
    c.owner_user_id,
    c.nombre_empresa,
    c.email_contacto,
    c.nif as cuenta_nif,
    f.id as finca_id,
    f.nombre as finca_nombre,
    f.nif as finca_nif,
    f.codigo_rea as finca_codigo_rea,
    f.codigo_siex as finca_codigo_siex,
    f.ca_explotacion as finca_ca_explotacion,
    coalesce(p.num_parcelas, 0) as num_parcelas,
    coalesce(p.hectareas, 0) as hectareas,
    coalesce(t.num_tratamientos, 0) as num_tratamientos_anio,
    public.ges_peso_finca_bytes(f.id) as peso_bytes
  from public.cuentas c
  left join public.fincas f on f.cuenta_id = c.id
  left join lateral (
    select count(*) as num_parcelas, sum(pa.sup_ha) as hectareas
    from public.parcelas pa
    where pa.finca_id = f.id
  ) p on true
  left join lateral (
    select count(*) as num_tratamientos
    from public.tratamientos tr
    where tr.finca_id = f.id
      and left(tr.fecha, 4) = extract(year from now())::text
  ) t on true
  order by c.nombre_empresa nulls last, f.nombre nulls last;
$$;
