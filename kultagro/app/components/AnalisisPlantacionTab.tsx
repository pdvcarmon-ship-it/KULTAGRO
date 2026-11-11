'use client'

// Pestaña PLANTACIÓN: análisis de cuántos árboles caben en una parcela según el marco, las distancias a
// las lindes (cabeceras/medianeras y laterales), los caminos opcionales y la orientación de las líneas.
// Calcula las 4 orientaciones posibles y deja ver cada una dibujada en el mapa. Todo se calcula en el
// navegador; no guarda nada ni modifica la parcela.

import { useEffect, useMemo, useRef, useState } from 'react'
import { analizarPlantacion, ORIENTACIONES, type AnalisisPlantacion } from '../lib/analisisPlantacion'

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
  const [resultado, setResultado] = useState<AnalisisPlantacion | null>(null)
  const [orientIdx, setOrientIdx] = useState(0)
  const [calculando, setCalculando] = useState(false)
  const [error, setError] = useState('')

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
    setError('')
    if (!parcela?.geojson) return
    const capa = L.geoJSON(parcela.geojson, { style: { color: '#00e5ff', weight: 2.5, fillColor: '#00e5ff', fillOpacity: 0.06 } }).addTo(map)
    parcelaLayerRef.current = capa
    try { map.fitBounds(capa.getBounds(), { padding: [30, 30] }) } catch { /* geometría vacía */ }
  }, [parcela])

  // Árboles y caminos de la orientación elegida
  useEffect(() => {
    const map = mapRef.current, L = LRef.current
    if (!map || !L || !arbolesLayerRef.current) return
    caminosLayerRef.current.clearLayers()
    if (!resultado) { arbolesLayerRef.current.setDatos(new Float64Array(0), 1, 40); return }
    const o = resultado.orientaciones[orientIdx]
    o.caminosGeo.forEach(anillo => {
      L.polygon(anillo, { color: '#d9b06b', weight: 1, fillColor: '#c8a165', fillOpacity: 0.6, interactive: false }).addTo(caminosLayerRef.current)
    })
    const latRef = o.puntos.length ? o.puntos[0] : 40
    arbolesLayerRef.current.setDatos(o.puntos, Math.min(num(distArboles) || 1, num(distLineas) || 1), latRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado, orientIdx])

  const calcular = () => {
    if (!parcela) { setError('Elige primero una parcela.'); return }
    setError('')
    const params = {
      distArboles: num(distArboles), distLineas: num(distLineas), cabecera: num(cabecera), lateral: num(lateral),
      ...(conCaminos ? { caminoMaxLinea: num(caminoMax), caminoAncho: num(caminoAncho) } : {}),
    }
    setCalculando(true)
    setTimeout(() => { // deja pintar el "Calculando…" antes de bloquear el hilo
      try {
        const r = analizarPlantacion(parcela.geojson, params)
        setResultado(r)
        setOrientIdx(r.mejor)
      } catch (e: any) {
        setResultado(null)
        setError(e?.message || 'No se pudo calcular el análisis.')
      } finally {
        setCalculando(false)
      }
    }, 30)
  }

  const mejorArboles = resultado ? resultado.orientaciones[resultado.mejor].arboles : 0
  const seleccion = resultado?.orientaciones[orientIdx]

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: isMobile ? 'column' : 'row', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Panel de datos y resultados */}
      <div style={{ width: isMobile ? '100%' : 360, flexShrink: 0, overflowY: 'auto', padding: 16, borderRight: isMobile ? 'none' : '1px solid var(--border)', maxHeight: isMobile ? '55%' : '100%', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--green)', marginBottom: 12, letterSpacing: '0.06em' }}>🌳 ANÁLISIS DE PLANTACIÓN</div>

        <label style={labelStyle}>1 · Parcela</label>
        <select value={parcelaId} onChange={e => setParcelaId(e.target.value)} style={inputStyle}>
          <option value="">Selecciona una parcela…</option>
          {parcelas.map(p => <option key={p.id} value={p.id}>{p.nombre} · {fmt(p.supHa, 2)} ha</option>)}
        </select>
        {parcelas.length === 0 && <div style={ayudaStyle}>No hay parcelas guardadas con geometría.</div>}
        <div style={ayudaStyle}>Si la parcela tiene varios recintos se trata como una sola. El análisis usa la geometría completa dibujada.</div>

        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>2 · Espacio alrededor (m)</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>Cabeceras y medianeras</div>
              <input type="text" inputMode="decimal" value={cabecera} onChange={e => setCabecera(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3 }}>Laterales</div>
              <input type="text" inputMode="decimal" value={lateral} onChange={e => setLateral(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={ayudaStyle}>
            <b>Cabeceras y medianeras:</b> del inicio/final de las líneas hasta la linde, y ancho de los caminos de mitad de línea.<br />
            <b>Laterales:</b> de la última línea hasta la linde.
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
            4 · Poner caminos (opcional)
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
          <div style={ayudaStyle}>Los caminos van en perpendicular a las líneas, de lado a lado de la parcela, cada vez que una línea superaría la longitud máxima. No se planta en ellos. El ancho es por defecto el de las cabeceras y medianeras.</div>
        </div>

        <button onClick={calcular} disabled={calculando || !parcela}
          style={{ width: '100%', marginTop: 16, padding: '10px 16px', borderRadius: 8, background: 'var(--green)', border: 'none', color: '#fff', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, letterSpacing: '0.06em', cursor: calculando ? 'wait' : 'pointer', opacity: !parcela || calculando ? 0.6 : 1 }}>
          {calculando ? 'CALCULANDO…' : 'CALCULAR ORIENTACIONES'}
        </button>
        {error && <div role="alert" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'var(--mono)', color: '#6E2417', background: 'rgba(110, 36, 23,0.08)', border: '1px solid rgba(110, 36, 23,0.3)' }}>⚠ {error}</div>}

        {resultado && (
          <div style={{ marginTop: 16 }}>
            <div style={{ ...labelStyle, marginBottom: 6 }}>5 · Orientación de las líneas (pulsa para verla en el mapa)</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 8 }}>
              Parcela {fmt(resultado.supHa, 2)} ha · marco teórico {fmt(resultado.marcoTeoricoHaArboles, 0)} árboles/ha
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {resultado.orientaciones.map((o, i) => {
                const activa = i === orientIdx
                const dif = mejorArboles - o.arboles
                return (
                  <button key={o.angulo} onClick={() => setOrientIdx(i)}
                    style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: activa ? 'rgba(46,125,50,0.12)' : 'var(--surface)', border: activa ? '2px solid var(--green)' : '1px solid var(--border)', color: 'var(--text)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{ORIENTACIONES.find(x => x.angulo === o.angulo)?.nombre}</span>
                      {i === resultado.mejor && <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 700 }}>⭐ MÁS ÁRBOLES</span>}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{fmt(o.arboles)} <span style={{ fontSize: 11, fontWeight: 400 }}>árboles</span></div>
                    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>
                      {fmt(o.arbolesHa, 1)} árboles/ha · {fmt(o.lineas)} líneas{conCaminos ? ` · ${o.caminos} camino${o.caminos === 1 ? '' : 's'}` : ''}
                      {dif > 0 ? ` · ${fmt(dif)} menos que la mejor` : ''}
                    </div>
                  </button>
                )
              })}
            </div>
            <div style={{ ...ayudaStyle, marginTop: 10 }}>
              Las orientaciones opuestas dan el mismo resultado (N = S, E = O, NE = SO, SE = NO). Cálculo sobre terreno plano: no tiene en cuenta pendiente, luz, viento ni maquinaria; más árboles no siempre es mejor orientación.
            </div>
          </div>
        )}
      </div>

      {/* Mapa */}
      <div style={{ flex: 1, minHeight: isMobile ? 300 : 0, position: 'relative' }}>
        <div ref={divRef} style={{ position: 'absolute', inset: 0 }} />
        {seleccion && (
          <div style={{ position: 'absolute', top: 10, left: 50, zIndex: 1000, background: 'rgba(255,255,255,0.92)', color: '#111', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontFamily: 'var(--mono)', boxShadow: '0 1px 6px rgba(0,0,0,0.35)' }}>
            <b>{ORIENTACIONES.find(x => x.angulo === seleccion.angulo)?.nombre}</b> · {fmt(seleccion.arboles)} árboles
          </div>
        )}
      </div>
    </div>
  )
}
