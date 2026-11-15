import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { generarDecaPdf } from './decaPdf'
import { DECA_VACIO, type DatosDeca } from './deca'

const datos: DatosDeca = {
  ...DECA_VACIO,
  cargadorNombre: 'Finca El Olivar S.L.', cargadorNif: 'A58818501', cargadorDomicilio: 'Camino Real 1, 41001 Sevilla',
  transportistaNombre: 'Juan Pérez', transportistaNif: '12345678Z',
  origen: 'Finca El Olivar (41/083/0/0/12/34/1)', destino: 'Cooperativa San José', destinoNif: 'A58818501', naturaleza: 'Olivar (Hojiblanca)',
  cantidad: '8500', unidad: 'kg', fechaTransporte: '2026-11-16', fechaFinServicio: '2026-11-16',
  matriculaVehiculo: 'E1234BBB', matriculaRemolque: 'R5678BCD', observaciones: 'Descarga en muelle 2.',
}

describe('generarDecaPdf', () => {
  it('genera un PDF pequeño con fecha de creación y de modificación en los metadatos', async () => {
    const creado = new Date('2026-11-15T10:30:00Z')
    const bytes = await generarDecaPdf({ datos, url: 'https://kultagro.app/api/deca/' + 'a'.repeat(43), creadoEn: creado, codigo: 'ABC12345' })
    expect(bytes.length).toBeGreaterThan(1000)
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(pdf.getCreationDate()?.toISOString()).toBe(creado.toISOString())
    expect(pdf.getModificationDate()?.toISOString()).toBe(creado.toISOString())
    expect(pdf.getTitle()).toContain('E1234BBB')
    expect(pdf.getPageCount()).toBe(1)
    if (process.env.DECA_DUMP) (await import('fs')).writeFileSync(process.env.DECA_DUMP, bytes)
  })
})
