# SIEX Fase 1 — puesta en marcha

Orden de despliegue (importante):

1. **Base de datos** — ejecutar `01_siex_fase1_columnas.sql` en el SQL editor de Supabase.
   Añade columnas a `tratamientos`. El frontend nuevo las escribe al guardar; si se despliega antes,
   guardar un tratamiento fallará.
2. **Backend** (`BACK-V30`) — desplegar el `main.py` nuevo (estado real de los productos del registro MAPA).
3. **Frontend** — desplegar. Sin más configuración, la regla de plazos (20/30 días) queda **desactivada**.
4. **Activar la regla de plazos** (cuando se decida):
   - frontend: variable de entorno `NEXT_PUBLIC_SIEX_BLOQUEO_DESDE=2026-10-01` (fecha ISO)
   - base de datos (recomendado): ejecutar `02_siex_fase1_bloqueo_servidor.sql` e insertar la **misma** fecha:
     `insert into public.siex_config (clave, valor) values ('bloqueo_desde','2026-10-01') on conflict (clave) do update set valor = excluded.valor;`
   - Solo se bloquean los tratamientos fitosanitarios **creados a partir de esa fecha** (el histórico no se toca).

Reglas de datos en `app/lib/siex.ts` (sin dependencias, con la lógica pura de longitudes, obligatoriedad y plazos).
