// lib/codigoActivacion.ts
//
// Código de activación del PRIMER acceso de un trabajador. La empresa lo genera al pulsar «Habilitar acceso»,
// se lo entrega al trabajador, y el servidor lo exige (una sola vez, con caducidad) para crear la contraseña.
// En base de datos solo se guarda el hash SHA-256 y la caducidad.

// Sin caracteres que se confunden (0/O, 1/I/L). 31 símbolos x 12 posiciones ≈ 59 bits.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const LONGITUD_CODIGO = 12
export const DIAS_VALIDEZ_CODIGO = 7

export const generarCodigo = (): string => {
  let codigo = ''
  const limite = 256 - (256 % ALFABETO.length) // descarta valores que sesgarían el reparto
  while (codigo.length < LONGITUD_CODIGO) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      if (b < limite && codigo.length < LONGITUD_CODIGO) codigo += ALFABETO[b % ALFABETO.length]
    }
  }
  return codigo
}

// Quita guiones y espacios y pasa a mayúsculas: «abcd-efgh-jkmn» == «ABCDEFGHJKMN».
export const normalizarCodigo = (v: string): string => (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Para mostrarlo en grupos de 4: XXXX-XXXX-XXXX.
export const formatearCodigo = (v: string): string => normalizarCodigo(v).replace(/(.{4})(?=.)/g, '$1-')

export const hashCodigo = async (codigo: string): Promise<string> => {
  const datos = new TextEncoder().encode(normalizarCodigo(codigo))
  const resumen = await crypto.subtle.digest('SHA-256', datos)
  return Array.from(new Uint8Array(resumen)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export const caducidadCodigo = (ahora: Date = new Date()): Date =>
  new Date(ahora.getTime() + DIAS_VALIDEZ_CODIGO * 24 * 60 * 60 * 1000)
