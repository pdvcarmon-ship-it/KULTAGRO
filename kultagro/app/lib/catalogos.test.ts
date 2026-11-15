import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ItemCatalogo } from './catalogos'
import { TODOS, fuenteFalsa } from './__fixtures__/fuenteFalsa'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
import {
  normalizarTexto, puntuar, filtrarItems, rutaDe, buscarCatalogo, obtenerItem, buscarPorNombreExacto,
  usarFuenteCatalogos, CAT,
} from './catalogos'

describe('normalizarTexto', () => {
  it('quita acentos, mayúsculas y signos', () => {
    expect(normalizarTexto('VIÑA - OLIVAR')).toBe('vina olivar')
    expect(normalizarTexto('  Pulgón del guisante, Acyrthosiphon ')).toBe('pulgon del guisante acyrthosiphon')
    expect(normalizarTexto('MAÍZ')).toBe('maiz')
    expect(normalizarTexto(null)).toBe('')
  })
  it('coincide con el texto de búsqueda que guarda el backend (Python) en TODAS las filas reales del fixture', () => {
    const distintas = TODOS.filter(i => !i.busqueda.startsWith(normalizarTexto(i.descripcion)))
    expect(distintas).toEqual([])
  })
})

describe('puntuar / filtrarItems', () => {
  it('exige que aparezcan todas las palabras tecleadas', () => {
    expect(puntuar('pulgon del guisante', ['pulgon', 'guisante'])).not.toBeNull()
    expect(puntuar('pulgon del guisante', ['pulgon', 'algodon'])).toBeNull()
  })
  it('prefiere lo que empieza por lo tecleado', () => {
    const a = puntuar('olivo', ['oli'])!, b = puntuar('viña olivar', ['oli'])!
    expect(a).toBeLessThan(b)
  })
  it('es insensible a acentos y mayúsculas', () => {
    const cultivos = TODOS.filter(i => i.catalogo === CAT.CULTIVO)
    expect(filtrarItems(cultivos, 'VINA').items.map(i => i.descripcion)).toContain('VIÑA')
    expect(filtrarItems(cultivos, 'viña').items.map(i => i.descripcion)).toContain('VIÑA')
  })
  it('no ofrece elementos dados de baja', () => {
    const items: ItemCatalogo[] = [
      { catalogo: 'X', codigo: '1', descripcion: 'ANTIGUO', padre: '', extra: {}, activo: false, orden: 0, busqueda: 'antiguo' },
      { catalogo: 'X', codigo: '2', descripcion: 'ANTIGUO NUEVO', padre: '', extra: {}, activo: true, orden: 1, busqueda: 'antiguo nuevo' },
    ]
    expect(filtrarItems(items, 'anti').items.map(i => i.codigo)).toEqual(['2'])
  })
  it('respeta el límite e indica si hay más', () => {
    const r = filtrarItems(TODOS.filter(i => i.catalogo === CAT.VARIEDAD && i.padre === '101'), '', { limite: 5 })
    expect(r.items).toHaveLength(5)
    expect(r.hayMas).toBe(true)
  })
  it('en árboles, a igual coincidencia ofrece antes los nodos finales que las categorías', () => {
    const plagas = TODOS.filter(i => i.catalogo === CAT.PLAGAS)
    const r = filtrarItems(plagas, 'pulgon').items
    const hojas = r.filter(i => i.extra.es_hoja === true).length
    expect(hojas).toBeGreaterThan(0)
  })
})

describe('rutaDe', () => {
  it('devuelve los ancestros de un nodo de árbol', () => {
    const plagas = new Map(TODOS.filter(i => i.catalogo === CAT.PLAGAS).map(i => [i.codigo, i]))
    const guisante = TODOS.find(i => i.catalogo === CAT.PLAGAS && i.descripcion.startsWith('Pulgón del guisante'))!
    const ruta = rutaDe(plagas, guisante, 3)
    expect(ruta.length).toBeGreaterThan(0)
    expect(ruta[ruta.length - 1]).toContain('pulgones')   // su padre directo: «Áfidos, pulgones, Aphididae»
  })
})

describe('buscarCatalogo (variedades dependientes del cultivo)', () => {
  let fuente: ReturnType<typeof fuenteFalsa>
  beforeEach(() => { fuente = fuenteFalsa(); usarFuenteCatalogos(fuente) })

  it('las variedades se buscan en el servidor y solo del cultivo indicado', async () => {
    const r = await buscarCatalogo(CAT.VARIEDAD, 'arb', { padre: '101' })
    expect(r.items.map(i => i.descripcion)).toContain('ARBEQUINA')
    expect(r.items.every(i => i.padre === '101')).toBe(true)
    expect(fuente.llamadasBuscar[0]).toMatchObject({ cat: CAT.VARIEDAD, padre: '101', tokens: ['arb'] })
  })
  it('con otro cultivo NO aparecen las variedades del olivo', async () => {
    const r = await buscarCatalogo(CAT.VARIEDAD, 'arb', { padre: '197' })
    expect(r.items.map(i => i.descripcion)).not.toContain('ARBEQUINA')
  })
  it('sin texto ofrece las primeras del cultivo (en el trigo, empezando por SIN VARIEDAD)', async () => {
    const r = await buscarCatalogo(CAT.VARIEDAD, '', { padre: '1' })
    expect(r.items[0].descripcion).toBe('SIN VARIEDAD')
  })
  it('lo dado de baja no se ofrece: SIEX retiró «SIN VARIEDAD» del olivo, hay que elegir una variedad real', async () => {
    const r = await buscarCatalogo(CAT.VARIEDAD, '', { padre: '101' })
    expect(r.items.map(i => i.descripcion)).not.toContain('SIN VARIEDAD')
    expect(r.items[0].descripcion).toBe('DE LA TERRA')
  })
  it('los catálogos pequeños se descargan una sola vez y se filtran en memoria', async () => {
    const espia = vi.spyOn(fuente, 'cargarTodo')
    await buscarCatalogo(CAT.CULTIVO, 'oli'); await buscarCatalogo(CAT.CULTIVO, 'vin'); await buscarCatalogo(CAT.CULTIVO, 'tri')
    expect(espia).toHaveBeenCalledTimes(1)
  })
  it('obtenerItem resuelve por cultivo + código de variedad (el "0" existe en todos los cultivos)', async () => {
    const a = await obtenerItem(CAT.VARIEDAD, '0', '101'), b = await obtenerItem(CAT.VARIEDAD, '0', '197')
    expect(a?.padre).toBe('101'); expect(b?.padre).toBe('197')
  })
  it('buscarPorNombreExacto enlaza textos antiguos ("Olivo", "vina") con el catálogo', async () => {
    expect((await buscarPorNombreExacto(CAT.CULTIVO, 'Olivo'))?.codigo).toBe('101')
    expect((await buscarPorNombreExacto(CAT.CULTIVO, 'viña'))?.codigo).toBe('102')
    expect(await buscarPorNombreExacto(CAT.CULTIVO, 'cultivo inventado')).toBeNull()
  })
})
