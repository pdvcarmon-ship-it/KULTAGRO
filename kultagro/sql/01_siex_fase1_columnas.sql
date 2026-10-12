-- =============================================================================
-- KULTAGRO × SIEX — Fase 1 · Migración OBLIGATORIA
-- Ejecutar en Supabase (SQL editor) ANTES de desplegar la versión nueva del frontend:
-- el guardado de tratamientos escribe estas columnas y fallaría si no existen.
-- Es idempotente: se puede ejecutar más de una vez.
-- =============================================================================

alter table public.tratamientos
  add column if not exists fecha_fin              date,     -- SIEX: FechaFin (si es NULL se entiende igual a `fecha`)
  add column if not exists hora_tratamiento       text,     -- SIEX: HoraTratamiento ('HH:MM', opcional)
  add column if not exists variedad               text,     -- variedad de las parcelas tratadas en la campaña del tratamiento
  add column if not exists producto_registro_id   text,     -- IdProducto del Registro MAPA con el que se eligió el producto
  add column if not exists superficie_tratada_ha  jsonb;    -- { "<parcela_id>": hectáreas tratadas (2 decimales) }

-- Identificador propio y estable de cada tratamiento para SIEX (IdAjenaTratamFito).
--  · SIEX lo define como entero de máximo 10 dígitos (number(10)): por eso el maxvalue.
--  · Lo genera la base de datos; el frontend NUNCA lo envía.
--  · Las filas existentes reciben su número automáticamente al añadir la columna.
--  · Nunca se regenera: es independiente de la PK actual (`id`, basada en Date.now()).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tratamientos' and column_name = 'siex_external_id'
  ) then
    alter table public.tratamientos
      add column siex_external_id bigint generated always as identity (maxvalue 9999999999);
  end if;
end $$;

create unique index if not exists idx_tratamientos_siex_external_id
  on public.tratamientos (siex_external_id);

-- Comprobación rápida (debe devolver 6 filas):
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='tratamientos'
--    and column_name in ('fecha_fin','hora_tratamiento','variedad','producto_registro_id','superficie_tratada_ha','siex_external_id');
