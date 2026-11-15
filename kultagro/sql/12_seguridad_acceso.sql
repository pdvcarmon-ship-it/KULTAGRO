-- Endurecimiento de acceso y enlaces públicos. Ejecutar en el SQL Editor de Supabase (se puede repetir).
--
--  1) Límite de peticiones (rate limit) para las rutas públicas: /api/acceso-trabajador y /api/deca/[token].
--  2) Código de activación para el PRIMER acceso de un trabajador: antes bastaba con el email de la empresa
--     y el DNI, así que cualquiera que los conociera podía fijar la contraseña antes que el trabajador.

-- 1) Contadores por clave y ventana de tiempo. Solo accesible con la service role key (RLS sin políticas).
create table if not exists public.rate_limit (
  clave          text primary key,
  contador       integer not null default 0,
  ventana_inicio timestamptz not null default now()
);
alter table public.rate_limit enable row level security;

-- Devuelve true si la petición está permitida. Atómica: un solo INSERT ... ON CONFLICT.
create or replace function public.rate_limit_hit(p_clave text, p_max integer, p_ventana_seg integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contador integer;
begin
  insert into public.rate_limit as r (clave, contador, ventana_inicio)
  values (p_clave, 1, now())
  on conflict (clave) do update set
    contador       = case when r.ventana_inicio < now() - make_interval(secs => p_ventana_seg) then 1 else r.contador + 1 end,
    ventana_inicio = case when r.ventana_inicio < now() - make_interval(secs => p_ventana_seg) then now() else r.ventana_inicio end
  returning contador into v_contador;

  -- Limpieza ocasional de claves antiguas.
  if random() < 0.01 then
    delete from public.rate_limit where ventana_inicio < now() - interval '1 day';
  end if;

  return v_contador <= p_max;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- 2) Código de activación (solo se guarda su hash SHA-256 y su caducidad).
alter table public.personal add column if not exists codigo_activacion_hash text;
alter table public.personal add column if not exists codigo_activacion_caduca timestamptz;
