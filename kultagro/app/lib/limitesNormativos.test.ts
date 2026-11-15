import { describe, it, expect } from 'vitest'
import { evaluarAporte, metalesSueloAfectados, aporteMetalesGHa } from './limitesNormativos'
const base = { fechaAplicacion: '2026-05-01', abonoTipo: 'organico' as const, dosisKgHa: 1000, metalesProducto: {}, materiaSecaPct: 100, aporteNKgHa: 0,
  sueloAfectados: [], zonaVulnerable: false, supHa: 5, colindanteMismaExplotacion: false, metodo: '', tecnicaAntierosion: false, historico: [] }
describe('limites', () => {
  it('conversion g/ha', () => { expect(aporteMetalesGHa({ Cu: 500 }, 1000, 100).Cu).toBe(500) })
  it('producto Cd 12 > 10', () => { expect(evaluarAporte({ ...base, metalesProducto: { Cd: 12 } }).some(a => a.tipo === 'producto')).toBe(true) })
  it('producto Cd 5 con suelo afectado > 0.2', () => { expect(evaluarAporte({ ...base, metalesProducto: { Cd: 5 }, sueloAfectados: ['Cd'] }).some(a => a.tipo === 'producto')).toBe(true) })
  it('anual Cu: 100000 kg/ha de 1000 mg/kg => media alta', () => { expect(evaluarAporte({ ...base, dosisKgHa: 30000, metalesProducto: { Cu: 1000 } }).some(a => a.tipo === 'anual')).toBe(true) })
  it('N zona vulnerable 200', () => { expect(evaluarAporte({ ...base, zonaVulnerable: true, aporteNKgHa: 200 }).some(a => a.tipo === 'nitrogeno_zona_vulnerable')).toBe(true) })
  it('N historico 12m suma', () => { expect(evaluarAporte({ ...base, zonaVulnerable: true, aporteNKgHa: 100, historico: [{ fecha: '2026-01-10', metalesGHa: {}, nKgHa: 100, organico: true }] }).length).toBe(1) })
  it('N fuera de 12m no suma', () => { expect(evaluarAporte({ ...base, zonaVulnerable: true, aporteNKgHa: 100, historico: [{ fecha: '2025-01-10', metalesGHa: {}, nKgHa: 100, organico: true }] }).length).toBe(0) })
  it('pendiente 12 plato', () => { expect(evaluarAporte({ ...base, pendienteMedia: 12, metodo: 'plato' }).some(a => a.tipo === 'metodo_pendiente_10')).toBe(true) })
  it('pendiente 12 plato recinto <1ha no colindante: permitido', () => { expect(evaluarAporte({ ...base, supHa: 0.5, pendienteMedia: 12, metodo: 'plato' }).length).toBe(0) })
  it('pendiente 16 inorg zona vuln sin tecnica', () => { expect(evaluarAporte({ ...base, abonoTipo: 'inorganico', zonaVulnerable: true, pendienteMedia: 16 }).some(a => a.tipo === 'metodo_pendiente_15')).toBe(true) })
  it('suelo afectado por pH', () => { expect(metalesSueloAfectados({ Cd: 1.2 }, 6.5).afectados).toEqual(['Cd']); expect(metalesSueloAfectados({ Cd: 1.2 }, 7.5).afectados).toEqual([]); expect(metalesSueloAfectados({ Cd: 1.2 }, undefined).faltaPh).toBe(true) })
})
