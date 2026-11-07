import { describe, it, expect } from 'vitest'
import { emparejarReferencias, type RecintoRef } from './sigpac'

const r = (po: string, pa: string, re: string, sup: number, extra: Partial<RecintoRef> = {}): RecintoRef =>
  ({ provincia: '41', municipio: '24', agregado: '0', zona: '0', poligono: po, parcela: pa, recinto: re, supHa: sup, usoSigpac: 'TA', ...extra })

describe('emparejarReferencias', () => {
  it('sin cambios: todas las referencias siguen existiendo', () => {
    const a = [r('13', '139', '1', 0.79), r('13', '138', '3', 9.15)]
    const x = emparejarReferencias(a, [...a])
    expect(x.cambios).toHaveLength(0); expect(x.sinResolver).toHaveLength(0); expect(x.sinCambio).toHaveLength(2)
  })
  it('detecta el cambio de número de parcela con la misma superficie', () => {
    const x = emparejarReferencias([r('13', '139', '1', 0.79)], [r('13', '501', '1', 0.79)])
    expect(x.cambios).toHaveLength(1)
    expect(x.cambios[0].nuevo.parcela).toBe('501')
  })
  it('tolera una pequeña diferencia de superficie (≤5 %)', () => {
    expect(emparejarReferencias([r('13', '139', '1', 10)], [r('13', '501', '1', 10.3)]).cambios).toHaveLength(1)
  })
  it('no empareja si la superficie difiere mucho: queda sin resolver y no se toca', () => {
    const x = emparejarReferencias([r('13', '139', '1', 10)], [r('13', '501', '1', 2)])
    expect(x.cambios).toHaveLength(0); expect(x.sinResolver).toHaveLength(1)
  })
  it('con varios recintos solo cambia el que cambió', () => {
    const a = [r('13', '139', '1', 0.79), r('13', '138', '3', 9.15)]
    const x = emparejarReferencias(a, [r('13', '139', '1', 0.79), r('13', '700', '3', 9.15)])
    expect(x.sinCambio).toHaveLength(1); expect(x.cambios).toHaveLength(1)
    expect(x.cambios[0].antiguo.parcela).toBe('138'); expect(x.cambios[0].nuevo.parcela).toBe('700')
  })
  it('no usa dos veces la misma referencia nueva', () => {
    const x = emparejarReferencias([r('1', '1', '1', 5), r('1', '2', '1', 5)], [r('9', '9', '1', 5)])
    expect(x.cambios).toHaveLength(1); expect(x.sinResolver).toHaveLength(1)
  })
})
