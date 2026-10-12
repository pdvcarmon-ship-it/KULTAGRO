import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ItemCatalogo } from '../lib/catalogos'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
import { CAT, usarFuenteCatalogos } from '../lib/catalogos'
import { fuenteFalsa } from '../lib/__fixtures__/fuenteFalsa'
import { CatalogoAutocomplete, CatalogoMultiAutocomplete } from './CatalogoAutocomplete'

let fuente: ReturnType<typeof fuenteFalsa>
beforeEach(() => { fuente = fuenteFalsa(); usarFuenteCatalogos(fuente) })

// Formulario mínimo como el de parcelas: cultivo y, después, variedad dependiente del cultivo
function CultivoVariedad(props: { cultivoInicial?: string; variedadInicial?: string; textoInicial?: string }) {
  const [cultivo, setCultivo] = useState(props.cultivoInicial || '')
  const [variedad, setVariedad] = useState(props.variedadInicial || '')
  return (
    <div>
      <CatalogoAutocomplete catalogo={CAT.CULTIVO} valor={cultivo} textoInicial={props.textoInicial}
        onChange={it => { setCultivo(it?.codigo || ''); setVariedad('') }} ariaLabel="Cultivo" placeholder="Escribe el cultivo" />
      <CatalogoAutocomplete catalogo={CAT.VARIEDAD} valor={variedad} padre={cultivo} disabled={!cultivo}
        onChange={it => setVariedad(it?.codigo || '')} ariaLabel="Variedad" placeholder="Escribe la variedad" disabledPlaceholder="Elige primero el cultivo" />
      <output data-testid="estado">{cultivo || '-'}/{variedad || '-'}</output>
    </div>
  )
}
const estado = () => screen.getByTestId('estado').textContent
const opciones = () => screen.queryAllByRole('option').map(o => o.textContent || '')

describe('CatalogoAutocomplete — escribir y elegir', () => {
  it('al escribir unas letras aparecen las opciones, y al elegir una se guarda su código', async () => {
    const u = userEvent.setup()
    render(<CultivoVariedad />)
    await u.type(screen.getByLabelText('Cultivo'), 'oli')
    const lista = await screen.findByRole('listbox')
    expect(within(lista).getByText('OLIVO')).toBeInTheDocument()
    await u.click(within(lista).getByText('OLIVO'))
    expect(estado()).toBe('101/-')
    expect(screen.getByLabelText('Cultivo')).toHaveValue('OLIVO')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('no distingue acentos ni mayúsculas: «vina» encuentra VIÑA', async () => {
    const u = userEvent.setup()
    render(<CultivoVariedad />)
    await u.type(screen.getByLabelText('Cultivo'), 'VINA')
    expect(await screen.findByText('VIÑA')).toBeInTheDocument()
  })

  it('se puede elegir solo con el teclado (flecha abajo + Intro) y Escape cierra la lista', async () => {
    const u = userEvent.setup()
    render(<CultivoVariedad />)
    await u.type(screen.getByLabelText('Cultivo'), 'oli')
    await screen.findByRole('listbox')
    await u.keyboard('{ArrowDown}{Enter}')
    expect(estado()).toBe('101/-')
    await u.clear(screen.getByLabelText('Cultivo'))
    await u.type(screen.getByLabelText('Cultivo'), 'vi')
    await screen.findByRole('listbox')
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('un texto que no está en el catálogo no se acepta y se avisa al salir del campo', async () => {
    const u = userEvent.setup()
    render(<CultivoVariedad />)
    await u.type(screen.getByLabelText('Cultivo'), 'zzz inventado')
    expect(await screen.findByText('Ninguna coincidencia')).toBeInTheDocument()
    await u.tab()
    expect(await screen.findByText(/no está en el catálogo/)).toBeInTheDocument()
    expect(estado()).toBe('-/-')
  })

  it('al abrir un formulario ya guardado muestra el nombre del código', async () => {
    render(<CultivoVariedad cultivoInicial="101" variedadInicial="3" />)
    await waitFor(() => expect(screen.getByLabelText('Cultivo')).toHaveValue('OLIVO'))
    await waitFor(() => expect(screen.getByLabelText('Variedad')).toHaveValue('ARBEQUINA'))
  })

  it('un texto antiguo sin código se muestra y permite buscarlo en el catálogo', async () => {
    const u = userEvent.setup()
    render(<CultivoVariedad textoInicial="Olivo" />)
    expect(screen.getByLabelText('Cultivo')).toHaveValue('Olivo')
    expect(estado()).toBe('-/-')
    await u.click(screen.getByLabelText('Cultivo'))
    await u.click(await screen.findByText('OLIVO'))
    expect(estado()).toBe('101/-')
  })
})

describe('CatalogoAutocomplete — la variedad depende del cultivo', () => {
  it('la variedad está desactivada hasta elegir el cultivo', () => {
    render(<CultivoVariedad />)
    expect(screen.getByLabelText('Variedad')).toBeDisabled()
    expect(screen.getByLabelText('Variedad')).toHaveAttribute('placeholder', 'Elige primero el cultivo')
  })

  it('solo aparecen variedades del cultivo elegido', async () => {
    const u = userEvent.setup()
    render(<CultivoVariedad />)
    await u.type(screen.getByLabelText('Cultivo'), 'oli')
    await u.click(await screen.findByText('OLIVO'))
    const variedad = screen.getByLabelText('Variedad')
    expect(variedad).toBeEnabled()
    await u.type(variedad, 'arb')
    await waitFor(() => expect(opciones()).toContain('ARBEQUINA'))
    // todas las consultas al servidor fueron acotadas al olivo (101)
    expect(fuente.llamadasBuscar.length).toBeGreaterThan(0)
    expect(fuente.llamadasBuscar.every(c => c.padre === '101')).toBe(true)
    await u.click(screen.getByText('ARBEQUINA'))
    expect(estado()).toBe('101/3')
  })

  it('al cambiar de cultivo se borra la variedad y solo se ofrecen las del nuevo cultivo', async () => {
    const u = userEvent.setup()
    render(<CultivoVariedad cultivoInicial="101" variedadInicial="3" />)
    await waitFor(() => expect(screen.getByLabelText('Variedad')).toHaveValue('ARBEQUINA'))
    const cultivo = screen.getByLabelText('Cultivo')
    await u.clear(cultivo)                                   // teclear sobre una selección la anula
    expect(estado()).toBe('-/-')
    expect(screen.getByLabelText('Variedad')).toBeDisabled()
    await u.type(cultivo, 'tomate')
    await u.click(await screen.findByText('TOMATE'))
    expect(estado()).toBe('197/-')
    expect(screen.getByLabelText('Variedad')).toHaveValue('')
    await u.click(screen.getByLabelText('Variedad'))
    await waitFor(() => expect(opciones().length).toBeGreaterThan(0))
    expect(opciones()).not.toContain('ARBEQUINA')
    await u.type(screen.getByLabelText('Variedad'), 'arb')
    await waitFor(() => expect(screen.queryByText('ARBEQUINA')).not.toBeInTheDocument())
  })
})

describe('CatalogoMultiAutocomplete — varias opciones (justificaciones, plagas...)', () => {
  function Multi(props: { inicial?: string[]; onCambio?: (i: ItemCatalogo[]) => void; catalogo?: string }) {
    const [vals, setVals] = useState<string[]>(props.inicial || [])
    return <CatalogoMultiAutocomplete catalogo={props.catalogo || CAT.JUSTIFICACION} valores={vals} ariaLabel="Justificación"
      onChange={its => { setVals(its.map(i => i.codigo)); props.onCambio?.(its) }} placeholder="Escribe para buscar" />
  }

  it('al enfocar ofrece todas las opciones; se pueden añadir varias como etiquetas', async () => {
    const u = userEvent.setup(); const cambios: ItemCatalogo[][] = []
    render(<Multi onCambio={i => cambios.push(i)} />)
    await u.click(screen.getByLabelText('Justificación'))
    await waitFor(() => expect(opciones()).toHaveLength(6))
    await u.click(screen.getByText('Superación de umbrales'))
    await u.click(screen.getByLabelText('Justificación'))
    await u.click(await screen.findByText('Recomendación de asesor'))
    expect(screen.getByRole('button', { name: 'Quitar Superación de umbrales' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar Recomendación de asesor' })).toBeInTheDocument()
    expect(cambios[cambios.length - 1].map(i => i.codigo)).toEqual(['1', '5'])
  })

  it('lo ya elegido no vuelve a aparecer en las sugerencias', async () => {
    const u = userEvent.setup()
    render(<Multi inicial={['1']} />)
    await screen.findByText('Superación de umbrales')
    await u.click(screen.getByLabelText('Justificación'))
    await waitFor(() => expect(opciones()).toHaveLength(5))
    expect(opciones()).not.toContain('Superación de umbrales')
  })

  it('se quita una etiqueta con la × y con Retroceso', async () => {
    const u = userEvent.setup(); const cambios: ItemCatalogo[][] = []
    render(<Multi inicial={['1', '5']} onCambio={i => cambios.push(i)} />)
    await screen.findByText('Recomendación de asesor')
    await u.click(screen.getByRole('button', { name: 'Quitar Superación de umbrales' }))
    expect(screen.queryByRole('button', { name: 'Quitar Superación de umbrales' })).not.toBeInTheDocument()
    await u.click(screen.getByLabelText('Justificación'))
    await u.keyboard('{Backspace}')
    expect(screen.queryByRole('button', { name: 'Quitar Recomendación de asesor' })).not.toBeInTheDocument()
    expect(cambios[cambios.length - 1]).toEqual([])
  })

  it('en catálogos en árbol (plagas) busca por nombre común y muestra la ruta del nodo', async () => {
    const u = userEvent.setup()
    render(<Multi catalogo={CAT.PLAGAS} />)
    await u.type(screen.getByLabelText('Justificación'), 'pulgon guisante')
    const op = await screen.findByRole('option')
    expect(op).toHaveTextContent('Pulgón del guisante')
    expect(op).toHaveTextContent('pulgones')            // ruta: «… › Áfidos, pulgones, Aphididae»
  })
})
