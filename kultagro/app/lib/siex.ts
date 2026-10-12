// Reglas de datos para la integración con SIEX (Fase 1).
//
// Módulo PURO: sin React, sin Supabase y sin llamadas de red. Reúne las reglas de
// obligatoriedad, longitudes y plazos que el formulario de tratamientos, personal y equipos
// necesitan para que los datos que se recopilan sean enviables más adelante.
//
// Fuente: Anexo VI v3.11.4 (descriptor EstructuraCuadernoWS y JSON Schema oficial del CUE).
// Los catálogos (cultivo, variedad, justificación, problemática…) son Fase 2 y NO están aquí.

// ── Qué tratamientos se envían a SIEX ────────────────────────────────────────────────
// Solo las actuaciones fitosanitarias. Abonado, correctores nutricionales y bioestimulantes
// van a otros bloques de SIEX (o a ninguno); "Otro" no se envía salvo que se decida lo contrario.
export const SIEX_TIPOS_ENVIABLES: readonly string[] = [
  'Herbicida', 'Fungicida', 'Insecticida', 'Regulador de crecimiento',
]

export const esTipoEnviableSiex = (tipo: string): boolean => SIEX_TIPOS_ENVIABLES.includes(tipo)

// ── Longitudes máximas del descriptor ────────────────────────────────────────────────
export const SIEX_MAX_OBSERVACIONES = 150   // TratamFito.Observaciones: string(150)
export const SIEX_MAX_ROPO = 14             // NumROPO: string(14)
export const SIEX_MAX_ROMA = 12             // NumROMA: string(12)
export const SIEX_MAX_NUM_REGISTRO = 10     // ProductosFito.NumRegistro: string(10)
export const SIEX_LONG_CODIGO_SIEX = 14     // CodigoSIEX: exactamente 14 caracteres
export const SIEX_LONG_CODIGO_REA = 14      // CodigoRea: exactamente 14 caracteres (ES + 12 dígitos)
export const SIEX_DECIMALES_DOSIS = 3       // Dosis: number(8,3)
export const SIEX_DECIMALES_SUPERFICIE = 2  // Superficie: number(8,2)

// ── Validadores de formato: devuelven un mensaje de error, o null si es válido ───────
export const errorNumRegistro = (v: string | undefined | null): string | null => {
  const s = (v || '').trim()
  if (!s) return 'El nº de registro del producto es obligatorio'
  if (s.length > SIEX_MAX_NUM_REGISTRO) return `El nº de registro no puede superar ${SIEX_MAX_NUM_REGISTRO} caracteres`
  if (/\s/.test(s)) return 'El nº de registro no puede contener espacios'
  return null
}

export const errorRopo = (v: string | undefined | null): string | null => {
  const s = (v || '').trim()
  if (!s) return 'Falta el nº de ROPO'
  if (s.length > SIEX_MAX_ROPO) return `El nº de ROPO no puede superar ${SIEX_MAX_ROPO} caracteres`
  return null
}

export const errorRoma = (v: string | undefined | null): string | null => {
  const s = (v || '').trim()
  if (!s) return 'Falta el nº de ROMA'
  if (s.length > SIEX_MAX_ROMA) return `El nº de ROMA no puede superar ${SIEX_MAX_ROMA} caracteres`
  return null
}

// Campos opcionales de la explotación: vacío es válido; si se rellenan, deben tener formato.
export const errorCodigoSiex = (v: string | undefined | null): string | null => {
  const s = (v || '').trim()
  if (!s) return null
  return s.length === SIEX_LONG_CODIGO_SIEX ? null : `El código SIEX debe tener exactamente ${SIEX_LONG_CODIGO_SIEX} caracteres`
}

export const errorCodigoRea = (v: string | undefined | null): string | null => {
  const s = (v || '').trim()
  if (!s) return null
  return /^ES\d{12}$/i.test(s) ? null : 'El código REA debe tener 14 caracteres: "ES" seguido de 12 dígitos'
}

// ── Materias activas a partir del "formulado" del registro MAPA ──────────────────────
// Ejemplos reales:
//   "GLIFOSATO 36% [SL] P/V"                                  → ["GLIFOSATO"]
//   "CIPROCONAZOL 8% + PICOXISTROBIN 20% [SC] P/V"            → ["CIPROCONAZOL", "PICOXISTROBIN"]
//   "GLIFOSATO (sal isopropilamina) 18% + MCPA 18% [SL] P/V"  → ["GLIFOSATO", "MCPA"]
// Antes solo se guardaba la primera (split('%')[0]) y en las mezclas se perdían las demás.
export const extraerMateriasActivas = (formulado: string | undefined | null): string[] => {
  if (!formulado) return []
  // 1. Quitar el sufijo de formulación: " [WG] P/P", " [SL] P/V"
  const sinFormulacion = formulado.replace(/\s*\[[^\]]*\]\s*(?:P\/[PV])?\s*$/i, '')
  // 2. Separar los principios activos de una mezcla
  const partes = sinFormulacion.split(/\s+\+\s+/)
  const nombres: string[] = []
  for (const parte of partes) {
    // 3. Quitar paréntesis (sales, cepas, unidades) antes de buscar la concentración, porque
    //    dentro pueden aparecer números ("CEPA ABTS-1857, 540 g/kg"). Se repite por si hay anidados.
    let limpia = parte
    while (/\([^()]*\)/.test(limpia)) limpia = limpia.replace(/\s*\([^()]*\)/g, '')
    limpia = limpia.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
    // 4. El nombre llega hasta la concentración ("36%", "62,5g/L", "5 x 10E11", "5/microlitro")
    const m = limpia.match(/^(.*?)\s+\d[\d.,]*\s*(?:%|g\/|mg\/|kg\/|x\s*10|\/|$)/i)
    const nombre = (m ? m[1] : limpia).trim()
    if (nombre && !nombres.some(n => n.toLowerCase() === nombre.toLowerCase())) nombres.push(nombre)
  }
  return nombres
}

// Texto para el campo "Materia activa": todas las materias activas separadas por " + ".
export const materiasActivasTexto = (formulado: string | undefined | null): string =>
  extraerMateriasActivas(formulado).join(' + ')

// ── Superficie tratada ───────────────────────────────────────────────────────────────
const redondear = (n: number, dec: number): number => {
  const f = Math.pow(10, dec)
  return Math.round((n + Number.EPSILON) * f) / f
}
const truncar = (n: number, dec: number): number => {
  const f = Math.pow(10, dec)
  return Math.floor((n + 1e-9) * f) / f
}

// Hectáreas tratadas de una parcela: supHa × % aplicado, con 2 decimales (SIEX: number(8,2)).
export const superficieTratadaHa = (supHa: number, porcentaje: number): number =>
  redondear(supHa * (porcentaje / 100), SIEX_DECIMALES_SUPERFICIE)

// Reparte la superficie tratada de una parcela entre sus recintos SIGPAC en proporción a la
// superficie de cada uno. El resto de redondeo se asigna al último recinto para que la suma
// coincida exactamente con el total. SIEX pide la superficie por DGC (= por recinto).
export const repartirSuperficieEntreRecintos = (totalHa: number, supRecintos: number[]): number[] => {
  const suma = supRecintos.reduce((a, b) => a + b, 0)
  if (supRecintos.length === 0) return []
  if (supRecintos.length === 1 || suma <= 0) return [redondear(totalHa, SIEX_DECIMALES_SUPERFICIE), ...supRecintos.slice(1).map(() => 0)]
  const parciales = supRecintos.map(s => truncar(totalHa * (s / suma), SIEX_DECIMALES_SUPERFICIE))
  const resto = redondear(totalHa - parciales.reduce((a, b) => a + b, 0), SIEX_DECIMALES_SUPERFICIE)
  parciales[parciales.length - 1] = redondear(parciales[parciales.length - 1] + resto, SIEX_DECIMALES_SUPERFICIE)
  return parciales
}

// ── Plazos: 20 días editable, 30 días envío automático a SIEX ────────────────────────
export const SIEX_DIAS_EDICION = 20
export const SIEX_DIAS_ENVIO = 30
const MS_DIA = 86400000

export interface PlazoSiex {
  aplica: boolean          // ¿este tratamiento está sujeto a la regla de plazos?
  diasTranscurridos: number
  editable: boolean        // false a partir del día 20
  diasParaBloqueo: number  // días que quedan de edición (0 si ya está bloqueado)
  diasParaEnvio: number    // días que faltan para el envío (0 si ya toca enviarlo)
}

// La regla se activa configurando `desde` (fecha ISO, p. ej. "2026-10-01"): solo los
// tratamientos ENVIABLES creados a partir de esa fecha quedan sujetos a plazo. Sin fecha
// (valor vacío) la regla está desactivada y nada se bloquea, para no bloquear de golpe el
// histórico ya registrado.
export const calcularPlazoSiex = (
  tipo: string,
  creadoEn: string | undefined | null,
  desde: string | undefined | null,
  ahora: Date = new Date(),
): PlazoSiex => {
  const inactivo: PlazoSiex = { aplica: false, diasTranscurridos: 0, editable: true, diasParaBloqueo: SIEX_DIAS_EDICION, diasParaEnvio: SIEX_DIAS_ENVIO }
  if (!desde || !creadoEn || !esTipoEnviableSiex(tipo)) return inactivo
  const creado = new Date(creadoEn)
  const inicio = new Date(desde + 'T00:00:00')
  if (isNaN(creado.getTime()) || isNaN(inicio.getTime()) || creado < inicio) return inactivo
  const dias = Math.floor((ahora.getTime() - creado.getTime()) / MS_DIA)
  return {
    aplica: true,
    diasTranscurridos: dias,
    editable: dias < SIEX_DIAS_EDICION,
    diasParaBloqueo: Math.max(0, SIEX_DIAS_EDICION - dias),
    diasParaEnvio: Math.max(0, SIEX_DIAS_ENVIO - dias),
  }
}

// Un tratamiento sigue "pendiente de envío" hasta que se cumplen los 30 días desde su creación.
// Mientras tanto no se pueden borrar las parcelas ni los equipos que utiliza, porque el envío
// automático los necesitará (recintos SIGPAC y nº de ROMA).
export const estaPendienteDeEnvio = (plazo: PlazoSiex): boolean =>
  plazo.aplica && plazo.diasTranscurridos < SIEX_DIAS_ENVIO
