import { describe, it, expect } from 'vitest'
import { pestanaConAcceso, moduloVisible, primeraPestanaDisponible, PESTANAS_CONFIGURABLES, PESTANAS_DE_MODULO } from './accesoPestanas'
import { CATALOGO_PERMISOS } from './permisos'

describe('acceso a pestañas por cuenta', () => {
  it('sin pestañas bloqueadas todo está disponible', () => {
    PESTANAS_CONFIGURABLES.forEach(p => expect(pestanaConAcceso(p, [])).toBe(true))
  })
  it('una pestaña bloqueada deja de estar disponible y las demás no', () => {
    expect(pestanaConAcceso('stock', ['stock'])).toBe(false)
    expect(pestanaConAcceso('riego', ['stock'])).toBe(true)
  })
  it('el módulo de permisos de una pestaña bloqueada desaparece de la lista de permisos', () => {
    expect(moduloVisible('Stock', ['stock'])).toBe(false)
    expect(moduloVisible('Riego', ['stock'])).toBe(true)
  })
  it('Parcelas sigue visible mientras el mapa o la plantación lo usen; desaparece si se quitan todas', () => {
    expect(moduloVisible('Parcelas', ['mis_parcelas'])).toBe(true)
    expect(moduloVisible('Parcelas', ['mis_parcelas', 'plantacion'])).toBe(true) // el mapa sigue
    expect(moduloVisible('Parcelas', ['mapa', 'mis_parcelas', 'plantacion'])).toBe(false)
  })
  it('todos los módulos del catálogo de permisos tienen pestañas asociadas', () => {
    const modulos = Array.from(new Set(CATALOGO_PERMISOS.map(p => p.modulo)))
    modulos.forEach(m => expect(PESTANAS_DE_MODULO[m], `falta el módulo "${m}"`).toBeDefined())
  })
  it('primera pestaña disponible para sacar al usuario de una bloqueada', () => {
    const orden = ['mapa', 'mis_parcelas', 'stock']
    expect(primeraPestanaDisponible(orden, p => p !== 'mapa')).toBe('mis_parcelas')
    expect(primeraPestanaDisponible(orden, () => false)).toBeNull()
  })
})
