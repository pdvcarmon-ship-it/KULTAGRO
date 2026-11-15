# SIEX Fase 2 — catálogos: puesta en marcha

Orden de despliegue (importante, y **después** de lo ya desplegado en la Fase 1):

1. **Base de datos**, en este orden:
   - `sql/03_siex_fase2_catalogos.sql` — crea la tabla `siex_catalogos` y su índice de búsqueda.
   - Cargar los catálogos con el importador del backend (ver más abajo). **Sin esto, el paso siguiente enlazaría 0 parcelas.**
   - `sql/04_siex_fase2_datos_kampo.sql` — añade `cultivo_codigo`/`variedad_codigo` a `parcelas`, `historico_cultivos_parcela` y `tratamientos`, y enlaza las parcelas cuyo cultivo/variedad coincide EXACTAMENTE con el catálogo. Las que no coinciden ("Trigo", "Viñedo"...) quedan sin código: el usuario las enlaza al editarlas.
2. **Backend**: no hay cambios de despliegue (el importador se ejecuta aparte, no es parte de la API).
3. **Frontend**: desplegar `app/page.tsx`, `app/lib/catalogos.ts` y `app/components/CatalogoAutocomplete.tsx` / `CultivoVariedadInput.tsx`. **Si se despliega antes de cargar los catálogos, el formulario de parcelas no dejará guardar ningún cultivo** (el catálogo estaría vacío).

## Cargar los catálogos (`siex_catalogos.py`)

```bash
cd backend
pip install -r requirements.txt
export DATABASE_URL="postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres"   # conexión directa a Postgres, no la URL de la API de Supabase

# Carga inicial, desde los 14 ficheros xlsx que ya tenéis:
python siex_catalogos.py --xlsx /ruta/a/los/catalogos

# Actualización periódica (cron, ej. semanal) contra el portal público del FEGA:
python siex_catalogos.py --api

# Solo un catálogo:
python siex_catalogos.py --api --solo REGULADORES_CRECIMIENTO

# Analizar sin escribir nada:
python siex_catalogos.py --xlsx /ruta/a/los/catalogos --dry-run
```

**Catálogos que faltan por cargar (no vienen en los ficheros xlsx, solo por `--api`):**
`REGULADORES_CRECIMIENTO`, `TIPO_MEDIDA_FITOSANITARIA`, `TIPO_COBERTURA_SUELO`, `SUST_ACTIVAS`, `TIPENERGIA`, `CAPACITACION_PROFESIONAL`, `COMUNIDAD_AUTONOMA`. **Mientras no se ejecuten con `--api`, la categoría "Reguladores de crecimiento" del formulario de tratamientos aparecerá vacía** (no es un error: el catálogo no está cargado). El modo `--api` se ha probado contra un portal simulado, no contra el FEGA real; conviene probarlo primero con `--dry-run` o con `--solo` sobre un catálogo antes de la carga completa.

El script nunca borra nada: lo que desaparece del fichero oficial se marca `activo = false`. Se puede volver a ejecutar tantas veces como haga falta.
