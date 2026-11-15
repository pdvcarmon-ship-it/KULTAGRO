// lib/rateLimit.ts  (solo servidor)
//
// Límite de peticiones para rutas públicas, apoyado en la función `rate_limit_hit` de Supabase
// (sql/12_seguridad_acceso.sql). Un contador en memoria no serviría en Vercel: cada petición puede
// caer en una instancia distinta.
//
// Si el límite no se puede consultar (p. ej. todavía no se ha ejecutado el SQL), la petición se PERMITE
// y se registra el error: es preferible no cortar un DeCA en plena inspección ni el login de la gente.

import { supabaseAdmin } from './supabaseAdmin'

export const limitar = async (clave: string, max: number, ventanaSeg: number): Promise<boolean> => {
  try {
    const { data, error } = await supabaseAdmin.rpc('rate_limit_hit', { p_clave: clave, p_max: max, p_ventana_seg: ventanaSeg })
    if (error) { console.error('[rateLimit] No se pudo comprobar el límite:', error.message); return true }
    return data !== false
  } catch (e) {
    console.error('[rateLimit] Error comprobando el límite:', e)
    return true
  }
}

export const ipDe = (req: { headers: { get(n: string): string | null } }): string =>
  (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'desconocida'
