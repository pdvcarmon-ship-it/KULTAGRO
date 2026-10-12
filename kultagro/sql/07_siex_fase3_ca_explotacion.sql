-- =============================================================================
-- GES/KULTAGRO × SIEX — Fase 3 · Código de organismo pagador (CAExplotacion)
-- Ejecutar en Supabase. Idempotente.
--
-- No hay catálogo disponible para este código (a diferencia de cultivo, variedad, etc.): la
-- documentación del FEGA solo dice "validar contra la lista de valores del Organismo Pagador",
-- sin publicar esa lista en los catálogos xlsx entregados. Por eso es un campo de texto libre de
-- 2 caracteres en GES, no un desplegable — hay que confirmar el código correcto con el FEGA/Junta
-- (Punto 0). Si todas las explotaciones de Kultagro están en la misma comunidad autónoma, es
-- previsible que el valor sea el mismo para todas las fincas.
-- =============================================================================

alter table public.fincas
  add column if not exists ca_explotacion text;   -- 2 caracteres (SIEX: CAExplotacion)

-- Comprobación rápida:
-- select id, nombre, nif, ca_explotacion from public.fincas where nif is not null;
