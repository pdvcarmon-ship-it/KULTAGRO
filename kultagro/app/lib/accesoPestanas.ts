// Acceso a pestañas por CUENTA. Lo fija WEB desde GES (columna cuentas.pestanas_deshabilitadas).
// Una cuenta sin acceso a una pestaña no la ve, ni tampoco ninguno de sus trabajadores: desaparece del
// índice de pestañas y su módulo desaparece de la lista de permisos de la pestaña PERMISOS.
//
// La lista guardada es la de pestañas DESHABILITADAS (vacía = todas), así una pestaña nueva queda
// disponible para todas las cuentas hasta que se bloquee a propósito.

// Identificadores de pestaña que se pueden bloquear desde GES (deben coincidir con los de GES).
// 'vincular_siex' sigue oculto para todos (ver MOSTRAR_VINCULAR_SIEX) y no se configura todavía.
export const PESTANAS_CONFIGURABLES = [
  'mapa', 'mis_parcelas', 'tratamientos', 'stock', 'tareas', 'riego', 'cosechas',
  'abonado', 'plantacion', 'personal', 'equipos', 'permisos',
] as const

// Pestañas que usan los permisos de cada módulo de CATALOGO_PERMISOS. Un módulo se muestra en PERMISOS
// mientras al menos una de sus pestañas siga disponible (p. ej. los permisos de "Parcelas" también los
// usa el MAPA para guardar parcelas, así que no se ocultan si solo se quita MIS PARCELAS).
export const PESTANAS_DE_MODULO: Record<string, string[]> = {
  // 'vincular_siex' no cuenta: está oculta para todos y no se configura desde GES (añadirla aquí cuando se publique)
  'Parcelas': ['mapa', 'mis_parcelas', 'plantacion'],
  'Tratamientos fitosanitarios': ['tratamientos'],
  'Stock': ['stock'],
  'Riego': ['riego'],
  'Maquinaria': ['equipos'],
  'Cosechas': ['cosechas'],
  'Personal': ['personal'],
  'Permisos': ['permisos'],
  'Plan de abonado': ['abonado'],
  'Tareas': ['tareas'],
}

export const pestanaConAcceso = (pestana: string, deshabilitadas: string[]): boolean => !deshabilitadas.includes(pestana)

export const moduloVisible = (modulo: string, deshabilitadas: string[]): boolean => {
  const pestanas = PESTANAS_DE_MODULO[modulo]
  if (!pestanas) return true // módulo sin pestaña asociada: no se oculta
  return pestanas.some(p => !deshabilitadas.includes(p))
}

// Primera pestaña disponible, para sacar al usuario de una que se le ha bloqueado
export const primeraPestanaDisponible = (orden: string[], permitida: (p: string) => boolean): string | null =>
  orden.find(permitida) ?? null
