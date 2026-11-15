import { describe, it, expect } from 'vitest'
import {
  DECA_VACIO, nifValido, matriculaValida, validarDeca, normalizarDeca, generarToken, TOKEN_REGEX,
  textoDestino, destinosGuardados, urlDeca, esHttps, fechaLimiteEnlace, enlaceVigente, hoyMadrid, nombreArchivoDeca, textoPeso,
  type DatosDeca,
} from './deca'

const AHORA = new Date('2026-11-15T10:00:00Z')

const valido: DatosDeca = {
  ...DECA_VACIO,
  cargadorNombre: 'Finca El Olivar S.L.', cargadorNif: 'A58818501', cargadorDomicilio: 'Camino Real 1, 41001 Sevilla',
  transportistaNombre: 'Juan Pérez', transportistaNif: '12345678Z',
  origen: 'Finca El Olivar, Osuna', destino: 'Cooperativa San José, Écija', naturaleza: 'Aceituna de almazara',
  cantidad: '8500', unidad: 'kg',
  fechaTransporte: '2026-11-16', fechaFinServicio: '2026-11-16',
  matriculaVehiculo: 'E1234BBB', matriculaRemolque: 'R5678BCD',
}

describe('nifValido', () => {
  it('acepta DNI, NIE y CIF con dígito de control correcto', () => {
    expect(nifValido('12345678Z')).toBe(true)
    expect(nifValido('12345678-z')).toBe(true)
    expect(nifValido('X1234567L')).toBe(true)
    expect(nifValido('A58818501')).toBe(true)
  })
  it('rechaza documentos españoles con control erróneo', () => {
    expect(nifValido('12345678A')).toBe(false)
    expect(nifValido('X1234567A')).toBe(false)
    expect(nifValido('A58818502')).toBe(false)
  })
  it('acepta otros formatos alfanuméricos (transportistas extranjeros) y rechaza basura', () => {
    expect(nifValido('PT123456789')).toBe(true)
    expect(nifValido('ab')).toBe(false)
    expect(nifValido('12 34 !')).toBe(false)
  })
})

describe('matriculaValida', () => {
  it('acepta matrículas habituales con o sin espacios y guiones', () => {
    expect(matriculaValida('1234 BBB')).toBe(true)
    expect(matriculaValida('E-1234-BBB')).toBe(true)
    expect(matriculaValida('SE-1234-AB')).toBe(true)
  })
  it('rechaza vacíos y caracteres raros', () => {
    expect(matriculaValida('')).toBe(false)
    expect(matriculaValida('12')).toBe(false)
    expect(matriculaValida('12/34*BBB')).toBe(false)
  })
})

describe('validarDeca', () => {
  it('un DeCA completo no da errores', () => {
    expect(validarDeca(valido, AHORA)).toEqual([])
  })
  it('el remolque, la autorización especial y las observaciones son opcionales', () => {
    expect(validarDeca({ ...valido, matriculaRemolque: '', autorizacionEspecial: '', observaciones: '' }, AHORA)).toEqual([])
  })
  it('pide todos los datos obligatorios', () => {
    const errores = validarDeca({ ...DECA_VACIO, unidad: 'kg' }, AHORA)
    expect(errores.length).toBeGreaterThanOrEqual(9)
  })
  it('no admite un peso cero o negativo', () => {
    expect(validarDeca({ ...valido, cantidad: '0' }, AHORA).length).toBe(1)
    expect(validarDeca({ ...valido, cantidad: '-3' }, AHORA).length).toBe(1)
  })
  it('acepta coma decimal en el peso', () => {
    expect(validarDeca({ ...valido, cantidad: '8500,5' }, AHORA)).toEqual([])
  })
  it('no admite crear un DeCA con fecha de transporte pasada, pero sí hoy', () => {
    expect(validarDeca({ ...valido, fechaTransporte: '2026-11-14' }, AHORA).length).toBe(1)
    expect(validarDeca({ ...valido, fechaTransporte: '2026-11-15', fechaFinServicio: '2026-11-15' }, AHORA)).toEqual([])
  })
  it('el fin del servicio no puede ser anterior al transporte', () => {
    expect(validarDeca({ ...valido, fechaFinServicio: '2026-11-15' }, AHORA).length).toBe(1)
  })
})

describe('normalizarDeca', () => {
  it('normaliza NIF y matrículas y completa el fin de servicio', () => {
    const n = normalizarDeca({ ...valido, cargadorNif: ' a-58818501 ', matriculaVehiculo: 'e 1234 bbb', fechaFinServicio: '', cantidad: '8500,5' })
    expect(n.cargadorNif).toBe('A58818501')
    expect(n.matriculaVehiculo).toBe('E1234BBB')
    expect(n.fechaFinServicio).toBe(valido.fechaTransporte)
    expect(n.cantidad).toBe('8500.5')
  })
})

describe('token y URL', () => {
  it('genera tokens distintos de 43 caracteres base64url', () => {
    const a = generarToken(); const b = generarToken()
    expect(a).toMatch(TOKEN_REGEX)
    expect(a).not.toBe(b)
  })
  it('construye la URL sin barras duplicadas', () => {
    expect(urlDeca('https://kultagro.app/', 'abc')).toBe('https://kultagro.app/api/deca/abc')
  })
  it('solo https', () => {
    expect(esHttps('https://x.es/a')).toBe(true)
    expect(esHttps('http://x.es/a')).toBe(false)
  })
})

describe('vigencia del enlace', () => {
  it('límite = fin del servicio + 7 días naturales', () => {
    expect(fechaLimiteEnlace('2026-11-16')).toBe('2026-11-23')
    expect(fechaLimiteEnlace('2026-12-28')).toBe('2027-01-04')
  })
  it('está activo durante el servicio y hasta el día límite incluido', () => {
    expect(enlaceVigente('2026-11-16', new Date('2026-11-15T10:00:00Z'))).toBe(true)
    expect(enlaceVigente('2026-11-16', new Date('2026-11-23T10:00:00Z'))).toBe(true)
  })
  it('se desactiva pasados los 7 días', () => {
    expect(enlaceVigente('2026-11-16', new Date('2026-11-24T10:00:00Z'))).toBe(false)
  })
  it('usa el día de España, no el UTC', () => {
    // 23:30 UTC del 15 ya es 16 en Madrid (UTC+1 en noviembre)
    expect(hoyMadrid(new Date('2026-11-15T23:30:00Z'))).toBe('2026-11-16')
  })
})

describe('destino con NIF', () => {
  it('sale como «Nombre (NIF)» y sin paréntesis si no hay NIF', () => {
    expect(textoDestino({ destino: 'Cooperativa San José', destinoNif: 'A58818501' })).toBe('Cooperativa San José (A58818501)')
    expect(textoDestino({ destino: 'Cooperativa San José', destinoNif: '' })).toBe('Cooperativa San José')
  })
  it('el NIF del destino es opcional pero, si se indica, debe ser válido', () => {
    expect(validarDeca({ ...valido, destinoNif: '' }, AHORA)).toEqual([])
    expect(validarDeca({ ...valido, destinoNif: 'A58818501' }, AHORA)).toEqual([])
    expect(validarDeca({ ...valido, destinoNif: '12345678A' }, AHORA).length).toBe(1)
  })
  it('guarda los destinos usados sin repetirlos, el más reciente primero', () => {
    const lista = destinosGuardados([
      { destino: 'Coop A', destinoNif: 'a58818501' },
      { destino: 'Almazara B', destinoNif: '' },
      { destino: 'coop a', destinoNif: 'A58818501' },
      { destino: '', destinoNif: 'X' },
    ])
    expect(lista).toEqual([{ destino: 'Coop A', destinoNif: 'A58818501' }, { destino: 'Almazara B', destinoNif: '' }])
  })
})

describe('utilidades de texto', () => {
  it('nombre de archivo', () => {
    expect(nombreArchivoDeca(valido)).toBe('DeCA_2026-11-16_E1234BBB.pdf')
  })
  it('texto del peso', () => {
    expect(textoPeso({ cantidad: '8500', unidad: 'kg' })).toContain('kg')
  })
})
