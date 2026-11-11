'use client'

// Pestaña PLANTACIÓN: análisis de cuántos árboles caben en una parcela según el marco, las distancias a
// las lindes (cabeceras/medianeras y laterales), los caminos opcionales y la orientación de las líneas.
// La orientación se elige con una brújula (arrastrando la aguja o pulsando una dirección) y todo se
// recalcula al momento y se dibuja en el mapa. Todo se calcula en el navegador; no guarda nada ni
// modifica la parcela.

import { useEffect, useMemo, useRef, useState } from 'react'
import { analizarPlantacion, azimutLineas, nombreRumbo, validarParams, type ResultadoOrientacion } from '../lib/analisisPlantacion'
import BrujulaOrientacion from './BrujulaOrientacion'
import { renderizarImagen, canvasABlob, type CapasImagen } from '../lib/exportImagen'

const ANGULOS_BUSQUEDA = Array.from({ length: 12 }, (_, i) => i * 15) // 0°, 15°… 165°

interface ParcelaPlantacion {
  id: string
  nombre: string
  supHa: number
  cultivo?: string
  geojson: any
}

interface Props {
  parcelas: ParcelaPlantacion[]
  isMobile: boolean
}

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
const ayudaStyle: React.CSSProperties = { fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 3, lineHeight: 1.45 }

// Capa de Leaflet que dibuja los árboles en canvas, por teselas y solo los visibles (aguanta decenas de miles)
const crearCapaArboles = (L: any) =>
  L.GridLayer.extend({
    setDatos(puntos: Float64Array, espaciadoM: number, latRef: number) {
      this._pts = puntos
      this._esp = espaciadoM
      this._latRef = latRef
      this.redraw()
    },
    createTile(coords: any) {
      const size = this.getTileSize()
      const tile = document.createElement('canvas')
      tile.width = size.x
      tile.height = size.y
      const pts: Float64Array | undefined = this._pts
      if (!pts || !pts.length) return tile
      const ctx = tile.getContext('2d')
      if (!ctx) return tile
      const z = coords.z
      const mundo = size.x * Math.pow(2, z)
      const x0 = coords.x * size.x, y0 = coords.y * size.y
      const mPorPx = (156543.03392 * Math.cos((this._latRef * Math.PI) / 180)) / Math.pow(2, z) * (256 / size.x)
      const r = Math.max(1, Math.min(4, (this._esp / mPorPx) * 0.28))
      const pad = r + 2
      const oeste = ((x0 - pad) / mundo) * 360 - 180, este = ((x0 + size.x + pad) / mundo) * 360 - 180
      const latDe = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / mundo))) * 180) / Math.PI
      const norte = latDe(y0 - pad), sur = latDe(y0 + size.y + pad)
      ctx.fillStyle = '#b6f04a'
      ctx.strokeStyle = 'rgba(0,0,0,0.65)'
      ctx.lineWidth = 0.8
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
      return tile
    },
  })

export default function AnalisisPlantacionTab({ parcelas, isMobile }: Props) {
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
  const [capasExport, setCapasExport] = useState<CapasImagen>({ satelite: true, contorno: true, arboles: true, caminos: true, brujula: true, datos: true })
  const [exportBlob, setExportBlob] = useState<Blob | null>(null)
  const [exportUrl, setExportUrl] = useState('')
  const [exportCargando, setExportCargando] = useState(false)
  const [exportAviso, setExportAviso] = useState('')
  const [panelAbierto, setPanelAbierto] = useState(true) // solo móvil: hoja inferior desplegada o recogida

  const parcela = useMemo(() => parcelas.find(p => p.id === parcelaId), [parcelas, parcelaId])
  const caminoAncho = caminoAnchoManual ?? cabecera

  // ---- Mapa ----
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const parcelaLayerRef = useRef<any>(null)
  const caminosLayerRef = useRef<any>(null)
  const arbolesLayerRef = useRef<any>(null)

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
    mapRef.current = map
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
    if (!parcela?.geojson) return
    const capa = L.geoJSON(parcela.geojson, { style: { color: '#00e5ff', weight: 2.5, fillColor: '#00e5ff', fillOpacity: 0.06 } }).addTo(map)
    parcelaLayerRef.current = capa
    try { map.fitBounds(capa.getBounds(), { padding: [30, 30] }) } catch { /* geometría vacía */ }
  }, [parcela])

  // Árboles y caminos del resultado actual
  useEffect(() => {
    const map = mapRef.current, L = LRef.current
    if (!map || !L || !arbolesLayerRef.current) return
    caminosLayerRef.current.clearLayers()
    if (!resultado) { arbolesLayerRef.current.setDatos(new Float64Array(0), 1, 40); return }
    const o = resultado
    o.caminosGeo.forEach(anillo => {
      L.polygon(anillo, { color: '#d9b06b', weight: 1, fillColor: '#c8a165', fillOpacity: 0.6, interactive: false }).addTo(caminosLayerRef.current)
    })
    const latRef = o.puntos.length ? o.puntos[0] : 40
    arbolesLayerRef.current.setDatos(o.puntos, Math.min(num(distArboles) || 1, num(distLineas) || 1), latRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado])

  const params = useMemo(() => ({
    distArboles: num(distArboles), distLineas: num(distLineas), cabecera: num(cabecera), lateral: num(lateral),
    ...(conCaminos ? { caminoMaxLinea: num(caminoMax), caminoAncho: num(caminoAncho) } : {}),
  }), [distArboles, distLineas, cabecera, lateral, conCaminos, caminoMax, caminoAncho])

  // Recalcula al momento cuando cambia la dirección de la brújula, la parcela o cualquier dato.
  // Pequeño retardo para no calcular en cada píxel mientras se arrastra la aguja.
  useEffect(() => {
    if (!parcela?.geojson) return
    const errParams = validarParams(params)
    if (errParams) { setResultado(null); setError(errParams); return }
    setCalculando(true)
    const t = setTimeout(() => {
      try {
        const r = analizarPlantacion(parcela.geojson, params, [azimutLineas(rumbo)])
        setResultado(r.orientaciones[0])
        setSupHa(r.supHa)
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
  }, [parcela, params, rumbo])

  // Si cambian los datos, la "mejor orientación" encontrada deja de valer
  useEffect(() => { setMejorBusqueda(null) }, [parcela, params])

  // Vista previa de la imagen a exportar: se redibuja al cambiar las capas elegidas
  useEffect(() => {
    if (!exportAbierto || !resultado || !parcela?.geojson) return
    let cancelado = false
    setExportCargando(true)
    const t = setTimeout(async () => {
      try {
        const { canvas, sateliteOk } = await renderizarImagen({
          geojson: parcela.geojson, puntos: resultado.puntos, caminosGeo: resultado.caminosGeo,
          espaciadoM: Math.min(num(distArboles) || 1, num(distLineas) || 1), capas: capasExport, rumbo,
          titulo: parcela.nombre,
          lineasTexto: [
            `${fmt(resultado.arboles)} árboles · ${fmt(resultado.arbolesHa, 1)} árboles/ha · ${fmt(resultado.lineas)} líneas${conCaminos ? ` · ${resultado.caminos} camino${resultado.caminos === 1 ? '' : 's'}` : ''}`,
            `Parcela ${fmt(supHa, 2)} ha · marco ${distArboles} × ${distLineas} m · cabeceras ${cabecera} m · laterales ${lateral} m`,
            `Líneas a ${rumbo}° (${nombreRumbo(rumbo)})`,
          ],
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
  }, [exportAbierto, capasExport, resultado, rumbo])

  const cerrarExport = () => {
    setExportAbierto(false)
    setExportBlob(null)
    setExportUrl(prev => { if (prev) URL.revokeObjectURL(prev); return '' })
  }

  const descargarImagen = () => {
    if (!exportBlob || !parcela) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(exportBlob)
    a.download = `plantacion-${parcela.nombre.replace(/[^\w\-]+/g, '_')}-${rumbo}grados.png`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  // Prueba una orientación cada 15° y deja la brújula en la que más árboles da
  const buscarMejor = () => {
    if (!parcela?.geojson) { setError('Elige primero una parcela.'); return }
    const errParams = validarParams(params)
    if (errParams) { setError(errParams); return }
    setBuscando(true)
    setTimeout(() => {
      try {
        const r = analizarPlantacion(parcela.geojson, params, ANGULOS_BUSQUEDA)
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

        <label style={labelStyle}>1 · Parcela</label>
        <select value={parcelaId} onChange={e => setParcelaId(e.target.value)} style={inputStyle}>
          <option value="">Selecciona una parcela…</option>
          {parcelas.map(p => <option key={p.id} value={p.id}>{p.nombre} · {fmt(p.supHa, 2)} ha</option>)}
        </select>
        {parcelas.length === 0 && <div style={ayudaStyle}>No hay parcelas guardadas con geometría.</div>}

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
        {error && <div role="alert" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'var(--mono)', color: '#6E2417', background: 'rgba(110, 36, 23,0.08)', border: '1px solid rgba(110, 36, 23,0.3)' }}>⚠ {error}</div>}

        {resultado && (
          <div style={{ marginTop: 16, opacity: calculando ? 0.55 : 1, transition: 'opacity .15s' }}>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Resultado</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 8 }}>
              Parcela {fmt(supHa, 2)} ha · marco teórico {fmt(marcoTeorico, 0)} árboles/ha
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(46,125,50,0.12)', border: '2px solid var(--green)', color: 'var(--text)' }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Líneas a {rumbo}° · {nombreRumbo(rumbo)}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{fmt(resultado.arboles)} <span style={{ fontSize: 11, fontWeight: 400 }}>árboles</span></div>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
                {fmt(resultado.arbolesHa, 1)} árboles/ha · {fmt(resultado.lineas)} líneas{conCaminos ? ` · ${resultado.caminos} camino${resultado.caminos === 1 ? '' : 's'}` : ''}
              </div>
            </div>
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
        </div>
      </div>

      {/* Mapa (en móvil ocupa toda la pestaña y el panel se superpone) */}
      <div style={isMobile ? { position: 'absolute', inset: 0 } : { flex: 1, minHeight: 0, position: 'relative' }}>
        <div ref={divRef} style={{ position: 'absolute', inset: 0 }} />
        {resultado && (
          <div style={{ position: 'absolute', top: 10, left: 50, zIndex: 1000, background: 'rgba(255,255,255,0.92)', color: '#111', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontFamily: 'var(--mono)', boxShadow: '0 1px 6px rgba(0,0,0,0.35)' }}>
            <b>Líneas a {rumbo}° ({nombreRumbo(rumbo)})</b> · {fmt(resultado.arboles)} árboles
          </div>
        )}
      </div>
      {exportAbierto && resultado && (
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
                ['contorno', 'Contorno de la parcela'],
                ['arboles', 'Árboles'],
                ['caminos', conCaminos ? 'Caminos' : 'Caminos (no activados)'],
                ['brujula', 'Brújula con la dirección'],
                ['datos', 'Datos (título y cifras)'],
              ] as [keyof CapasImagen, string][]).map(([k, txt]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', opacity: k === 'caminos' && !conCaminos ? 0.5 : 1 }}>
                  <input type="checkbox" checked={capasExport[k]} disabled={k === 'caminos' && !conCaminos}
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
