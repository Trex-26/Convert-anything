/**
 * pdfEngine.js
 * PDF conversion built on pdf.js (read/render + text layer), pdf-lib (write)
 * and the document/sheet/slides engines for structured outputs.
 *
 *  - PDF -> JPG / PNG / WebP / TIFF : real page rasterisation at a chosen scale
 *  - PDF -> TXT / HTML / DOCX / XLSX : rebuilt from the embedded text layer
 *  - PDF -> PPTX                    : one slide per page (image based)
 *  - PDF -> PDF                     : repackage / strip metadata
 */
import { OUTPUT_FORMATS } from './registry.js'

let pdfjsPromise = null

const IN_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined'

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // The browser build needs a worker; the legacy build runs on the main
      // thread and is what Node-based tests use.
      const pdfjs = IN_BROWSER
        ? await import('pdfjs-dist/build/pdf.mjs')
        : await import('pdfjs-dist/legacy/build/pdf.mjs')
      if (IN_BROWSER && !pdfjs.GlobalWorkerOptions.workerSrc) {
        const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      }
      return pdfjs
    })()
  }
  return pdfjsPromise
}

async function openPdf(file) {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  try {
    return await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise
  } catch (err) {
    const msg = String(err?.message ?? err)
    if (/password/i.test(msg)) {
      throw new Error('This PDF is password-protected. Remove the password first, then convert it.', { cause: err })
    }
    throw new Error('This PDF appears to be malformed or corrupted.', { cause: err })
  }
}

// ---------------------------------------------------------------------------
// Text layer
// ---------------------------------------------------------------------------

/**
 * Group text items into visual lines, preserving reading order.
 * Each line keeps its spans so table detection can use x positions.
 */
function pageLines(textContent) {
  const items = (textContent.items ?? []).filter((it) => typeof it.str === 'string' && it.str.trim())
  const rows = []
  for (const item of items) {
    const y = item.transform?.[5] ?? 0
    const x = item.transform?.[4] ?? 0
    const size = Math.abs(item.transform?.[3] ?? 10) || 10
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(1.5, size * 0.35))
    if (!row) {
      row = { y, spans: [] }
      rows.push(row)
    }
    row.spans.push({ text: item.str, x, size })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows.map((row) => {
    row.spans.sort((a, b) => a.x - b.x)
    return {
      size: Math.max(...row.spans.map((s) => s.size)),
      spans: row.spans,
      text: row.spans.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(),
    }
  })
}

/** Decide whether a run of lines looks tabular (multiple wide gaps). */
function asTableRows(lines) {
  const split = (line) =>
    line.spans.reduce((acc, span) => {
      const prev = acc[acc.length - 1]
      if (prev && span.x - (prev.x + prev.width) > 12) acc.push({ x: span.x, width: 0, text: span.text })
      else if (prev) {
        prev.text += ` ${span.text}`
        prev.width = span.x + (span.width ?? 0) - prev.x
      } else acc.push({ x: span.x, width: span.width ?? 0, text: span.text })
      return acc
    }, [])

  const rows = lines.map((line) =>
    split(line).map((cell) => cell.text.replace(/\s+/g, ' ').trim()),
  )
  const avgCols = rows.reduce((n, r) => n + r.length, 0) / Math.max(1, rows.length)
  return { rows, isTable: avgCols >= 3 }
}

function blocksFromPages(pages) {
  const blocks = []
  pages.forEach((lines, pageIndex) => {
    if (pageIndex > 0) blocks.push({ type: 'pagebreak' })
    const sizes = lines.map((l) => l.size).sort((a, b) => a - b)
    const bodySize = sizes[Math.floor(sizes.length / 2)] || 11

    let paragraph = []
    let tableRun = []

    const flushParagraph = () => {
      if (!paragraph.length) return
      const text = paragraph.join(' ').replace(/\s+/g, ' ').trim()
      if (text) blocks.push({ type: 'paragraph', runs: [{ text }] })
      paragraph = []
    }
    const flushTable = () => {
      if (tableRun.length < 2) {
        tableRun.forEach((line) => paragraph.push(line.text))
        tableRun = []
        return
      }
      blocks.push({ type: 'table', rows: asTableRows(tableRun).rows })
      tableRun = []
    }

    for (const line of lines) {
      if (!line.text) continue
      const tabular = asTableRows([line]).isTable
      const isHeading = line.size > bodySize * 1.25 && line.text.length < 120

      if (tabular) {
        flushParagraph()
        tableRun.push(line)
        continue
      }
      flushTable()

      if (isHeading) {
        flushParagraph()
        blocks.push({
          type: 'heading',
          level: line.size > bodySize * 1.7 ? 1 : line.size > bodySize * 1.4 ? 2 : 3,
          runs: [{ text: line.text }],
        })
        continue
      }
      paragraph.push(line.text)
    }
    flushTable()
    flushParagraph()
  })
  return blocks
}

/**
 * Extract the text layer once and cache derived shapes.
 * Returns { pages: lines[][], hasText }.
 */
async function extractText(pdf) {
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(pageLines(content))
    page.cleanup?.()
  }
  const hasText = pages.some((lines) => lines.some((l) => l.text.length > 0))
  return { pages, hasText }
}

// ---------------------------------------------------------------------------
// Raster output
// ---------------------------------------------------------------------------

function makeCanvas(width, height) {
  if (!IN_BROWSER) {
    throw new Error('Rendering PDF pages to images requires a browser.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function canvasToBytes(canvas, format, quality) {
  if (format === 'tiff') {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const mod = await import('utif')
    const UTIF = mod.default ?? mod
    return UTIF.encodeImage(data, width, height)
  }
  const mime = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`Cannot encode ${mime}.`))), mime, quality),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

/** Render every page (or a subset) to images. */
async function renderPages(pdf, { format = 'png', scale = 2, quality = 0.92 } = {}) {
  const out = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    // White background: JPEG has no alpha and PDFs are normally opaque.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const bytes = await canvasToBytes(canvas, format, quality)
    out.push({ bytes, width: canvas.width, height: canvas.height, page: i })
    page.cleanup?.()
  }
  return out
}

// ---------------------------------------------------------------------------
// Public conversion entry
// ---------------------------------------------------------------------------

/**
 * @param {{file: File|Blob, name: string}} input
 * @param {string} format
 * @param {{scale?: number, quality?: number, pageSize?: string}} [options]
 * @returns {Promise<{blob: Blob, warnings: string[], multiFile?: Array<{name: string, blob: Blob}>}>}
 */
export async function convertPdf(input, format, options = {}) {
  const warnings = []
  const pdf = await openPdf(input.file)

  const imageFormats = ['jpg', 'png', 'webp', 'tiff']
  if (imageFormats.includes(format)) {
    const pages = await renderPages(pdf, { format, scale: options.scale ?? 2, quality: options.quality ?? 0.92 })
    if (pages.length === 1) {
      return {
        blob: new Blob([pages[0].bytes], { type: OUTPUT_FORMATS[format].mime }),
        warnings,
      }
    }
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    const ext = OUTPUT_FORMATS[format].ext
    const stem = (input.name ?? 'document').replace(/\.[^.]+$/, '')
    pages.forEach((p) => zip.file(`${stem}-page-${p.page}${ext}`, p.bytes))
    const zipped = await zip.generateAsync({ type: 'blob' })
    warnings.push(`This PDF has ${pages.length} pages, so you get a ZIP with one ${format.toUpperCase()} per page.`)
    return { blob: zipped, warnings, zip: true }
  }

  const { pages, hasText } = await extractText(pdf)
  if (!hasText) {
    throw new Error(
      'This PDF has no text layer (it looks scanned), so text output would be empty. Choose an image format instead, or run OCR first.',
    )
  }
  const blocks = blocksFromPages(pages)

  if (format === 'txt') {
    const text = blocks
      .map((b) => {
        if (b.type === 'heading' || b.type === 'paragraph') return b.runs.map((r) => r.text).join('')
        if (b.type === 'table') return b.rows.map((r) => r.join('\t')).join('\n')
        return ''
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return { blob: new Blob([text], { type: OUTPUT_FORMATS.txt.mime }), warnings }
  }

  if (format === 'html') {
    const body = blocks
      .map((b) => {
        if (b.type === 'heading') return `<h${b.level}>${escapeHtml(b.runs.map((r) => r.text).join(''))}</h${b.level}>`
        if (b.type === 'paragraph') return `<p>${escapeHtml(b.runs.map((r) => r.text).join(''))}</p>`
        if (b.type === 'table') {
          const rows = b.rows
            .map(
              (row, i) =>
                `<tr>${row.map((c) => `<${i === 0 ? 'th' : 'td'}>${escapeHtml(c)}</${i === 0 ? 'th' : 'td'}>`).join('')}</tr>`,
            )
            .join('')
          return `<table border="1" cellspacing="0" cellpadding="4">${rows}</table>`
        }
        return ''
      })
      .join('\n')
    const html = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(input.name ?? 'PDF')}</title></head>\n<body>\n${body}\n</body></html>`
    return { blob: new Blob([html], { type: OUTPUT_FORMATS.html.mime }), warnings }
  }

  if (format === 'docx') {
    const docx = await import('docx')
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = docx
    const children = []
    for (const b of blocks) {
      if (b.type === 'heading') {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: b.runs.map((r) => r.text).join(''), bold: true })],
            heading: HeadingLevel[`HEADING_${Math.min(3, b.level)}`],
          }),
        )
      } else if (b.type === 'paragraph') {
        children.push(new Paragraph({ children: [new TextRun(b.runs.map((r) => r.text).join(''))] }))
      } else if (b.type === 'table') {
        children.push(
          new Table({
            rows: b.rows.map(
              (row) =>
                new TableRow({
                  children: row.map((cell) => new TableCell({ children: [new Paragraph(String(cell))] })),
                }),
            ),
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
        )
        children.push(new Paragraph({}))
      }
    }
    if (!children.length) children.push(new Paragraph(''))
    const doc = new Document({ sections: [{ children }] })
    const buffer = await Packer.toBuffer(doc)
    warnings.push('Text, headings and tables are rebuilt from the PDF text layer; exact fonts and positions are not preserved.')
    return { blob: new Blob([buffer], { type: OUTPUT_FORMATS.docx.mime }), warnings }
  }

  if (format === 'xlsx') {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    pages.forEach((lines, i) => {
      const rows = []
      for (const line of lines) {
        if (!line.text) continue
        const { rows: cells } = asTableRows([line])
        rows.push(cells[0] ?? [line.text])
      }
      const ws = XLSX.utils.aoa_to_sheet(rows)
      XLSX.utils.book_append_sheet(wb, ws, `Page ${i + 1}`.slice(0, 31))
    })
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    warnings.push('Cells are inferred from the PDF text layer; merged cells and styling are not reproduced.')
    return { blob: new Blob([out], { type: OUTPUT_FORMATS.xlsx.mime }), warnings }
  }

  if (format === 'pptx') {
    const mod = await import('pptxgenjs')
    const PptxGenJS = mod.default ?? mod
    const pptx = new PptxGenJS()
    const rendered = await renderPages(pdf, { format: 'jpg', scale: 2, quality: 0.9 })
    const first = rendered[0]
    const ratio = first ? first.height / first.width : 0.75
    pptx.defineLayout({
      name: 'PAGE',
      width: 10,
      height: Math.max(3, Math.min(20, 10 * ratio)),
    })
    pptx.layout = 'PAGE'
    rendered.forEach((p, i) => {
      const slide = pptx.addSlide()
      slide.addImage({
        data: `data:image/jpeg;base64,${toBase64(p.bytes)}`,
        x: 0,
        y: 0,
        w: '100%',
        h: '100%',
      })
      slide.addNotes?.(`Page ${i + 1}`)
    })
    const buffer = await pptx.write({ outputType: 'arraybuffer' })
    warnings.push('Each page becomes a slide image, so appearance is preserved but text is not editable.')
    return { blob: new Blob([buffer], { type: OUTPUT_FORMATS.pptx.mime }), warnings }
  }

  throw new Error(`No PDF engine builds .${format}.`)
}

/** PDF -> PDF repackage (metadata stripped, object streams rebuilt). */
export async function repackagePdf(input) {
  const { compressPdf } = await import('./pdfOps.js')
  return { blob: await compressPdf(input.file), warnings: [] }
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function toBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
