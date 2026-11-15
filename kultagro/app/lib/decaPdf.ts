// lib/decaPdf.ts
//
// Genera el PDF del DeCA cumpliendo la Resolución de 5 de junio de 2026:
//   - PDF nativo digital (texto vectorial, no una imagen escaneada), muy por debajo de 5 MB.
//   - Fecha y hora de creación y de modificación como METADATOS del PDF (CreationDate / ModDate).
//   - Código QR dentro del documento con la URL única de descarga.
// La URL y la fecha de creación las decide quien llama (la fecha es la del registro en base de datos,
// para que el PDF y el sistema coincidan).

import { PDFDocument } from 'pdf-lib'
import { type DatosDeca, formatFechaDeca, formatFechaHoraMadrid, textoDestino, textoPeso } from './deca'

export interface OpcionesPdfDeca {
  datos: DatosDeca
  url: string          // URL https única, tal y como irá en el QR
  creadoEn: Date       // fecha y hora de creación registradas por el sistema
  modificadoEn?: Date  // por defecto, igual que la de creación
  codigo: string       // identificador corto del documento (se imprime en el pie)
}

export const qrComoDataUrl = async (url: string, ancho = 360): Promise<string> => {
  const QRCode = (await import('qrcode')).default
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: ancho })
}

const GRIS: [number, number, number] = [226, 232, 220]
const BORDE: [number, number, number] = [150, 150, 150]

export const generarDecaPdf = async (op: OpcionesPdfDeca): Promise<Uint8Array> => {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const d = op.datos

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margen = 40
  const ancho = 595 - margen * 2

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('DOCUMENTO DE CONTROL ADMINISTRATIVO (DeCA)', margen, 44)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(70, 70, 70)
  doc.text('Transporte de mercancías por carretera · Orden FOM/2861/2012, art. 6', margen, 59)
  doc.setTextColor(20, 20, 20)

  const estilo = { font: 'helvetica', fontSize: 9.5, cellPadding: 5, lineColor: BORDE, lineWidth: 0.5, textColor: [20, 20, 20] as [number, number, number], valign: 'middle' as const }
  const etiqueta = { fillColor: GRIS, fontStyle: 'bold' as const }
  const cabecera = (texto: string) => ({ content: texto, colSpan: 2, styles: { fillColor: [31, 74, 40] as [number, number, number], textColor: [255, 255, 255] as [number, number, number], fontStyle: 'bold' as const, fontSize: 10 } })
  const fila = (k: string, v: string) => [{ content: k, styles: etiqueta }, { content: v || '—' }]

  const cuerpo: any[] = [
    [cabecera('1. CARGADOR CONTRACTUAL')],
    fila('Nombre o razón social', d.cargadorNombre),
    fila('NIF', d.cargadorNif),
    fila('Domicilio', d.cargadorDomicilio),
    [cabecera('2. TRANSPORTISTA EFECTIVO')],
    fila('Nombre o razón social', d.transportistaNombre),
    fila('NIF', d.transportistaNif),
    [cabecera('3. ENVÍO')],
    fila('Origen', d.origen),
    fila('Destino', textoDestino(d)),
    fila('Mercancía', d.naturaleza),
    fila('Peso', textoPeso(d)),
    [cabecera('4. TRANSPORTE')],
    fila('Fecha de realización', formatFechaDeca(d.fechaTransporte) + (d.fechaFinServicio && d.fechaFinServicio !== d.fechaTransporte ? ` (hasta el ${formatFechaDeca(d.fechaFinServicio)})` : '')),
    fila(d.matriculaRemolque ? 'Matrícula del tractor' : 'Matrícula del vehículo', d.matriculaVehiculo),
  ]
  if (d.matriculaRemolque) cuerpo.push(fila('Matrícula del remolque / semirremolque', d.matriculaRemolque))
  // Solo se imprime si el vehículo circula amparado por una autorización especial de circulación.
  if (d.autorizacionEspecial) cuerpo.push(fila('Autorización especial de circulación', d.autorizacionEspecial))
  if (d.observaciones) {
    cuerpo.push([cabecera('5. OBSERVACIONES O RESERVAS')])
    cuerpo.push([{ content: d.observaciones, colSpan: 2 }])
  }

  autoTable(doc, {
    startY: 74,
    margin: { left: margen, right: margen },
    theme: 'grid',
    styles: estilo,
    columnStyles: { 0: { cellWidth: 170 } },
    body: cuerpo,
  })

  // --- Bloque QR + datos del documento ---
  let y = ((doc as any).lastAutoTable?.finalY ?? 400) + 22
  const tamQr = 105
  if (y + tamQr + 60 > 842 - margen) { doc.addPage(); y = margen }

  const qr = await qrComoDataUrl(op.url)
  doc.setDrawColor(150, 150, 150)
  doc.setLineWidth(0.5)
  doc.rect(margen, y, ancho, tamQr + 16)
  doc.addImage(qr, 'PNG', margen + 8, y + 8, tamQr, tamQr, undefined, 'FAST')

  const xTexto = margen + tamQr + 24
  const anchoTexto = ancho - tamQr - 32
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text('Documento digital con enlace de descarga', xTexto, y + 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const lineas = doc.splitTextToSize(
    'Este documento único, accesible con el código QR o con el enlace, hace las veces de los dos ejemplares: el del cargador contractual y el del transportista efectivo, que lo lleva a bordo del vehículo.',
    anchoTexto
  )
  doc.text(lineas, xTexto, y + 34)
  let yy = y + 34 + lineas.length * 10 + 6

  doc.setFont('helvetica', 'bold')
  doc.text('Enlace:', xTexto, yy)
  doc.setFont('courier', 'normal')
  doc.setFontSize(7.5)
  const lineasUrl = doc.splitTextToSize(op.url, anchoTexto)
  doc.text(lineasUrl, xTexto, yy + 10)
  yy += 10 + lineasUrl.length * 9 + 6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(70, 70, 70)
  doc.text(`Creado: ${formatFechaHoraMadrid(op.creadoEn)} (hora de España)  ·  Código: ${op.codigo}`, xTexto, Math.min(yy, y + tamQr + 8))

  doc.setFontSize(7.5)
  doc.text('Generado con KULTAGRO', margen, 842 - 24)

  // --- Metadatos (CreationDate / ModDate) ---
  // jsPDF no escribe ModDate, así que se fijan aquí con pdf-lib, que también deja el PDF como lo imprime jsPDF.
  const bruto = doc.output('arraybuffer')
  const pdf = await PDFDocument.load(bruto, { updateMetadata: false })
  pdf.setTitle(`DeCA ${formatFechaDeca(d.fechaTransporte)} · ${d.matriculaVehiculo}`)
  pdf.setSubject('Documento de Control Administrativo del transporte de mercancías por carretera')
  pdf.setAuthor(d.cargadorNombre)
  pdf.setKeywords(['DeCA', 'transporte', op.codigo])
  pdf.setCreator('KULTAGRO')
  pdf.setProducer('KULTAGRO')
  pdf.setCreationDate(op.creadoEn)
  pdf.setModificationDate(op.modificadoEn ?? op.creadoEn)
  return pdf.save()
}
