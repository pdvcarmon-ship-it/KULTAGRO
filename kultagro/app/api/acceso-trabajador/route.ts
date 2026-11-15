// app/api/acceso-trabajador/route.ts
//
// Único punto donde se usa la service role key para gestionar el acceso de
// trabajadores. Recibe (emailEmpresa, dni, password, codigo) desde LoginScreen.tsx y:
//
//   - Si es la PRIMERA vez (personal.estado_acceso = 'pendiente'):
//     exige el CÓDIGO DE ACTIVACIÓN que generó la empresa (un solo uso, caduca), y entonces
//     crea el usuario real de Supabase Auth con un email "sintético" interno y la contraseña
//     que acaba de elegir.
//
//   - Si YA tenía acceso ('activo'): no toca nada, solo devuelve el mismo
//     email sintético — la contraseña la valida el propio Supabase Auth
//     cuando el cliente llama a signInWithPassword con ese email.
//
// Seguridad (esta ruta es pública en internet):
//   - Límite de intentos por IP y por empresa+DNI (sql/12_seguridad_acceso.sql).
//   - No revela si existe la empresa, el DNI o el acceso: ante CUALQUIER fallo de verificación
//     devuelve un email sintético inexistente, y el signInWithPassword del cliente falla con el
//     mensaje habitual de credenciales incorrectas. Así no se puede averiguar qué DNI existen.
//   - El primer acceso ya no se puede secuestrar conociendo solo el email de la empresa y el DNI.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '../../lib/supabaseAdmin'
import { hashCodigo, normalizarCodigo } from '../../lib/codigoActivacion'
import { limitar, ipDe } from '../../lib/rateLimit'

interface BodyEsperado {
  emailEmpresa?: string
  dni?: string
  password?: string
  codigo?: string
}

const normalizarDni = (v: string) => v.trim().toUpperCase()

// El email sintético incluye la cuenta_id, no solo el DNI: así, si la misma
// persona (mismo DNI) trabaja algún día para dos empresas distintas con
// KAMPO, cada una genera un login interno distinto sin colisión.
const emailSinteticoPara = (dni: string, cuentaId: string) =>
  `${normalizarDni(dni).toLowerCase()}@${cuentaId}.kampo.internal`

// Los emails reales terminan en «@<uuid>.kampo.internal»; este nunca coincide con uno real.
const emailFalso = (dni: string) => `${normalizarDni(dni).toLowerCase()}@no-existe.kampo.internal`

const hashesIguales = (a: string, b: string): boolean => {
  const ba = Buffer.from(a, 'hex'); const bb = Buffer.from(b, 'hex')
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb)
}

const MAX_POR_IP = 20          // intentos por IP cada 10 minutos
const MAX_POR_PERSONA = 8      // intentos por empresa+DNI cada 15 minutos

export async function POST(req: NextRequest) {
  let body: BodyEsperado
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo de la petición inválido.' }, { status: 400 })
  }

  const emailEmpresa = (body.emailEmpresa || '').trim()
  const dni = (body.dni || '').trim()
  const password = body.password || ''
  const codigo = normalizarCodigo(body.codigo || '')

  if (!emailEmpresa || !dni || !password) {
    return NextResponse.json({ error: 'Faltan datos: email de empresa, DNI y contraseña son obligatorios.' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 })
  }

  // 0) Límite de intentos.
  const permitidoIp = await limitar(`acceso:ip:${ipDe(req)}`, MAX_POR_IP, 600)
  const permitidoPersona = await limitar(`acceso:persona:${emailEmpresa.toLowerCase()}|${normalizarDni(dni)}`, MAX_POR_PERSONA, 900)
  if (!permitidoIp || !permitidoPersona) {
    return NextResponse.json({ error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' }, { status: 429 })
  }

  // 1) Traducir el email de empresa a cuenta_id.
  const { data: cuentaId, error: errCuenta } = await supabaseAdmin.rpc('cuenta_id_por_email_empresa', { p_email: emailEmpresa })
  if (errCuenta) {
    console.error('[acceso-trabajador] Error buscando cuenta:', errCuenta)
    return NextResponse.json({ error: 'No se pudo comprobar el acceso. Inténtalo de nuevo.' }, { status: 500 })
  }
  if (!cuentaId) return NextResponse.json({ syntheticEmail: emailFalso(dni) })

  // 2) Buscar el personal con ese DNI dentro de esa cuenta (case-insensitive).
  const { data: personalDeLaCuenta, error: errPersonal } = await supabaseAdmin
    .from('personal')
    .select('id, dni, estado_acceso, auth_user_id, codigo_activacion_hash, codigo_activacion_caduca')
    .eq('cuenta_id', cuentaId)

  if (errPersonal) {
    console.error('[acceso-trabajador] Error buscando personal:', errPersonal)
    return NextResponse.json({ error: 'No se pudo comprobar el acceso. Inténtalo de nuevo.' }, { status: 500 })
  }

  const persona = (personalDeLaCuenta || []).find(p => normalizarDni(p.dni || '') === normalizarDni(dni))
  if (!persona || persona.estado_acceso === 'sin_acceso' || !persona.estado_acceso) {
    return NextResponse.json({ syntheticEmail: emailFalso(dni) })
  }

  const syntheticEmail = emailSinteticoPara(dni, cuentaId)

  // 3) Primera vez: hace falta el código de activación vigente.
  if (persona.estado_acceso === 'pendiente' || !persona.auth_user_id) {
    const vigente = !!persona.codigo_activacion_hash && !!persona.codigo_activacion_caduca && new Date(persona.codigo_activacion_caduca).getTime() > Date.now()
    const correcto = vigente && codigo.length > 0 && hashesIguales(await hashCodigo(codigo), persona.codigo_activacion_hash as string)
    if (!correcto) return NextResponse.json({ syntheticEmail: emailFalso(dni) })

    const { data: nuevoUsuario, error: errCrear } = await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      password,
      email_confirm: true,
      user_metadata: { tipo_cuenta: 'trabajador' }, // el trigger de altas de empresa ignora esto a propósito
    })
    if (errCrear || !nuevoUsuario?.user) {
      console.error('[acceso-trabajador] Error creando usuario:', errCrear)
      return NextResponse.json({ error: 'No se pudo activar el acceso. Inténtalo de nuevo o contacta con la empresa.' }, { status: 500 })
    }

    // El código es de un solo uso: se borra al activarse.
    const { error: errUpdate } = await supabaseAdmin
      .from('personal')
      .update({ auth_user_id: nuevoUsuario.user.id, estado_acceso: 'activo', codigo_activacion_hash: null, codigo_activacion_caduca: null })
      .eq('id', persona.id)

    if (errUpdate) {
      console.error('[acceso-trabajador] Usuario creado pero no se pudo vincular a personal:', errUpdate)
      return NextResponse.json({ error: 'Acceso creado pero hubo un problema al vincularlo. Contacta con la empresa.' }, { status: 500 })
    }

    return NextResponse.json({ syntheticEmail })
  }

  // 4) Ya tenía acceso activo: solo devolvemos el email sintético. La
  //    contraseña la valida Supabase Auth en el signInWithPassword del cliente.
  return NextResponse.json({ syntheticEmail })
}
