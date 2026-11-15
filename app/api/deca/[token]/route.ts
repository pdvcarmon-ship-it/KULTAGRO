// app/api/deca/[token]/route.ts
//
// Enlace público del DeCA (el que lleva el código QR). Resolución de 5 de junio de 2026:
//   - https (lo garantiza el despliegue) y al invocarla se DESCARGA directamente el PDF:
//     sin login, sin página intermedia ni botones.
//   - El enlace no puede caducar antes de que termine el servicio; pasados 7 días naturales
//     desde el fin del servicio se puede desactivar (aquí se hace, ver enlaceVigente).
//
// La URL no se puede adivinar (token de 256 bits). El PDF está en un bucket privado y solo
// se lee aquí, con la service role key. Los datos siguen disponibles para el cargador y el
// transportista desde la app durante el año de conservación, aunque el enlace público se desactive.

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '../../../lib/supabaseAdmin'
import { TOKEN_REGEX, enlaceVigente, nombreArchivoDeca } from '../../../lib/deca'

export const dynamic = 'force-dynamic'

const respuestaTexto = (mensaje: string, status: number) =>
  new Response(mensaje, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token
  if (!TOKEN_REGEX.test(token)) return respuestaTexto('Documento no encontrado.', 404)

  const { data: fila, error } = await supabaseAdmin
    .from('decas')
    .select('pdf_path, fecha_fin_servicio, datos')
    .eq('token', token)
    .maybeSingle()

  if (error) {
    console.error('[deca] Error consultando el DeCA:', error)
    return respuestaTexto('No se ha podido recuperar el documento. Inténtalo de nuevo.', 500)
  }
  if (!fila || !fila.pdf_path) return respuestaTexto('Documento no encontrado.', 404)

  if (!enlaceVigente(fila.fecha_fin_servicio)) {
    return respuestaTexto('Este enlace ya no está activo: han pasado más de 7 días desde el fin del servicio.', 410)
  }

  const { data: blob, error: errDescarga } = await supabaseAdmin.storage.from('decas').download(fila.pdf_path)
  if (errDescarga || !blob) {
    console.error('[deca] Error descargando el PDF:', errDescarga)
    return respuestaTexto('No se ha podido recuperar el documento. Inténtalo de nuevo.', 500)
  }

  const bytes = await blob.arrayBuffer()
  const nombre = nombreArchivoDeca({
    fechaTransporte: fila.datos?.fechaTransporte || '',
    matriculaVehiculo: fila.datos?.matriculaVehiculo || '',
  })
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nombre}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
