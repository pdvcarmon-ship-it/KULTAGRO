# DeCA (Documento de Control Administrativo del transporte)

Botón **🚛 CREAR DeCA** en la pestaña COSECHAS (y «Crear DeCA con esta cosecha» dentro de cada cosecha,
que precarga origen, naturaleza y peso).

## Puesta en marcha

1. **Dependencias**: `npm install` (nuevas: `qrcode`, `@types/qrcode`, `pdf-lib`).
2. **Base de datos**: ejecutar `11_deca.sql` en el SQL Editor de Supabase. Crea la tabla `decas` y el bucket
   privado `decas`. ⚠️ Revisa las políticas RLS del fichero: dan acceso a cada usuario a sus propios DeCA
   (`user_id = auth.uid()`); si los trabajadores comparten datos con la empresa con otra regla, usa la misma.
3. **Variables de entorno** (Vercel):
   - `SUPABASE_SERVICE_ROLE_KEY` — ya la usa `acceso-trabajador`; la necesita también el enlace público.
   - `NEXT_PUBLIC_APP_URL` — dirección **https** de la app (p. ej. `https://kultagro.vercel.app`). Si no se pone,
     se usa el dominio desde el que se abre la app. Es la base de la URL que va dentro del QR.
4. **Permiso**: el nuevo permiso «Crear y consultar DeCA» (módulo Cosechas) lo tiene el dueño, y los roles
   empresa / encargado / ingeniero al crearlos. A los trabajadores que ya existen hay que activárselo en PERMISOS.

## Cómo cumple la Resolución de 5 de junio de 2026

| Requisito | Dónde |
|---|---|
| Contenido mínimo (art. 6 Orden FOM/2861/2012) | `app/lib/deca.ts` (validación) y formulario |
| PDF nativo, < 5 MB | `app/lib/decaPdf.ts` (texto vectorial, ~20 KB; el bucket limita a 5 MB) |
| Fecha y hora de creación y modificación como metadatos del PDF | `decaPdf.ts` (`CreationDate` / `ModDate`) |
| El sistema registra la fecha de creación (anterior al inicio del servicio) | `decas.creado_en` / `modificado_en` (servidor); no se admite fecha de transporte pasada |
| QR con la URL única dentro del PDF | `decaPdf.ts` |
| URL https que descarga el PDF directamente, sin login | `app/api/deca/[token]/route.ts` |
| Enlace activo hasta el fin del servicio; desactivable a los 7 días | `enlaceVigente()` en `deca.ts` |
| Conservación mínima de 1 año | No hay política de borrado: la app no permite eliminar un DeCA |
| Corrección de datos | «Generados → Duplicar» crea un PDF nuevo (nueva URL y QR) y conserva el original |

## Fuera de alcance (de momento)

- Varios envíos en un mismo DeCA (solo si cargador y transportista coinciden).
- Editar el mismo PDF marcando los datos antiguos como no válidos (se usa la otra vía permitida: PDF nuevo).
- Firma electrónica (solo es obligatoria si el DeCA se usa también con fin contractual).
- Esquema eFTI (Reglamento UE 2020/1056).
