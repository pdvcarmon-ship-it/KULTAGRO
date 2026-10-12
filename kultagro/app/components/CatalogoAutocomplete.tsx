'use client'
// Autocompletado sobre catálogos SIEX: el usuario escribe unas letras y aparecen las opciones.
// No es un desplegable de selección: no hay lista que recorrer, se busca escribiendo.
//
//  · <CatalogoAutocomplete>       una opción (cultivo, variedad, estado fenológico...)
//  · <CatalogoMultiAutocomplete>  varias opciones como etiquetas (justificaciones, plagas...)
//
// Dependencia entre catálogos: `padre` limita las opciones a las de ese padre. Ejemplo: la
// variedad recibe como `padre` el código del cultivo ya elegido, y solo ofrece variedades de ese cultivo.

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ItemCatalogo, LIMITE_SUGERENCIAS, buscarCatalogo, esCatalogoServidor, mapaCatalogo, obtenerItem, rutaDe,
} from '../lib/catalogos'

// ── Hook: sugerencias para el texto tecleado ─────────────────────────────────────────
function useSugerencias(catalogo: string, texto: string, padre: string, habilitado: boolean, excluir?: Set<string>, limite = LIMITE_SUGERENCIAS) {
  const [items, setItems] = useState<ItemCatalogo[]>([])
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [rutas, setRutas] = useState<Map<string, ItemCatalogo> | null>(null)
  const clavesExcluidas = excluir ? Array.from(excluir).sort().join('|') : ''

  useEffect(() => {
    if (!habilitado) { setItems([]); setHayMas(false); setCargando(false); return }
    let cancelado = false
    setCargando(true)
    // En catálogos grandes (servidor) se espera un momento a que el usuario termine de teclear
    const espera = esCatalogoServidor(catalogo) ? 180 : 0
    const t = setTimeout(async () => {
      try {
        const r = await buscarCatalogo(catalogo, texto, { padre, limite, excluir })
        if (cancelado) return
        setItems(r.items); setHayMas(r.hayMas); setError('')
      } catch {
        if (!cancelado) { setItems([]); setError('No se pudo cargar el catálogo. Comprueba la conexión.') }
      } finally {
        if (!cancelado) setCargando(false)
      }
    }, espera)
    return () => { cancelado = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogo, texto, padre, habilitado, limite, clavesExcluidas])

  // Para catálogos en árbol (plagas...) se muestra la ruta del padre; solo si el catálogo está entero en memoria
  useEffect(() => {
    if (esCatalogoServidor(catalogo) || !habilitado) return
    let vivo = true
    mapaCatalogo(catalogo).then(m => { if (vivo) setRutas(m) }).catch(() => {})
    return () => { vivo = false }
  }, [catalogo, habilitado])

  return { items, hayMas, cargando, error, rutas }
}

// Posición del listado respecto a la PANTALLA (position: fixed), para que no lo recorten las tablas ni las
// ventanas con scroll donde se usa el campo. Se abre hacia arriba si abajo no cabe.
interface Anclaje { left: number; width: number; top: number; bottom: number; arriba: boolean; alto: number }
function useAnclaje(abierto: boolean, ref: React.RefObject<HTMLElement | null>): Anclaje | null {
  const [pos, setPos] = useState<Anclaje | null>(null)
  useLayoutEffect(() => {
    if (!abierto || !ref.current) { setPos(null); return }
    const calcular = () => {
      if (!ref.current) return
      const r = ref.current.getBoundingClientRect()
      const abajo = window.innerHeight - r.bottom
      const arriba = abajo < 220 && r.top > abajo
      setPos({ left: r.left, width: r.width, top: r.bottom + 2, bottom: window.innerHeight - r.top + 2, arriba, alto: Math.max(120, Math.min(264, (arriba ? r.top : abajo) - 12)) })
    }
    calcular()
    window.addEventListener('scroll', calcular, true)
    window.addEventListener('resize', calcular)
    return () => { window.removeEventListener('scroll', calcular, true); window.removeEventListener('resize', calcular) }
  }, [abierto, ref])
  return pos
}

const estiloBase: React.CSSProperties = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', outline: 'none', boxSizing: 'border-box',
}

// Texto secundario de una opción: nombre científico / EPPO / ruta del árbol
const detalleDe = (item: ItemCatalogo, rutas: Map<string, ItemCatalogo> | null): string => {
  const partes: string[] = []
  const ruta = rutas ? rutaDe(rutas, item) : []
  if (ruta.length) partes.push(ruta.join(' › '))
  const cientifico = item.extra?.latin || item.extra?.nombre_cientifico
  if (cientifico && !item.descripcion.includes(cientifico)) partes.push(cientifico)
  if (item.extra?.es_hoja === false) partes.push('categoría')
  return partes.join(' · ')
}

// ── Lista desplegable de sugerencias (compartida) ────────────────────────────────────
function ListaSugerencias(props: {
  id: string; items: ItemCatalogo[]; activo: number; hayMas: boolean; cargando: boolean; error: string
  rutas: Map<string, ItemCatalogo> | null; vacioTexto: string; hayTexto: boolean; anclaje: Anclaje | null
  onElegir: (i: ItemCatalogo) => void; onHover: (n: number) => void
}) {
  const { id, items, activo, hayMas, cargando, error, rutas, vacioTexto, hayTexto, anclaje, onElegir, onHover } = props
  const posicion: React.CSSProperties = anclaje
    ? { position: 'fixed', left: anclaje.left, width: anclaje.width, maxHeight: anclaje.alto, ...(anclaje.arriba ? { bottom: anclaje.bottom } : { top: anclaje.top }) }
    : { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, maxHeight: 264 }
  const caja: React.CSSProperties = {
    ...posicion, zIndex: 1000, overflowY: 'auto',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
  }
  const aviso: React.CSSProperties = { padding: '9px 12px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', lineHeight: 1.4 }
  if (error) return <div style={{ ...caja, ...aviso, color: '#6E2417' }} role="alert">{error}</div>
  if (items.length === 0) {
    if (cargando) return <div style={{ ...caja, ...aviso }}>Buscando…</div>
    return <div style={{ ...caja, ...aviso }}>{hayTexto ? vacioTexto : 'Sin opciones disponibles'}</div>
  }
  return (
    <ul id={id} role="listbox" style={{ ...caja, listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((it, n) => {
        const detalle = detalleDe(it, rutas)
        return (
          <li key={`${it.padre}|${it.codigo}`} id={`${id}-${n}`} role="option" aria-selected={n === activo}
              // onMouseDown (no onClick): se ejecuta antes de que el campo pierda el foco y cierre la lista
              onMouseDown={e => { e.preventDefault(); onElegir(it) }} onMouseEnter={() => onHover(n)}
              style={{ padding: '7px 12px', cursor: 'pointer', background: n === activo ? 'var(--surface2)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'var(--sans)' }}>{it.descripcion}</div>
            {detalle && <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 1 }}>{detalle}</div>}
          </li>
        )
      })}
      {hayMas && <li style={{ ...aviso, listStyle: 'none' }}>Hay más resultados: sigue escribiendo para afinar</li>}
    </ul>
  )
}

// Navegación con teclado común a los dos componentes
function manejarTeclas(e: React.KeyboardEvent, o: {
  abierto: boolean; setAbierto: (b: boolean) => void; activo: number; setActivo: (n: number) => void
  items: ItemCatalogo[]; elegir: (i: ItemCatalogo) => void
}) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!o.abierto) { o.setAbierto(true); return }
    o.setActivo(Math.min(o.activo + 1, o.items.length - 1))
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); o.setActivo(Math.max(o.activo - 1, 0))
  } else if (e.key === 'Enter') {
    if (o.abierto && o.items.length > 0) {
      const elegido = o.items[o.activo >= 0 ? o.activo : (o.items.length === 1 ? 0 : -1)]
      if (elegido) { e.preventDefault(); o.elegir(elegido) }
    }
  } else if (e.key === 'Escape') {
    if (o.abierto) { e.preventDefault(); o.setAbierto(false) }
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════
// Selección única
// ═════════════════════════════════════════════════════════════════════════════════════
export interface CatalogoAutocompleteProps {
  catalogo: string
  valor?: string                          // código seleccionado ('' o undefined = ninguno)
  padre?: string                          // limita las opciones a las de este padre (variedad → cultivo)
  onChange: (item: ItemCatalogo | null) => void
  textoInicial?: string                   // texto antiguo (sin código) que se muestra hasta que se elija del catálogo
  placeholder?: string
  disabled?: boolean
  disabledPlaceholder?: string            // p. ej. "Elige primero el cultivo"
  vacioTexto?: string
  estilo?: React.CSSProperties
  ariaLabel?: string
}

export function CatalogoAutocomplete({
  catalogo, valor = '', padre = '', onChange, textoInicial = '', placeholder, disabled, disabledPlaceholder,
  vacioTexto = 'Ninguna coincidencia', estilo, ariaLabel,
}: CatalogoAutocompleteProps) {
  const idLista = useId()
  const [texto, setTexto] = useState(textoInicial)
  const [seleccionado, setSeleccionado] = useState<ItemCatalogo | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(-1)
  const [tocado, setTocado] = useState(false)
  const bloqueoSync = useRef(false)   // evita que la sincronización con `valor` pise lo que el usuario acaba de elegir
  const contenedor = useRef<HTMLDivElement>(null)

  // Sincroniza con el código recibido (al abrir un formulario ya guardado, o si el padre lo borra)
  useEffect(() => {
    let vivo = true
    if (!valor) {
      setSeleccionado(null)
      if (!bloqueoSync.current) setTexto(textoInicial)
      return
    }
    obtenerItem(catalogo, valor, padre).then(it => {
      if (!vivo) return
      setSeleccionado(it)
      if (it && !bloqueoSync.current) setTexto(it.descripcion)
    }).catch(() => {})
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogo, valor, padre])

  const consulta = seleccionado && texto === seleccionado.descripcion ? '' : texto   // con algo ya elegido, al enfocar se ofrece todo
  const { items, hayMas, cargando, error, rutas } = useSugerencias(catalogo, consulta, padre, abierto && !disabled)
  const anclaje = useAnclaje(abierto && !disabled, contenedor)
  useEffect(() => { setActivo(-1) }, [items])

  const elegir = (it: ItemCatalogo) => {
    bloqueoSync.current = true
    setSeleccionado(it); setTexto(it.descripcion); setAbierto(false); setTocado(false)
    onChange(it)
    setTimeout(() => { bloqueoSync.current = false }, 0)
  }

  const alTeclear = (nuevo: string) => {
    setTexto(nuevo); setAbierto(true)
    if (seleccionado && nuevo !== seleccionado.descripcion) {   // teclear sobre una selección la anula
      setSeleccionado(null)
      bloqueoSync.current = true
      onChange(null)
      setTimeout(() => { bloqueoSync.current = false }, 0)
    }
  }

  const sinElegir = !seleccionado && texto.trim() !== ''
  const colorBorde = disabled ? 'var(--border)' : seleccionado ? 'var(--green)' : (tocado && sinElegir) ? '#8A4B12' : 'var(--border)'

  return (
    <div ref={contenedor} style={{ position: 'relative' }}>
      <input
        type="text" role="combobox" aria-expanded={abierto} aria-controls={idLista} aria-autocomplete="list"
        aria-activedescendant={activo >= 0 ? `${idLista}-${activo}` : undefined} aria-label={ariaLabel}
        autoComplete="off" disabled={disabled} value={texto}
        placeholder={disabled ? (disabledPlaceholder || placeholder) : placeholder}
        onChange={e => alTeclear(e.target.value)}
        onFocus={() => setAbierto(true)}
        onBlur={() => { setAbierto(false); setTocado(true) }}
        onKeyDown={e => manejarTeclas(e, { abierto, setAbierto, activo, setActivo, items, elegir })}
        style={{ ...estiloBase, ...estilo, border: `1px solid ${colorBorde}`, opacity: disabled ? 0.6 : 1 }}
      />
      {abierto && !disabled && (
        <ListaSugerencias id={idLista} items={items} activo={activo} hayMas={hayMas} cargando={cargando} error={error}
          rutas={rutas} vacioTexto={vacioTexto} hayTexto={consulta.trim() !== ''} anclaje={anclaje} onElegir={elegir} onHover={setActivo} />
      )}
      {tocado && sinElegir && !abierto && !disabled && (
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: '#8A4B12', marginTop: 3, lineHeight: 1.4 }}>
          «{texto}» no está en el catálogo. Elige una de las opciones que aparecen al escribir.
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════════════
// Selección múltiple (etiquetas)
// ═════════════════════════════════════════════════════════════════════════════════════
export interface CatalogoMultiAutocompleteProps {
  catalogo: string
  valores: string[]                        // códigos seleccionados
  onChange: (items: ItemCatalogo[]) => void
  placeholder?: string
  maximo?: number
  vacioTexto?: string
  estilo?: React.CSSProperties
  ariaLabel?: string
}

export function CatalogoMultiAutocomplete({
  catalogo, valores, onChange, placeholder, maximo, vacioTexto = 'Ninguna coincidencia', estilo, ariaLabel,
}: CatalogoMultiAutocompleteProps) {
  const idLista = useId()
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(-1)
  const [elegidos, setElegidos] = useState<ItemCatalogo[]>([])
  const bloqueoSync = useRef(false)
  const contenedor = useRef<HTMLDivElement>(null)

  // Resuelve los códigos recibidos a elementos (nombre) — al abrir un formulario ya guardado
  const clave = valores.join('|')
  useEffect(() => {
    if (bloqueoSync.current) return
    let vivo = true
    Promise.all(valores.map(c => obtenerItem(catalogo, c))).then(rs => {
      if (vivo) setElegidos(rs.filter((x): x is ItemCatalogo => !!x))
    }).catch(() => {})
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogo, clave])

  const excluir = useMemo(() => new Set(elegidos.map(e => e.codigo)), [elegidos])
  const completo = maximo !== undefined && elegidos.length >= maximo
  const { items, hayMas, cargando, error, rutas } = useSugerencias(catalogo, texto, '', abierto && !completo, excluir)
  const anclaje = useAnclaje(abierto && !completo, contenedor)
  useEffect(() => { setActivo(-1) }, [items])

  const cambiar = (nuevos: ItemCatalogo[]) => {
    bloqueoSync.current = true
    setElegidos(nuevos)
    onChange(nuevos)
    setTimeout(() => { bloqueoSync.current = false }, 0)
  }
  const elegir = (it: ItemCatalogo) => { cambiar([...elegidos, it]); setTexto(''); setActivo(-1) }
  const quitar = (codigo: string) => cambiar(elegidos.filter(e => e.codigo !== codigo))

  return (
    <div ref={contenedor} style={{ position: 'relative' }}>
      <div style={{ ...estiloBase, ...estilo, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '6px 8px' }}>
        {elegidos.map(e => (
          <span key={e.codigo} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 4px 2px 8px', fontSize: 12, color: 'var(--text)' }}>
            {e.descripcion}
            <button type="button" aria-label={`Quitar ${e.descripcion}`} onClick={() => quitar(e.codigo)}
              style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 3px' }}>×</button>
          </span>
        ))}
        <input
          type="text" role="combobox" aria-expanded={abierto} aria-controls={idLista} aria-autocomplete="list"
          aria-label={ariaLabel} autoComplete="off" value={texto} disabled={completo}
          placeholder={elegidos.length === 0 ? placeholder : completo ? '' : 'Añadir otra…'}
          onChange={e => { setTexto(e.target.value); setAbierto(true) }}
          onFocus={() => setAbierto(true)} onBlur={() => setAbierto(false)}
          onKeyDown={e => {
            if (e.key === 'Backspace' && texto === '' && elegidos.length > 0) { quitar(elegidos[elegidos.length - 1].codigo); return }
            manejarTeclas(e, { abierto, setAbierto, activo, setActivo, items, elegir })
          }}
          style={{ flex: 1, minWidth: 120, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)', padding: '3px 2px' }}
        />
      </div>
      {abierto && !completo && (
        <ListaSugerencias id={idLista} items={items} activo={activo} hayMas={hayMas} cargando={cargando} error={error}
          rutas={rutas} vacioTexto={vacioTexto} hayTexto={texto.trim() !== ''} anclaje={anclaje} onElegir={elegir} onHover={setActivo} />
      )}
    </div>
  )
}
