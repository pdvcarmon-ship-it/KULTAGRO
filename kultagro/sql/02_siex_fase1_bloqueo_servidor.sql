-- =============================================================================
-- KULTAGRO × SIEX — Fase 1 · Bloqueo de edición en el SERVIDOR (OPCIONAL)
--
-- Regla: un tratamiento fitosanitario enviable (tipo Herbicida/Fungicida/Insecticida/Regulador
-- con nº de registro) creado a partir de la fecha de activación:
--   · se puede editar y borrar durante los primeros 20 días desde su creación (created_at),
--   · pasados 20 días queda bloqueado, y a los 30 días lo envía el proceso automático a SIEX.
--
-- El frontend ya aplica esta regla en pantalla (lib/siex.ts), pero un bloqueo solo en el
-- navegador se puede saltar, porque el frontend escribe directamente en Supabase. Este trigger
-- lo hace cumplir en la base de datos.
--
-- ACTIVACIÓN: la regla está DESACTIVADA hasta que se inserte la fecha de activación:
--     insert into public.siex_config (clave, valor) values ('bloqueo_desde', '2026-10-01')
--       on conflict (clave) do update set valor = excluded.valor;
-- Debe coincidir con la variable del frontend NEXT_PUBLIC_SIEX_BLOQUEO_DESDE. Solo se bloquean los
-- tratamientos creados a partir de esa fecha, para no bloquear de golpe el histórico.
--
-- IMPORTANTE para el futuro proceso de envío: este trigger también afecta a la clave de
-- servicio. Cuando exista el job de sincronización con SIEX (Fase 3+) que actualice el estado de
-- envío de tratamientos bloqueados, habrá que añadir esas columnas a la lista de exclusiones.
-- =============================================================================

create table if not exists public.siex_config (
  clave text primary key,
  valor text not null
);
alter table public.siex_config enable row level security;  -- sin políticas: solo accesible con clave de servicio / SQL editor

create or replace function public.siex_bloqueo_tratamientos()
returns trigger
language plpgsql
as $$
declare
  desde date;
begin
  select valor::date into desde from public.siex_config where clave = 'bloqueo_desde';
  if desde is null then
    return coalesce(new, old);                    -- regla desactivada
  end if;

  if old.tipo in ('Herbicida', 'Fungicida', 'Insecticida', 'Regulador de crecimiento')
     and coalesce(old.num_registro, '') <> ''
     and old.created_at >= desde
     and now() >= old.created_at + interval '20 days' then

    -- Las horas de trabajo no forman parte de lo que se envía a SIEX: se siguen pudiendo registrar.
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'horas_trabajadas' - 'horas_personal_id')
         = (to_jsonb(old) - 'horas_trabajadas' - 'horas_personal_id') then
      return new;
    end if;

    raise exception 'Tratamiento bloqueado: pasaron más de 20 días desde su creación y se enviará automáticamente a SIEX a los 30 días.'
      using errcode = 'P0001';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_siex_bloqueo_tratamientos on public.tratamientos;
create trigger trg_siex_bloqueo_tratamientos
  before update or delete on public.tratamientos
  for each row execute function public.siex_bloqueo_tratamientos();
