// lib/deca.ts
//
// Documento de Control Administrativo (DeCA) del transporte de mercancías por carretera.
// Fuentes: Orden FOM/2861/2012 (contenido mínimo, art. 6) y Resolución de 5 de junio de 2026
// (características técnicas del PDF, QR y URL).
//
// Este fichero solo tiene lógica pura (sin React, sin Supabase) para poder probarla con vitest.
// El PDF se genera en lib/decaPdf.ts y el enlace público de descarga en app/api/deca/[token].

export const UNIDADES_DECA = ['kg', 't', 'l', 'sacos', 'cajas', 'unidades'] as const

// Días naturales tras el fin del servicio a partir de los cuales se puede desactivar la descarga
// pública (Resolución, apartado URL). Nunca antes de que termine el servicio.
export const DIAS_ENLACE_TRAS_FIN_SERVICIO = 7

// Conservación mínima de los ficheros por cargador y transportista (1 año). La app nunca borra un DeCA.
export const DIAS_CONSERVACION_MINIMA = 365

// Contenido mínimo del art. 6 de la Orden FOM/2861/2012.
export interface DatosDeca {
  // Cargador contractual
  cargadorNombre: string
  cargadorNif: string
  cargadorDomicilio: string
  // Transportista efectivo
  transportistaNombre: string
  transportistaNif: string
  // Envío
  origen: string          // «FINCA (referencia SIGPAC)»
  destino: string         // nombre o razón social del destinatario
  destinoNif: string      // NIF o DNI del destinatario (opcional); sale entre paréntesis junto al destino
  naturaleza: string      // la «Mercancía»: cultivo y variedad (se mantiene el nombre del campo por compatibilidad)
  cantidad: string        // peso; si no es posible, otra magnitud (ver `unidad`)
  unidad: string
  // Transporte
  fechaTransporte: string      // 'YYYY-MM-DD'
  fechaFinServicio: string     // 'YYYY-MM-DD' (igual a fechaTransporte salvo servicios de varios días)
  matriculaVehiculo: string    // tractor o vehículo; en conjunto articulado, la del tractor
  matriculaRemolque: string    // remolque o semirremolque (opcional)
  autorizacionEspecial: string // solo si circula amparado por una autorización especial de circulación
  observaciones: string        // observaciones o reservas (opcional)
}

export const DECA_VACIO: DatosDeca = {
  cargadorNombre: '', cargadorNif: '', cargadorDomicilio: '',
  transportistaNombre: '', transportistaNif: '',
  origen: '', destino: '', destinoNif: '', naturaleza: '', cantidad: '', unidad: 'kg',
  fechaTransporte: '', fechaFinServicio: '',
  matriculaVehiculo: '', matriculaRemolque: '', autorizacionEspecial: '', observaciones: '',
}

// --- Normalización ---

export const normalizarNif = (v: string): string => v.toUpperCase().replace(/[\s.-]/g, '')
export const normalizarMatricula = (v: string): string => v.toUpperCase().replace(/\s+/g, '')

// --- Validación de NIF / NIE / CIF ---
// Solo se rechaza lo que tiene forma de documento español pero no cuadra con su dígito de control.
// Cualquier otro formato (transportistas extranjeros, NIF-IVA) se acepta si es alfanumérico razonable.

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE'

export const nifValido = (valor: string): boolean => {
  const v = normalizarNif(valor)
  if (!/^[A-Z0-9]{5,15}$/.test(v)) return false

  if (/^\d{8}[A-Z]$/.test(v)) return LETRAS_DNI[Number(v.slice(0, 8)) % 23] === v[8]

  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    const num = Number('XYZ'.indexOf(v[0]) + v.slice(1, 8))
    return LETRAS_DNI[num % 23] === v[8]
  }

  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    const d = v.slice(1, 8).split('').map(Number)
    const impares = d.filter((_, i) => i % 2 === 0).map(n => { const x = n * 2; return Math.floor(x / 10) + (x % 10) }).reduce((a, b) => a + b, 0)
    const pares = d.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0)
    const control = (10 - ((impares + pares) % 10)) % 10
    const comoNumero = String(control)
    const comoLetra = 'JABCDEFGHI'[control]
    // Algunas entidades llevan letra, otras número, y otras admiten cualquiera: se aceptan ambos.
    return v[8] === comoNumero || v[8] === comoLetra
  }

  return true
}

export const matriculaValida = (valor: string): boolean => /^[A-Z0-9-]{4,12}$/.test(normalizarMatricula(valor))

// --- Fechas ---

const sumarDias = (iso: string, dias: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const f = new Date(Date.UTC(y, m - 1, d + dias))
  return f.toISOString().slice(0, 10)
}

// Fecha de hoy (YYYY-MM-DD) en la hora de España peninsular, que es la que importa para el servicio.
export const hoyMadrid = (ahora: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)

export const formatFechaDeca = (iso?: string): string => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

export const formatFechaHoraMadrid = (fecha: Date): string =>
  new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(fecha).replace(',', '')

// Último día en que el enlace público sigue activo: fin del servicio + 7 días naturales.
export const fechaLimiteEnlace = (fechaFinServicio: string): string =>
  sumarDias(fechaFinServicio, DIAS_ENLACE_TRAS_FIN_SERVICIO)

export const enlaceVigente = (fechaFinServicio: string, ahora: Date = new Date()): boolean =>
  hoyMadrid(ahora) <= fechaLimiteEnlace(fechaFinServicio)

// --- Validación del formulario ---

export const validarDeca = (d: DatosDeca, ahora: Date = new Date()): string[] => {
  const errores: string[] = []
  const vacio = (v: string) => !v || !v.trim()

  if (vacio(d.cargadorNombre)) errores.push('Cargador contractual: falta el nombre o razón social.')
  if (vacio(d.cargadorNif)) errores.push('Cargador contractual: falta el NIF.')
  else if (!nifValido(d.cargadorNif)) errores.push('Cargador contractual: el NIF no es válido.')
  if (vacio(d.cargadorDomicilio)) errores.push('Cargador contractual: falta el domicilio.')

  if (vacio(d.transportistaNombre)) errores.push('Transportista efectivo: falta el nombre o razón social.')
  if (vacio(d.transportistaNif)) errores.push('Transportista efectivo: falta el NIF.')
  else if (!nifValido(d.transportistaNif)) errores.push('Transportista efectivo: el NIF no es válido.')

  if (vacio(d.origen)) errores.push('Falta el origen del envío.')
  if (vacio(d.destino)) errores.push('Falta el destino del envío.')
  if (!vacio(d.destinoNif) && !nifValido(d.destinoNif)) errores.push('Destino: el NIF/DNI no es válido.')
  if (vacio(d.naturaleza)) errores.push('Falta la mercancía.')

  const cantidad = Number(String(d.cantidad).replace(',', '.'))
  if (vacio(d.cantidad) || !isFinite(cantidad) || cantidad <= 0) errores.push('Falta el peso de la mercancía (o su magnitud, si el peso es de difícil determinación).')

  if (vacio(d.matriculaVehiculo)) errores.push('Falta la matrícula del vehículo (en un conjunto articulado, la del tractor).')
  else if (!matriculaValida(d.matriculaVehiculo)) errores.push('La matrícula del vehículo no tiene un formato válido.')
  if (!vacio(d.matriculaRemolque) && !matriculaValida(d.matriculaRemolque)) errores.push('La matrícula del remolque no tiene un formato válido.')

  if (vacio(d.fechaTransporte)) errores.push('Falta la fecha de realización del transporte.')
  else {
    // El DeCA debe crearse antes de que empiece el servicio: no se admite una fecha ya pasada.
    if (d.fechaTransporte < hoyMadrid(ahora)) errores.push('La fecha del transporte no puede ser anterior a hoy: el DeCA debe crearse antes de iniciar el servicio.')
    if (d.fechaFinServicio && d.fechaFinServicio < d.fechaTransporte) errores.push('La fecha de fin del servicio no puede ser anterior a la del transporte.')
  }
  return errores
}

// Deja los datos listos para guardar: sin espacios sobrantes, NIF y matrículas normalizados,
// fecha de fin = fecha del transporte si no se indicó otra.
export const normalizarDeca = (d: DatosDeca): DatosDeca => ({
  ...d,
  cargadorNombre: d.cargadorNombre.trim(), cargadorNif: normalizarNif(d.cargadorNif), cargadorDomicilio: d.cargadorDomicilio.trim(),
  transportistaNombre: d.transportistaNombre.trim(), transportistaNif: normalizarNif(d.transportistaNif),
  origen: d.origen.trim(), destino: d.destino.trim(), destinoNif: normalizarNif(d.destinoNif || ''), naturaleza: d.naturaleza.trim(),
  cantidad: String(d.cantidad).trim().replace(',', '.'),
  matriculaVehiculo: normalizarMatricula(d.matriculaVehiculo), matriculaRemolque: normalizarMatricula(d.matriculaRemolque),
  autorizacionEspecial: d.autorizacionEspecial.trim(), observaciones: d.observaciones.trim(),
  fechaFinServicio: d.fechaFinServicio || d.fechaTransporte,
})

// --- Enlace público (QR) ---

// Token aleatorio de 256 bits en base64url: la URL del DeCA no se puede adivinar.
export const generarToken = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/

export const esHttps = (url: string): boolean => /^https:\/\//i.test(url)

export const urlDeca = (base: string, token: string): string => `${base.replace(/\/+$/, '')}/api/deca/${token}`

export const nombreArchivoDeca = (d: Pick<DatosDeca, 'fechaTransporte' | 'matriculaVehiculo'>): string =>
  `DeCA_${d.fechaTransporte || 'sin-fecha'}_${normalizarMatricula(d.matriculaVehiculo).replace(/[^A-Z0-9]/g, '') || 'sin-matricula'}.pdf`

// Destino tal y como sale en el documento: «Nombre (NIF)».
export const textoDestino = (d: Pick<DatosDeca, 'destino' | 'destinoNif'>): string =>
  d.destinoNif && d.destinoNif.trim() ? `${d.destino} (${d.destinoNif})` : d.destino

// Destinos usados en DeCA anteriores, sin repetir (el más reciente primero): así se guardan para próximas veces.
export const destinosGuardados = (anteriores: Pick<DatosDeca, 'destino' | 'destinoNif'>[]): { destino: string; destinoNif: string }[] => {
  const vistos = new Set<string>()
  const lista: { destino: string; destinoNif: string }[] = []
  anteriores.forEach(d => {
    const nombre = (d.destino || '').trim()
    if (!nombre) return
    const clave = `${nombre.toLowerCase()}|${normalizarNif(d.destinoNif || '')}`
    if (vistos.has(clave)) return
    vistos.add(clave)
    lista.push({ destino: nombre, destinoNif: normalizarNif(d.destinoNif || '') })
  })
  return lista
}

// Texto para el campo "peso" tal y como sale en el documento.
export const textoPeso = (d: Pick<DatosDeca, 'cantidad' | 'unidad'>): string => {
  const n = Number(String(d.cantidad).replace(',', '.'))
  const num = isFinite(n) ? n.toLocaleString('es-ES', { maximumFractionDigits: 3 }) : d.cantidad
  return `${num} ${d.unidad}`
}
