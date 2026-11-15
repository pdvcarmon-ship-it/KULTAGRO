// Catálogos oficiales SIEX (Fase 2): acceso a datos y búsqueda por texto.
//
// Los catálogos viven en la tabla `siex_catalogos` (sql/03_siex_fase2_catalogos.sql), cargada por
// el script siex_catalogos.py del backend. Aquí solo se LEEN.
//
//  · Catálogos pequeños (cultivos, plagas, enfermedades, malas hierbas, justificaciones...):
//    se descargan enteros una sola vez y se filtran en el navegador (respuesta inmediata al teclear).
//  · Catálogos grandes (variedades: ~88.000 filas): se consulta al servidor mientras se escribe,
//    siempre acotado al cultivo elegido.
//
// Este módulo no depende de React. La fuente de datos se puede sustituir (`usarFuenteCatalogos`)
// para probarlo sin Supabase.

import { supabase } from './supabaseClient'

// ── Tipos ────────────────────────────────────────────────────────────────────────────
export interface ItemCatalogo {
  catalogo: string                 // idTabla oficial ('PRODUCTOS', 'VARIEDAD_ESPECIE_TIPO', 'PLAGAS'...)
  codigo: string                   // código que se envía a SIEX
  descripcion: string              // lo que ve el usuario
  padre: string                    // cultivo (variedades) o nodo padre (árboles); '' si no tiene
  extra: Record<string, any>       // nombre científico, EPPO, es_hoja...
  activo: boolean
  orden: number
  busqueda: string                 // texto normalizado (minúsculas, sin acentos)
}

export interface ResultadoBusqueda { items: ItemCatalogo[]; hayMas: boolean }

// Nombres oficiales (idTabla) de los catálogos que usa Kampo
export const CAT = {
  CULTIVO: 'PRODUCTOS',
  VARIEDAD: 'VARIEDAD_ESPECIE_TIPO',
  PLAGAS: 'PLAGAS',
  ENFERMEDADES: 'ENFERMEDADES',
  MALAS_HIERBAS: 'MALAS_HIERBAS',
  REGULADORES: 'REGULADORES_CRECIMIENTO',
  JUSTIFICACION: 'JUSTIFICACION_ACTUACION',
  ESTADO_FENOLOGICO: 'EST_FENOLOGICO',
  EFICACIA: 'EFICACIA_TRATAMIENTO',
  UNIDADES: 'UNIDADES_MEDIDA',
} as const

// Catálogos demasiado grandes para descargarlos enteros: se buscan en el servidor
const CATALOGOS_SERVIDOR = new Set<string>([CAT.VARIEDAD])
export const esCatalogoServidor = (catalogo: string): boolean => CATALOGOS_SERVIDOR.has(catalogo)

export const LIMITE_SUGERENCIAS = 12

// ── Normalización y ranking (funciones puras) ────────────────────────────────────────
// DEBE coincidir con `normalizar` de siex_catalogos.py (backend): así lo que se teclea se compara
// con el texto de búsqueda que se guardó en la base de datos.
export const normalizarTexto = (s: string | null | undefined): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export const tokensDe = (texto: string): string[] => normalizarTexto(texto).split(' ').filter(Boolean)

// Menor puntuación = mejor. null = no coincide (deben aparecer TODAS las palabras tecleadas).
export const puntuar = (busqueda: string, tokens: string[]): number | null => {
  if (tokens.length === 0) return 0
  for (const t of tokens) if (!busqueda.includes(t)) return null
  const palabras = busqueda.split(' ')
  let puntos = busqueda.startsWith(tokens.join(' ')) ? 0 : 10          // empieza por lo tecleado
  for (const t of tokens) if (!palabras.some(p => p.startsWith(t))) puntos += 3   // coincidencia a mitad de palabra
  return puntos
}

// Filtra y ordena: mejor coincidencia primero; a igualdad, los nodos finales (hojas) antes que las
// categorías, y después el orden original del catálogo oficial.
export const filtrarItems = (
  items: ItemCatalogo[], texto: string,
  opciones: { padre?: string; limite?: number; soloActivos?: boolean; excluir?: Set<string> } = {},
): ResultadoBusqueda => {
  const { padre, limite = LIMITE_SUGERENCIAS, soloActivos = true, excluir } = opciones
  const tokens = tokensDe(texto)
  const encontrados: { item: ItemCatalogo; puntos: number }[] = []
  for (const item of items) {
    if (soloActivos && !item.activo) continue
    if (padre !== undefined && padre !== '' && item.padre !== padre) continue
    if (excluir && excluir.has(item.codigo)) continue
    const puntos = puntuar(item.busqueda, tokens)
    if (puntos !== null) encontrados.push({ item, puntos })
  }
  encontrados.sort((a, b) =>
    a.puntos - b.puntos ||
    Number(b.item.extra?.es_hoja === true) - Number(a.item.extra?.es_hoja === true) ||
    a.item.orden - b.item.orden)
  return { items: encontrados.slice(0, limite).map(e => e.item), hayMas: encontrados.length > limite }
}

// Ruta de ancestros de un nodo de árbol, de la raíz al padre ("Insectos › Pulgones"). Requiere el catálogo entero.
export const rutaDe = (todos: Map<string, ItemCatalogo>, item: ItemCatalogo, maxNiveles = 2): string[] => {
  const ruta: string[] = []
  let actual: ItemCatalogo | undefined = item.padre ? todos.get(item.padre) : undefined
  let guarda = 0
  while (actual && guarda++ < 12) {
    ruta.unshift(actual.descripcion)
    actual = actual.padre ? todos.get(actual.padre) : undefined
  }
  return ruta.slice(-maxNiveles)
}

// ── Fuente de datos ──────────────────────────────────────────────────────────────────
export interface FuenteCatalogos {
  cargarTodo(catalogo: string): Promise<ItemCatalogo[]>
  buscar(catalogo: string, tokens: string[], padre: string, limite: number): Promise<ItemCatalogo[]>
  item(catalogo: string, codigo: string, padre: string): Promise<ItemCatalogo | null>
}

const desdeFila = (f: any): ItemCatalogo => ({
  catalogo: f.catalogo_id, codigo: String(f.codigo), descripcion: f.descripcion, padre: f.padre || '',
  extra: f.extra || {}, activo: f.activo !== false, orden: f.orden ?? 0, busqueda: f.busqueda || '',
})

const COLUMNAS = 'catalogo_id,codigo,descripcion,padre,extra,activo,orden,busqueda'
const TAM_PAGINA = 1000   // límite de filas por petición de Supabase

const fuenteSupabase: FuenteCatalogos = {
  async cargarTodo(catalogo) {
    const todos: ItemCatalogo[] = []
    for (let desde = 0; ; desde += TAM_PAGINA) {
      const { data, error } = await supabase.from('siex_catalogos').select(COLUMNAS)
        .eq('catalogo_id', catalogo).order('orden').range(desde, desde + TAM_PAGINA - 1)
      if (error) throw new Error(error.message)
      const filas = data || []
      todos.push(...filas.map(desdeFila))
      if (filas.length < TAM_PAGINA) break
    }
    return todos
  },
  async buscar(catalogo, tokens, padre, limite) {
    let q = supabase.from('siex_catalogos').select(COLUMNAS).eq('catalogo_id', catalogo).eq('activo', true)
    if (padre) q = q.eq('padre', padre)
    for (const t of tokens) q = q.ilike('busqueda', `%${t}%`)   // los tokens solo llevan [a-z0-9]
    const { data, error } = await q.order('orden').limit(limite)
    if (error) throw new Error(error.message)
    return (data || []).map(desdeFila)
  },
  async item(catalogo, codigo, padre) {
    let q = supabase.from('siex_catalogos').select(COLUMNAS).eq('catalogo_id', catalogo).eq('codigo', codigo)
    if (padre) q = q.eq('padre', padre)
    const { data, error } = await q.limit(1)
    if (error) throw new Error(error.message)
    return data && data.length > 0 ? desdeFila(data[0]) : null
  },
}

let fuente: FuenteCatalogos = fuenteSupabase
const cacheCompletos = new Map<string, Promise<ItemCatalogo[]>>()
const cacheItems = new Map<string, ItemCatalogo | null>()

// Para pruebas: sustituye la fuente y vacía las cachés
export const usarFuenteCatalogos = (nueva: FuenteCatalogos | null): void => {
  fuente = nueva || fuenteSupabase
  cacheCompletos.clear()
  cacheItems.clear()
}

// ── API para los componentes ─────────────────────────────────────────────────────────
// Catálogo completo (solo para los pequeños). Se descarga una vez por sesión.
export const cargarCatalogo = (catalogo: string): Promise<ItemCatalogo[]> => {
  let p = cacheCompletos.get(catalogo)
  if (!p) {
    p = fuente.cargarTodo(catalogo).catch(e => { cacheCompletos.delete(catalogo); throw e })   // si falla, se reintentará
    cacheCompletos.set(catalogo, p)
  }
  return p
}

export const buscarCatalogo = async (
  catalogo: string, texto: string,
  opciones: { padre?: string; limite?: number; excluir?: Set<string> } = {},
): Promise<ResultadoBusqueda> => {
  const { padre = '', limite = LIMITE_SUGERENCIAS, excluir } = opciones
  if (esCatalogoServidor(catalogo)) {
    // Se piden algunos más de los que se muestran para poder ordenar por relevancia y saber si hay más
    const filas = await fuente.buscar(catalogo, tokensDe(texto), padre, limite * 3 + 1)
    return filtrarItems(filas, texto, { padre, limite, excluir })
  }
  return filtrarItems(await cargarCatalogo(catalogo), texto, { padre, limite, excluir })
}

// Recupera un elemento por su código (para mostrar su nombre al abrir un formulario ya guardado)
export const obtenerItem = async (catalogo: string, codigo: string, padre = ''): Promise<ItemCatalogo | null> => {
  if (!codigo) return null
  const clave = `${catalogo}|${padre}|${codigo}`
  if (cacheItems.has(clave)) return cacheItems.get(clave) || null
  let resultado: ItemCatalogo | null
  if (esCatalogoServidor(catalogo)) {
    resultado = await fuente.item(catalogo, codigo, padre)
  } else {
    const todos = await cargarCatalogo(catalogo)
    resultado = todos.find(i => i.codigo === codigo && (!padre || i.padre === padre)) || null
  }
  cacheItems.set(clave, resultado)
  return resultado
}

// Mapa código -> elemento de un catálogo pequeño (para rutas jerárquicas)
export const mapaCatalogo = async (catalogo: string): Promise<Map<string, ItemCatalogo>> =>
  new Map((await cargarCatalogo(catalogo)).map(i => [i.codigo, i]))

// Busca por nombre exacto (sin acentos ni mayúsculas). Sirve para enlazar textos antiguos con el catálogo.
export const buscarPorNombreExacto = async (catalogo: string, nombre: string, padre = ''): Promise<ItemCatalogo | null> => {
  const objetivo = normalizarTexto(nombre)
  if (!objetivo) return null
  if (esCatalogoServidor(catalogo)) {
    const filas = await fuente.buscar(catalogo, tokensDe(nombre), padre, 50)
    return filas.find(f => normalizarTexto(f.descripcion) === objetivo) || null
  }
  const todos = await cargarCatalogo(catalogo)
  return todos.find(i => i.activo && normalizarTexto(i.descripcion) === objetivo && (!padre || i.padre === padre)) || null
}

// ── Cultivo + variedad ───────────────────────────────────────────────────────────────
export interface CultivoVariedadValor {
  cultivo: string          // nombre (texto que ya usa el resto de la aplicación)
  cultivoCodigo: string    // PRODUCTOS.codigo ('' si aún es un texto antiguo sin enlazar)
  variedad: string
  variedadCodigo: string   // VARIEDAD_ESPECIE_TIPO.codigo dentro del cultivo
}

// ¿Tiene el cultivo alguna variedad vigente en el catálogo? (1.019 de 1.023 cultivos activos sí)
export const cultivoTieneVariedades = async (cultivoCodigo: string): Promise<boolean> => {
  if (!cultivoCodigo) return false
  return (await buscarCatalogo(CAT.VARIEDAD, '', { padre: cultivoCodigo, limite: 1 })).items.length > 0
}

// Comprobación común de los formularios: el cultivo debe ser del catálogo y, si el cultivo tiene
// variedades, también la variedad. Devuelve el mensaje de error o null.
export const errorCultivoVariedad = async (v: CultivoVariedadValor): Promise<string | null> => {
  if (!v.cultivoCodigo) {
    return v.cultivo.trim()
      ? `El cultivo «${v.cultivo}» no está enlazado con el catálogo SIEX. Escribe unas letras y elígelo de la lista.`
      : 'El cultivo es obligatorio: escribe unas letras y elígelo de la lista.'
  }
  if (!v.variedadCodigo && await cultivoTieneVariedades(v.cultivoCodigo)) {
    return v.variedad.trim()
      ? `La variedad «${v.variedad}» no está enlazada con el catálogo SIEX. Escribe unas letras y elígela de la lista.`
      : 'La variedad es obligatoria: escribe unas letras y elígela de la lista.'
  }
  return null
}
