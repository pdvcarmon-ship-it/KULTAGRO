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

// Geometría de un sector: un trozo recortado de la parcela (MultiPolygon lon/lat) o, por compatibilidad, un contorno
export type GeomSector = number[][][][] | Anillo

export interface OpcionesDominio {
  sector?: GeomSector                              // trozo de parcela que es el sector en curso
  sectoresPrevios?: GeomSector[]                   // sectores ya terminados (no se pisan)
  caminoAnterior?: { geom: GeomSector; ancho: number } // camino entre el sector anterior y este
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

// Franja de `ancho` metros alrededor de una figura: la figura unida a una "cápsula" por cada lado
// (rectángulo + círculo en cada vértice). Es la figura engrosada, es decir, la figura más su orla.
const cap = (A: PuntoXY, B: PuntoXY, ancho: number): any[] => {
  const circulo = (cx: number, cy: number, n = 24): PuntoXY[] =>
    Array.from({ length: n + 1 }, (_, i) => [cx + ancho * Math.cos((2 * Math.PI * (i % n)) / n), cy + ancho * Math.sin((2 * Math.PI * (i % n)) / n)] as PuntoXY)
  const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy)
  if (len < 1e-9) return [[circulo(A[0], A[1])]]
  const nx = (-dy / len) * ancho, ny = (dx / len) * ancho
  return [[[[A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny], [A[0] - nx, A[1] - ny], [A[0] + nx, A[1] + ny]]], [circulo(A[0], A[1])]]
}
const engrosar = (mp: MP, ancho: number): MP => {
  const piezas: any[] = []
  for (const poly of mp) for (const ring of poly as PuntoXY[][]) {
    for (let i = 0; i < ring.length; i++) piezas.push(...cap(ring[i], ring[(i + 1) % ring.length], ancho))
  }
  return polygonClipping.union(mp, ...piezas)
}

// Convierte la geometría de un sector (trozo o contorno) a MultiPolygon en metros
const esAnillo = (g: any): g is Anillo => Array.isArray(g) && g.length > 0 && typeof g[0][0] === 'number'

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
  const sectorM = (g: GeomSector): MP => (esAnillo(g) ? [[anilloM(g)]] : (g as number[][][][]).map(poly => poly.map(r => r.map(aM))))
  const mpAGeo = (mp: any[]): number[][][][] => mp.map((poly: PuntoXY[][]) => poly.map(r => r.map(aG)))

  let dom: MP = polygonClipping.union(...(polis.map(poly => poly.map(r => r.map(aM))) as [any, ...any[]]))
  if (op.sector) dom = polygonClipping.intersection(dom, sectorM(op.sector))
  const vacio = (): Dominio => ({ geometria: { type: 'MultiPolygon', coordinates: [] }, supHa: 0, camino: null })
  if (!dom.length) return vacio()

  for (const previo of op.sectoresPrevios || []) {
    dom = polygonClipping.difference(dom, sectorM(previo))
    if (!dom.length) return vacio()
  }

  let camino: number[][][][] | null = null
  if (op.caminoAnterior && op.caminoAnterior.ancho > 0) {
    const previoM = sectorM(op.caminoAnterior.geom)
    const orla = polygonClipping.difference(engrosar(previoM, op.caminoAnterior.ancho), previoM)
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


// ---------------------------------------------------------------------------------------------
// Recortar lo que queda de la parcela con una línea (como en los sectores de riego)
// ---------------------------------------------------------------------------------------------

export interface PiezaCorte { mp: number[][][][]; supHa: number } // trozo (MultiPolygon lon/lat) y su superficie

const puntoEnMP = (p: PuntoXY, mp: MP): boolean => {
  let dentro = false
  for (const poly of mp as PuntoXY[][][]) for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro
    }
  }
  return dentro
}

// `restante` es la parte de la parcela aún sin repartir (MultiPolygon lon/lat) y `linea` la polilínea dibujada
// ([lon, lat]). La línea debe empezar y acabar fuera de la parcela, cruzándola. Devuelve los trozos resultantes.
export const cortarConLinea = (restante: number[][][][], linea: [number, number][]): { piezas: PiezaCorte[]; error?: string } => {
  if (!restante.length) return { piezas: [], error: 'No queda parcela por repartir.' }
  if (linea.length < 2) return { piezas: [], error: 'La línea necesita al menos 2 puntos.' }
  const todos = restante.flat(2)
  const lon0 = (Math.min(...todos.map(c => c[0])) + Math.max(...todos.map(c => c[0]))) / 2
  const lat0 = (Math.min(...todos.map(c => c[1])) + Math.max(...todos.map(c => c[1]))) / 2
  const cos0 = Math.cos((lat0 * Math.PI) / 180)
  const aM = (c: number[]): PuntoXY => [(c[0] - lon0) * M_LON * cos0, (c[1] - lat0) * M_LAT]
  const aG = (p: number[]): number[] => [lon0 + p[0] / (M_LON * cos0), lat0 + p[1] / M_LAT]
  const mp: MP = restante.map(poly => poly.map(r => r.map(aM)))
  const lm = linea.map(aM)
  if (puntoEnMP(lm[0], mp) || puntoEnMP(lm[lm.length - 1], mp)) {
    return { piezas: [], error: 'La línea debe empezar y terminar fuera de la parcela, cruzándola por en medio. Vuelve a dibujarla.' }
  }
  // La línea se convierte en una banda finísima (5 cm) que se resta a la parcela
  const piezasBanda: any[] = []
  for (let i = 0; i + 1 < lm.length; i++) piezasBanda.push(...cap(lm[i], lm[i + 1], 0.025))
  const banda = polygonClipping.union(...(piezasBanda as [any, ...any[]]))
  const resultado = polygonClipping.difference(mp, banda)
  const piezas: PiezaCorte[] = resultado
    .map((poly: PuntoXY[][]) => ({ m: [poly] as MP, a: areaMP([poly]) }))
    .filter((p: { a: number }) => p.a > 1) // descarta restos ínfimos (menos de 1 m²)
    .map((p: { m: MP; a: number }) => ({ mp: p.m.map((poly: PuntoXY[][]) => poly.map(r => r.map(aG))), supHa: p.a / 10000 }))
  if (piezas.length < 2) return { piezas: [], error: 'El corte no ha dividido la parcela en trozos. Prueba a dibujar la línea de otra forma.' }
  return { piezas }
}
