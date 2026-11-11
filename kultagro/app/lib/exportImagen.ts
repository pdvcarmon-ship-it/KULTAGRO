// Exporta el análisis de plantación como imagen PNG: la parcela debajo (con o sin fondo de satélite) y encima
// los árboles, los caminos, la brújula y los datos, según las capas que elija el usuario. Se dibuja directamente
// en un canvas (no es una captura del mapa), así que sale siempre encuadrada en la parcela y con buena resolución.

import { poligonosDeGeojson } from './analisisPlantacion'

export interface CapasImagen {
  satelite: boolean   // fondo de imagen aérea (si no, fondo liso)
  contorno: boolean   // contorno de la parcela
  arboles: boolean
  caminos: boolean
  brujula: boolean    // brújula con la dirección de las líneas
  datos: boolean      // franja inferior con título y cifras
}

export interface OpcionesImagen {
  geojson: any
  puntos: Float64Array                  // [lat, lon, …] de cada árbol
  caminosGeo: [number, number][][]      // anillos [lat, lon]
  espaciadoM: number                    // m entre árboles (para el tamaño del punto)
  capas: CapasImagen
  rumbo: number                         // dirección de las líneas, 0 = N, sentido horario
  titulo: string
  lineasTexto: string[]
  ancho?: number                        // px de ancho de la imagen (por defecto 1600)
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
  const lineH = 34 * s, bandaH = o.capas.datos ? Math.round(24 * s + (1 + o.lineasTexto.length) * lineH + 12 * s) : 0
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

  // ---- Caminos ----
  if (o.capas.caminos) {
    ctx.fillStyle = 'rgba(200,161,101,0.65)'
    ctx.strokeStyle = '#d9b06b'
    ctx.lineWidth = 1 * s
    for (const anillo of o.caminosGeo) {
      ctx.beginPath()
      anillo.forEach(([la, lo], i) => { const [x, y] = pt(lo, la); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
      ctx.closePath(); ctx.fill(); ctx.stroke()
    }
  }

  // ---- Árboles ----
  if (o.capas.arboles) {
    const r = Math.max(1.5 * s, Math.min(9 * s, o.espaciadoM * pxPorM * 0.3))
    ctx.fillStyle = sobreSatelite ? '#b6f04a' : '#2e7d32'
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'
    ctx.lineWidth = 0.9 * s
    for (let i = 0; i < o.puntos.length; i += 2) {
      const [x, y] = pt(o.puntos[i + 1], o.puntos[i])
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
      if (r >= 3 * s) ctx.stroke()
    }
  }

  // ---- Brújula ----
  if (o.capas.brujula) {
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
    const [px, py] = d(o.rumbo, R - 26 * s), [qx, qy] = d(o.rumbo + 180, R - 26 * s)
    ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 4 * s; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(px, py); ctx.stroke()
    const [a1x, a1y] = d(o.rumbo - 14, R - 40 * s), [a2x, a2y] = d(o.rumbo + 14, R - 40 * s)
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
    for (const l of o.lineasTexto) { y += lineH; ctx.fillText(l, 24 * s, y - 8 * s) }
  }

  return { canvas, sateliteOk: o.capas.satelite ? sateliteOk : true }
}

export const canvasABlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo generar el PNG.'))), 'image/png'))
