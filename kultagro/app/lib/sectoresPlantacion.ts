// Zonas dentro de una parcela para el análisis de plantación: zonas de exclusión y sectores.
// Se trabaja en metros sobre un plano local y con operaciones de polígonos (unión, intersección y
// diferencia) para obtener el "dominio": la superficie donde sí se puede plantar. Ese dominio se pasa
// tal cual a analizarPlantacion, que ya respeta cabeceras y laterales también alrededor de los huecos.

import polygonClipping from 'polygon-clipping'
import { poligonosDeGeojson } from './analisisPlantacion'

export type Anillo = [number, number][] // [lon, lat]
type PuntoXY = [number, number]
type MP = any // MultiPolygon de polygon-clipping, en metros

const M_LAT = 110574
const M_LON = 111320

export interface OpcionesDominio {
  sector?: Anillo                                  // contorno dibujado del sector en curso
  sectoresPrevios?: Anillo[]                       // sectores ya terminados (no se pisan)
  caminoAnterior?: { anillo: Anillo; ancho: number } // camino entre el sector anterior y este
  exclusiones?: Anillo[]                           // zonas donde no se planta
}

export interface Dominio {
  geometria: { type: 'MultiPolygon'; coordinates: number[][][][] } // lon/lat
  supHa: number
  camino: number[][][][] | null // polígonos lon/lat del camino entre el sector anterior y este
}

const areaAnillo = (r: PuntoXY[]): number => {
  let s = 0
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1] }
  return Math.abs(s) / 2
}
const areaMP = (mp: any[]): number =>
  mp.reduce((acc: number, poly: PuntoXY[][]) => acc + poly.reduce((a2, ring, i) => a2 + (i === 0 ? areaAnillo(ring) : -areaAnillo(ring)), 0), 0)

// Franja de `ancho` metros alrededor de un contorno: el contorno unido a una "cápsula" por cada lado
// (rectángulo + círculo en cada vértice). Es el contorno engrosado, es decir, la parcela más su orla.
const engrosar = (anillo: PuntoXY[], ancho: number): MP => {
  const circulo = (cx: number, cy: number, n = 24): PuntoXY[] =>
    Array.from({ length: n + 1 }, (_, i) => [cx + ancho * Math.cos((2 * Math.PI * (i % n)) / n), cy + ancho * Math.sin((2 * Math.PI * (i % n)) / n)] as PuntoXY)
  const piezas: any[] = []
  for (let i = 0; i < anillo.length; i++) {
    const A = anillo[i], B = anillo[(i + 1) % anillo.length]
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    const nx = (-dy / len) * ancho, ny = (dx / len) * ancho
    piezas.push([[[A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny], [A[0] - nx, A[1] - ny], [A[0] + nx, A[1] + ny]]])
    piezas.push([circulo(A[0], A[1])])
  }
  return polygonClipping.union([anillo] as any, ...piezas)
}

export const dominioPlantacion = (parcelaGeojson: any, op: OpcionesDominio = {}): Dominio => {
  const polis = poligonosDeGeojson(parcelaGeojson)
  if (!polis.length) throw new Error('La parcela no tiene geometría.')
  const todos = polis.flat(2)
  const lons = todos.map(c => c[0]), lats = todos.map(c => c[1])
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2, lat0 = (Math.min(...lats) + Math.max(...lats)) / 2
  const cos0 = Math.cos((lat0 * Math.PI) / 180)
  const aM = (c: number[]): PuntoXY => [(c[0] - lon0) * M_LON * cos0, (c[1] - lat0) * M_LAT]
  const aG = (p: number[]): number[] => [lon0 + p[0] / (M_LON * cos0), lat0 + p[1] / M_LAT]
  const anilloM = (a: Anillo): PuntoXY[] => a.map(aM)
  const mpAGeo = (mp: any[]): number[][][][] => mp.map((poly: PuntoXY[][]) => poly.map(r => r.map(aG)))

  let dom: MP = polygonClipping.union(...(polis.map(poly => poly.map(r => r.map(aM))) as [any, ...any[]]))
  if (op.sector) dom = polygonClipping.intersection(dom, [anilloM(op.sector)] as any)
  const vacio = (): Dominio => ({ geometria: { type: 'MultiPolygon', coordinates: [] }, supHa: 0, camino: null })
  if (!dom.length) return vacio()

  for (const previo of op.sectoresPrevios || []) {
    dom = polygonClipping.difference(dom, [anilloM(previo)] as any)
    if (!dom.length) return vacio()
  }

  let camino: number[][][][] | null = null
  if (op.caminoAnterior && op.caminoAnterior.ancho > 0) {
    const ring = anilloM(op.caminoAnterior.anillo)
    const orla = polygonClipping.difference(engrosar(ring, op.caminoAnterior.ancho), [ring] as any)
    const zonaCamino = orla.length ? polygonClipping.intersection(dom, orla) : []
    camino = zonaCamino.length ? mpAGeo(zonaCamino) : null
    if (orla.length) dom = polygonClipping.difference(dom, orla)
    if (!dom.length) return { ...vacio(), camino }
  }

  const excl = (op.exclusiones || []).filter(a => a.length >= 3)
  if (excl.length) {
    dom = polygonClipping.difference(dom, ...(excl.map(a => [anilloM(a)]) as [any, ...any[]]))
    if (!dom.length) return { ...vacio(), camino }
  }

  return { geometria: { type: 'MultiPolygon', coordinates: mpAGeo(dom) }, supHa: areaMP(dom) / 10000, camino }
}

// Superficie (ha) de un contorno lon/lat, para mostrarla en listados
export const supHaAnillo = (a: Anillo): number => {
  if (a.length < 3) return 0
  const lat0 = a.reduce((s, c) => s + c[1], 0) / a.length
  const cos0 = Math.cos((lat0 * Math.PI) / 180)
  return areaAnillo(a.map(c => [c[0] * M_LON * cos0, c[1] * M_LAT] as PuntoXY)) / 10000
}

// Centro aproximado de un contorno [lat, lon] (para colocar etiquetas)
export const centroAnillo = (a: Anillo): [number, number] => {
  const n = a.length || 1
  return [a.reduce((s, c) => s + c[1], 0) / n, a.reduce((s, c) => s + c[0], 0) / n]
}
