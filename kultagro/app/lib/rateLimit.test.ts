// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

let respuesta: any = { data: true, error: null }
let lanzar = false
vi.mock('./supabaseAdmin', () => ({
  supabaseAdmin: { rpc: async () => { if (lanzar) throw new Error('caído'); return respuesta } },
}))
import { limitar, ipDe } from './rateLimit'

describe('limitar', () => {
  it('permite o bloquea según la función de base de datos', async () => {
    respuesta = { data: true, error: null }; expect(await limitar('k', 5, 60)).toBe(true)
    respuesta = { data: false, error: null }; expect(await limitar('k', 5, 60)).toBe(false)
  })
  it('si no se puede consultar (SQL sin ejecutar, caída), PERMITE en lugar de cortar el servicio', async () => {
    respuesta = { data: null, error: { message: 'function does not exist' } }
    expect(await limitar('k', 5, 60)).toBe(true)
    lanzar = true
    expect(await limitar('k', 5, 60)).toBe(true)
  })
})

describe('ipDe', () => {
  const req = (h: Record<string, string>) => ({ headers: { get: (n: string) => h[n] ?? null } })
  it('toma la primera IP de x-forwarded-for', () => expect(ipDe(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1'))
  it('usa x-real-ip o un valor por defecto', () => {
    expect(ipDe(req({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3')
    expect(ipDe(req({}))).toBe('desconocida')
  })
})
