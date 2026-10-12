// Límites normativos de nutrientes y metales pesados (RD 1051/2022 y RD 47/2022).
// Funciones puras, sin acceso a base de datos. Los valores son los del Anexo I de
// "limites-normativos-plan-abonado.md". La app AVISA, nunca bloquea el guardado
// (la responsabilidad legal es del titular).
//
// Unidades internas: metales en g/ha; nitrógeno en kg N/ha.

export type Metal = 'Cd' | 'Cu' | 'Ni' | 'Pb' | 'Zn' | 'Hg' | 'Cr' | 'CrVI' | 'As'
export type MetalesMapa = Partial<Record<Metal, number>>

export const METALES_PRODUCTO: Metal[] = ['Cd', 'Cu', 'Ni', 'Pb', 'Zn', 'Hg', 'Cr', 'CrVI', 'As']
export const METALES_SUELO: Metal[] = ['Cd', 'Cu', 'Ni', 'Pb', 'Zn', 'Hg', 'Cr']
export const ETIQUETA_METAL: Record<Metal, string> = { Cd: 'Cd', Cu: 'Cu', Ni: 'Ni', Pb: 'Pb', Zn: 'Zn', Hg: 'Hg', Cr: 'Cr', CrVI: 'Cr VI', As: 'As' }

// Tabla A — concentración en el producto (mg/kg materia seca). [general, si suelo afectado]
// null en "afectado" = sin columna específica; 0 = "no detectable".
export const LIMITE_PRODUCTO: Record<Metal, { general: number; afectado: number | null }> = {
  Cd: { general: 10, afectado: 0.2 }, Cu: { general: 1000, afectado: 20 }, Ni: { general: 300, afectado: 6 },
  Pb: { general: 750, afectado: 15 }, Zn: { general: 2500, afectado: 50 }, Hg: { general: 10, afectado: 0.2 },
  Cr: { general: 1000, afectado: null }, CrVI: { general: 2, afectado: 0 }, As: { general: 40, afectado: 0.8 },
}

// Tabla B — concentración acumulada en el suelo (mg/kg ms, 25 cm). [pH < 7, pH >= 7]
export const LIMITE_SUELO: Record<string, { acido: number; basico: number }> = {
  Cd: { acido: 1, basico: 1.5 }, Cu: { acido: 50, basico: 100 }, Ni: { acido: 30, basico: 70 },
  Pb: { acido: 50, basico: 100 }, Zn: { acido: 150, basico: 200 }, Hg: { acido: 0.5, basico: 1 }, Cr: { acido: 60, basico: 100 },
}

// Tabla C — aporte anual (g/ha/año, media de 10 años). [general, si suelo afectado]
export const LIMITE_ANUAL: Record<string, { general: number; afectado: number }> = {
  Cd: { general: 150, afectado: 3 }, Cu: { general: 2400, afectado: 48 }, Ni: { general: 600, afectado: 12 },
  Pb: { general: 1500, afectado: 30 }, Zn: { general: 6000, afectado: 120 }, Hg: { general: 150, afectado: 3 }, Cr: { general: 2400, afectado: 48 },
}

// Nitrógeno orgánico en zona vulnerable (RD 47/2022). Solo el límite general es estatal.
export const LIMITE_N_GENERAL_KG_HA = 170
// Límites por cultivo: dependen del programa de actuación de cada CCAA. NO se cargan hasta
// confirmar los de Andalucía. Formato previsto: { cultivo: 'maíz', regimen: 'secano', limite: 210 }
export const LIMITES_N_CULTIVO: { cultivo: string; regimen: 'secano' | 'regadio' | null; limite: number }[] = []

export const METODOS_APLICACION = [
  { valor: '', etiqueta: 'No especificado' },
  { valor: 'plato', etiqueta: 'Plato' },
  { valor: 'abanico', etiqueta: 'Abanico' },
  { valor: 'canon', etiqueta: 'Cañón' },
  { valor: 'localizado', etiqueta: 'Localizado / fertirrigación' },
  { valor: 'enterrado', etiqueta: 'Enterrado / inyección' },
  { valor: 'otro', etiqueta: 'Otro' },
] as const
const METODOS_RESTRINGIDOS_PENDIENTE_10 = ['plato', 'abanico', 'canon']

export interface AvisoNormativo {
  tipo: 'producto' | 'anual' | 'nitrogeno_zona_vulnerable' | 'metodo_pendiente_10' | 'metodo_pendiente_15'
  metal?: Metal
  valor?: number
  limite?: number
  texto: string
}

export interface AporteHistorico {
  fecha: string // 'YYYY-MM-DD'
  metalesGHa: MetalesMapa // g/ha aportados por ese plan
  nKgHa: number           // kg N/ha aportados (solo cuenta si organico)
  organico: boolean
}

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
const fmtN = (n: number): string => (Math.round(n * 100) / 100).toString().replace('.', ',')

// mg/kg ms × dosis (kg/ha de producto) × fracción de materia seca / 1000 = g/ha
export function aporteMetalesGHa(metales: MetalesMapa, dosisKgHa: number, materiaSecaPct: number): MetalesMapa {
  const ms = (materiaSecaPct > 0 ? materiaSecaPct : 100) / 100
  const out: MetalesMapa = {}
  METALES_PRODUCTO.forEach(m => { if (metales[m] != null) out[m] = (num(metales[m]) * num(dosisKgHa) * ms) / 1000 })
  return out
}

// Metales del suelo que superan la tabla B según el pH (suelo "afectado" → columna 3 en A y C).
export function metalesSueloAfectados(metalesSuelo: MetalesMapa | undefined, ph: number | undefined): { afectados: Metal[]; faltaPh: boolean } {
  if (!metalesSuelo) return { afectados: [], faltaPh: false }
  const hayDatos = METALES_SUELO.some(m => metalesSuelo[m] != null)
  if (!hayDatos) return { afectados: [], faltaPh: false }
  if (ph == null || !isFinite(ph)) return { afectados: [], faltaPh: true }
  const afectados = METALES_SUELO.filter(m => {
    const v = metalesSuelo[m]
    if (v == null) return false
    const lim = LIMITE_SUELO[m]
    return v > (ph < 7 ? lim.acido : lim.basico)
  })
  return { afectados, faltaPh: false }
}

const restarAnios = (iso: string, anios: number): string => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - anios); return d.toISOString().slice(0, 10)
}

export interface EntradaEvaluacion {
  fechaAplicacion: string               // 'YYYY-MM-DD'
  abonoTipo: 'organico' | 'inorganico' | ''
  dosisKgHa: number
  metalesProducto: MetalesMapa          // mg/kg ms
  materiaSecaPct: number
  aporteNKgHa: number                   // kg N/ha aportados por este abono
  sueloAfectados: Metal[]
  pendienteMedia?: number               // %
  zonaVulnerable: boolean
  supHa: number
  colindanteMismaExplotacion: boolean
  metodo: string
  tecnicaAntierosion: boolean
  historico: AporteHistorico[]          // aportes previos de la misma parcela (sin este)
}

export function evaluarAporte(e: EntradaEvaluacion): AvisoNormativo[] {
  const av: AvisoNormativo[] = []
  const afectado = (m: Metal) => e.sueloAfectados.includes(m)

  // 1) Concentración en el producto (tabla A)
  METALES_PRODUCTO.forEach(m => {
    const v = e.metalesProducto[m]
    if (v == null) return
    const l = LIMITE_PRODUCTO[m]
    const lim = afectado(m) && l.afectado != null ? l.afectado : l.general
    if (v > lim) av.push({ tipo: 'producto', metal: m, valor: v, limite: lim,
      texto: `${ETIQUETA_METAL[m]} en el producto: ${fmtN(v)} mg/kg ms supera el límite de ${fmtN(lim)}${afectado(m) ? ' (suelo afectado)' : ''}.` })
  })

  // 2) Aporte anual, media móvil de 10 años (tabla C). Media = suma de 10 años / 10.
  const nuevo = aporteMetalesGHa(e.metalesProducto, e.dosisKgHa, e.materiaSecaPct)
  const desde = restarAnios(e.fechaAplicacion, 10)
  const previos = e.historico.filter(h => h.fecha > desde && h.fecha <= e.fechaAplicacion)
  METALES_SUELO.forEach(m => {
    if (e.metalesProducto[m] == null && !previos.some(h => h.metalesGHa[m] != null)) return
    const total = num(nuevo[m]) + previos.reduce((a, h) => a + num(h.metalesGHa[m]), 0)
    const media = total / 10
    const l = LIMITE_ANUAL[m]
    const lim = afectado(m) ? l.afectado : l.general
    if (media > lim) av.push({ tipo: 'anual', metal: m, valor: media, limite: lim,
      texto: `${ETIQUETA_METAL[m]}: media de 10 años de ${fmtN(media)} g/ha/año supera el límite de ${fmtN(lim)}${afectado(m) ? ' (suelo afectado)' : ''}.` })
  })

  // 3) Nitrógeno orgánico en zona vulnerable (últimos 12 meses)
  if (e.zonaVulnerable && e.abonoTipo === 'organico') {
    const desde12 = restarAnios(e.fechaAplicacion, 1)
    const nPrevio = e.historico.filter(h => h.organico && h.fecha > desde12 && h.fecha <= e.fechaAplicacion).reduce((a, h) => a + h.nKgHa, 0)
    const n12 = nPrevio + e.aporteNKgHa
    if (n12 > LIMITE_N_GENERAL_KG_HA) av.push({ tipo: 'nitrogeno_zona_vulnerable', valor: n12, limite: LIMITE_N_GENERAL_KG_HA,
      texto: `Nitrógeno orgánico en zona vulnerable: ${fmtN(n12)} kg N/ha en 12 meses supera el límite general de ${LIMITE_N_GENERAL_KG_HA}.` })
  }

  // 4) Método según pendiente
  const pend = e.pendienteMedia
  if (pend != null) {
    if (pend > 10 && METODOS_RESTRINGIDOS_PENDIENTE_10.includes(e.metodo) && !(e.supHa < 1 && !e.colindanteMismaExplotacion))
      av.push({ tipo: 'metodo_pendiente_10', valor: pend, limite: 10,
        texto: `Pendiente del ${fmtN(pend)} %: no se permite aplicar por plato, abanico o cañón con pendiente superior al 10 % (salvo recintos de menos de 1 ha no colindantes).` })
    if (pend > 15 && e.abonoTipo === 'inorganico' && e.zonaVulnerable && !e.tecnicaAntierosion)
      av.push({ tipo: 'metodo_pendiente_15', valor: pend, limite: 15,
        texto: `Pendiente del ${fmtN(pend)} % en zona vulnerable: el fertilizante inorgánico requiere técnica antierosión (bancales, terrazas, laboreo de conservación) o aplicación enterrada/en cobertera.` })
  }
  return av
}
