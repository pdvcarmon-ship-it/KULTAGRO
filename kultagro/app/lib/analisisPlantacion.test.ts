import { describe, it, expect } from 'vitest'
import { analizarPlantacion, validarParams, poligonosDeGeojson } from './analisisPlantacion'

// Rectángulo de ancho×alto metros cerca del ecuador (1° lon ≈ 111320 m, 1° lat ≈ 110574 m)
const rect = (w: number, h: number) => {
  const dx = w / 111320, dy = h / 110574
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [dx, 0], [dx, dy], [0, dy], [0, 0]]] } }
}
const P = { distArboles: 5, distLineas: 5, cabecera: 10, lateral: 5 }

describe('analizarPlantacion', () => {
  it('rechaza parámetros no válidos', () => {
    expect(validarParams({ ...P, distArboles: 0 })).toMatch(/entre árboles/)
    expect(validarParams({ ...P, caminoMaxLinea: 30 })).toMatch(/ancho del camino/)
    expect(validarParams({ ...P, caminoMaxLinea: 30, caminoAncho: 6 })).toBeNull()
  })

  it('devuelve las 4 orientaciones y la superficie', () => {
    const r = analizarPlantacion(rect(100, 60), P)
    expect(r.orientaciones.map(o => o.angulo)).toEqual([0, 45, 90, 135])
    expect(r.supHa).toBeGreaterThan(0.59); expect(r.supHa).toBeLessThan(0.61)
  })

  it('elige las líneas largas cuando la cabecera es mayor que el lateral', () => {
    // 100 m (E-O) × 60 m (N-S). Líneas E-O: 17 árboles × 11 líneas ≈ 187. Líneas N-S: 9 × 19 ≈ 171.
    const r = analizarPlantacion(rect(100, 60), P)
    expect(r.orientaciones[r.mejor].angulo).toBe(90)
    const eo = r.orientaciones.find(o => o.angulo === 90)!
    const ns = r.orientaciones.find(o => o.angulo === 0)!
    expect(eo.arboles).toBeGreaterThanOrEqual(170); expect(eo.arboles).toBeLessThanOrEqual(187)
    expect(eo.arboles).toBeGreaterThan(ns.arboles)
    expect(eo.puntos.length).toBe(eo.arboles * 2)
  })

  it('ningún árbol queda a menos de la cabecera/lateral de la linde', () => {
    const r = analizarPlantacion(rect(100, 60), P)
    const eo = r.orientaciones.find(o => o.angulo === 90)!
    for (let i = 0; i < eo.puntos.length; i += 2) {
      const y = eo.puntos[i] * 110574, x = eo.puntos[i + 1] * 111320
      expect(x).toBeGreaterThanOrEqual(10 - 0.05); expect(x).toBeLessThanOrEqual(90 + 0.05) // cabecera 10 m (E-O)
      expect(y).toBeGreaterThanOrEqual(5 - 0.05); expect(y).toBeLessThanOrEqual(55 + 0.05)  // lateral 5 m (N-S)
    }
  })

  it('caminos: ninguna línea supera la longitud máxima y el camino queda libre de árboles', () => {
    const r = analizarPlantacion(rect(200, 40), { ...P, caminoMaxLinea: 50, caminoAncho: 6 })
    const eo = r.orientaciones.find(o => o.angulo === 90)!
    expect(eo.caminos).toBeGreaterThanOrEqual(2)
    expect(eo.caminosGeo.length).toBe(eo.caminos)
    // agrupa por línea (misma latitud) y recorre los árboles de oeste a este
    const filas = new Map<string, number[]>()
    for (let i = 0; i < eo.puntos.length; i += 2) {
      const k = (eo.puntos[i] * 110574).toFixed(2)
      if (!filas.has(k)) filas.set(k, [])
      filas.get(k)!.push(eo.puntos[i + 1] * 111320)
    }
    expect(filas.size).toBeGreaterThan(3)
    filas.forEach(xs => {
      xs.sort((a, b) => a - b)
      let inicio = xs[0]
      for (let i = 1; i < xs.length; i++) {
        const salto = xs[i] - xs[i - 1]
        if (salto > 5 + 0.05) { expect(salto).toBeGreaterThanOrEqual(6 - 0.05); inicio = xs[i] } // hueco = camino
        else expect(xs[i] - inicio).toBeLessThanOrEqual(50 + 0.05)                               // tramo ≤ máximo
      }
    })
  })

  it('con caminos caben menos árboles que sin ellos', () => {
    const sin = analizarPlantacion(rect(200, 40), P).orientaciones.find(o => o.angulo === 90)!
    const con = analizarPlantacion(rect(200, 40), { ...P, caminoMaxLinea: 50, caminoAncho: 6 }).orientaciones.find(o => o.angulo === 90)!
    expect(con.arboles).toBeLessThan(sin.arboles)
  })

  it('respeta huecos y une recintos contiguos', () => {
    const dx = 100 / 111320, dy = 60 / 110574
    const dosMitades = { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [dx / 2, 0], [dx / 2, dy], [0, dy], [0, 0]]] } },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[dx / 2, 0], [dx, 0], [dx, dy], [dx / 2, dy], [dx / 2, 0]]] } },
    ] }
    const unida = analizarPlantacion(dosMitades, P).orientaciones.find(o => o.angulo === 90)!.arboles
    const entera = analizarPlantacion(rect(100, 60), P).orientaciones.find(o => o.angulo === 90)!.arboles
    expect(Math.abs(unida - entera)).toBeLessThanOrEqual(12) // se tratan como una sola parcela
    expect(poligonosDeGeojson(dosMitades)).toHaveLength(2)
  })
})
