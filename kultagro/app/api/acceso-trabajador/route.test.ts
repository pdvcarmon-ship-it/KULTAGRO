// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashCodigo } from '../../lib/codigoActivacion'

const CUENTA = '11111111-1111-1111-1111-111111111111'
let personal: any[] = []
let permitir = true
const createUser = vi.fn(async () => ({ data: { user: { id: 'u-nuevo' } }, error: null }))
const update = vi.fn()

vi.mock('../../lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    rpc: async (nombre: string, args: any) => {
      if (nombre === 'rate_limit_hit') return { data: permitir, error: null }
      if (nombre === 'cuenta_id_por_email_empresa') return { data: args.p_email === 'empresa@x.es' ? CUENTA : null, error: null }
      return { data: null, error: null }
    },
    from: () => ({
      select: () => ({ eq: async () => ({ data: personal, error: null }) }),
      update: (v: any) => { update(v); return { eq: async () => ({ error: null }) } },
    }),
    auth: { admin: { createUser: (...a: any[]) => (createUser as any)(...a) } },
  },
}))

import { POST } from './route'

const llamar = (b: any) => POST({ json: async () => b, headers: { get: () => '1.2.3.4' } } as any)
const base = { emailEmpresa: 'empresa@x.es', dni: '12345678Z', password: 'secreta1', codigo: '' }
const MANANA = () => new Date(Date.now() + 86_400_000).toISOString()

beforeEach(() => {
  permitir = true
  createUser.mockClear(); update.mockClear()
  personal = [{ id: 'p1', dni: '12345678Z', estado_acceso: 'pendiente', auth_user_id: null, codigo_activacion_hash: null, codigo_activacion_caduca: null }]
})

describe('POST /api/acceso-trabajador', () => {
  it('429 si se superan los intentos', async () => {
    permitir = false
    expect((await llamar(base)).status).toBe(429)
  })
  it('no revela si la empresa existe: devuelve un email inexistente', async () => {
    const r = await llamar({ ...base, emailEmpresa: 'otra@x.es' })
    expect(r.status).toBe(200)
    expect((await r.json()).syntheticEmail).toContain('@no-existe.kampo.internal')
  })
  it('no revela si el DNI existe ni si no tiene acceso', async () => {
    const dniAjeno = await (await llamar({ ...base, dni: '00000000T' })).json()
    expect(dniAjeno.syntheticEmail).toContain('@no-existe.')
    personal[0].estado_acceso = 'sin_acceso'
    expect((await (await llamar(base)).json()).syntheticEmail).toContain('@no-existe.')
  })
  it('primer acceso SIN código no crea el usuario (ya no se puede secuestrar con email + DNI)', async () => {
    const r = await (await llamar(base)).json()
    expect(r.syntheticEmail).toContain('@no-existe.')
    expect(createUser).not.toHaveBeenCalled()
  })
  it('primer acceso con código erróneo o caducado no crea el usuario', async () => {
    personal[0].codigo_activacion_hash = await hashCodigo('ABCDEFGHJKMN')
    personal[0].codigo_activacion_caduca = MANANA()
    await llamar({ ...base, codigo: 'AAAA-AAAA-AAAA' })
    personal[0].codigo_activacion_caduca = new Date(Date.now() - 1000).toISOString()
    await llamar({ ...base, codigo: 'abcd-efgh-jkmn' })
    expect(createUser).not.toHaveBeenCalled()
  })
  it('primer acceso con el código correcto crea el usuario y gasta el código', async () => {
    personal[0].codigo_activacion_hash = await hashCodigo('ABCDEFGHJKMN')
    personal[0].codigo_activacion_caduca = MANANA()
    const r = await (await llamar({ ...base, codigo: 'abcd-efgh-jkmn' })).json()
    expect(r.syntheticEmail).toBe(`12345678z@${CUENTA}.kampo.internal`)
    expect(createUser).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ estado_acceso: 'activo', codigo_activacion_hash: null, codigo_activacion_caduca: null }))
  })
  it('un trabajador con acceso activo recibe su email interno sin pedir código', async () => {
    personal[0] = { ...personal[0], estado_acceso: 'activo', auth_user_id: 'u1' }
    const r = await (await llamar(base)).json()
    expect(r.syntheticEmail).toBe(`12345678z@${CUENTA}.kampo.internal`)
    expect(createUser).not.toHaveBeenCalled()
  })
})
