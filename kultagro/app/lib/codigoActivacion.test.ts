// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { generarCodigo, normalizarCodigo, formatearCodigo, hashCodigo, caducidadCodigo, LONGITUD_CODIGO } from './codigoActivacion'

describe('código de activación', () => {
  it('genera 12 caracteres sin símbolos ambiguos y distintos cada vez', () => {
    const a = generarCodigo(); const b = generarCodigo()
    expect(a).toHaveLength(LONGITUD_CODIGO)
    expect(a).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]+$/)
    expect(a).not.toBe(b)
  })
  it('normaliza y formatea', () => {
    expect(normalizarCodigo(' abcd-efgh jkmn ')).toBe('ABCDEFGHJKMN')
    expect(formatearCodigo('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN')
  })
  it('el hash no depende de mayúsculas ni guiones, y cambia con el código', async () => {
    expect(await hashCodigo('abcd-efgh-jkmn')).toBe(await hashCodigo('ABCDEFGHJKMN'))
    expect(await hashCodigo('ABCDEFGHJKMN')).not.toBe(await hashCodigo('ABCDEFGHJKMP'))
    expect(await hashCodigo('ABCDEFGHJKMN')).toMatch(/^[0-9a-f]{64}$/)
  })
  it('caduca a los 7 días', () => {
    const ahora = new Date('2026-11-15T10:00:00Z')
    expect(caducidadCodigo(ahora).toISOString()).toBe('2026-11-22T10:00:00.000Z')
  })
})
