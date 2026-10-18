// docs.js
// Local document + spreadsheet conversion engine.
// - DOCX → HTML / plain text  (mammoth, DOM-based parse of the OOXML)
// - XLSX / ODS / CSV → CSV / HTML text / XLSX workbook  (SheetJS)
// - Plain text → PDF (pdf-lib, standard font, automatic pagination)
//
// All libraries are lazy-imported so the main bundle stays small.
// Text→PDF uses a standard Type 1 font (WinAnsi) — non-Latin-1 characters
// are transliterated to '?' and this limitation is surfaced in the UI.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PAGE_POINTS = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

// mammoth's browser build accepts {arrayBuffer}; its Node build accepts
// {buffer}. Passing both keeps one code path working in every environment.
async function mammothOptions(file) {
  const arrayBuffer = await file.arrayBuffer()
  return { arrayBuffer, buffer: new Uint8Array(arrayBuffer) }
}

export async function docxToHtml(file) {
  const { default: mammoth } = await import('mammoth')
  const result = await mammoth.convertToHtml(await mammothOptions(file))
  // mammoth reports warnings for unsupported styling — attach them for the UI.
  return { html: result.value, warnings: result.messages?.length ?? 0 }
}

export async function docxToText(file) {
  const { default: mammoth } = await import('mammoth')
  const result = await mammoth.extractRawText(await mammothOptions(file))
  return result.value
}

// ---------------------------------------------------------------------------
// Spreadsheets (XLSX / ODS / CSV)
// ---------------------------------------------------------------------------

async function workbookFrom(file) {
  const XLSX = await import('xlsx')
  const data = new Uint8Array(await file.arrayBuffer())
  const wb = XLSX.read(data, { type: 'array' })
  if (!wb.SheetNames.length) throw new Error('This workbook contains no sheets.')
  return { XLSX, wb }
}

function firstSheet({ wb }) {
  return wb.Sheets[wb.SheetNames[0]]
}

export async function sheetToCsv(file) {
  const { XLSX, wb } = await workbookFrom(file)
  return XLSX.utils.sheet_to_csv(firstSheet({ XLSX, wb }))
}

export async function sheetToHtml(file) {
  const { XLSX, wb } = await workbookFrom(file)
  const rows = XLSX.utils.sheet_to_html(firstSheet({ XLSX, wb }))
  return rows
}

export async function sheetToText(file) {
  const csv = await sheetToCsv(file)
  return csv // tabular plain text; CSV is the text representation
}

/** Convert any readable workbook (CSV/XLSX/ODS) into a real .xlsx file. */
export async function sheetToXlsx(file) {
  const { XLSX, wb } = await workbookFrom(file)
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ---------------------------------------------------------------------------
// Text → PDF
// ---------------------------------------------------------------------------

function sanitizeLine(line, font) {
  // WinAnsi standard fonts: transliterate anything outside latin-1 + a few
  // common typographic characters that pdf-lib maps itself.
  let out = ''
  for (const ch of line) {
    try {
      font.encodeText(ch) // throws when the glyph is unavailable
      out += ch
    } catch {
      out += '?'
    }
  }
  return out
}

export async function textToPdf(file, settings = {}, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const text = new TextDecoder('utf-8', { fatal: false }).decode(await file.arrayBuffer())
  if (!text.trim()) throw new Error('This text file is empty.')

  const doc = await PDFDocument.create()
  doc.setTitle('Convert-anything text export')
  doc.setProducer('Convert-anything')
  doc.setCreator('Convert-anything')
  const font = await doc.embedFont(StandardFonts.Courier)

  const [pw, ph] = PAGE_POINTS[settings.pageSize] ?? PAGE_POINTS.Letter
  const margin = 36
  const size = 10.5
  const lineH = size * 1.45
  const maxW = pw - margin * 2
  const maxLinesPerPage = Math.floor((ph - margin * 2) / lineH)

  // Wrap by measured width; honor \n. Convert tabs to 4 spaces.
  // IMPORTANT: sanitize first — measuring with font.widthOfTextAtSize throws
  // for glyphs the standard font cannot encode, so sanitization must precede
  // every width call.
  const rawLines = text.replace(/\t/g, '    ').split(/\r?\n/)
  const wrapped = []
  for (const rawLine of rawLines) {
    const line = sanitizeLine(rawLine, font)
    if (line === '') { wrapped.push(''); continue }
    let cur = ''
    for (const word of line.split(/(\s+)/)) {
      const candidate = cur + word
      if (font.widthOfTextAtSize(candidate, size) > maxW && cur.trim() !== '') {
        wrapped.push(cur.replace(/\s+$/, ''))
        cur = word.trimStart()
      } else {
        cur = candidate
      }
      while (font.widthOfTextAtSize(cur, size) > maxW) {
        // single token longer than a line — hard-split
        let cut = ''
        let i = 0
        while (i < cur.length && font.widthOfTextAtSize(cut + cur[i], size) <= maxW) {
          cut += cur[i]
          i++
        }
        wrapped.push(cut)
        cur = cur.slice(i)
      }
    }
    wrapped.push(cur)
  }

  let page = null
  let y = 0
  let linesOnPage = 0
  const newPage = () => {
    page = doc.addPage([pw, ph])
    y = ph - margin
    linesOnPage = 0
  }

  for (const line of wrapped) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (!page || linesOnPage >= maxLinesPerPage) newPage()
    if (line.trim()) {
      page.drawText(line, { x: margin, y, size, font, color: rgb(0.06, 0.09, 0.16) })
    }
    y -= lineH
    linesOnPage++
  }

  return new Blob([await finish(doc)], { type: 'application/pdf' })
}

function finish(doc) {
  return doc.save({ useObjectStreams: true })
}

// ---------------------------------------------------------------------------
// Dispatcher — one entry point used by the conversion registry
// ---------------------------------------------------------------------------

/**
 * Convert a document/spreadsheet file to the requested output format id
 * (see converters.js OUTPUT_FORMATS). Returns Blob (binary) or string for
 * text outputs, which callers wrap in a Blob with correct mime + ext.
 */
export async function convertDocument(input, outputFormat, settings, signal) {
  const { family, file } = input
  switch (outputFormat) {
    case 'html':
      if (family === 'doc') {
        const { html } = await docxToHtml(file)
        return { kind: 'text', text: html }
      }
      return { kind: 'text', text: await sheetToHtml(file) }
    case 'txt':
      if (family === 'doc') return { kind: 'text', text: await docxToText(file) }
      if (family === 'sheet') return { kind: 'text', text: await sheetToText(file) }
      return { kind: 'text', text: new TextDecoder('utf-8', { fatal: false }).decode(await file.arrayBuffer()) }
    case 'csv':
      if (family !== 'sheet') {
        throw new Error('CSV output is only available for spreadsheet files (.xlsx, .ods, .csv).')
      }
      return { kind: 'text', text: await sheetToCsv(file) }
    case 'xlsx':
      if (family !== 'sheet') {
        throw new Error('XLSX output is only available for spreadsheet files (.xlsx, .ods, .csv).')
      }
      return { kind: 'binary', blob: await sheetToXlsx(file) }
    case 'pdf':
      if (family === 'text') return { kind: 'binary', blob: await textToPdf(file, settings, signal) }
      break
    default:
      break
  }
  throw new Error(`No local conversion path builds ${outputFormat.toUpperCase()} from this file type.`)
}
