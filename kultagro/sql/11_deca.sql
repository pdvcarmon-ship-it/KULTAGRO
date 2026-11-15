-- DeCA (Documento de Control Administrativo del transporte de mercancías por carretera).
-- Ejecutar en el SQL Editor de Supabase. Se puede ejecutar más de una vez.
--
-- Qué crea:
--   * tabla public.decas: un registro por DeCA, con la fecha y hora de creación/modificación
--     que fija el SERVIDOR (la Resolución exige que el sistema las registre).
--   * bucket privado 'decas' en Storage: ahí se guarda el PDF. Nunca es público: el enlace del QR
--     pasa por app/api/deca/[token]/route.ts, que lo sirve y controla la vigencia.
--
-- Conservación: cargador y transportista deben conservar el DeCA al menos 1 año. Por eso NO hay
-- política de borrado: la app no permite eliminar un DeCA.

create table if not exists public.decas (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  token             text not null unique,            -- parte única de la URL del QR (43 car. base64url)
  datos             jsonb not null,                  -- contenido del DeCA (art. 6 de la Orden FOM/2861/2012)
  fecha_transporte  date not null,
  fecha_fin_servicio date not null,                  -- el enlace público no caduca antes de esta fecha (+7 días)
  pdf_path          text,                            -- ruta en el bucket 'decas'
  creado_en         timestamptz not null default now(),
  modificado_en     timestamptz not null default now()
);

create index if not exists decas_user_creado_idx on public.decas (user_id, creado_en desc);

alter table public.decas enable row level security;

-- ⚠️ Estas políticas dan acceso a cada usuario SOLO a sus propios DeCA (user_id = auth.uid()).
-- Si en tu proyecto los trabajadores comparten datos con la empresa mediante otra regla (la que ya
-- usan tablas como `cosechas`), sustituye `user_id = auth.uid()` por esa misma condición.
drop policy if exists decas_select on public.decas;
create policy decas_select on public.decas for select using (user_id = auth.uid());

drop policy if exists decas_insert on public.decas;
create policy decas_insert on public.decas for insert with check (user_id = auth.uid());

drop policy if exists decas_update on public.decas;
create policy decas_update on public.decas for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Bucket privado para los PDF. Ruta: <user_id>/<id>.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('decas', 'decas', false, 5242880, array['application/pdf'])   -- 5 MB, solo PDF (Resolución)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists decas_storage_select on storage.objects;
create policy decas_storage_select on storage.objects for select
  using (bucket_id = 'decas' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists decas_storage_insert on storage.objects;
create policy decas_storage_insert on storage.objects for insert
  with check (bucket_id = 'decas' and (storage.foldername(name))[1] = auth.uid()::text);
