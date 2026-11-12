// Análisis de plantación: cuántos árboles caben en una parcela (o varios recintos) según el marco,
// las distancias a las lindes y la orientación de las líneas. Funciones puras, todo en el navegador.
//
// Conceptos:
// - Marco: distancia entre árboles de una misma línea (distArboles) y entre líneas (distLineas).
// - Cabecera: distancia desde el inicio/final de cada línea hasta la linde.
// - Lateral: distancia desde la última línea hasta la linde.
// - Camino (opcional): perpendicular a las líneas, de lado a lado de la parcela, cada vez que una línea
//   llegaría a superar la longitud máxima indicada. En el camino no se planta.
// - Orientación: azimut de las líneas (0° = N-S, 45° = NE-SO, 90° = E-O, 135° = SE-NO).
//   Los opuestos (180°, 225°…) dan exactamente lo mismo, por eso solo se calculan 4.
//
// Se trabaja en metros sobre un plano local (terreno plano, sin corrección por pendiente).

export interface ParamsPlantacion {
  distArboles: number        // m entre árboles de una misma línea
  distLineas: number         // m entre líneas
  cabecera: number           // m, extremo de línea → linde
  lateral: number            // m, última línea → linde
  caminoMaxLinea?: number    // m, longitud máxima de línea sin camino (opcional)
  caminoAncho?: number       // m, ancho libre del camino (opcional)
}

export interface ResultadoOrientacion {
  angulo: number             // azimut de las líneas, en grados
  arboles: number
  arbolesHa: number          // árboles por hectárea de parcela
  lineas: number             // líneas que llevan al menos un árbol
  caminos: number
  puntos: Float64Array       // [lat, lon, lat, lon, …] de cada árbol
  caminosGeo: [number, number][][] // anillos [lat, lon] de las bandas de camino recortadas a la parcela
  cabecerasGeo: [number, number][][] // anillos [lat, lon] de las franjas de cabecera (extremos de las líneas)
}

export interface AnalisisPlantacion {
  supHa: number
  marcoTeoricoHaArboles: number  // árboles/ha de un marco sin lindes ni caminos
  orientaciones: ResultadoOrientacion[]
  mejor: number                  // índice de la orientación con más árboles
}

export const ORIENTACIONES: { angulo: number; nombre: string }[] = [
  { angulo: 0, nombre: 'Norte-Sur (0°)' },
  { angulo: 45, nombre: 'Noreste-Suroeste (45°)' },
  { angulo: 90, nombre: 'Este-Oeste (90°)' },
  { angulo: 135, nombre: 'Sureste-Noroeste (135°)' },
]

// Rumbo en grados → 0–359 (admite negativos y más de 360)
export const normalizarRumbo = (g: number): number => ((Math.round(g) % 360) + 360) % 360

// Nombre de la dirección más cercana de la rosa de 16 vientos (N, NNE, NE…), en español
const VIENTOS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']
export const nombreRumbo = (g: number): string => VIENTOS[Math.round(normalizarRumbo(g) / 22.5) % 16]

// Las líneas no tienen sentido: 200° y 20° dan el mismo reparto. Se calcula siempre en 0–179°.
export const azimutLineas = (rumbo: number): number => normalizarRumbo(rumbo) % 180

const M_LAT = 110574
const M_LON = 111320
const EPS = 1e-9

type Intervalo = [number, number]
type Arista = [number, number, number, number]

// Polígonos de una geometría GeoJSON (Feature, FeatureCollection, Polygon o MultiPolygon):
// cada polígono = lista de anillos [lon, lat]; el primero es el exterior y el resto, huecos.
export const poligonosDeGeojson = (g: any): number[][][][] => {
  const out: number[][][][] = []
  const geom = (x: any) => {
    if (!x) return
    if (x.type === 'Polygon') out.push(x.coordinates)
    else if (x.type === 'MultiPolygon') x.coordinates.forEach((c: number[][][]) => out.push(c))
  }
  if (g?.type === 'FeatureCollection') (g.features || []).forEach((f: any) => geom(f.geometry))
  else if (g?.type === 'Feature') geom(g.geometry)
  else geom(g)
  return out
}

const aristasDeAnillos = (anillos: [number, number][][]): Arista[] => {
  const e: Arista[] = []
  anillos.forEach(r => {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length]
      if (a[0] === b[0] && a[1] === b[1]) continue
      e.push([a[0], a[1], b[0], b[1]])
    }
  })
  return e
}

// Tramos de la recta u = valor (eje v) que quedan dentro del polígono (regla par-impar).
const intervalosEnLinea = (aristas: Arista[], u: number): Intervalo[] => {
  const cruces: number[] = []
  for (const [u1, v1, u2, v2] of aristas) {
    if ((u1 <= u) !== (u2 <= u)) cruces.push(v1 + ((u - u1) * (v2 - v1)) / (u2 - u1))
  }
  cruces.sort((a, b) => a - b)
  const res: Intervalo[] = []
  for (let i = 0; i + 1 < cruces.length; i += 2) {
    const a = cruces[i], b = cruces[i + 1]
    if (res.length && a - res[res.length - 1][1] < EPS) res[res.length - 1][1] = b // recintos contiguos: se unen
    else res.push([a, b])
  }
  return res
}

const interseccion = (A: Intervalo[], B: Intervalo[]): Intervalo[] => {
  const res: Intervalo[] = []
  let i = 0, j = 0
  while (i < A.length && j < B.length) {
    const a = Math.max(A[i][0], B[j][0]), b = Math.min(A[i][1], B[j][1])
    if (b - a >= -EPS) res.push([a, Math.max(a, b)])
    if (A[i][1] < B[j][1]) i++
    else j++
  }
  return res
}

const recortarExtremos = (I: Intervalo[], cab: number): Intervalo[] => {
  const res: Intervalo[] = []
  for (const [a, b] of I) if (b - a - 2 * cab >= -EPS) res.push([a + cab, Math.max(a + cab, b - cab)])
  return res
}

const areaPoligono = (anillos: [number, number][][]): number => {
  const sh = (r: [number, number][]) => {
    let s = 0
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1] }
    return Math.abs(s) / 2
  }
  return anillos.reduce((acc, r, i) => acc + (i === 0 ? sh(r) : -sh(r)), 0)
}

export const validarParams = (p: ParamsPlantacion): string | null => {
  if (!(p.distArboles > 0)) return 'La distancia entre árboles debe ser mayor que 0.'
  if (!(p.distLineas > 0)) return 'La distancia entre líneas debe ser mayor que 0.'
  if (!(p.cabecera >= 0)) return 'La cabecera no puede ser negativa.'
  if (!(p.lateral >= 0)) return 'El lateral no puede ser negativo.'
  if (p.caminoMaxLinea !== undefined || p.caminoAncho !== undefined) {
    if (!((p.caminoMaxLinea ?? 0) > 0)) return 'La longitud máxima de línea sin camino debe ser mayor que 0.'
    if (!((p.caminoAncho ?? 0) > 0)) return 'El ancho del camino debe ser mayor que 0.'
    if ((p.caminoMaxLinea as number) < p.distArboles) return 'La longitud máxima de línea no puede ser menor que la distancia entre árboles.'
  }
  return null
}

const PASOS_OFFSET = 6 // desplazamientos de la malla que se prueban en cada eje

// conGeometria = false evita calcular los polígonos de caminos y cabeceras (útil al probar muchos ángulos)
export const analizarPlantacion = (geojson: any, params: ParamsPlantacion, angulos: number[] = ORIENTACIONES.map(o => o.angulo), conGeometria = true): AnalisisPlantacion => {
  const error = validarParams(params)
  if (error) throw new Error(error)
  const poligonos = poligonosDeGeojson(geojson)
  if (!poligonos.length) throw new Error('La parcela no tiene geometría.')

  // Plano local en metros centrado en la parcela
  const lons = poligonos.flat(2).map(c => c[0]), lats = poligonos.flat(2).map(c => c[1])
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2, lat0 = (Math.min(...lats) + Math.max(...lats)) / 2
  const cos0 = Math.cos((lat0 * Math.PI) / 180)
  const aMetros = (c: number[]): [number, number] => [(c[0] - lon0) * M_LON * cos0, (c[1] - lat0) * M_LAT]
  const aGrados = (x: number, y: number): [number, number] => [lat0 + y / M_LAT, lon0 + x / (M_LON * cos0)] // [lat, lon]
  const poligonosM = poligonos.map(poly => poly.map(r => r.map(aMetros)))
  const supM2 = poligonosM.reduce((acc, p) => acc + areaPoligono(p), 0)
  const supHa = supM2 / 10000

  const { distArboles: dA, distLineas: dL, cabecera: cab, lateral: lat } = params
  // Una línea a EXACTAMENTE la distancia lateral de la linde es válida; la micra de tolerancia evita
  // perderla por cómo se resuelven los cruces justo en el borde.
  const latEf = Math.max(0, lat - 1e-6)
  const conCaminos = params.caminoMaxLinea !== undefined && params.caminoAncho !== undefined
  const lMax = params.caminoMaxLinea ?? 0
  const ancho = params.caminoAncho ?? 0

  const orientaciones: ResultadoOrientacion[] = angulos.map(angulo => {
    const th = (angulo * Math.PI) / 180
    const d: [number, number] = [Math.sin(th), Math.cos(th)]      // dirección de las líneas
    const p: [number, number] = [Math.cos(th), -Math.sin(th)]     // perpendicular a las líneas
    const aUV = (x: number, y: number): [number, number] => [x * p[0] + y * p[1], x * d[0] + y * d[1]]
    const deUV = (u: number, v: number): [number, number] => [u * p[0] + v * d[0], u * p[1] + v * d[1]]

    const anillosUV = poligonosM.flatMap(poly => poly.map(r => r.map(([x, y]) => aUV(x, y))))
    const aristas = aristasDeAnillos(anillosUV)
    const aristasVU: Arista[] = aristas.map(([u1, v1, u2, v2]) => [v1, u1, v2, u2]) // eje cambiado, para los caminos
    const us = anillosUV.flat().map(c => c[0]), vs = anillosUV.flat().map(c => c[1])
    const uMin = Math.min(...us), uMax = Math.max(...us), vMin = Math.min(...vs), vMax = Math.max(...vs)

    // Bandas de camino (en v): se reparten desde el inicio de las líneas; ver más abajo el desplazamiento
    const segmentosPara = (s0: number): { ini: number; fin: number }[] => {
      const segs: { ini: number; fin: number }[] = []
      if (!conCaminos) { segs.push({ ini: s0, fin: Infinity }); return segs }
      for (let k = 0; ; k++) {
        const ini = s0 + k * (lMax + ancho)
        if (ini > vMax - cab + EPS) break
        segs.push({ ini, fin: ini + lMax })
      }
      return segs
    }

    type Fila = { u: number; I: Intervalo[] }
    const filasPara = (ou: number): Fila[] => {
      const filas: Fila[] = []
      for (let u = uMin + ou; u <= uMax + EPS; u += dL) {
        const I = recortarExtremos(
          interseccion(interseccion(intervalosEnLinea(aristas, u - latEf), intervalosEnLinea(aristas, u)), intervalosEnLinea(aristas, u + latEf)),
          cab
        )
        if (I.length) filas.push({ u, I })
      }
      return filas
    }

    const contar = (filas: Fila[], segs: { ini: number; fin: number }[]): number => {
      let n = 0
      for (const f of filas) for (const [a, b] of f.I) for (const s of segs) {
        const lo = Math.max(a, s.ini), hi = Math.min(b, s.fin)
        if (hi < lo - EPS) continue
        const jmin = Math.ceil((lo - s.ini) / dA - 1e-7), jmax = Math.floor((hi - s.ini) / dA + 1e-7)
        if (jmax >= jmin) n += jmax - jmin + 1
      }
      return n
    }

    // Se prueban pequeños desplazamientos de la malla y se queda el que más árboles da
    let mejorN = -1, mejorOu = 0, mejorOv = 0
    for (let iu = 0; iu < PASOS_OFFSET; iu++) {
      const ou = (iu / PASOS_OFFSET) * dL
      const filas = filasPara(ou)
      for (let iv = 0; iv < PASOS_OFFSET; iv++) {
        const ov = (iv / PASOS_OFFSET) * dA
        const n = contar(filas, segmentosPara(vMin + cab + ov))
        if (n > mejorN) { mejorN = n; mejorOu = ou; mejorOv = ov }
      }
    }

    // Generación de los árboles con el mejor desplazamiento
    const filas = filasPara(mejorOu)
    const segs = segmentosPara(vMin + cab + mejorOv)
    const buf: number[] = []
    for (const f of filas) for (const [a, b] of f.I) for (const s of segs) {
      const lo = Math.max(a, s.ini), hi = Math.min(b, s.fin)
      if (hi < lo - EPS) continue
      const jmin = Math.ceil((lo - s.ini) / dA - 1e-7), jmax = Math.floor((hi - s.ini) / dA + 1e-7)
      for (let j = jmin; j <= jmax; j++) {
        const [x, y] = deUV(f.u, s.ini + j * dA)
        const [la, lo2] = aGrados(x, y)
        buf.push(la, lo2)
      }
    }
    const arboles = buf.length / 2

    // Caminos: bandas entre segmentos, recortadas a la parcela
    const caminosGeo: [number, number][][] = []
    let caminos = 0
    if (conCaminos) {
      for (let i = 0; i + 1 < segs.length; i++) {
        const r0 = segs[i].fin, r1 = r0 + ancho
        if (r1 > vMax - cab + EPS) break
        const tramos = intervalosEnLinea(aristasVU, (r0 + r1) / 2) // tramos en u dentro de la parcela
        if (!tramos.length) continue
        caminos++
        if (conGeometria) for (const [u1, u2] of tramos) {
          caminosGeo.push([deUV(u1, r0), deUV(u2, r0), deUV(u2, r1), deUV(u1, r1)].map(([x, y]) => aGrados(x, y)))
        }
      }
    }

    // Cabeceras: franjas de ancho `cab` a lo largo de cada extremo de línea, hasta la linde (o hasta el hueco
    // de una zona excluida). Se descompone la parcela en tramos entre vértices consecutivos: en cada uno los
    // extremos de las líneas son rectas y la franja es un trapecio exacto.
    const cabecerasGeo: [number, number][][] = []
    if (conGeometria && cab > 0) {
      const us = Array.from(new Set(aristas.flatMap(e => [e[0], e[2]]))).sort((a, b) => a - b)
      const aGeo = (pts: [number, number][]): [number, number][] => pts.map(([u, v]) => { const [x, y] = deUV(u, v); return aGrados(x, y) })
      for (let i = 0; i + 1 < us.length; i++) {
        const ui = us[i], uj = us[i + 1]
        if (uj - ui < 1e-6) continue
        const um = (ui + uj) / 2
        const cr: { vm: number; vi: number; vj: number }[] = []
        for (const [u1, v1, u2, v2] of aristas) {
          if ((u1 <= um) !== (u2 <= um)) {
            const k = (v2 - v1) / (u2 - u1)
            cr.push({ vm: v1 + (um - u1) * k, vi: v1 + (ui - u1) * k, vj: v1 + (uj - u1) * k })
          }
        }
        cr.sort((a, b) => a.vm - b.vm)
        for (let c = 0; c + 1 < cr.length; c += 2) {
          const A = cr[c], B = cr[c + 1]
          cabecerasGeo.push(aGeo([[ui, A.vi], [uj, A.vj], [uj, Math.min(A.vj + cab, B.vj)], [ui, Math.min(A.vi + cab, B.vi)]]))
          cabecerasGeo.push(aGeo([[ui, Math.max(B.vi - cab, A.vi)], [uj, Math.max(B.vj - cab, A.vj)], [uj, B.vj], [ui, B.vi]]))
        }
      }
    }

    return {
      angulo, arboles,
      arbolesHa: supHa > 0 ? arboles / supHa : 0,
      lineas: filas.length,
      caminos, caminosGeo, cabecerasGeo,
      puntos: Float64Array.from(buf),
    }
  })

  let mejor = 0
  orientaciones.forEach((o, i) => { if (o.arboles > orientaciones[mejor].arboles) mejor = i })
  return { supHa, marcoTeoricoHaArboles: 10000 / (dA * dL), orientaciones, mejor }
}
