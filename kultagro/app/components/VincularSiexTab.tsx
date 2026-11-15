'use client'
// SIEX — vinculación de DGCs (Fase 3).
//
// Por finca (con NIF ya asignado desde GES), consulta el REA de esa explotación y empareja sus
// DGCs con los recintos SIGPAC de cada parcela, por igualdad exacta de las 7 referencias
// (provincia, municipio, agregado, zona, polígono, parcela, recinto). Sin esto, ningún
// tratamiento de esa finca puede enviarse a SIEX (el traductor lo rechaza con un error claro).
//
// Solo Opción A: los recintos sin DGC exacta quedan "sin vincular", para corregir la parcela en
// SIGPAC. No hay vinculación manual (Opción B, pospuesta).

import React, { useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

// Formas mínimas que necesita este componente (estructuralmente compatibles con los tipos reales
// de page.tsx: Finca, ParcelaGuardada, RecintoRef — no hace falta importarlos).
interface RecintoLike {
  provincia?: string; municipio?: string; agregado?: string; zona?: string
  poligono?: string; parcela?: string; recinto?: string; supHa: number
  siexDgcCodigo?: string
}
interface ParcelaLike {
  id: string; nombre: string; fincaId?: string
  parcelaInfo?: { recintos?: RecintoLike[] } | any
}
interface FincaLike { id: string; nombre: string; nif?: string }

export interface VincularSiexTabProps {
  session: any
  fincas: FincaLike[]
  misParcelas: ParcelaLike[]
  setMisParcelas: React.Dispatch<React.SetStateAction<any[]>>
}

interface RecintoResultado { indice: number; emparejado: boolean; codigo_dgc: number | null; motivo: string }
interface ParcelaResultado { todos_vinculados: boolean; recintos: RecintoResultado[] }
interface RespuestaEmparejar { modo: string; total_dgcs_en_rea: number; parcelas: Record<string, ParcelaResultado> }

export default function VincularSiexTab({ session, fincas, misParcelas, setMisParcelas }: VincularSiexTabProps) {
  // Solo tiene sentido para fincas con NIF (las que ha dado de alta GES): sin NIF no hay a quién
  // preguntarle el REA. Las fincas creadas por el propio usuario, sin NIF, no aparecen aquí.
  const fincasConNif = useMemo(() => fincas.filter(f => (f.nif || '').trim()), [fincas])

  const [fincaId, setFincaId] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState<RespuestaEmparejar | null>(null)
  const [guardado, setGuardado] = useState(false)

  const finca = fincasConNif.find(f => f.id === fincaId)
  const parcelasFinca = useMemo(() => misParcelas.filter(p => p.fincaId === fincaId), [misParcelas, fincaId])

  const consultarRea = async () => {
    if (!finca) return
    setConsultando(true); setError(''); setResultado(null); setGuardado(false)
    try {
      const cuerpo = {
        nif_titular: finca.nif,
        parcelas: Object.fromEntries(parcelasFinca.map(p => [
          p.id,
          { recintos: (p.parcelaInfo?.recintos || []).map((r: RecintoLike) => ({
            provincia: r.provincia, municipio: r.municipio, agregado: r.agregado, zona: r.zona,
            poligono: r.poligono, parcela: r.parcela, recinto: r.recinto, supHa: r.supHa,
          })) },
        ])),
      }
      const resp = await fetch(`${BACKEND}/siex/emparejar-dgcs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
      })
      if (!resp.ok) {
        const detalle = await resp.json().catch(() => null)
        throw new Error(detalle?.detail || `Error del servidor (${resp.status})`)
      }
      setResultado(await resp.json())
    } catch (e: any) {
      setError(e?.message || 'No se pudo consultar el REA. Comprueba la conexión con el servidor.')
    } finally {
      setConsultando(false)
    }
  }

  const guardarVinculacion = async () => {
    if (!resultado || !session) return
    setGuardando(true)
    try {
      const actualizadas: ParcelaLike[] = []
      for (const p of parcelasFinca) {
        const r = resultado.parcelas[p.id]
        if (!r) continue
        const recintos: RecintoLike[] = p.parcelaInfo?.recintos || []
        const recintosNuevos = recintos.map((rec, i) => {
          const match = r.recintos.find(x => x.indice === i)
          return match?.emparejado ? { ...rec, siexDgcCodigo: String(match.codigo_dgc) } : rec
        })
        const parcelaInfoNueva = { ...(p.parcelaInfo || {}), recintos: recintosNuevos }
        await supabase.from('parcelas').update({ parcela_info: parcelaInfoNueva }).eq('id', p.id)
        actualizadas.push({ ...p, parcelaInfo: parcelaInfoNueva })
      }
      setMisParcelas(prev => prev.map(p => actualizadas.find(a => a.id === p.id) || p))
      setGuardado(true)
    } catch (e) {
      console.error('Error guardando la vinculación de DGCs:', e)
      setError('Se consultó el REA correctamente, pero hubo un error al guardar. Puedes intentarlo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const totalRecintos = parcelasFinca.reduce((n, p) => n + (p.parcelaInfo?.recintos?.length || 0), 0)
  const recintosVinculadosYa = parcelasFinca.reduce((n, p) =>
    n + (p.parcelaInfo?.recintos || []).filter((r: RecintoLike) => r.siexDgcCodigo).length, 0)
  const recintosVinculadosTrasConsulta = resultado
    ? Object.values(resultado.parcelas).reduce((n, r) => n + r.recintos.filter(x => x.emparejado).length, 0) : 0

  const estiloTarjeta: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }
  const estiloBoton: React.CSSProperties = { padding: '10px 18px', borderRadius: 6, background: 'var(--green)', border: 'none', color: 'var(--bg)', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Vincular con SIEX</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginTop: 6 }}>
          Para poder enviar los tratamientos de una finca a SIEX, cada recinto SIGPAC de sus parcelas necesita
          su código de DGC. Se obtiene consultando el REA de la explotación (por su NIF) y emparejando por
          referencia SIGPAC exacta. Los recintos que no encuentren una DGC exacta se quedan sin vincular:
          revisa esa parcela en SIGPAC y vuelve a consultar.
        </p>
      </div>

      {fincasConNif.length === 0 ? (
        <div style={{ ...estiloTarjeta, color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--mono)' }}>
          Ninguna finca tiene NIF todavía. Las fincas se dan de alta con su NIF desde GES; hasta entonces no se pueden vincular con SIEX.
        </div>
      ) : (
        <div style={estiloTarjeta}>
          <label style={{ display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Finca</label>
          <select value={fincaId} onChange={e => { setFincaId(e.target.value); setResultado(null); setError(''); setGuardado(false) }}
            style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none' }}>
            <option value="">Selecciona una finca...</option>
            {fincasConNif.map(f => <option key={f.id} value={f.id}>{f.nombre} ({f.nif})</option>)}
          </select>

          {finca && (
            <div style={{ marginTop: 14, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
              {parcelasFinca.length} parcela(s), {totalRecintos} recinto(s) SIGPAC en total
              {totalRecintos > 0 && ` · ${recintosVinculadosYa} ya vinculado(s) de una consulta anterior`}
            </div>
          )}

          {finca && (
            <button onClick={consultarRea} disabled={consultando || parcelasFinca.length === 0} style={{ ...estiloBoton, marginTop: 12, opacity: consultando || parcelasFinca.length === 0 ? 0.6 : 1 }}>
              {consultando ? 'Consultando el REA…' : 'Consultar REA y emparejar'}
            </button>
          )}
          {finca && parcelasFinca.length === 0 && (
            <div style={{ marginTop: 8, fontSize: 11, fontFamily: 'var(--mono)', color: '#8A4B12' }}>Esta finca todavía no tiene parcelas.</div>
          )}
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 6, background: 'rgba(110, 36, 23,0.08)', border: '1px solid rgba(110, 36, 23,0.3)', fontSize: 12, color: '#6E2417' }}>{error}</div>
      )}

      {resultado && (
        <div style={estiloTarjeta}>
          <div style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)', marginBottom: 10 }}>
            {resultado.modo === 'simulation' && (
              <div style={{ marginBottom: 8, fontSize: 10, color: '#8A4B12' }}>
                Resultado en modo SIMULACIÓN (no hay conexión real a SIEX todavía).
              </div>
            )}
            El REA de «{finca?.nombre}» trae {resultado.total_dgcs_en_rea} DGC(s) en total.
            {' '}{recintosVinculadosTrasConsulta} de {totalRecintos} recinto(s) de esta finca han quedado vinculados.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {parcelasFinca.map(p => {
              const r = resultado.parcelas[p.id]
              if (!r) return null
              return (
                <div key={p.id} style={{ padding: '8px 10px', borderRadius: 6, background: r.todos_vinculados ? 'rgba(31, 74, 40,0.06)' : 'rgba(138, 75, 18,0.06)', border: `1px solid ${r.todos_vinculados ? 'rgba(31, 74, 40,0.2)' : 'rgba(138, 75, 18,0.3)'}` }}>
                  <div style={{ fontSize: 12, fontFamily: 'var(--sans)', color: 'var(--text)', fontWeight: 600 }}>
                    {r.todos_vinculados ? '✓ ' : '— '}{p.nombre}
                  </div>
                  {!r.todos_vinculados && (
                    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {r.recintos.filter(x => !x.emparejado).map(x => (
                        <div key={x.indice} style={{ fontSize: 10, fontFamily: 'var(--mono)', color: '#8A4B12' }}>
                          Recinto {x.indice + 1}: {x.motivo}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <button onClick={guardarVinculacion} disabled={guardando || guardado} style={{ ...estiloBoton, marginTop: 14, opacity: guardando || guardado ? 0.6 : 1 }}>
            {guardado ? 'Guardado ✓' : guardando ? 'Guardando…' : 'Guardar vinculación'}
          </button>
        </div>
      )}
    </div>
  )
}
