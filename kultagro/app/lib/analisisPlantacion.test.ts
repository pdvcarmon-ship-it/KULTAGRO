import { describe, it, expect } from 'vitest'
import { analizarPlantacion, validarParams, poligonosDeGeojson, normalizarRumbo, nombreRumbo, azimutLineas } from './analisisPlantacion'

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

describe('rumbo de la brújula', () => {
  it('normaliza y convierte el rumbo en azimut de líneas (0–179°)', () => {
    expect(normalizarRumbo(-90)).toBe(270)
    expect(normalizarRumbo(360)).toBe(0)
    expect(azimutLineas(200)).toBe(20)
    expect(azimutLineas(90)).toBe(90)
    expect(azimutLineas(270)).toBe(90)
  })
  it('da nombre a la dirección', () => {
    expect(nombreRumbo(0)).toBe('N')
    expect(nombreRumbo(90)).toBe('E')
    expect(nombreRumbo(225)).toBe('SO')
    expect(nombreRumbo(359)).toBe('N')
  })
  it('admite un ángulo cualquiera y rumbos opuestos dan el mismo resultado', () => {
    const a = analizarPlantacion(rect(200, 40), P, [azimutLineas(20)]).orientaciones[0]
    const b = analizarPlantacion(rect(200, 40), P, [azimutLineas(200)]).orientaciones[0]
    expect(a.arboles).toBe(b.arboles)
    expect(a.arboles).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Cabeceras pintadas, zonas de exclusión y sectores
// ---------------------------------------------------------------------------------------------
import { dominioPlantacion, cortarConLinea } from './sectoresPlantacion'

const M = (lon: number, lat: number) => [lon * 111320, lat * 110574]
const areaRingM = (ring: number[][]) => { let s = 0; for (let i = 0; i < ring.length; i++) { const a = M(ring[i][0], ring[i][1]), b = M(ring[(i + 1) % ring.length][0], ring[(i + 1) % ring.length][1]); s += a[0] * b[1] - b[0] * a[1] } return Math.abs(s) / 2 }
const areaMPm2 = (mp: number[][][][]) => mp.reduce((acc, poly) => acc + poly.reduce((a, r, i) => a + (i === 0 ? areaRingM(r) : -areaRingM(r)), 0), 0)
const cuadro = (x0: number, y0: number, x1: number, y1: number) => [[x0 / 111320, y0 / 110574], [x1 / 111320, y0 / 110574], [x1 / 111320, y1 / 110574], [x0 / 111320, y1 / 110574], [x0 / 111320, y0 / 110574]] as [number, number][]

describe('cabeceras', () => {
  it('las franjas de cabecera ocupan el ancho de la cabecera en cada extremo de línea', () => {
    const eo = analizarPlantacion(rect(100, 60), P).orientaciones.find(o => o.angulo === 90)!
    // líneas E-O: cabecera de 10 m en el extremo este y en el oeste, a lo largo de los 60 m de ancho
    const area = eo.cabecerasGeo.reduce((a, ring) => a + areaRingM(ring.map(([la, lo]) => [lo, la])), 0)
    expect(area).toBeGreaterThan(2 * 10 * 60 * 0.98); expect(area).toBeLessThan(2 * 10 * 60 * 1.02)
  })
  it('sin cabecera no hay franjas, y se pueden omitir al probar muchos ángulos', () => {
    expect(analizarPlantacion(rect(100, 60), { ...P, cabecera: 0 }).orientaciones[0].cabecerasGeo).toHaveLength(0)
    expect(analizarPlantacion(rect(100, 60), P, [90], false).orientaciones[0].cabecerasGeo).toHaveLength(0)
  })
})

describe('zonas de exclusión', () => {
  const parcela = rect(100, 60)
  it('el dominio es la parcela menos la zona excluida, aunque se salga de la parcela', () => {
    const d = dominioPlantacion(parcela, { exclusiones: [cuadro(40, 20, 60, 40)] })
    expect(areaMPm2(d.geometria.coordinates)).toBeGreaterThan((6000 - 400) * 0.99); expect(areaMPm2(d.geometria.coordinates)).toBeLessThan((6000 - 400) * 1.01)
    const fuera = dominioPlantacion(parcela, { exclusiones: [cuadro(80, 40, 140, 100)] }) // solo 20×20 cae dentro
    expect(areaMPm2(fuera.geometria.coordinates)).toBeGreaterThan((6000 - 400) * 0.99); expect(areaMPm2(fuera.geometria.coordinates)).toBeLessThan((6000 - 400) * 1.01)
  })
  it('no hay árboles dentro y se respetan cabeceras y laterales alrededor', () => {
    const d = dominioPlantacion(parcela, { exclusiones: [cuadro(40, 20, 60, 40)] })
    const eo = analizarPlantacion(d.geometria, P).orientaciones.find(o => o.angulo === 90)!
    expect(eo.arboles).toBeGreaterThan(100)
    for (let i = 0; i < eo.puntos.length; i += 2) {
      const y = eo.puntos[i] * 110574, x = eo.puntos[i + 1] * 111320 // el centro de la parcela está en (50,30) m, el plano de la prueba parte de (0,0)
      // zona excluida (40..60, 20..40): a menos de la cabecera (10 m) en el sentido de la línea, solo vale si la línea queda a ≥ lateral (5 m)
      const enBandaX = x > 40 - 10 + 0.1 && x < 60 + 10 - 0.1
      if (enBandaX) expect(y <= 20 - 5 + 0.1 || y >= 40 + 5 - 0.1).toBe(true)
    }
  })
  it('con una zona excluida caben menos árboles', () => {
    const sin = analizarPlantacion(parcela, P, [90]).orientaciones[0].arboles
    const con = analizarPlantacion(dominioPlantacion(parcela, { exclusiones: [cuadro(40, 20, 60, 40)] }).geometria, P, [90]).orientaciones[0].arboles
    expect(con).toBeLessThan(sin)
  })
})

describe('sectores', () => {
  const parcela = rect(100, 60)
  const mitadOeste = cuadro(-10, -10, 50, 70) // se sale de la parcela: se recorta
  const mitadEste = cuadro(50, -10, 110, 70)
  it('el sector se recorta a la parcela', () => {
    const a = dominioPlantacion(parcela, { sector: mitadOeste })
    expect(areaMPm2(a.geometria.coordinates)).toBeGreaterThan(3000 * 0.99); expect(areaMPm2(a.geometria.coordinates)).toBeLessThan(3000 * 1.01)
  })
  it('el siguiente sector no pisa al anterior y, si hay camino, deja su ancho libre', () => {
    const sinCamino = dominioPlantacion(parcela, { sector: mitadEste, sectoresPrevios: [mitadOeste] })
    expect(areaMPm2(sinCamino.geometria.coordinates)).toBeGreaterThan(3000 * 0.99)
    const conCamino = dominioPlantacion(parcela, { sector: mitadEste, sectoresPrevios: [mitadOeste], caminoAnterior: { geom: mitadOeste, ancho: 6 } })
    expect(areaMPm2(conCamino.geometria.coordinates)).toBeGreaterThan((3000 - 360) * 0.98); expect(areaMPm2(conCamino.geometria.coordinates)).toBeLessThan((3000 - 360) * 1.02)
    expect(conCamino.camino).not.toBeNull()
    expect(areaMPm2(conCamino.camino!)).toBeGreaterThan(360 * 0.98); expect(areaMPm2(conCamino.camino!)).toBeLessThan(360 * 1.02)
  })
  it('cada sector se analiza por separado con su propio marco y dirección', () => {
    const a = analizarPlantacion(dominioPlantacion(parcela, { sector: mitadOeste }).geometria, P, [0]).orientaciones[0]
    const b = analizarPlantacion(dominioPlantacion(parcela, { sector: mitadEste, sectoresPrevios: [mitadOeste] }).geometria, { ...P, distArboles: 4, distLineas: 6 }, [90]).orientaciones[0]
    expect(a.arboles).toBeGreaterThan(20); expect(b.arboles).toBeGreaterThan(20)
    expect(a.angulo).toBe(0); expect(b.angulo).toBe(90)
  })
  it('un sector fuera de la parcela deja el dominio vacío', () => {
    const d = dominioPlantacion(parcela, { sector: cuadro(200, 200, 300, 300) })
    expect(d.supHa).toBe(0); expect(d.geometria.coordinates).toHaveLength(0)
  })
})

describe('recortar la parcela con una línea (como en los sectores de riego)', () => {
  const parcela = rect(100, 60)
  const linea = (pts: number[][]) => pts.map(([x, y]) => [x / 111320, y / 110574] as [number, number])
  const restante = dominioPlantacion(parcela).geometria.coordinates

  it('una línea que cruza la parcela la parte en dos trozos que suman la parcela', () => {
    const r = cortarConLinea(restante, linea([[50, -10], [50, 70]]))
    expect(r.error).toBeUndefined()
    expect(r.piezas).toHaveLength(2)
    const total = r.piezas.reduce((a, p) => a + areaMPm2(p.mp), 0)
    expect(total).toBeGreaterThan(6000 * 0.995); expect(total).toBeLessThanOrEqual(6000)
    r.piezas.forEach(p => { expect(p.supHa).toBeGreaterThan(0.29); expect(p.supHa).toBeLessThan(0.31) })
  })
  it('también corta con una línea quebrada', () => {
    const r = cortarConLinea(restante, linea([[30, -10], [30, 30], [70, 30], [70, 70]]))
    expect(r.piezas).toHaveLength(2)
  })
  it('la línea debe empezar y acabar fuera de la parcela', () => {
    expect(cortarConLinea(restante, linea([[50, 30], [50, 70]])).error).toMatch(/fuera de la parcela/)
    expect(cortarConLinea(restante, linea([[50, -10], [50, 30]])).error).toMatch(/fuera de la parcela/)
  })
  it('una línea que no cruza la parcela no la divide', () => {
    expect(cortarConLinea(restante, linea([[200, -10], [200, 70]])).error).toMatch(/no ha dividido/)
  })
  it('los trozos son los sectores: el segundo es lo que queda tras el primero, sin huecos ni solapes', () => {
    const { piezas } = cortarConLinea(restante, linea([[50, -10], [50, 70]]))
    const oeste = piezas.find(p => p.mp[0][0].every(c => c[0] * 111320 <= 50.1))!
    const resto = dominioPlantacion(parcela, { sectoresPrevios: [oeste.mp] })
    expect(areaMPm2(resto.geometria.coordinates)).toBeGreaterThan(3000 * 0.99)
    // el sector es el propio trozo de parcela: su dominio coincide con él (la plantación no cambia)
    const dom = dominioPlantacion(parcela, { sector: oeste.mp })
    expect(Math.abs(areaMPm2(dom.geometria.coordinates) - areaMPm2(oeste.mp))).toBeLessThan(1)
    // con camino de 6 m, el segundo sector pierde esa franja
    const conCamino = dominioPlantacion(parcela, { sector: resto.geometria.coordinates, sectoresPrevios: [oeste.mp], caminoAnterior: { geom: oeste.mp, ancho: 6 } })
    expect(areaMPm2(conCamino.geometria.coordinates)).toBeGreaterThan((3000 - 360) * 0.98); expect(areaMPm2(conCamino.geometria.coordinates)).toBeLessThan((3000 - 360) * 1.02)
  })
})
