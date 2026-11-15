import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import AnalisisPlantacionTab from './AnalisisPlantacionTab'

// El componente carga Leaflet con require() (lo resuelve Next); aquí se emula, ignorando los .css
beforeAll(() => {
  const req = createRequire(import.meta.url)
  ;(globalThis as any).require = (id: string) => (id.endsWith('.css') ? {} : req(id))
  // jsdom no implementa createSVGRect, y Leaflet cree por eso que no hay SVG: se le dice que sí para poder dibujar polígonos
  req('leaflet').Browser.svg = true
  ;(HTMLCanvasElement.prototype as any).getContext = () => null // jsdom no dibuja en canvas; la capa de árboles lo tolera
  ;(globalThis as any).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }
})

const rect = (w: number, h: number) => {
  const dx = w / 111320, dy = h / 110574
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-5.98, 37.4], [-5.98 + dx, 37.4], [-5.98 + dx, 37.4 + dy], [-5.98, 37.4 + dy], [-5.98, 37.4]]] } }] }
}
const fincas = [{ id: 'f1', nombre: 'Finca Norte' }, { id: 'f2', nombre: 'Finca Sur' }]
const parcelas = [
  { id: 'p1', nombre: 'Parcela A', supHa: 0.6, fincaId: 'f1', geojson: rect(100, 60) },
  { id: 'p2', nombre: 'Parcela B', supHa: 0.6, fincaId: 'f2', geojson: rect(100, 60) },
]

describe('pestaña PLANTACIÓN', () => {
  it('primero se elige la finca y la parcela solo muestra las de esa finca', () => {
    render(<AnalisisPlantacionTab fincas={fincas} parcelas={parcelas} isMobile={false} />)
    const selParcela = screen.getByLabelText('Parcela') as HTMLSelectElement
    expect(selParcela).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Finca'), { target: { value: 'f1' } })
    expect(selParcela).not.toBeDisabled()
    expect(within(selParcela).getByText(/Parcela A/)).toBeInTheDocument()
    expect(within(selParcela).queryByText(/Parcela B/)).toBeNull()
  })

  it('al elegir la parcela calcula; con sectores se usa todo lo que queda, se termina y se pregunta por el camino', async () => {
    render(<AnalisisPlantacionTab fincas={fincas} parcelas={parcelas} isMobile={false} />)
    fireEvent.change(screen.getByLabelText('Finca'), { target: { value: 'f1' } })
    fireEvent.change(screen.getByLabelText('Parcela'), { target: { value: 'p1' } })
    expect(await screen.findByText(/Zonas dentro de la parcela/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/árboles/).length).toBeGreaterThan(0), { timeout: 3000 })

    fireEvent.click(screen.getByText('CREAR SECTORES'))
    expect(screen.getByText(/CORTAR LA PARCELA/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/USAR TODO LO QUE QUEDA/))
    const terminada = await screen.findByText('✔ TERMINADA', undefined, { timeout: 3000 })
    fireEvent.click(terminada)

    // pregunta si la linde con el siguiente sector será un camino
    expect(screen.getByText(/¿La linde con el/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Sí, será un camino/))
    fireEvent.click(screen.getByText('GUARDAR SECTOR'))
    await waitFor(() => expect(screen.getByText(/Ya está repartida toda la parcela/)).toBeInTheDocument())
    expect(screen.getByText('Sector 1')).toBeInTheDocument()
  })

  it('cambiar de parcela descarta zonas y sectores', async () => {
    render(<AnalisisPlantacionTab fincas={fincas} parcelas={parcelas} isMobile={false} />)
    fireEvent.change(screen.getByLabelText('Finca'), { target: { value: 'f1' } })
    fireEvent.change(screen.getByLabelText('Parcela'), { target: { value: 'p1' } })
    fireEvent.click(await screen.findByText('CREAR SECTORES'))
    expect(screen.getByText(/CORTAR LA PARCELA/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Finca'), { target: { value: 'f2' } })
    expect(screen.queryByText(/CORTAR LA PARCELA/)).toBeNull()
  })
})
