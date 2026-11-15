// Exporta el análisis de plantación como imagen PNG: la parcela debajo (con o sin fondo de satélite) y encima
// los árboles, los caminos, la brújula y los datos, según las capas que elija el usuario. Se dibuja directamente
// en un canvas (no es una captura del mapa), así que sale siempre encuadrada en la parcela y con buena resolución.

import { poligonosDeGeojson } from './analisisPlantacion'

export interface CapasImagen {
  satelite: boolean    // fondo de imagen aérea (si no, fondo liso)
  contorno: boolean    // contorno de la parcela (y de cada sector)
  exclusiones: boolean // zonas de exclusión
  arboles: boolean
  caminos: boolean     // caminos y cabeceras (se pintan igual)
  brujula: boolean     // brújula con la dirección de las líneas (una flecha por sector si hay varios)
  datos: boolean       // franja inferior con título y cifras
}

// Un conjunto de plantación: la parcela entera, o un sector de ella
export interface ConjuntoImagen {
  etiqueta?: string                       // "Sector 1"
  color: string                           // color de los árboles y del contorno del sector
  puntos: Float64Array                    // [lat, lon, …] de cada árbol
  espaciadoM: number                      // m entre árboles (para el tamaño del punto)
  caminosGeo: [number, number][][]        // caminos interiores, anillos [lat, lon]
  cabecerasGeo: [number, number][][]      // cabeceras, anillos [lat, lon]
  caminoEntreSectoresGeo?: [number, number][][] // camino con el sector anterior, anillos [lat, lon]
  contornos?: [number, number][][]        // contorno(s) del sector (anillos exteriores), [lat, lon]
  rumbo: number                           // dirección de las líneas, 0 = N, sentido horario
}

export interface BloqueTexto {
  titulo: string
  color?: string
  lineas: string[]
}

export interface OpcionesImagen {
  geojson: any
  conjuntos: ConjuntoImagen[]
  exclusionesGeo: [number, number][][]    // anillos [lat, lon]
  capas: CapasImagen
  titulo: string
  generales: string[]                     // líneas generales bajo el título
  bloques: BloqueTexto[]                  // un bloque por sector (o uno solo)
  ancho?: number                          // px de ancho de la imagen (por defecto 1600)
}

export interface ResultadoImagen {
  canvas: HTMLCanvasElement
  sateliteOk: boolean   // false si se pidió satélite y no se pudo cargar ninguna tesela
}

const URL_TESELA = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ATRIBUCION = '© Esri, Maxar, Earthstar Geographics'
const cacheTeselas = new Map<string, Promise<HTMLImageElement | null>>()

const cargarTesela = (z: number, x: number, y: number): Promise<HTMLImageElement | null> => {
  const url = URL_TESELA.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  let p = cacheTeselas.get(url)
  if (!p) {
    p = new Promise(resolve => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      const t = setTimeout(() => resolve(null), 15000)
      img.onload = () => { clearTimeout(t); resolve(img) }
      img.onerror = () => { clearTimeout(t); resolve(null) }
      img.src = url
    })
    cacheTeselas.set(url, p)
  }
  return p
}

// lon/lat → coordenadas Mercator del mundo entero en un cuadrado de 256 unidades
const proyectar = (lon: number, lat: number): [number, number] => {
  const s = Math.sin((lat * Math.PI) / 180)
  return [((lon + 180) / 360) * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256]
}

export const renderizarImagen = async (o: OpcionesImagen): Promise<ResultadoImagen> => {
  const poligonos = poligonosDeGeojson(o.geojson)
  if (!poligonos.length) throw new Error('La parcela no tiene geometría.')
  const W = o.ancho ?? 1600
  const s = W / 1600 // factor de escala de grosores y tipografías

  // Encuadre: caja de la parcela con un margen
  const todos = poligonos.flat(2).map(c => proyectar(c[0], c[1]))
  const xs = todos.map(c => c[0]), ys = todos.map(c => c[1])
  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const margen = Math.max(maxX - minX, maxY - minY, 1e-9) * 0.08
  minX -= margen; maxX += margen; minY -= margen; maxY += margen
  const bw = maxX - minX, bh = maxY - minY
  const H = Math.round(Math.min(Math.max((W * bh) / bw, W * 0.45), W * 1.25))
  const k = Math.min(W / bw, H / bh) // px de imagen por unidad Mercator
  const ox = (W - bw * k) / 2 - minX * k, oy = (H - bh * k) / 2 - minY * k
  const pt = (lon: number, lat: number): [number, number] => { const [x, y] = proyectar(lon, lat); return [x * k + ox, y * k + oy] }

  const lat0 = poligonos[0][0][0][1]
  const pxPorM = k / (156543.03392 * Math.cos((lat0 * Math.PI) / 180))

  // Franja de datos
  const lineH = 34 * s
  const lineasBanda = 1 + o.generales.length + o.bloques.reduce((n, b) => n + 1 + b.lineas.length, 0)
  const bandaH = o.capas.datos ? Math.round(24 * s + lineasBanda * lineH + (o.bloques.length > 1 ? o.bloques.length * 10 * s : 0) + 12 * s) : 0
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H + bandaH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo crear la imagen.')

  // ---- Fondo ----
  let sateliteOk = true
  ctx.save()
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip()
  ctx.fillStyle = '#f2efe6'
  ctx.fillRect(0, 0, W, H)
  if (o.capas.satelite) {
    let z = Math.max(0, Math.min(19, Math.round(Math.log2(k))))
    const rango = (zz: number) => {
      const u = 256 / 2 ** zz, n = 2 ** zz
      return {
        u, n,
        x0: Math.floor((0 - ox) / k / u), x1: Math.floor((W - ox) / k / u),
        y0: Math.max(0, Math.floor((0 - oy) / k / u)), y1: Math.min(n - 1, Math.floor((H - oy) / k / u)),
      }
    }
    let r = rango(z)
    while (z > 0 && (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > 100) { z--; r = rango(z) }
    const peticiones: Promise<{ img: HTMLImageElement | null; tx: number; ty: number }>[] = []
    for (let tx = r.x0; tx <= r.x1; tx++) for (let ty = r.y0; ty <= r.y1; ty++) {
      const txm = ((tx % r.n) + r.n) % r.n
      peticiones.push(cargarTesela(z, txm, ty).then(img => ({ img, tx, ty })))
    }
    const teselas = await Promise.all(peticiones)
    const cargadas = teselas.filter(t => t.img)
    if (!cargadas.length) sateliteOk = false
    else {
      ctx.fillStyle = '#222'
      ctx.fillRect(0, 0, W, H)
      for (const { img, tx, ty } of cargadas) {
        ctx.drawImage(img as HTMLImageElement, tx * r.u * k + ox, ty * r.u * k + oy, r.u * k + 0.6, r.u * k + 0.6) // +0.6 evita costuras
      }
    }
  }
  const sobreSatelite = o.capas.satelite && sateliteOk

  // ---- Parcela ----
  const trazarParcela = () => {
    ctx.beginPath()
    for (const poly of poligonos) for (const anillo of poly) {
      anillo.forEach((c, i) => { const [x, y] = pt(c[0], c[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
      ctx.closePath()
    }
  }
  trazarParcela()
  ctx.fillStyle = sobreSatelite ? 'rgba(0,229,255,0.06)' : 'rgba(46,125,50,0.10)'
  ctx.fill('evenodd')
  if (o.capas.contorno) {
    ctx.lineWidth = 3 * s
    ctx.strokeStyle = sobreSatelite ? '#00e5ff' : '#1b5e20'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  const COLOR_CAMINO = 'rgba(200,161,101,0.65)'
  const anillo = (ring: [number, number][]) => {
    ctx.beginPath()
    ring.forEach(([la, lo], i) => { const [x, y] = pt(lo, la); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
    ctx.closePath()
  }

  // ---- Zonas de exclusión ----
  if (o.capas.exclusiones && o.exclusionesGeo.length) {
    ctx.fillStyle = 'rgba(229,57,53,0.38)'
    ctx.strokeStyle = '#e53935'
    ctx.lineWidth = 2 * s
    ctx.setLineDash([8 * s, 5 * s])
    for (const ring of o.exclusionesGeo) { anillo(ring); ctx.fill(); ctx.stroke() }
    ctx.setLineDash([])
  }

  // ---- Caminos y cabeceras (mismo color aunque cambie el ancho) ----
  if (o.capas.caminos) {
    ctx.fillStyle = COLOR_CAMINO
    ctx.strokeStyle = COLOR_CAMINO
    ctx.lineWidth = 1 * s
    for (const c of o.conjuntos) {
      for (const ring of [...c.cabecerasGeo, ...c.caminosGeo, ...(c.caminoEntreSectoresGeo || [])]) { anillo(ring); ctx.fill(); ctx.stroke() }
    }
  }

  // ---- Contorno de cada sector ----
  const varios = o.conjuntos.length > 1
  if (varios && o.capas.contorno) {
    for (const c of o.conjuntos) {
      if (!c.contornos) continue
      for (const ring of c.contornos) {
        anillo(ring)
        ctx.lineWidth = 3 * s; ctx.strokeStyle = c.color; ctx.lineJoin = 'round'; ctx.stroke()
      }
    }
  }

  // ---- Árboles ----
  if (o.capas.arboles) {
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'
    ctx.lineWidth = 0.9 * s
    for (const c of o.conjuntos) {
      const r = Math.max(1.5 * s, Math.min(9 * s, c.espaciadoM * pxPorM * 0.3))
      ctx.fillStyle = sobreSatelite || varios ? c.color : '#2e7d32'
      for (let i = 0; i < c.puntos.length; i += 2) {
        const [x, y] = pt(c.puntos[i + 1], c.puntos[i])
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
        if (r >= 3 * s) ctx.stroke()
      }
    }
  }

  // ---- Etiquetas y flecha de dirección de cada sector ----
  if (varios && (o.capas.brujula || o.capas.contorno)) {
    for (const c of o.conjuntos) {
      if (!c.contornos || !c.contornos.length) continue
      // etiqueta en el centro del anillo más grande
      const grande = c.contornos.reduce((m, r) => (r.length > m.length ? r : m), c.contornos[0])
      const cla = grande.reduce((a, p) => a + p[0], 0) / grande.length, clo = grande.reduce((a, p) => a + p[1], 0) / grande.length
      const [cx, cy] = pt(clo, cla)
      if (o.capas.brujula) {
        const L = 42 * s, rad = (c.rumbo * Math.PI) / 180
        const px = cx + L * Math.sin(rad), py = cy - L * Math.cos(rad), qx = cx - L * Math.sin(rad), qy = cy + L * Math.cos(rad)
        for (const [col, w] of [['#000', 6 * s], [c.color, 3.5 * s]] as [string, number][]) {
          ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'
          ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(px, py); ctx.stroke()
        }
        const h = 13 * s, a1 = rad + Math.PI - 0.45, a2 = rad + Math.PI + 0.45
        ctx.fillStyle = c.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * s
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + h * Math.sin(a1), py - h * Math.cos(a1)); ctx.lineTo(px + h * Math.sin(a2), py - h * Math.cos(a2)); ctx.closePath(); ctx.fill(); ctx.stroke()
      }
      if (c.etiqueta) {
        const texto = `${c.etiqueta} · ${c.rumbo}°`
        ctx.font = `700 ${19 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        const tw = ctx.measureText(texto).width + 16 * s
        ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(cx - tw / 2, cy + 50 * s, tw, 28 * s)
        ctx.fillStyle = c.color; ctx.fillRect(cx - tw / 2, cy + 50 * s, 5 * s, 28 * s)
        ctx.fillStyle = '#fff'; ctx.fillText(texto, cx + 2 * s, cy + 64 * s)
      }
    }
  }

  // ---- Brújula (una sola, cuando no hay sectores) ----
  if (o.capas.brujula && !varios && o.conjuntos.length === 1) {
    const rumbo = o.conjuntos[0].rumbo
    const R = 64 * s, cx = W - R - 24 * s, cy = R + 24 * s
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI)
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fill()
    ctx.lineWidth = 2 * s; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke()
    const d = (g: number, rad: number): [number, number] => [cx + rad * Math.sin((g * Math.PI) / 180), cy - rad * Math.cos((g * Math.PI) / 180)]
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5 * s
    for (let g = 0; g < 360; g += 45) { const [a, b] = d(g, R - 2 * s), [c2, e] = d(g, R - 9 * s); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c2, e); ctx.stroke() }
    ctx.fillStyle = '#c0392b'; ctx.font = `700 ${20 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const [nx, ny] = d(0, R - 22 * s); ctx.fillText('N', nx, ny)
    // aguja: línea de plantación, con punta hacia el rumbo
    const [px, py] = d(rumbo, R - 26 * s), [qx, qy] = d(rumbo + 180, R - 26 * s)
    ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 4 * s; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(px, py); ctx.stroke()
    const [a1x, a1y] = d(rumbo - 14, R - 40 * s), [a2x, a2y] = d(rumbo + 14, R - 40 * s)
    ctx.fillStyle = '#2e7d32'; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(a1x, a1y); ctx.lineTo(a2x, a2y); ctx.closePath(); ctx.fill()
  }

  // ---- Atribución del fondo ----
  if (sobreSatelite) {
    ctx.font = `${16 * s}px sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'
    ctx.lineWidth = 3 * s; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.fillStyle = '#fff'
    ctx.strokeText(ATRIBUCION, W - 10 * s, H - 10 * s); ctx.fillText(ATRIBUCION, W - 10 * s, H - 10 * s)
  }
  ctx.restore()

  // ---- Franja de datos ----
  if (o.capas.datos) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, H, W, bandaH)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    let y = H + 12 * s + lineH
    ctx.fillStyle = '#111'; ctx.font = `700 ${28 * s}px sans-serif`
    ctx.fillText(o.titulo, 24 * s, y - 4 * s)
    ctx.fillStyle = '#333'; ctx.font = `${22 * s}px sans-serif`
    for (const l of o.generales) { y += lineH; ctx.fillText(l, 24 * s, y - 8 * s) }
    for (const b of o.bloques) {
      if (o.bloques.length > 1) y += 10 * s
      y += lineH
      let x = 24 * s
      if (b.color) { ctx.fillStyle = b.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * s; ctx.fillRect(x, y - 22 * s, 22 * s, 22 * s); ctx.strokeRect(x, y - 22 * s, 22 * s, 22 * s); x += 32 * s }
      ctx.fillStyle = '#111'; ctx.font = `700 ${23 * s}px sans-serif`
      ctx.fillText(b.titulo, x, y - 6 * s)
      ctx.fillStyle = '#333'; ctx.font = `${21 * s}px sans-serif`
      for (const l of b.lineas) { y += lineH; ctx.fillText(l, 24 * s + (b.color ? 32 * s : 0), y - 8 * s) }
    }
  }

  return { canvas, sateliteOk: o.capas.satelite ? sateliteOk : true }
}

export const canvasABlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo generar el PNG.'))), 'image/png'))
