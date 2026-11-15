'use client'

// components/DecaModal.tsx
//
// "Crear DeCA" (pestaña COSECHAS): formulario con el contenido mínimo del art. 6 de la Orden
// FOM/2861/2012, generación del PDF con QR y metadatos (lib/decaPdf.ts), guardado en Supabase
// (tabla `decas` + bucket privado `decas`, ver sql/11_deca.sql) y enlace público de descarga
// directa (app/api/deca/[token]/route.ts).
//
// Orden de la creación — pensado para que la fecha de creación del PDF coincida con la que
// registra el servidor:
//   1. se inserta el registro (el servidor fija creado_en = now())
//   2. se genera el PDF con ESA fecha como CreationDate/ModDate
//   3. se sube el PDF al bucket y se anota la ruta en el registro

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import {
  DECA_VACIO, UNIDADES_DECA, type DatosDeca,
  validarDeca, normalizarDeca, generarToken, destinosGuardados, textoDestino, urlDeca, esHttps, hoyMadrid,
  enlaceVigente, fechaLimiteEnlace, formatFechaDeca, formatFechaHoraMadrid, nombreArchivoDeca, textoPeso,
} from '../lib/deca'
import { generarDecaPdf, qrComoDataUrl } from '../lib/decaPdf'

// Parcela guardada, ya preparada para el desplegable de origen.
export interface ParcelaDeca {
  id: string
  fincaId: string
  nombre: string
  sigpac: string        // referencia(s) SIGPAC en texto
  cultivo: string       // cultivo y variedad, p. ej. «Olivar (Hojiblanca)»
}

export interface CargadorDeca {
  fincaId: string
  etiqueta: string      // nombre de la finca, para el selector
  nombre: string
  nif: string
  domicilio: string
}

interface Props {
  session: Session
  isMobile: boolean
  cargadores: CargadorDeca[]
  fincas: { id: string; nombre: string }[]
  parcelas: ParcelaDeca[]
  inicial?: Partial<DatosDeca>   // datos precargados (p. ej. desde una cosecha)
  fincaIdInicial?: string
  onClose: () => void
}

interface FilaDeca {
  id: string
  token: string
  datos: DatosDeca
  fecha_fin_servicio: string
  pdf_path: string | null
  creado_en: string
}

interface Resultado { url: string; bytes: Uint8Array; nombre: string; qr: string; creadoEn: Date }

const lbl: CSSProperties = { display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase' }
const inp: CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }
const seccion: CSSProperties = { fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--green)', textShadow: 'var(--green-outline)', letterSpacing: '0.06em', fontWeight: 700, marginTop: 4 }
const nota: CSSProperties = { fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', lineHeight: 1.4 }
const botonSec: CSSProperties = { padding: '8px 12px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer' }
const botonPrim: CSSProperties = { padding: '8px 12px', borderRadius: 6, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }

const baseUrl = (): string => (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, '')
const esLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u)

const mensajeError = (e: any): string => {
  const txt = String(e?.message || e || '')
  if (/relation .*decas.* does not exist|schema cache|Could not find the table/i.test(txt) || e?.code === '42P01' || e?.code === 'PGRST205')
    return 'Falta crear la tabla "decas" en Supabase. Ejecuta sql/11_deca.sql y vuelve a intentarlo.'
  if (/bucket not found/i.test(txt)) return 'Falta el almacenamiento "decas" en Supabase. Ejecuta sql/11_deca.sql y vuelve a intentarlo.'
  return `No se pudo crear el DeCA: ${txt || 'error desconocido'}`
}

// Uint8Array -> Blob PDF (el cast evita un choque de tipos entre versiones de TypeScript)
const aBlobPdf = (b: Uint8Array): Blob => new Blob([b as unknown as BlobPart], { type: 'application/pdf' })

const abrirBlob = (blob: Blob, ventana?: Window | null) => {
  const u = URL.createObjectURL(blob)
  if (ventana) ventana.location.href = u
  else window.open(u, '_blank')
  setTimeout(() => URL.revokeObjectURL(u), 60_000)
}

const guardarBlob = (blob: Blob, nombre: string) => {
  const u = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = u; a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(u), 10_000)
}

const copiar = async (texto: string) => {
  try { await navigator.clipboard.writeText(texto) }
  catch { window.prompt('Copia el enlace:', texto) }
}

export default function DecaModal({ session, isMobile, cargadores, fincas, parcelas, inicial, fincaIdInicial, onClose }: Props) {
  const hoy = hoyMadrid()
  const cargadorInicial = cargadores.find(c => c.fincaId === fincaIdInicial) || cargadores[0]

  const [vista, setVista] = useState<'nuevo' | 'resultado' | 'historial'>('nuevo')
  const [fincaCargadorId, setFincaCargadorId] = useState(cargadorInicial?.fincaId || '')
  const [transportePropio, setTransportePropio] = useState(false)
  const [datos, setDatos] = useState<DatosDeca>(() => ({
    ...DECA_VACIO,
    cargadorNombre: cargadorInicial?.nombre || '', cargadorNif: cargadorInicial?.nif || '', cargadorDomicilio: cargadorInicial?.domicilio || '',
    fechaTransporte: hoy,
    ...inicial,
  }))
  const [errores, setErrores] = useState<string[]>([])
  const [generando, setGenerando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [historial, setHistorial] = useState<FilaDeca[]>([])
  const [cargandoHist, setCargandoHist] = useState(true)
  const [avisoHist, setAvisoHist] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [origenFincaId, setOrigenFincaId] = useState(fincaIdInicial || '')
  const [origenParcelaId, setOrigenParcelaId] = useState('')

  const set = <K extends keyof DatosDeca>(k: K, v: DatosDeca[K]) => setDatos(prev => ({ ...prev, [k]: v }))

  const cargarHistorial = async (): Promise<FilaDeca[]> => {
    const { data, error } = await supabase
      .from('decas')
      .select('id, token, datos, fecha_fin_servicio, pdf_path, creado_en')
      .not('pdf_path', 'is', null)
      .order('creado_en', { ascending: false })
      .limit(100)
    if (error) {
      setAvisoHist(mensajeError(error))
      setCargandoHist(false)
      return []
    }
    const filas = (data || []) as FilaDeca[]
    setHistorial(filas)
    setAvisoHist('')
    setCargandoHist(false)
    return filas
  }

  // Al abrir: carga el historial y, si el transportista y las matrículas están vacíos, reutiliza los del último DeCA.
  useEffect(() => {
    let vivo = true
    cargarHistorial().then(filas => {
      const ultimo = filas[0]?.datos
      if (!vivo || !ultimo) return
      setDatos(prev => ({
        ...prev,
        transportistaNombre: prev.transportistaNombre || ultimo.transportistaNombre || '',
        transportistaNif: prev.transportistaNif || ultimo.transportistaNif || '',
        matriculaVehiculo: prev.matriculaVehiculo || ultimo.matriculaVehiculo || '',
        matriculaRemolque: prev.matriculaRemolque || ultimo.matriculaRemolque || '',
        destino: prev.destino || ultimo.destino || '',
        destinoNif: prev.destino ? prev.destinoNif : (ultimo.destinoNif || ''),
      }))
    })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const parcelasDeFinca = parcelas.filter(p => p.fincaId === origenFincaId)
  const destinos = useMemo(() => destinosGuardados(historial.map(h => h.datos)), [historial])

  // Origen = «FINCA (SIGPAC)» y Mercancía = cultivo y variedad de la parcela elegida.
  const elegirOrigenFinca = (fincaId: string) => {
    setOrigenFincaId(fincaId)
    setOrigenParcelaId('')
    const f = fincas.find(x => x.id === fincaId)
    setDatos(prev => ({ ...prev, origen: f ? f.nombre : '' }))
  }
  const elegirOrigenParcela = (parcelaId: string) => {
    setOrigenParcelaId(parcelaId)
    const p = parcelas.find(x => x.id === parcelaId)
    const f = fincas.find(x => x.id === origenFincaId)
    if (!p || !f) return
    setDatos(prev => ({ ...prev, origen: p.sigpac && p.sigpac !== '—' ? `${f.nombre} (${p.sigpac})` : f.nombre, naturaleza: p.cultivo || prev.naturaleza }))
  }

  // Al escribir/elegir un destino ya usado, se completa su NIF/DNI.
  const cambiarDestino = (valor: string) => {
    const guardado = destinos.find(x => x.destino.toLowerCase() === valor.trim().toLowerCase())
    setDatos(prev => ({ ...prev, destino: valor, destinoNif: guardado ? guardado.destinoNif : prev.destinoNif }))
  }

  const elegirCargador = (fincaId: string) => {
    setFincaCargadorId(fincaId)
    const c = cargadores.find(x => x.fincaId === fincaId)
    if (c) setDatos(prev => ({ ...prev, cargadorNombre: c.nombre, cargadorNif: c.nif, cargadorDomicilio: c.domicilio }))
  }

  const datosFinales = useMemo<DatosDeca>(() => transportePropio
    ? { ...datos, transportistaNombre: datos.cargadorNombre, transportistaNif: datos.cargadorNif }
    : datos, [datos, transportePropio])

  const crear = async () => {
    const d = normalizarDeca(datosFinales)
    const lista = validarDeca(d)
    const base = baseUrl()
    if (!esHttps(base) && !esLocal(base)) lista.push('La URL del documento debe empezar por https://. Configura NEXT_PUBLIC_APP_URL con la dirección https de la aplicación.')
    if (lista.length > 0) { setErrores(lista); return }

    setErrores([])
    setGenerando(true)
    try {
      const id = crypto.randomUUID()
      const token = generarToken()
      const url = urlDeca(base, token)

      // 1. Registro: el servidor fija la fecha y hora de creación.
      const { data: fila, error: errIns } = await supabase
        .from('decas')
        .insert({ id, user_id: session.user.id, token, datos: d, fecha_transporte: d.fechaTransporte, fecha_fin_servicio: d.fechaFinServicio })
        .select('creado_en')
        .single()
      if (errIns || !fila) throw errIns || new Error('No se pudo registrar el documento')
      const creadoEn = new Date(fila.creado_en)

      // 2. PDF con esa fecha en los metadatos.
      const bytes = await generarDecaPdf({ datos: d, url, creadoEn, codigo: id.slice(0, 8).toUpperCase() })

      // 3. Subida al bucket privado y anotación de la ruta.
      const ruta = `${session.user.id}/${id}.pdf`
      const { error: errUp } = await supabase.storage.from('decas').upload(ruta, aBlobPdf(bytes), { contentType: 'application/pdf', upsert: false })
      if (errUp) throw errUp
      const { error: errUpd } = await supabase.from('decas').update({ pdf_path: ruta, modificado_en: fila.creado_en }).eq('id', id)
      if (errUpd) throw errUpd

      setResultado({ url, bytes, nombre: nombreArchivoDeca(d), qr: await qrComoDataUrl(url, 240), creadoEn })
      setVista('resultado')
      cargarHistorial()
    } catch (e) {
      console.error('Error creando el DeCA:', e)
      setErrores([mensajeError(e)])
    } finally {
      setGenerando(false)
    }
  }

  const blobResultado = (r: Resultado) => aBlobPdf(r.bytes)

  const compartir = async (r: Resultado) => {
    const archivo = new File([r.bytes as unknown as BlobPart], r.nombre, { type: 'application/pdf' })
    const nav: any = navigator
    try {
      if (nav.canShare?.({ files: [archivo] })) await nav.share({ files: [archivo], title: 'DeCA', text: `DeCA — ${r.url}` })
      else await nav.share({ title: 'DeCA', text: 'Documento de Control Administrativo', url: r.url })
    } catch { /* el usuario canceló */ }
  }

  const descargarDeHistorial = async (fila: FilaDeca, modo: 'abrir' | 'guardar') => {
    if (!fila.pdf_path) return
    const ventana = modo === 'abrir' ? window.open('', '_blank') : null
    const { data, error } = await supabase.storage.from('decas').download(fila.pdf_path)
    if (error || !data) { ventana?.close(); alert('No se pudo descargar el PDF. Inténtalo de nuevo.'); return }
    if (modo === 'abrir') abrirBlob(data, ventana)
    else guardarBlob(data, nombreArchivoDeca(fila.datos))
  }

  // Un DeCA nuevo a partir de uno anterior (p. ej. para corregir datos): el original se conserva.
  const duplicar = (fila: FilaDeca) => {
    setDatos({ ...DECA_VACIO, ...fila.datos, fechaTransporte: hoy, fechaFinServicio: '' })
    setTransportePropio(false)
    setErrores([])
    setVista('nuevo')
  }

  const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }

  const pestanaBtn = (id: 'nuevo' | 'historial', texto: string) => (
    <button onClick={() => setVista(id)}
      style={{ ...botonSec, background: (vista === id || (id === 'nuevo' && vista === 'resultado')) ? 'rgba(31, 74, 40, 1)' : 'var(--surface2)', color: (vista === id || (id === 'nuevo' && vista === 'resultado')) ? 'var(--bg)' : 'var(--text)', fontWeight: 700 }}>
      {texto}
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 10 : 20 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--green)', borderRadius: 12, width: '100%', maxWidth: 560, padding: isMobile ? 16 : 24, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--green)', textShadow: 'var(--green-outline)' }}>🚛 CREAR DeCA</div>
          <button onClick={onClose} title="Cerrar" style={{ background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {pestanaBtn('nuevo', 'Nuevo')}
          {pestanaBtn('historial', `Generados${historial.length ? ` (${historial.length})` : ''}`)}
        </div>

        {/* ---------------- NUEVO ---------------- */}
        {vista === 'nuevo' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={nota}>Documento de Control Administrativo del transporte de mercancías por carretera. Se genera un PDF con código QR y un enlace de descarga directa.</div>

            <div style={seccion}>1. CARGADOR CONTRACTUAL</div>
            {cargadores.length > 1 && (
              <div>
                <label style={lbl}>Datos de la explotación de</label>
                <select value={fincaCargadorId} onChange={e => elegirCargador(e.target.value)} style={inp}>
                  {cargadores.map(c => <option key={c.fincaId} value={c.fincaId}>{c.etiqueta}</option>)}
                </select>
              </div>
            )}
            <div style={grid2}>
              <div>
                <label style={lbl}>Nombre o razón social <span style={{ color: '#6E2417' }}>*</span></label>
                <input value={datos.cargadorNombre} onChange={e => set('cargadorNombre', e.target.value)} style={inp} />
              </div>
              <div>
                <label style={lbl}>NIF <span style={{ color: '#6E2417' }}>*</span></label>
                <input value={datos.cargadorNif} onChange={e => set('cargadorNif', e.target.value)} style={inp} autoCapitalize="characters" />
              </div>
            </div>
            <div>
              <label style={lbl}>Domicilio <span style={{ color: '#6E2417' }}>*</span></label>
              <input value={datos.cargadorDomicilio} onChange={e => set('cargadorDomicilio', e.target.value)} style={inp} />
            </div>
            {cargadores.length === 0 && (
              <div style={nota}>Puedes rellenar estos datos automáticamente guardando los datos de la explotación en la pestaña de Mis parcelas (cuaderno de campo).</div>
            )}

            <div style={seccion}>2. TRANSPORTISTA EFECTIVO</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={transportePropio} onChange={e => setTransportePropio(e.target.checked)} />
              Transporto yo (el transportista es el mismo cargador)
            </label>
            {transportePropio ? (
              <div style={nota}>Si transportas con tu propio vehículo, comprueba si ese transporte necesita título habilitante: si no lo necesita, el DeCA no es obligatorio. Ante la duda, consulta con tu asesor de transporte.</div>
            ) : (
              <div style={grid2}>
                <div>
                  <label style={lbl}>Nombre o razón social <span style={{ color: '#6E2417' }}>*</span></label>
                  <input value={datos.transportistaNombre} onChange={e => set('transportistaNombre', e.target.value)} style={inp} />
                </div>
                <div>
                  <label style={lbl}>NIF <span style={{ color: '#6E2417' }}>*</span></label>
                  <input value={datos.transportistaNif} onChange={e => set('transportistaNif', e.target.value)} style={inp} autoCapitalize="characters" />
                </div>
              </div>
            )}

            <div style={seccion}>3. ENVÍO</div>
            <div style={grid2}>
              <div>
                <label style={lbl}>Origen: finca</label>
                <select value={origenFincaId} onChange={e => elegirOrigenFinca(e.target.value)} style={inp}>
                  <option value="">Selecciona finca</option>
                  {fincas.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Origen: parcela</label>
                <select value={origenParcelaId} onChange={e => elegirOrigenParcela(e.target.value)} style={inp} disabled={!origenFincaId}>
                  <option value="">{origenFincaId ? 'Selecciona parcela' : 'Primero elige la finca'}</option>
                  {parcelasDeFinca.map(p => <option key={p.id} value={p.id}>{p.nombre ? `${p.nombre} · ` : ''}{p.cultivo}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={lbl}>Origen <span style={{ color: '#6E2417' }}>*</span></label>
              <input value={datos.origen} onChange={e => set('origen', e.target.value)} style={inp} placeholder="FINCA (referencia SIGPAC)" />
            </div>
            <div>
              <label style={lbl}>Mercancía <span style={{ color: '#6E2417' }}>*</span></label>
              <input value={datos.naturaleza} onChange={e => set('naturaleza', e.target.value)} style={inp} placeholder="Cultivo y variedad, p. ej.: Olivar (Hojiblanca)" />
            </div>
            <div style={grid2}>
              <div>
                <label style={lbl}>Destino <span style={{ color: '#6E2417' }}>*</span></label>
                <input list="destinos-deca" value={datos.destino} onChange={e => cambiarDestino(e.target.value)} style={inp} placeholder="Comprador / destinatario" />
                <datalist id="destinos-deca">
                  {destinos.map(x => <option key={`${x.destino}|${x.destinoNif}`} value={x.destino}>{x.destinoNif}</option>)}
                </datalist>
              </div>
              <div>
                <label style={lbl}>NIF / DNI del destino</label>
                <input value={datos.destinoNif} onChange={e => set('destinoNif', e.target.value)} style={inp} autoCapitalize="characters" />
              </div>
            </div>
            <div style={nota}>Los destinos se guardan al crear el DeCA y salen como sugerencia la próxima vez. En el documento aparecen como «Destino (NIF)».</div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl}>Peso <span style={{ color: '#6E2417' }}>*</span></label>
                <input type="number" inputMode="decimal" step="any" min="0" value={datos.cantidad} onChange={e => set('cantidad', e.target.value)} style={inp} />
              </div>
              <div>
                <label style={lbl}>Unidad</label>
                <select value={datos.unidad} onChange={e => set('unidad', e.target.value)} style={inp}>
                  {UNIDADES_DECA.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div style={nota}>Si el peso exacto es de difícil determinación, indica otra magnitud (sacos, cajas, unidades…).</div>

            <div style={seccion}>4. TRANSPORTE</div>
            <div style={grid2}>
              <div>
                <label style={lbl}>Fecha del transporte <span style={{ color: '#6E2417' }}>*</span></label>
                <input type="date" min={hoy} value={datos.fechaTransporte} onChange={e => set('fechaTransporte', e.target.value)} style={inp} />
              </div>
              <div>
                <label style={lbl}>Fin del servicio (si dura varios días)</label>
                <input type="date" min={datos.fechaTransporte || hoy} value={datos.fechaFinServicio} onChange={e => set('fechaFinServicio', e.target.value)} style={inp} />
              </div>
            </div>
            <div style={grid2}>
              <div>
                <label style={lbl}>Matrícula del vehículo (tractor) <span style={{ color: '#6E2417' }}>*</span></label>
                <input value={datos.matriculaVehiculo} onChange={e => set('matriculaVehiculo', e.target.value)} style={inp} autoCapitalize="characters" placeholder="E1234BBB" />
              </div>
              <div>
                <label style={lbl}>Matrícula remolque / semirremolque</label>
                <input value={datos.matriculaRemolque} onChange={e => set('matriculaRemolque', e.target.value)} style={inp} autoCapitalize="characters" placeholder="Si lo hay" />
              </div>
            </div>
            <div>
              <label style={lbl}>Autorización especial de circulación</label>
              <input value={datos.autorizacionEspecial} onChange={e => set('autorizacionEspecial', e.target.value)} style={inp} placeholder="Solo si el vehículo circula amparado por una" />
            </div>
            <div>
              <label style={lbl}>Observaciones o reservas</label>
              <textarea value={datos.observaciones} onChange={e => set('observaciones', e.target.value)} rows={2} placeholder="Solo si las partes lo piden (opcional)..." style={{ ...inp, resize: 'vertical' }} />
            </div>

            <div style={nota}>El DeCA debe crearse antes de iniciar el servicio y entregarse al conductor (en el móvil o impreso, siempre con el QR). Una vez creado no se puede borrar: debe conservarse al menos un año. Para corregir datos, crea uno nuevo desde «Generados → Duplicar».</div>

            {errores.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {errores.map((e, i) => <div key={i} style={{ color: '#6E2417', fontSize: 11, fontFamily: 'var(--mono)' }}>• {e}</div>)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={crear} disabled={generando} style={{ flex: 1, padding: 11, borderRadius: 8, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, cursor: generando ? 'wait' : 'pointer', opacity: generando ? 0.7 : 1 }}>
                {generando ? 'GENERANDO…' : 'CREAR DeCA'}
              </button>
              <button onClick={onClose} style={{ flex: 1, padding: 11, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, cursor: 'pointer' }}>CANCELAR</button>
            </div>
          </div>
        )}

        {/* ---------------- RESULTADO ---------------- */}
        {vista === 'resultado' && resultado && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>✅ DeCA creado el {formatFechaHoraMadrid(resultado.creadoEn)}</div>
            <img src={resultado.qr} alt="Código QR del DeCA" width={200} height={200} style={{ background: '#fff', padding: 6, borderRadius: 6 }} />
            <div style={{ ...nota, wordBreak: 'break-all', maxWidth: '100%' }}>{resultado.url}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => abrirBlob(blobResultado(resultado))} style={botonPrim}>Abrir PDF</button>
              <button onClick={() => guardarBlob(blobResultado(resultado), resultado.nombre)} style={botonSec}>Descargar</button>
              <button onClick={async () => { await copiar(resultado.url); setCopiado(true); setTimeout(() => setCopiado(false), 2000) }} style={botonSec}>{copiado ? '¡Copiado!' : 'Copiar enlace'}</button>
              {typeof navigator !== 'undefined' && 'share' in navigator && <button onClick={() => compartir(resultado)} style={botonSec}>Compartir</button>}
            </div>
            <div style={{ ...nota, textAlign: 'left' }}>
              Entrega esta copia al conductor antes de iniciar el servicio, en el móvil o impresa, y en ambos casos con el QR. En una inspección basta con mostrar el QR; las anotaciones a mano en una copia impresa no cuentan.
            </div>
            <div style={{ display: 'flex', gap: 10, width: '100%' }}>
              <button onClick={() => setVista('historial')} style={{ flex: 1, padding: 10, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer' }}>VER GENERADOS</button>
              <button onClick={onClose} style={{ flex: 1, padding: 10, borderRadius: 8, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>CERRAR</button>
            </div>
          </div>
        )}

        {/* ---------------- HISTORIAL ---------------- */}
        {vista === 'historial' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {avisoHist && <div style={{ color: '#6E2417', fontSize: 11, fontFamily: 'var(--mono)' }}>{avisoHist}</div>}
            {cargandoHist && <div style={nota}>Cargando…</div>}
            {!cargandoHist && !avisoHist && historial.length === 0 && <div style={nota}>Todavía no has creado ningún DeCA.</div>}
            {historial.map(f => {
              const activo = enlaceVigente(f.fecha_fin_servicio)
              return (
                <div key={f.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)', fontWeight: 700 }}>
                    {formatFechaDeca(f.datos.fechaTransporte)} · {f.datos.naturaleza} · {textoPeso(f.datos)}
                  </div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                    {f.datos.origen} → {textoDestino(f.datos)} · {f.datos.matriculaVehiculo}{f.datos.matriculaRemolque ? ` + ${f.datos.matriculaRemolque}` : ''}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                    Creado {formatFechaHoraMadrid(new Date(f.creado_en))} · {activo ? `enlace activo hasta el ${formatFechaDeca(fechaLimiteEnlace(f.fecha_fin_servicio))}` : 'enlace público desactivado (el PDF sigue disponible aquí)'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button onClick={() => descargarDeHistorial(f, 'abrir')} style={{ ...botonSec, padding: '5px 9px', fontSize: 10 }}>Abrir PDF</button>
                    <button onClick={() => descargarDeHistorial(f, 'guardar')} style={{ ...botonSec, padding: '5px 9px', fontSize: 10 }}>Descargar</button>
                    {activo && <button onClick={() => copiar(urlDeca(baseUrl(), f.token))} style={{ ...botonSec, padding: '5px 9px', fontSize: 10 }}>Copiar enlace</button>}
                    <button onClick={() => duplicar(f)} style={{ ...botonSec, padding: '5px 9px', fontSize: 10 }}>Duplicar</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
