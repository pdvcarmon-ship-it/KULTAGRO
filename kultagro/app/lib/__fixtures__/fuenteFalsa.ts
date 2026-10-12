// Fuente de catálogos falsa para pruebas: datos reales (subconjunto) y el mismo comportamiento de búsqueda
// que la base de datos (todas las palabras tecleadas deben estar en `busqueda`).
import type { ItemCatalogo, FuenteCatalogos } from '../catalogos'
import fixture from './catalogos.json'

export const TODOS: ItemCatalogo[] = (fixture as any[]).map(f => ({
  catalogo: f.catalogo_id, codigo: String(f.codigo), descripcion: f.descripcion, padre: f.padre || '',
  extra: f.extra || {}, activo: f.activo !== false, orden: f.orden ?? 0, busqueda: f.busqueda,
}))

// Fuente falsa con el mismo comportamiento que la base de datos (búsqueda por tokens en `busqueda`)
export const fuenteFalsa = (): FuenteCatalogos & { llamadasBuscar: any[] } => {
  const llamadasBuscar: any[] = []
  return {
    llamadasBuscar,
    cargarTodo: async cat => TODOS.filter(i => i.catalogo === cat),
    buscar: async (cat, tokens, padre, limite) => {
      llamadasBuscar.push({ cat, tokens, padre, limite })
      return TODOS.filter(i => i.catalogo === cat && i.activo && (!padre || i.padre === padre) && tokens.every(t => i.busqueda.includes(t)))
        .sort((a, b) => a.orden - b.orden).slice(0, limite)
    },
    item: async (cat, codigo, padre) => TODOS.find(i => i.catalogo === cat && i.codigo === codigo && (!padre || i.padre === padre)) || null,
  }
}

