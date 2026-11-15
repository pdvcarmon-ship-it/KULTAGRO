'use client'

// Pestaña PLANTACIÓN: análisis de cuántos árboles caben en una parcela según el marco, las distancias a
// las lindes (cabeceras/medianeras y laterales), los caminos opcionales y la orientación de las líneas.
// La orientación se elige con una brújula (arrastrando la aguja o pulsando una dirección) y todo se
// recalcula al momento y se dibuja en el mapa. Todo se calcula en el navegador; no guarda nada ni
// modifica la parcela.

import { useEffect, useMemo, useRef, useState } from 'react'
import { analizarPlantacion, azimutLineas, nombreRumbo, validarParams, type ResultadoOrientacion } from '../lib/analisisPlantacion'
import { dominioPlantacion, cortarConLinea, supHaAnillo, type Anillo, type Dominio, type PiezaCorte } from '../lib/sectoresPlantacion'
import BrujulaOrientacion from './BrujulaOrientacion'
import { renderizarImagen, canvasABlob, type CapasImagen, type ConjuntoImagen, type BloqueTexto } from '../lib/exportImagen'

const ANGULOS_BUSQUEDA = Array.from({ length: 12 }, (_, i) => i * 15) // 0°, 15°… 165°

interface FincaPlantacion {
  id: string
  nombre: string
}

interface ParcelaPlantacion {
  id: string
  nombre: string
  supHa: number
  cultivo?: string
  fincaId?: string
  geojson: any
}

interface Props {
  fincas: FincaPlantacion[]
  parcelas: ParcelaPlantacion[]
  isMobile: boolean
}

const SIN_FINCA = '__sin_finca__'
const COLORES_SECTOR = ['#b6f04a', '#ffd54f', '#4fc3f7', '#ff8a65', '#ba68c8', '#4db6ac', '#f06292', '#fff176']
const COLOR_CAMINO = '#c8a165' // caminos, cabeceras y camino entre sectores: el mismo color aunque cambie el ancho

// Parámetros de un sector, guardados tal cual estaban en el formulario al terminarlo
interface ParamsTexto {
  distArboles: string; distLineas: string; cabecera: string; lateral: string
  conCaminos: boolean; caminoMax: string; caminoAncho: string
}

interface SectorTerminado {
  id: number
  nombre: string
  color: string
  geom: number[][][][]                 // trozo de parcela que es el sector (MultiPolygon lon/lat)
  rumbo: number
  params: ParamsTexto
  resultado: ResultadoOrientacion
  supHa: number
  caminoPrevio: number[][][][] | null  // camino con el sector anterior (lon/lat)
  caminoSiguiente: number | null       // ancho del camino con el sector siguiente; null = no es camino
}

type Dibujo = { tipo: 'exclusion' | 'corte'; vertices: [number, number][] } // vértices [lat, lon]; 'corte' = línea con la que se recorta la parcela

interface ConjuntoArboles { puntos: Float64Array; color: string; espaciadoM: number }

const aLatLon = (a: Anillo): [number, number][] => a.map(([lo, la]) => [la, lo])
// MultiPolygon lon/lat → formato de Leaflet (polígonos con huecos, [lat, lon])
const mpALeaflet = (mp: number[][][][]): [number, number][][][] => mp.map(poly => poly.map(ring => ring.map(([lo, la]) => [la, lo] as [number, number])))
// Anillos exteriores [lat, lon] de un MultiPolygon (para contornos y etiquetas en la imagen)
const contornosLatLon = (mp: number[][][][]): [number, number][][] => mp.map(poly => poly[0].map(([lo, la]) => [la, lo] as [number, number]))
const COLORES_PIEZA = ['#29b6f6', '#ffa726', '#ab47bc', '#66bb6a', '#ef5350', '#ffee58']
const mpAAnillosLatLon = (mp: number[][][][] | null): [number, number][][] => (mp || []).map(poly => poly[0].map(([lo, la]) => [la, lo] as [number, number]))

const num = (t: string): number => Number(String(t).replace(/\s/g, '').replace(',', '.'))
const fmt = (n: number, d = 0) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '8px 10px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 4,
  textTransform: 'uppercase', letterSpacing: '0.06em',
}
const botonSec: React.CSSProperties = {
  width: '100%', marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'transparent', border: '1px solid var(--green)',
  color: 'var(--green)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 11, letterSpacing: '0.04em', cursor: 'pointer',
}
const botonPeligro: React.CSSProperties = { ...botonSec, border: '1px solid #b3261e', color: '#b3261e' }
const ayudaStyle: React.CSSProperties = { fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 3, lineHeight: 1.45 }

// Capa de Leaflet que dibuja los árboles en canvas, por teselas y solo los visibles (aguanta decenas de miles)
const crearCapaArboles = (L: any) =>
  L.GridLayer.extend({
    setDatos(conjuntos: ConjuntoArboles[], latRef: number) {
      this._conjuntos = conjuntos
      this._latRef = latRef
      this.redraw()
    },
    createTile(coords: any) {
      const size = this.getTileSize()
      const tile = document.createElement('canvas')
      tile.width = size.x
      tile.height = size.y
      const conjuntos: ConjuntoArboles[] | undefined = this._conjuntos
      if (!conjuntos || !conjuntos.length) return tile
      const ctx = tile.getContext('2d')
      if (!ctx) return tile
      const z = coords.z
      const mundo = size.x * Math.pow(2, z)
      const x0 = coords.x * size.x, y0 = coords.y * size.y
      const mPorPx = (156543.03392 * Math.cos((this._latRef * Math.PI) / 180)) / Math.pow(2, z) * (256 / size.x)
      const pad = 6
      const oeste = ((x0 - pad) / mundo) * 360 - 180, este = ((x0 + size.x + pad) / mundo) * 360 - 180
      const latDe = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / mundo))) * 180) / Math.PI
      const norte = latDe(y0 - pad), sur = latDe(y0 + size.y + pad)
      ctx.strokeStyle = 'rgba(0,0,0,0.65)'
      ctx.lineWidth = 0.8
      for (const c of conjuntos) {
        const pts = c.puntos
        const r = Math.max(1, Math.min(4, (c.espaciadoM / mPorPx) * 0.28))
        ctx.fillStyle = c.color
        for (let i = 0; i < pts.length; i += 2) {
          const lat = pts[i], lon = pts[i + 1]
          if (lon < oeste || lon > este || lat > norte || lat < sur) continue
          const px = ((lon + 180) / 360) * mundo - x0
          const s = Math.sin((lat * Math.PI) / 180)
          const py = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * mundo - y0
          ctx.beginPath()
          ctx.arc(px, py, r, 0, 2 * Math.PI)
          ctx.fill()
          if (r >= 2.5) ctx.stroke()
        }
      }
      return tile
    },
  })

export default function AnalisisPlantacionTab({ fincas, parcelas, isMobile }: Props) {
  const [fincaId, setFincaId] = useState('')
  const [parcelaId, setParcelaId] = useState('')
  const [cabecera, setCabecera] = useState('6')
  const [lateral, setLateral] = useState('4')
  const [distArboles, setDistArboles] = useState('4')
  const [distLineas, setDistLineas] = useState('6')
  const [conCaminos, setConCaminos] = useState(false)
  const [caminoMax, setCaminoMax] = useState('100')
  const [caminoAnchoManual, setCaminoAnchoManual] = useState<string | null>(null) // null = igual que la cabecera
  const [rumbo, setRumbo] = useState(90) // dirección de las líneas en la brújula (0 = N, sentido horario)
  const [resultado, setResultado] = useState<ResultadoOrientacion | null>(null)
  const [supHa, setSupHa] = useState(0)
  const [marcoTeorico, setMarcoTeorico] = useState(0)
  const [mejorBusqueda, setMejorBusqueda] = useState<{ angulo: number; arboles: number } | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [calculando, setCalculando] = useState(false)
  const [error, setError] = useState('')
  const [exportAbierto, setExportAbierto] = useState(false)
  const [capasExport, setCapasExport] = useState<CapasImagen>({ satelite: true, contorno: true, exclusiones: true, arboles: true, caminos: true, brujula: true, datos: true })
  // Zonas dentro de la parcela
  const [exclusiones, setExclusiones] = useState<Anillo[]>([])
  const [modoSectores, setModoSectores] = useState(false)
  const [sectores, setSectores] = useState<SectorTerminado[]>([])
  const [sectorActivo, setSectorActivo] = useState<number[][][][] | null>(null) // trozo de parcela del sector que se está diseñando
  const [piezas, setPiezas] = useState<(PiezaCorte & { id: number })[] | null>(null) // trozos resultantes del último corte, a elegir
  const [dibujo, setDibujo] = useState<Dibujo | null>(null)
  const [terminando, setTerminando] = useState(false)               // diálogo de TERMINADA
  const [esCamino, setEsCamino] = useState(false)
  const [anchoCamino, setAnchoCamino] = useState('')
  const [exportBlob, setExportBlob] = useState<Blob | null>(null)
  const [exportUrl, setExportUrl] = useState('')
  const [exportCargando, setExportCargando] = useState(false)
  const [exportAviso, setExportAviso] = useState('')
  const [panelAbierto, setPanelAbierto] = useState(true) // solo móvil: hoja inferior desplegada o recogida

  const parcela = useMemo(() => parcelas.find(p => p.id === parcelaId), [parcelas, parcelaId])
  const caminoAncho = caminoAnchoManual ?? cabecera

  // Fincas que tienen parcelas con geometría; "Sin finca" solo si hay parcelas sin finca asignada
  const opcionesFinca = useMemo(() => {
    const conParcelas = fincas.filter(f => parcelas.some(p => p.fincaId === f.id))
    const haySin = parcelas.some(p => !p.fincaId || !fincas.some(f => f.id === p.fincaId))
    return [...conParcelas, ...(haySin ? [{ id: SIN_FINCA, nombre: 'Sin finca' }] : [])]
  }, [fincas, parcelas])
  const parcelasFinca = useMemo(() => {
    if (!fincaId) return []
    return fincaId === SIN_FINCA
      ? parcelas.filter(p => !p.fincaId || !fincas.some(f => f.id === p.fincaId))
      : parcelas.filter(p => p.fincaId === fincaId)
  }, [parcelas, fincas, fincaId])
  useEffect(() => { if (!fincaId && opcionesFinca.length === 1) setFincaId(opcionesFinca[0].id) }, [opcionesFinca, fincaId])
  useEffect(() => { if (parcelaId && !parcelasFinca.some(p => p.id === parcelaId)) setParcelaId('') }, [parcelasFinca, parcelaId])

  const colorActivo = COLORES_SECTOR[(modoSectores ? sectores.length : 0) % COLORES_SECTOR.length]

  // ---- Mapa ----
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const parcelaLayerRef = useRef<any>(null)
  const caminosLayerRef = useRef<any>(null)
  const zonasLayerRef = useRef<any>(null)
  const arbolesLayerRef = useRef<any>(null)
  const dibujoRef = useRef<Dibujo | null>(null)
  const cerrarDibujoRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (typeof window === 'undefined' || !divRef.current || mapRef.current) return
    const L = require('leaflet')
    require('leaflet/dist/leaflet.css')
    LRef.current = L
    const map = L.map(divRef.current, { center: [40.0, -3.5], zoom: 6, zoomControl: true })
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri, Maxar, Earthstar Geographics', maxZoom: 20,
    }).addTo(map)
    const CapaArboles = crearCapaArboles(L)
    arbolesLayerRef.current = new CapaArboles({ maxZoom: 22, maxNativeZoom: 22, zIndex: 450 })
    arbolesLayerRef.current.addTo(map)
    caminosLayerRef.current = L.layerGroup().addTo(map)
    zonasLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // Dibujo de zonas: un clic añade un vértice; doble clic cierra el polígono
    map.on('click', (e: any) => {
      if (!dibujoRef.current) return
      setDibujo(d => (d ? { ...d, vertices: [...d.vertices, [e.latlng.lat, e.latlng.lng]] } : d))
    })
    map.on('dblclick', () => { if (dibujoRef.current) cerrarDibujoRef.current() })
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(divRef.current)
    return () => { ro.disconnect(); map.remove(); mapRef.current = null }
  }, [])

  // Contorno de la parcela elegida (la geometría completa, sin tocar)
  useEffect(() => {
    const map = mapRef.current, L = LRef.current
    if (!map || !L) return
    if (parcelaLayerRef.current) { map.removeLayer(parcelaLayerRef.current); parcelaLayerRef.current = null }
    setResultado(null)
    setMejorBusqueda(null)
    setError('')
    setExclusiones([]); setModoSectores(false); setSectores([]); setSectorActivo(null); setPiezas(null); setDibujo(null); setTerminando(false)
    if (!parcela?.geojson) return
    const capa = L.geoJSON(parcela.geojson, { interactive: false, style: { color: '#00e5ff', weight: 2.5, fillColor: '#00e5ff', fillOpacity: 0.06 } }).addTo(map)
    parcelaLayerRef.current = capa
    try { map.fitBounds(capa.getBounds(), { padding: [30, 30] }) } catch { /* geometría vacía */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcela?.id, parcela?.geojson])

  const params = useMemo(() => ({
    distArboles: num(distArboles), distLineas: num(distLineas), cabecera: num(cabecera), lateral: num(lateral),
    ...(conCaminos ? { caminoMaxLinea: num(caminoMax), caminoAncho: num(caminoAncho) } : {}),
  }), [distArboles, distLineas, cabecera, lateral, conCaminos, caminoMax, caminoAncho])

  // Superficie donde se puede plantar: la parcela (o el sector en curso) menos los sectores ya terminados,
  // el camino con el anterior y las zonas de exclusión
  const dominioInfo = useMemo((): { dom: Dominio | null; err: string } => {
    if (!parcela?.geojson) return { dom: null, err: '' }
    if (modoSectores && !sectorActivo) return { dom: null, err: '' }
    try {
      const prev = sectores[sectores.length - 1]
      const dom = dominioPlantacion(parcela.geojson, {
        sector: modoSectores ? (sectorActivo as number[][][][]) : undefined,
        sectoresPrevios: modoSectores ? sectores.map(sc => sc.geom) : [],
        caminoAnterior: modoSectores && prev?.caminoSiguiente ? { geom: prev.geom, ancho: prev.caminoSiguiente } : undefined,
        exclusiones,
      })
      return { dom, err: dom.supHa <= 0 ? 'No queda superficie donde plantar: el sector o las zonas de exclusión no dejan espacio.' : '' }
    } catch {
      return { dom: null, err: 'El contorno dibujado no es válido (se cruza consigo mismo). Bórralo y vuélvelo a dibujar.' }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcela?.geojson, modoSectores, sectorActivo, sectores, exclusiones])
  const dominio = dominioInfo.dom && dominioInfo.dom.supHa > 0 ? dominioInfo.dom : null

  // Lo que queda de la parcela sin repartir entre sectores (sobre esto se corta para el siguiente sector)
  const restante = useMemo((): Dominio | null => {
    if (!modoSectores || sectorActivo || !parcela?.geojson) return null
    try {
      const d = dominioPlantacion(parcela.geojson, { sectoresPrevios: sectores.map(sc => sc.geom) })
      return d.supHa > 0.0001 ? d : null
    } catch { return null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcela?.geojson, modoSectores, sectorActivo, sectores])

  // Árboles, caminos, cabeceras y zonas dibujadas en el mapa
  useEffect(() => {
    const map = mapRef.current, L = LRef.current
    if (!map || !L || !arbolesLayerRef.current) return
    caminosLayerRef.current.clearLayers()
    zonasLayerRef.current.clearLayers()
    const estiloCamino = { color: COLOR_CAMINO, weight: 1, fillColor: COLOR_CAMINO, fillOpacity: 0.6, interactive: false }
    const arboles: ConjuntoArboles[] = []
    let latRef = 40
    const poner = (res: ResultadoOrientacion, extra: [number, number][][], color: string, esp: number) => {
      const anillos = [...res.cabecerasGeo, ...res.caminosGeo, ...extra]
      if (anillos.length) L.polygon(anillos.map(r => [r]), estiloCamino).addTo(caminosLayerRef.current) // un solo polígono múltiple
      if (res.puntos.length) { arboles.push({ puntos: res.puntos, color, espaciadoM: esp }); latRef = res.puntos[0] }
    }
    sectores.forEach(sc => poner(sc.resultado, mpAAnillosLatLon(sc.caminoPrevio), sc.color, Math.min(num(sc.params.distArboles) || 1, num(sc.params.distLineas) || 1)))
    if (resultado) poner(resultado, mpAAnillosLatLon(dominio?.camino || null), colorActivo, Math.min(num(distArboles) || 1, num(distLineas) || 1))
    arbolesLayerRef.current.setDatos(arboles, latRef)

    // Zonas de exclusión
    exclusiones.forEach((z, i) => {
      L.polygon(aLatLon(z), { color: '#e53935', weight: 2, dashArray: '6 4', fillColor: '#e53935', fillOpacity: 0.35, interactive: false })
        .bindTooltip(`Exclusión ${i + 1}`, { permanent: false }).addTo(zonasLayerRef.current)
    })
    // Contornos de los sectores (terminados y en curso)
    sectores.forEach(sc => L.polygon(mpALeaflet(sc.geom), { color: sc.color, weight: 3, fillOpacity: 0, interactive: false }).addTo(zonasLayerRef.current))
    if (modoSectores && sectorActivo) L.polygon(mpALeaflet(sectorActivo), { color: colorActivo, weight: 3, dashArray: '8 5', fillOpacity: 0.04, interactive: false }).addTo(zonasLayerRef.current)
    // Lo que queda por repartir (donde se dibuja el corte) y los trozos entre los que elegir
    if (modoSectores && !sectorActivo && restante && !piezas) {
      L.polygon(mpALeaflet(restante.geometria.coordinates), { color: '#ffffff', weight: 2, dashArray: '6 4', fillColor: '#ffffff', fillOpacity: 0.12, interactive: false }).addTo(zonasLayerRef.current)
    }
    if (modoSectores && !sectorActivo && piezas) {
      piezas.forEach((pz, i) => {
        const col = COLORES_PIEZA[i % COLORES_PIEZA.length]
        L.polygon(mpALeaflet(pz.mp), { color: col, weight: 2, fillColor: col, fillOpacity: 0.4, interactive: true })
          .bindTooltip(`Trozo ${i + 1} · ${pz.supHa.toFixed(2)} ha — púlsalo para elegirlo`, { sticky: true })
          .on('click', () => { setSectorActivo(pz.mp); setError('') }) // se conservan los trozos para poder elegir otro
          .addTo(zonasLayerRef.current)
      })
    }
    // Vista previa de lo que se está dibujando
    if (dibujo && dibujo.vertices.length) {
      const col = dibujo.tipo === 'exclusion' ? '#e53935' : '#ffffff'
      if (dibujo.tipo === 'exclusion' && dibujo.vertices.length >= 3) L.polygon(dibujo.vertices, { color: col, weight: 2, dashArray: '4 4', fillOpacity: 0.1, interactive: false }).addTo(zonasLayerRef.current)
      else L.polyline(dibujo.vertices, { color: col, weight: 2, interactive: false }).addTo(zonasLayerRef.current)
      dibujo.vertices.forEach(v => L.circleMarker(v, { radius: 4, color: '#000', weight: 1, fillColor: col, fillOpacity: 1, interactive: false }).addTo(zonasLayerRef.current))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado, sectores, exclusiones, dibujo, sectorActivo, modoSectores, dominio, restante, piezas])

  // Cursor en cruz y sin zoom por doble clic mientras se dibuja
  useEffect(() => {
    dibujoRef.current = dibujo
    const map = mapRef.current
    if (!map) return
    map.getContainer().style.cursor = dibujo ? 'crosshair' : ''
    if (dibujo) map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
  }, [dibujo])

  // Recalcula al momento cuando cambia la dirección de la brújula, la parcela o cualquier dato.
  // Pequeño retardo para no calcular en cada píxel mientras se arrastra la aguja.
  useEffect(() => {
    if (!dominio) { setResultado(null); setError(dominioInfo.err); return }
    const errParams = validarParams(params)
    if (errParams) { setResultado(null); setError(errParams); return }
    setCalculando(true)
    const t = setTimeout(() => {
      try {
        const r = analizarPlantacion(dominio.geometria, params, [azimutLineas(rumbo)])
        setResultado(r.orientaciones[0])
        setSupHa(dominio.supHa)
        setMarcoTeorico(r.marcoTeoricoHaArboles)
        setError('')
      } catch (e: any) {
        setResultado(null)
        setError(e?.message || 'No se pudo calcular el análisis.')
      } finally {
        setCalculando(false)
      }
    }, 80)
    return () => clearTimeout(t)
  }, [dominio, dominioInfo.err, params, rumbo])

  // Si cambian los datos, la "mejor orientación" encontrada deja de valer
  useEffect(() => { setMejorBusqueda(null) }, [dominio, params])

  // Conjuntos (parcela entera o sectores) y textos que lleva la imagen exportada
  const construirExport = (): { conjuntos: ConjuntoImagen[]; bloques: BloqueTexto[]; generales: string[] } | null => {
    const conjuntos: ConjuntoImagen[] = []
    const bloques: BloqueTexto[] = []
    const lineas = (p: ParamsTexto, rumboX: number, arboles: number, arbolesHa: number, caminos: number, extra?: string): string[] => [
      `Marco de plantación: ${p.distArboles} × ${p.distLineas} m (entre árboles × entre líneas)`,
      `Ancho de calle: ${p.distLineas} m`,
      `Densidad: ${fmt(arbolesHa, 1)} plantas/ha · ${fmt(arboles)} árboles`,
      `Dirección de las líneas: ${rumboX}° (${nombreRumbo(rumboX)})`,
      `Cabeceras ${p.cabecera} m · laterales ${p.lateral} m${p.conCaminos ? ` · ${caminos} camino${caminos === 1 ? '' : 's'} de ${p.caminoAncho} m (línea máx. ${p.caminoMax} m)` : ''}`,
      ...(extra ? [extra] : []),
    ]
    const varios = sectores.length + (modoSectores && sectorActivo && resultado ? 1 : 0) > 1
    sectores.forEach((sc, i) => {
      const ant = sectores[i - 1]
      conjuntos.push({
        etiqueta: sc.nombre, color: sc.color, puntos: sc.resultado.puntos,
        espaciadoM: Math.min(num(sc.params.distArboles) || 1, num(sc.params.distLineas) || 1),
        caminosGeo: sc.resultado.caminosGeo, cabecerasGeo: sc.resultado.cabecerasGeo,
        caminoEntreSectoresGeo: mpAAnillosLatLon(sc.caminoPrevio), contornos: contornosLatLon(sc.geom), rumbo: sc.rumbo,
      })
      bloques.push({
        titulo: `${sc.nombre} · ${fmt(sc.supHa, 2)} ha`, color: sc.color,
        lineas: lineas(sc.params, sc.rumbo, sc.resultado.arboles, sc.resultado.arbolesHa, sc.resultado.caminos,
          ant?.caminoSiguiente ? `Camino con ${ant.nombre}: ${fmt(ant.caminoSiguiente, 1)} m de ancho` : undefined),
      })
    })
    if (resultado && dominio && (!modoSectores || sectorActivo)) {
      const ant = sectores[sectores.length - 1]
      const p: ParamsTexto = { distArboles, distLineas, cabecera, lateral, conCaminos, caminoMax, caminoAncho }
      conjuntos.push({
        etiqueta: modoSectores ? `Sector ${sectores.length + 1}` : undefined, color: modoSectores ? colorActivo : '#b6f04a',
        puntos: resultado.puntos, espaciadoM: Math.min(num(distArboles) || 1, num(distLineas) || 1),
        caminosGeo: resultado.caminosGeo, cabecerasGeo: resultado.cabecerasGeo,
        caminoEntreSectoresGeo: mpAAnillosLatLon(dominio.camino),
        contornos: modoSectores && sectorActivo ? contornosLatLon(sectorActivo) : undefined, rumbo,
      })
      bloques.push({
        titulo: `${modoSectores ? `Sector ${sectores.length + 1}` : 'Plantación'} · ${fmt(dominio.supHa, 2)} ha`,
        color: varios ? colorActivo : undefined,
        lineas: lineas(p, rumbo, resultado.arboles, resultado.arbolesHa, resultado.caminos,
          modoSectores && ant?.caminoSiguiente ? `Camino con ${ant.nombre}: ${fmt(ant.caminoSiguiente, 1)} m de ancho` : undefined),
      })
    }
    if (!conjuntos.length) return null
    const total = conjuntos.reduce((n, c) => n + c.puntos.length / 2, 0)
    const generales = [
      `Parcela ${fmt(parcela?.supHa || 0, 2)} ha${exclusiones.length ? ` · ${exclusiones.length} zona${exclusiones.length === 1 ? '' : 's'} de exclusión` : ''}${conjuntos.length > 1 ? ` · ${conjuntos.length} sectores · ${fmt(total)} árboles en total` : ''}`,
    ]
    return { conjuntos, bloques, generales }
  }

  // Vista previa de la imagen a exportar: se redibuja al cambiar las capas elegidas
  useEffect(() => {
    if (!exportAbierto || !parcela?.geojson) return
    const datos = construirExport()
    if (!datos) return
    let cancelado = false
    setExportCargando(true)
    const t = setTimeout(async () => {
      try {
        const { canvas, sateliteOk } = await renderizarImagen({
          geojson: parcela.geojson, conjuntos: datos.conjuntos, exclusionesGeo: exclusiones.map(aLatLon),
          capas: capasExport, titulo: parcela.nombre, generales: datos.generales, bloques: datos.bloques,
        })
        const blob = await canvasABlob(canvas)
        if (cancelado) return
        setExportBlob(blob)
        setExportUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
        setExportAviso(sateliteOk ? '' : 'No se pudo cargar el fondo de satélite; la imagen sale sin él.')
      } catch (e: any) {
        if (!cancelado) setExportAviso(e?.message || 'No se pudo generar la imagen.')
      } finally {
        if (!cancelado) setExportCargando(false)
      }
    }, 150)
    return () => { cancelado = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportAbierto, capasExport, resultado, rumbo, sectores, exclusiones])

  const cerrarExport = () => {
    setExportAbierto(false)
    setExportBlob(null)
    setExportUrl(prev => { if (prev) URL.revokeObjectURL(prev); return '' })
  }

  const descargarImagen = () => {
    if (!exportBlob || !parcela) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(exportBlob)
    const nSect = sectores.length + (modoSectores && sectorActivo && resultado ? 1 : 0)
    a.download = `plantacion-${parcela.nombre.replace(/[^\w\-]+/g, '_')}-${nSect > 1 ? `${nSect}sectores` : `${rumbo}grados`}.png`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  // ---- Dibujo de zonas y sectores ----
  const empezarDibujo = (tipo: Dibujo['tipo']) => { setError(''); setDibujo({ tipo, vertices: [] }); if (isMobile) setPanelAbierto(false) }
  const quitarUltimoPunto = () => setDibujo(d => (d ? { ...d, vertices: d.vertices.slice(0, -1) } : d))
  // Recorta lo que queda de la parcela con la línea dibujada y deja elegir uno de los trozos
  const cortarRestante = (linea: [number, number][]) => {
    if (!restante) return
    const r = cortarConLinea(restante.geometria.coordinates, linea.map(([la, lo]) => [lo, la] as [number, number]))
    if (r.error) { setError(r.error); return }
    setError('')
    setPiezas(r.piezas.map((p, i) => ({ ...p, id: i })))
  }
  const cancelarDibujo = () => { setDibujo(null); if (isMobile) setPanelAbierto(true) }
  const cerrarDibujo = () => {
    const d = dibujoRef.current
    if (!d) return
    // un doble clic añade dos puntos iguales seguidos: se quitan
    const v = d.vertices.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
    if (d.tipo === 'exclusion') {
      if (v.length < 3) { setError('Hacen falta al menos 3 puntos para cerrar la zona.'); return }
      setExclusiones(prev => [...prev, v.map(([la, lo]) => [lo, la] as [number, number])])
    } else {
      if (v.length < 2) { setError('La línea de corte necesita al menos 2 puntos.'); return }
      cortarRestante(v)
    }
    setDibujo(null)
    if (isMobile) setPanelAbierto(true)
  }
  cerrarDibujoRef.current = cerrarDibujo

  const crearSectores = () => { setModoSectores(true); setSectorActivo(null); setPiezas(null); setSectores([]); setError('') }
  const salirDeSectores = () => {
    if (sectores.length > 0 && !confirm('Se descartarán los sectores ya terminados. ¿Continuar?')) return
    setModoSectores(false); setSectores([]); setSectorActivo(null); setPiezas(null); setDibujo(null); setError('')
  }
  const deshacerUltimoSector = () => { setSectores(prev => prev.slice(0, -1)); setSectorActivo(null); setPiezas(null) }
  const abrirTerminar = () => { setEsCamino(false); setAnchoCamino(cabecera); setTerminando(true) }
  const confirmarTerminar = () => {
    if (!resultado || !dominio || !sectorActivo) return
    let ancho: number | null = null
    if (esCamino) {
      ancho = num(anchoCamino)
      if (!(ancho > 0)) { setError('Indica el ancho del camino (mayor que 0).'); return }
    }
    const nuevo: SectorTerminado = {
      id: Date.now(), nombre: `Sector ${sectores.length + 1}`, color: colorActivo, geom: sectorActivo, rumbo,
      params: { distArboles, distLineas, cabecera, lateral, conCaminos, caminoMax, caminoAncho },
      resultado, supHa: dominio.supHa, caminoPrevio: dominio.camino, caminoSiguiente: ancho,
    }
    setSectores(prev => [...prev, nuevo])
    setSectorActivo(null)
    setPiezas(null)
    setResultado(null)
    setTerminando(false)
    setError('')
  }

  // Prueba una orientación cada 15° y deja la brújula en la que más árboles da
  const buscarMejor = () => {
    if (!dominio) { setError(dominioInfo.err || 'Elige primero una parcela.'); return }
    const errParams = validarParams(params)
    if (errParams) { setError(errParams); return }
    setBuscando(true)
    setTimeout(() => {
      try {
        const r = analizarPlantacion(dominio.geometria, params, ANGULOS_BUSQUEDA, false)
        const mejor = r.orientaciones[r.mejor]
        setMejorBusqueda({ angulo: mejor.angulo, arboles: mejor.arboles })
        setRumbo(mejor.angulo)
        setError('')
      } catch (e: any) {
        setError(e?.message || 'No se pudo calcular el análisis.')
      } finally {
        setBuscando(false)
      }
    }, 30)
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'row', background: 'var(--bg)', overflow: 'hidden', position: 'relative' }}>
      {/* Panel de datos y resultados. Móvil: hoja inferior sobre el mapa, como en la pestaña MAPA, que se recoge
          entera y desplegada nunca pasa del 50 % de la pestaña. */}
      <div style={isMobile ? {
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1100,
        height: panelAbierto ? '50%' : 52,
        borderRadius: '16px 16px 0 0', boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
        transition: 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box',
      } : {
        width: 360, flexShrink: 0, overflowY: 'auto', padding: 16, borderRight: '1px solid var(--border)', height: '100%', boxSizing: 'border-box',
      }}>
        {isMobile && (
          <div onClick={() => setPanelAbierto(p => !p)} role="button" aria-expanded={panelAbierto} aria-label={panelAbierto ? 'Recoger panel' : 'Desplegar panel'}
            style={{ padding: '14px 16px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0, minHeight: 52, boxSizing: 'border-box' }}>
            <div style={{ width: 44, height: 5, borderRadius: 3, background: 'var(--green)', opacity: 0.7 }} />
            {!panelAbierto && resultado && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>
                {fmt(resultado.arboles)} árboles · líneas a {rumbo}°
              </span>
            )}
          </div>
        )}
        <div style={isMobile ? { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px 16px', display: panelAbierto ? 'block' : 'none' } : undefined}>
        <div style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)', marginBottom: 12, letterSpacing: '0.06em' }}>🌳 ANÁLISIS DE PLANTACIÓN</div>

        <label style={labelStyle}>1 · Finca y parcela</label>
        <select value={fincaId} onChange={e => setFincaId(e.target.value)} style={inputStyle} aria-label="Finca">
          <option value="">Selecciona una finca…</option>
          {opcionesFinca.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
        </select>
        <select value={parcelaId} onChange={e => setParcelaId(e.target.value)} disabled={!fincaId} style={{ ...inputStyle, marginTop: 8, opacity: fincaId ? 1 : 0.6 }} aria-label="Parcela">
          <option value="">{fincaId ? 'Selecciona una parcela…' : 'Primero elige la finca'}</option>
          {parcelasFinca.map(p => <option key={p.id} value={p.id}>{p.nombre} · {fmt(p.supHa, 2)} ha</option>)}
        </select>
        {parcelas.length === 0 && <div style={ayudaStyle}>No hay parcelas guardadas con geometría.</div>}

        {error && <div role="alert" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'var(--mono)', color: '#6E2417', background: 'rgba(110, 36, 23,0.08)', border: '1px solid rgba(110, 36, 23,0.3)' }}>⚠ {error}</div>}

        {parcela && (
          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>Zonas dentro de la parcela</label>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>🚫 Zonas de exclusión</div>
            <div style={ayudaStyle}>No se planta en ellas y se respetan las cabeceras y los laterales a su alrededor.</div>
            {exclusiones.map((z, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6, fontSize: 12, color: 'var(--text)' }}>
                <span>Exclusión {i + 1} · {fmt(supHaAnillo(z), 2)} ha</span>
                <button onClick={() => setExclusiones(prev => prev.filter((_, j) => j !== i))} aria-label={`Quitar la exclusión ${i + 1}`} title="Quitar esta zona"
                  style={{ width: 22, height: 22, lineHeight: '18px', padding: 0, borderRadius: 4, border: '1px solid #b3261e', background: 'transparent', color: '#b3261e', fontWeight: 700, cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button onClick={() => empezarDibujo('exclusion')} disabled={!!dibujo} style={{ ...botonSec, opacity: dibujo ? 0.5 : 1 }}>+ DIBUJAR ZONA DE EXCLUSIÓN</button>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginTop: 16 }}>🧩 Sectores</div>
            {!modoSectores ? (
              <>
                <div style={ayudaStyle}>Divide la parcela en sectores para diseñar plantaciones distintas (marco, dirección…). Se recorta la parcela con una línea y se elige el trozo, de uno en uno, como en los sectores de riego.</div>
                <button onClick={crearSectores} style={botonSec}>CREAR SECTORES</button>
              </>
            ) : (
              <>
                {sectores.map(sc => (
                  <div key={sc.id} style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--surface2)', border: `2px solid ${sc.color}`, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', lineHeight: 1.5 }}>
                    <b>{sc.nombre}</b> · {fmt(sc.supHa, 2)} ha · {fmt(sc.resultado.arboles)} árboles ({fmt(sc.resultado.arbolesHa, 1)}/ha)<br />
                    Marco {sc.params.distArboles} × {sc.params.distLineas} m · líneas a {sc.rumbo}° ({nombreRumbo(sc.rumbo)})
                    {sc.caminoSiguiente ? <><br />Camino con el siguiente: {fmt(sc.caminoSiguiente, 1)} m</> : null}
                  </div>
                ))}
                {!sectorActivo ? (
                  restante ? (
                    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, border: `2px dashed ${colorActivo}`, fontSize: 11, color: 'var(--text)', lineHeight: 1.5 }}>
                      <b>Sector {sectores.length + 1}</b> · quedan {fmt(restante.supHa, 2)} ha de la parcela sin repartir.
                      {piezas ? (
                        <>
                          <div style={ayudaStyle}>Elige el trozo que será este sector, en el mapa o aquí:</div>
                          {piezas.map((pz, i) => (
                            <button key={pz.id} onClick={() => { setSectorActivo(pz.mp); setError('') }}
                              style={{ ...botonSec, borderColor: COLORES_PIEZA[i % COLORES_PIEZA.length], color: 'var(--text)' }}>
                              Trozo {i + 1} · {fmt(pz.supHa, 2)} ha
                            </button>
                          ))}
                          <button onClick={() => setPiezas(null)} style={botonPeligro}>CANCELAR EL CORTE</button>
                        </>
                      ) : (
                        <>
                          <div style={ayudaStyle}>Corta la parcela con una línea que la cruce (empieza y acaba fuera de ella) y elige el trozo. Si es el último, usa todo lo que queda.</div>
                          <button onClick={() => empezarDibujo('corte')} disabled={!!dibujo} style={{ ...botonSec, opacity: dibujo ? 0.5 : 1 }}>✂️ CORTAR LA PARCELA</button>
                          <button onClick={() => { setSectorActivo(restante.geometria.coordinates); setError('') }} style={botonSec}>USAR TODO LO QUE QUEDA ({fmt(restante.supHa, 2)} ha)</button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text)' }}>Ya está repartida toda la parcela. Puedes exportar la imagen.</div>
                  )
                ) : (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text)' }}>
                    Diseñando el <b>Sector {sectores.length + 1}</b> ({fmt(dominioInfo.dom?.supHa || 0, 2)} ha plantables). Ajusta los datos de abajo y pulsa TERMINADA.
                    <button onClick={() => { setSectorActivo(null); setResultado(null) }} style={botonSec}>↺ ELEGIR OTRO TROZO</button>
                  </div>
                )}
                {sectores.length > 0 && <button onClick={deshacerUltimoSector} style={botonSec}>↩ DESHACER EL ÚLTIMO SECTOR</button>}
                {sectores.length > 0 && !sectorActivo && !piezas && (
                  <button onClick={() => setExportAbierto(true)} style={{ ...botonSec, background: 'var(--green)', color: '#fff' }}>📷 EXPORTAR IMAGEN</button>
                )}
                <button onClick={salirDeSectores} style={botonPeligro}>SALIR DE LOS SECTORES</button>
              </>
            )}
          </div>
        )}

        {parcela && (!modoSectores || sectorActivo) && !dibujo && (
        <>
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>2 · Espacio alrededor (m)</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>Cabeceras</div>
              <input type="text" inputMode="decimal" value={cabecera} onChange={e => setCabecera(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>Laterales</div>
              <input type="text" inputMode="decimal" value={lateral} onChange={e => setLateral(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>3 · Marco de plantación (m)</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>Entre árboles de una línea</div>
              <input type="text" inputMode="decimal" value={distArboles} onChange={e => setDistArboles(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>Entre líneas</div>
              <input type="text" inputMode="decimal" value={distLineas} onChange={e => setDistLineas(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text)' }}>
            <input type="checkbox" checked={conCaminos} onChange={e => setConCaminos(e.target.checked)} />
            4 · Caminos (opcional)
          </label>
          {conCaminos && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>Longitud máx. de línea sin camino</div>
                <input type="text" inputMode="decimal" value={caminoMax} onChange={e => setCaminoMax(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>Ancho del camino</div>
                <input type="text" inputMode="decimal" value={caminoAncho} onChange={e => setCaminoAnchoManual(e.target.value)} style={inputStyle} />
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>5 · Dirección de las líneas</label>
          <BrujulaOrientacion valor={rumbo} onChange={setRumbo} />
          <div style={{ ...ayudaStyle, textAlign: 'center' }}>Gira la aguja arrastrándola, usa las flechas del teclado o pulsa una dirección. El mapa y los resultados se recalculan al momento.</div>
          <button onClick={buscarMejor} disabled={buscando || !parcela}
            style={{ width: '100%', marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'transparent', border: '1px solid var(--green)', color: 'var(--green)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', cursor: buscando ? 'wait' : 'pointer', opacity: !parcela || buscando ? 0.6 : 1 }}>
            {buscando ? 'BUSCANDO…' : '⭐ BUSCAR LA ORIENTACIÓN CON MÁS ÁRBOLES'}
          </button>
        </div>

        {resultado && (
          <div style={{ marginTop: 16, opacity: calculando ? 0.55 : 1, transition: 'opacity .15s' }}>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Resultado</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 8 }}>
              {modoSectores ? 'Sector' : 'Parcela'} {fmt(supHa, 2)} ha · marco teórico {fmt(marcoTeorico, 0)} árboles/ha
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(46,125,50,0.12)', border: '2px solid var(--green)', color: 'var(--text)' }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{modoSectores ? `Sector ${sectores.length + 1} · ` : ''}Líneas a {rumbo}° · {nombreRumbo(rumbo)}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{fmt(resultado.arboles)} <span style={{ fontSize: 11, fontWeight: 400 }}>árboles</span></div>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
                {fmt(resultado.arbolesHa, 1)} árboles/ha · {fmt(resultado.lineas)} líneas{conCaminos ? ` · ${resultado.caminos} camino${resultado.caminos === 1 ? '' : 's'}` : ''}
              </div>
            </div>
            {modoSectores && (
              <button onClick={abrirTerminar}
                style={{ width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 8, background: colorActivo, border: '2px solid #000', color: '#000', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, letterSpacing: '0.06em', cursor: 'pointer' }}>
                ✔ TERMINADA
              </button>
            )}
            <button onClick={() => setExportAbierto(true)}
              style={{ width: '100%', marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--green)', border: 'none', color: '#fff', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', cursor: 'pointer' }}>
              📷 EXPORTAR IMAGEN
            </button>
            {mejorBusqueda && (
              <div style={{ ...ayudaStyle, marginTop: 8 }}>
                ⭐ Mejor orientación probada (cada 15°): <b>{mejorBusqueda.angulo}°</b> con {fmt(mejorBusqueda.arboles)} árboles
                {resultado.arboles < mejorBusqueda.arboles ? ` · la actual tiene ${fmt(mejorBusqueda.arboles - resultado.arboles)} menos` : ' · es la que tienes ahora'}.
              </div>
            )}
          </div>
        )}
        </>
        )}
        </div>
      </div>

      {/* Mapa (en móvil ocupa toda la pestaña y el panel se superpone) */}
      <div style={isMobile ? { position: 'absolute', inset: 0 } : { flex: 1, minHeight: 0, position: 'relative' }}>
        <div ref={divRef} style={{ position: 'absolute', inset: 0 }} />
        {resultado && !dibujo && (
          <div style={{ position: 'absolute', top: 10, left: 50, zIndex: 1000, background: 'rgba(255,255,255,0.92)', color: '#111', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontFamily: 'var(--mono)', boxShadow: '0 1px 6px rgba(0,0,0,0.35)' }}>
            <b>{modoSectores ? `Sector ${sectores.length + 1} · ` : ''}Líneas a {rumbo}° ({nombreRumbo(rumbo)})</b> · {fmt(resultado.arboles)} árboles
          </div>
        )}
        {dibujo && (
          <div role="toolbar" aria-label="Dibujo de zona" style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 1200, background: 'rgba(255,255,255,0.95)', color: '#111', borderRadius: 10, padding: '8px 10px', boxShadow: '0 2px 10px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', maxWidth: '92%' }}>
            <div style={{ fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'center' }}>
              {dibujo.tipo === 'exclusion' ? '🚫 Zona de exclusión' : `✂️ Línea de corte (sector ${sectores.length + 1})`} · clic = punto · doble clic = {dibujo.tipo === 'exclusion' ? 'cerrar' : 'cortar'} · {dibujo.vertices.length} punto{dibujo.vertices.length === 1 ? '' : 's'}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button onClick={cerrarDibujo} disabled={dibujo.vertices.length < (dibujo.tipo === 'exclusion' ? 3 : 2)} style={{ padding: '6px 10px', borderRadius: 6, border: 'none', background: '#2e7d32', color: '#fff', fontWeight: 700, fontSize: 11, cursor: 'pointer', opacity: dibujo.vertices.length < (dibujo.tipo === 'exclusion' ? 3 : 2) ? 0.5 : 1 }}>{dibujo.tipo === 'exclusion' ? '✔ CERRAR' : '✂️ CORTAR'}</button>
              <button onClick={quitarUltimoPunto} disabled={!dibujo.vertices.length} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #555', background: '#fff', color: '#111', fontSize: 11, cursor: 'pointer', opacity: dibujo.vertices.length ? 1 : 0.5 }}>↩ Quitar punto</button>
              <button onClick={cancelarDibujo} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #b3261e', background: '#fff', color: '#b3261e', fontSize: 11, cursor: 'pointer' }}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
      {terminando && (
        <div onClick={() => setTerminando(false)} style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Terminar sector"
            style={{ background: 'var(--surface)', color: 'var(--text)', borderRadius: 12, width: '100%', maxWidth: 420, padding: 18, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 13, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)', marginBottom: 10 }}>✔ TERMINAR SECTOR {sectores.length + 1}</div>
            <div style={{ fontSize: 13, marginBottom: 10 }}>¿La linde con el <b>siguiente sector</b> será un camino?</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" name="camino" checked={!esCamino} onChange={() => setEsCamino(false)} /> No, no será un camino
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 6 }}>
              <input type="radio" name="camino" checked={esCamino} onChange={() => setEsCamino(true)} /> Sí, será un camino
            </label>
            {esCamino && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>Ancho del camino (m)</div>
                <input type="text" inputMode="decimal" value={anchoCamino} onChange={e => setAnchoCamino(e.target.value)} style={inputStyle} autoFocus />
                <div style={ayudaStyle}>El camino se descuenta del siguiente sector, pegado a este. En él no se planta.</div>
              </div>
            )}
            {error && <div role="alert" style={{ marginTop: 8, fontSize: 11, fontFamily: 'var(--mono)', color: '#6E2417' }}>⚠ {error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={confirmarTerminar} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: 'var(--green)', border: 'none', color: '#fff', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>GUARDAR SECTOR</button>
              <button onClick={() => setTerminando(false)} style={{ padding: '10px 12px', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {exportAbierto && (resultado || sectores.length > 0) && (
        <div onClick={cerrarExport} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Exportar imagen"
            style={{ background: 'var(--surface)', color: 'var(--text)', borderRadius: 12, width: '100%', maxWidth: 980, maxHeight: '94vh', display: 'flex', flexDirection: isMobile ? 'column' : 'row', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ flex: 1, minHeight: isMobile ? 160 : 0, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10, overflow: 'auto', position: 'relative' }}>
              {exportUrl && <img src={exportUrl} alt="Vista previa de la imagen" style={{ maxWidth: '100%', maxHeight: isMobile ? '36vh' : '86vh', objectFit: 'contain', opacity: exportCargando ? 0.5 : 1, transition: 'opacity .15s' }} />}
              {exportCargando && <div style={{ position: 'absolute', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Preparando imagen…</div>}
            </div>
            <div style={{ width: isMobile ? '100%' : 260, flexShrink: 0, padding: 16, boxSizing: 'border-box', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)', letterSpacing: '0.06em' }}>📷 EXPORTAR IMAGEN</div>
              <div style={{ ...labelStyle, marginTop: 4, marginBottom: 0 }}>Qué se ve</div>
              {([
                ['satelite', 'Fondo de satélite'],
                ['contorno', sectores.length > 0 ? 'Contorno de la parcela y de los sectores' : 'Contorno de la parcela'],
                ['exclusiones', 'Zonas de exclusión'],
                ['arboles', 'Árboles'],
                ['caminos', 'Caminos y cabeceras'],
                ['brujula', sectores.length > 1 || (sectores.length === 1 && resultado) ? 'Dirección de cada sector' : 'Brújula con la dirección'],
                ['datos', 'Datos (marco, calle, densidad, dirección)'],
              ] as [keyof CapasImagen, string][]).map(([k, txt]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={capasExport[k]}
                    onChange={e => setCapasExport(c => ({ ...c, [k]: e.target.checked }))} />
                  {txt}
                </label>
              ))}
              {exportAviso && <div role="alert" style={{ fontSize: 11, fontFamily: 'var(--mono)', color: '#6E2417', background: 'rgba(110, 36, 23,0.08)', border: '1px solid rgba(110, 36, 23,0.3)', borderRadius: 6, padding: '6px 8px' }}>⚠ {exportAviso}</div>}
              <div style={{ flex: 1 }} />
              <button onClick={descargarImagen} disabled={!exportBlob || exportCargando}
                style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--green)', border: 'none', color: '#fff', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, letterSpacing: '0.06em', cursor: 'pointer', opacity: !exportBlob || exportCargando ? 0.6 : 1 }}>
                ⬇ DESCARGAR PNG
              </button>
              <button onClick={cerrarExport}
                style={{ padding: '8px 14px', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
