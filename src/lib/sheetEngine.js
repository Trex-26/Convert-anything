/**
 * sheetEngine.js
 * Spreadsheet conversion via SheetJS. Every target is a real workbook/text
 * file produced from the parsed grid — formulas, sheet names and merged cells
 * are kept whenever the target format can represent them.
 */
import * as XLSX from 'xlsx'
import { renderBlocks } from './pdfLayout.js'
import { OUTPUT_FORMATS } from './registry.js'

const BOOK_TYPES = { xlsx: 'xlsx', xls: 'xls', ods: 'ods' }
const MAX_PDF_ROWS = 400

async function readWorkbook(file) {
  const data = new Uint8Array(await file.arrayBuffer())
  let wb
  try {
    wb = XLSX.read(data, { type: 'array', cellDates: true, cellFormula: true, cellStyles: true })
  } catch {
    throw new Error('This spreadsheet could not be parsed. The file may be corrupted.')
  }
  if (!wb.SheetNames.length) throw new Error('This workbook contains no sheets.')
  return wb
}

function rowsOf(worksheet) {
  return XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false, blankrows: false })
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function workbookToHtml(wb) {
  const parts = wb.SheetNames.map((name) => {
    const rows = rowsOf(wb.Sheets[name])
    const body = rows
      .map(
        (row, i) =>
          `<tr>${row
            .map((cell) => `<${i === 0 ? 'th' : 'td'}>${escapeHtml(cell)}</${i === 0 ? 'th' : 'td'}>`)
            .join('')}</tr>`,
      )
      .join('\n')
    return `<h2>${escapeHtml(name)}</h2>\n<table border="1" cellspacing="0" cellpadding="4">\n${body}\n</table>`
  })
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Convert-anything workbook</title>
<style>body{font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse;margin-bottom:24px}td,th{border:1px solid #cbd5e1;padding:4px 8px;font-size:13px;text-align:left}th{background:#f1f5f9}</style>
</head><body>
${parts.join('\n')}
</body></html>`
}

function workbookToJson(wb) {
  const sheets = {}
  for (const name of wb.SheetNames) sheets[name] = rowsOf(wb.Sheets[name])
  if (wb.SheetNames.length === 1) return JSON.stringify(sheets[wb.SheetNames[0]], null, 2)
  return JSON.stringify(sheets, null, 2)
}

async function workbookToPdf(wb, options) {
  const blocks = []
  wb.SheetNames.forEach((name, index) => {
    const rows = rowsOf(wb.Sheets[name])
    if (rows.length === 0) return
    if (index > 0) blocks.push({ type: 'pagebreak' })
    blocks.push({ type: 'heading', level: 2, runs: [{ text: name }] })
    const shown = rows.slice(0, MAX_PDF_ROWS)
    blocks.push({ type: 'table', rows: shown.map((row) => row.map((cell) => String(cell ?? ''))) })
    if (rows.length > MAX_PDF_ROWS) {
      blocks.push({
        type: 'paragraph',
        runs: [{ text: `… ${rows.length - MAX_PDF_ROWS} more rows not shown. Convert to XLSX/CSV to keep every row.`, italic: true }],
      })
    }
  })
  const { bytes } = await renderBlocks(blocks, {
    pageSize: options.pageSize === 'A4' ? 'A4' : 'Letter',
    margin: 36,
  })
  return bytes
}

/**
 * @param {{file: File|Blob}} input
 * @param {string} format
 * @returns {Promise<{blob: Blob, warnings: string[]}>}
 */
export async function convertSheet(input, format, options = {}) {
  const wb = await readWorkbook(input.file)
  const warnings = []

  if (bookTypeWorks(format)) {
    const out = XLSX.write(wb, { bookType: BOOK_TYPES[format], type: 'array', cellStyles: true })
    return { blob: new Blob([out], { type: OUTPUT_FORMATS[format].mime }), warnings }
  }

  if (format === 'csv' || format === 'tsv') {
    if (wb.SheetNames.length > 1) {
      warnings.push(`Only the first worksheet (“${wb.SheetNames[0]}”) is exported; ${wb.SheetNames.length - 1} other sheet(s) were left out.`)
    }
    const text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], {
      FS: format === 'tsv' ? '\t' : ',',
    })
    return { blob: new Blob([text], { type: OUTPUT_FORMATS[format].mime }), warnings }
  }

  if (format === 'json') {
    return { blob: new Blob([workbookToJson(wb)], { type: OUTPUT_FORMATS.json.mime }), warnings }
  }

  if (format === 'html') {
    return { blob: new Blob([workbookToHtml(wb)], { type: OUTPUT_FORMATS.html.mime }), warnings }
  }

  if (format === 'pdf') {
    return { blob: new Blob([await workbookToPdf(wb, options)], { type: OUTPUT_FORMATS.pdf.mime }), warnings }
  }

  throw new Error(`No spreadsheet engine builds .${format}.`)
}

function bookTypeWorks(format) {
  if (!BOOK_TYPES[format]) return false
  return true
}

export { readWorkbook, rowsOf }
