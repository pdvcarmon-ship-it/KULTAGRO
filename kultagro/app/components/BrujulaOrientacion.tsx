'use client'

// Brújula para elegir la dirección de las líneas de plantación: se gira arrastrando la aguja (ratón o dedo),
// con el teclado (flechas) o pulsando una de las 8 direcciones. Devuelve el rumbo en grados (0 = Norte,
// sentido horario). Las líneas son bidireccionales, así que N y S, E y O… dan el mismo reparto.

import { useRef } from 'react'
import { normalizarRumbo, nombreRumbo } from '../lib/analisisPlantacion'

interface Props {
  valor: number                    // rumbo 0–359
  onChange: (rumbo: number) => void
  size?: number
}

const PUNTOS: { rumbo: number; sigla: string }[] = [
  { rumbo: 0, sigla: 'N' }, { rumbo: 45, sigla: 'NE' }, { rumbo: 90, sigla: 'E' }, { rumbo: 135, sigla: 'SE' },
  { rumbo: 180, sigla: 'S' }, { rumbo: 225, sigla: 'SO' }, { rumbo: 270, sigla: 'O' }, { rumbo: 315, sigla: 'NO' },
]

export default function BrujulaOrientacion({ valor, onChange, size = 220 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const arrastrando = useRef(false)
  const c = 110 // centro del viewBox 220×220
  const R = 96
  const rumbo = normalizarRumbo(valor)

  const punto = (r: number, grados: number): [number, number] => {
    const a = (grados * Math.PI) / 180
    return [c + r * Math.sin(a), c - r * Math.cos(a)]
  }

  const desdeEvento = (e: React.PointerEvent) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const dx = e.clientX - (rect.left + rect.width / 2)
    const dy = e.clientY - (rect.top + rect.height / 2)
    if (Math.hypot(dx, dy) < 8) return // justo en el centro no hay dirección
    onChange(Math.round(normalizarRumbo((Math.atan2(dx, -dy) * 180) / Math.PI)))
  }

  const onKey = (e: React.KeyboardEvent) => {
    const paso = e.shiftKey ? 15 : 1
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(normalizarRumbo(rumbo + paso)) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(normalizarRumbo(rumbo - paso)) }
    else if (e.key === 'Home') { e.preventDefault(); onChange(0) }
  }

  const [px, py] = punto(R - 14, rumbo)
  const [qx, qy] = punto(R - 14, rumbo + 180)
  const [ax1, ay1] = punto(R - 30, rumbo - 7)
  const [ax2, ay2] = punto(R - 30, rumbo + 7)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <svg
        ref={svgRef} viewBox="0 0 220 220" width={size} height={size}
        role="slider" tabIndex={0} aria-label="Dirección de las líneas de plantación"
        aria-valuemin={0} aria-valuemax={359} aria-valuenow={rumbo} aria-valuetext={`${rumbo} grados, ${nombreRumbo(rumbo)}`}
        onKeyDown={onKey}
        onPointerDown={e => { arrastrando.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); desdeEvento(e) }}
        onPointerMove={e => { if (arrastrando.current) desdeEvento(e) }}
        onPointerUp={e => { arrastrando.current = false; try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch { /* ya liberado */ } }}
        onPointerCancel={() => { arrastrando.current = false }}
        style={{ touchAction: 'none', cursor: 'grab', userSelect: 'none', maxWidth: '100%', outline: 'none' }}
      >
        <circle cx={c} cy={c} r={R + 8} fill="var(--surface)" stroke="var(--border)" strokeWidth={2} />
        <circle cx={c} cy={c} r={R - 36} fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="2 4" />
        {/* marcas cada 15°, más largas cada 45° */}
        {Array.from({ length: 24 }, (_, i) => i * 15).map(g => {
          const larga = g % 45 === 0
          const [x1, y1] = punto(R + 6, g), [x2, y2] = punto(R - (larga ? 6 : 2), g)
          return <line key={g} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted)" strokeWidth={larga ? 1.6 : 0.8} />
        })}
        {/* puntos cardinales: también son botones */}
        {PUNTOS.map(p => {
          const [x, y] = punto(R - 20, p.rumbo)
          const activo = rumbo === p.rumbo
          const cardinal = p.sigla.length === 1
          return (
            <g key={p.sigla} onPointerDown={e => e.stopPropagation()} onClick={() => onChange(p.rumbo)} style={{ cursor: 'pointer' }}>
              <circle cx={x} cy={y} r={cardinal ? 11 : 9} fill={activo ? 'var(--green)' : 'transparent'} />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                fontSize={cardinal ? 12 : 9} fontWeight={700} fontFamily="var(--mono)"
                fill={activo ? '#fff' : p.sigla === 'N' ? '#c0392b' : 'var(--text)'}>{p.sigla}</text>
            </g>
          )
        })}
        {/* aguja: línea de plantación (doble sentido) y punta hacia el rumbo */}
        <line x1={qx} y1={qy} x2={px} y2={py} stroke="var(--green)" strokeWidth={5} strokeLinecap="round" opacity={0.35} />
        <line x1={qx} y1={qy} x2={px} y2={py} stroke="var(--green)" strokeWidth={2} strokeLinecap="round" />
        <polygon points={`${px},${py} ${ax1},${ay1} ${ax2},${ay2}`} fill="var(--green)" />
        <circle cx={c} cy={c} r={5} fill="var(--green)" stroke="var(--surface)" strokeWidth={2} />
      </svg>
      <div style={{ fontFamily: 'var(--mono)', textAlign: 'center' }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{rumbo}°</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>{nombreRumbo(rumbo)}</span>
      </div>
    </div>
  )
}
