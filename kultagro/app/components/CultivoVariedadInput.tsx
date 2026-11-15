'use client'
// Par de campos "Cultivo" + "Variedad" del catálogo SIEX. La variedad solo ofrece las del cultivo elegido.
// Se usa en el formulario de parcelas, el histórico de cultivos, el cambio de campaña y la importación.

import React from 'react'
import { CAT, CultivoVariedadValor } from '../lib/catalogos'
import { CatalogoAutocomplete } from './CatalogoAutocomplete'

export interface CultivoVariedadInputProps {
  valor: CultivoVariedadValor
  onChange: (v: CultivoVariedadValor) => void
  disposicion?: 'columna' | 'fila'
  etiquetas?: boolean                         // mostrar «Cultivo» / «Variedad» encima de cada campo
  estiloCampo?: React.CSSProperties           // para formularios compactos
}

const estiloEtiqueta: React.CSSProperties = {
  display: 'block', fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em',
}

export function CultivoVariedadInput({ valor, onChange, disposicion = 'columna', etiquetas = true, estiloCampo }: CultivoVariedadInputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: disposicion === 'fila' ? 'row' : 'column', gap: disposicion === 'fila' ? 8 : 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {etiquetas && <label style={estiloEtiqueta}>Cultivo <span style={{ color: '#6E2417' }}>*</span></label>}
        <CatalogoAutocomplete
          catalogo={CAT.CULTIVO} valor={valor.cultivoCodigo} textoInicial={valor.cultivoCodigo ? '' : valor.cultivo}
          onChange={it => onChange({ cultivo: it ? it.descripcion : '', cultivoCodigo: it ? it.codigo : '', variedad: '', variedadCodigo: '' })}
          placeholder="Escribe el cultivo: olivo, trigo, viña…" ariaLabel="Cultivo" estilo={estiloCampo} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {etiquetas && <label style={estiloEtiqueta}>Variedad <span style={{ color: '#6E2417' }}>*</span></label>}
        <CatalogoAutocomplete
          catalogo={CAT.VARIEDAD} valor={valor.variedadCodigo} padre={valor.cultivoCodigo}
          textoInicial={valor.variedadCodigo ? '' : valor.variedad} disabled={!valor.cultivoCodigo}
          onChange={it => onChange({ ...valor, variedad: it ? it.descripcion : '', variedadCodigo: it ? it.codigo : '' })}
          placeholder="Escribe la variedad: arbequina, picual…" disabledPlaceholder="Elige primero el cultivo"
          vacioTexto="Ninguna variedad de este cultivo coincide" ariaLabel="Variedad" estilo={estiloCampo} />
      </div>
    </div>
  )
}
