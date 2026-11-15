import { describe, it, expect, vi, beforeEach } from 'vitest'

// En el entorno de test (jsdom) Blob no tiene arrayBuffer(); en Node real sí.
const pdfFalso = () => ({ arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer })

const fila = { pdf_path: 'u1/d1.pdf', fecha_fin_servicio: '2999-01-01', datos: { fechaTransporte: '2999-01-01', matriculaVehiculo: 'E1234BBB' } }
let respuestaFila: any = { data: fila, error: null }
let respuestaDescarga: any = { data: pdfFalso(), error: null }

vi.mock('../../../lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => respuestaFila }) }) }),
    storage: { from: () => ({ download: async () => respuestaDescarga }) },
  },
}))

import { GET } from './route'

const TOKEN = 'A'.repeat(43)
const llamar = (token: string) => GET({} as any, { params: { token } })

beforeEach(() => {
  respuestaFila = { data: { ...fila }, error: null }
  respuestaDescarga = { data: pdfFalso(), error: null }
})

describe('GET /api/deca/[token]', () => {
  it('sirve el PDF directamente, sin login ni página intermedia', async () => {
    const r = await llamar(TOKEN)
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('application/pdf')
    expect(r.headers.get('Content-Disposition')).toContain('DeCA_2999-01-01_E1234BBB.pdf')
    expect(r.headers.get('X-Robots-Tag')).toBe('noindex')
    expect(new Uint8Array(await r.arrayBuffer()).length).toBe(4)
  })
  it('404 si el token no tiene el formato esperado', async () => {
    expect((await llamar('corto')).status).toBe(404)
  })
  it('404 si no existe o no tiene PDF', async () => {
    respuestaFila = { data: null, error: null }
    expect((await llamar(TOKEN)).status).toBe(404)
    respuestaFila = { data: { ...fila, pdf_path: null }, error: null }
    expect((await llamar(TOKEN)).status).toBe(404)
  })
  it('410 pasados 7 días desde el fin del servicio', async () => {
    respuestaFila = { data: { ...fila, fecha_fin_servicio: '2020-01-01' }, error: null }
    expect((await llamar(TOKEN)).status).toBe(410)
  })
  it('500 si falla la descarga del almacenamiento', async () => {
    respuestaDescarga = { data: null, error: { message: 'x' } }
    expect((await llamar(TOKEN)).status).toBe(500)
  })
})
