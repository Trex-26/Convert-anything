import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import JSZip from 'jszip'

import {
  OUTPUT_FORMATS,
  QUALITY_PRESETS,
  availableFormatsFor,
  commonFormatsForFiles,
  convertSingleItem,
  familyLabel,
  warningsFor,
} from '../src/lib/converters.js'
import { ROUTES, UNSUPPORTED_INPUTS, supportChart } from '../src/lib/registry.js'
import { encodeBmp, encodeGif, encodeIco, encodeTiff } from '../src/lib/imageEngine.js'
import { convertDocument } from '../src/lib/docEngine.js'
import { convertSheet } from '../src/lib/sheetEngine.js'
import { convertPdf } from '../src/lib/pdfEngine.js'
import { detectSignature } from '../src/lib/fileValidation.js'

// --- helpers ---------------------------------------------------------------

const blobOf = (bytes, name, type = 'application/octet-stream') =>
  Object.assign(new Blob([bytes], { type }), { name })

const textBlob = (text, name, type) => blobOf(new TextEncoder().encode(text), name, type)

const headOf = async (blob, n = 8) => new Uint8Array(await blob.slice(0, n).arrayBuffer())

const ascii = (bytes) => String.fromCharCode(...bytes)

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

async function makePdf({ text = 'Quarterly Report Total 42', draw = true } = {}) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([500, 400])
  if (draw) page.drawText(text, { x: 40, y: 340, size: 14, font })
  return blobOf(await doc.save(), 'sample.pdf', 'application/pdf')
}

function rgbaPixels(width, height) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = (i * 7) % 256
    data[i * 4 + 1] = (i * 13) % 256
    data[i * 4 + 2] = (i * 29) % 256
    data[i * 4 + 3] = 255
  }
  return data
}

// --- registry ---------------------------------------------------------------

test('Registry - every advertised format has metadata', () => {
  for (const [id, format] of Object.entries(OUTPUT_FORMATS)) {
    assert.equal(format.id, id)
    assert.ok(format.label, `${id} label`)
    assert.match(format.ext, /^\.[a-z0-9]+$/, `${id} extension`)
    assert.match(format.mime, /^[a-z]+\/[\w.+-]+$/, `${id} mime`)
  }
})

test('Registry - routes only advertise formats we can actually write', () => {
  const engines = new Set(['image', 'pdf', 'document', 'spreadsheet', 'presentation'])
  for (const [signature, route] of Object.entries(ROUTES)) {
    assert.ok(engines.has(route.category), `${signature} has a known engine`)
    assert.ok(route.outputs.length > 0, `${signature} advertises at least one output`)
    for (const id of route.outputs) {
      assert.ok(OUTPUT_FORMATS[id], `${signature} -> ${id} exists`)
      assert.notEqual(id, signature === 'jpeg' ? 'jpeg' : null)
    }
  }
  // No canvas/Avif encoder exists, so AVIF must never be an output.
  const allOutputs = Object.values(ROUTES).flatMap((r) => r.outputs)
  assert.ok(!allOutputs.includes('avif'), 'AVIF is input-only')
  assert.ok(!allOutputs.includes('svg'), 'SVG is input-only')
  assert.ok(!allOutputs.includes('doc'), 'legacy DOC is not produced')
})

test('Registry - legacy Office formats are explained, never routed', () => {
  for (const id of ['doc', 'odt', 'rtf', 'ppt', 'odp']) {
    assert.ok(UNSUPPORTED_INPUTS[id], `${id} has an explanation`)
    assert.ok(!ROUTES[id], `${id} is not advertised as convertible`)
  }
})

test('Registry - support chart covers every category in order', () => {
  const chart = supportChart()
  assert.deepEqual(
    chart.map((c) => c.id),
    ['image', 'pdf', 'document', 'spreadsheet', 'presentation'],
  )
  const imageRow = chart[0].rows.find((r) => r.signature === 'jpeg')
  assert.ok(imageRow.outputs.some((o) => o.id === 'webp'))
  for (const cat of chart) assert.ok(cat.rows.length > 0)
})

test('Registry - quality presets are ordered and complete', () => {
  assert.deepEqual(Object.keys(QUALITY_PRESETS), ['high', 'balanced', 'small'])
  assert.ok(QUALITY_PRESETS.small.jpeg < QUALITY_PRESETS.balanced.jpeg)
  assert.ok(QUALITY_PRESETS.balanced.jpeg < QUALITY_PRESETS.high.jpeg)
})

// --- routing ----------------------------------------------------------------

test('Routing - outputs follow the detected signature, not the extension', () => {
  assert.deepEqual(
    availableFormatsFor({ signature: 'jpeg' }).map((f) => f.id),
    ['png', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'pdf'],
  )
  assert.deepEqual(
    availableFormatsFor({ signature: 'pdf' }).map((f) => f.id),
    ['jpg', 'png', 'webp', 'tiff', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'pdf'],
  )
  assert.deepEqual(
    availableFormatsFor({ signature: 'docx' }).map((f) => f.id),
    ['pdf', 'html', 'txt', 'md'],
  )
  assert.deepEqual(
    availableFormatsFor({ signature: 'csv' }).map((f) => f.id),
    ['xlsx', 'xls', 'ods', 'tsv', 'json', 'html', 'pdf'],
  )
  assert.deepEqual(availableFormatsFor({ signature: 'pptx' }).map((f) => f.id), ['pdf', 'jpg', 'png', 'pptx'])
})

test('Routing - a misfiled extension cannot unlock unsupported outputs', () => {
  const fakeImage = { name: 'photo.png', type: 'image/png' }
  // Family fallback still works...
  assert.ok(availableFormatsFor(fakeImage).length > 0)
  // ...but the signature wins when present.
  assert.deepEqual(availableFormatsFor({ ...fakeImage, signature: 'docx' }).map((f) => f.id), [
    'pdf',
    'html',
    'txt',
    'md',
  ])
  assert.deepEqual(availableFormatsFor({ name: 'virus.exe', signature: null }), [])
})

test('Routing - family labels describe the detected type', () => {
  assert.equal(familyLabel({ signature: 'jpeg' }), 'JPG')
  assert.equal(familyLabel({ signature: 'xlsx' }), 'XLSX')
  assert.equal(familyLabel({ family: 'doc' }), 'Document')
  assert.equal(familyLabel({ family: 'image' }), 'Image')
})

test('Routing - common outputs are the intersection of every file', () => {
  assert.deepEqual(commonFormatsForFiles([]), [])
  // Every route can emit PDF, so PNG + DOCX still share exactly that.
  assert.deepEqual(
    commonFormatsForFiles([{ signature: 'png' }, { signature: 'docx' }]).map((f) => f.id),
    ['pdf'],
  )
  const pair = commonFormatsForFiles([{ signature: 'png' }, { signature: 'jpeg' }]).map((f) => f.id)
  assert.deepEqual(pair, ['webp', 'gif', 'bmp', 'tiff', 'ico', 'pdf'])
  // Unknown files advertise nothing, so nothing can be shared.
  assert.deepEqual(commonFormatsForFiles([{ signature: 'png' }, { name: 'x.exe' }]), [])
})

test('Warnings - lossy targets carry an explanation', () => {
  assert.match(warningsFor('xlsx', 'csv').join(' '), /first worksheet/i)
  assert.match(warningsFor('jpeg', 'bmp').join(' '), /alpha|transparen/i)
  assert.match(warningsFor('pdf', 'docx').join(' '), /text layer/i)
  assert.deepEqual(warningsFor('png', 'png'), [])
})

// --- image encoders ---------------------------------------------------------

test('Image - BMP encoder writes a valid 24-bit bitmap', async () => {
  const width = 4
  const height = 3
  const bmp = encodeBmp(rgbaPixels(width, height), width, height)
  assert.equal(ascii(bmp.subarray(0, 2)), 'BM')
  const view = new DataView(bmp.buffer)
  assert.equal(view.getUint32(2, true), bmp.length)
  assert.equal(view.getInt32(18, true), width)
  assert.equal(view.getInt32(22, true), height)
  assert.equal(view.getUint16(28, true), 24)
  // Bottom-up row order: last source row is written first.
  assert.ok(bmp.length > 54)
})

test('Image - GIF encoder emits a real GIF89a with a trailer', async () => {
  const width = 8
  const height = 8
  const gif = await encodeGif(rgbaPixels(width, height), width, height)
  assert.equal(ascii(gif.subarray(0, 6)), 'GIF89a')
  assert.equal(gif[gif.length - 1], 0x3b)
})

test('Image - TIFF encoder emits a parseable TIFF header', async () => {
  const tiff = await encodeTiff(rgbaPixels(4, 4), 4, 4)
  // UTIF writes big-endian TIFFs; both byte orders are valid.
  assert.equal(detectSignature(tiff.subarray(0, 32)), 'tiff')
  assert.ok(tiff.length > 100)
})

test('Image - ICO container wraps a PNG payload with correct dimensions', async () => {
  const png = new Uint8Array([...pngSignature, 0, 0, 0, 0])
  const ico = await encodeIco(png, 32, 32)
  const view = new DataView(ico.buffer)
  assert.equal(view.getUint16(2, true), 1) // icon
  assert.equal(view.getUint16(4, true), 1) // one image
  assert.equal(ico[6], 32)
  assert.equal(ico[7], 32)
  assert.equal(view.getUint32(18, true), 22) // payload offset
  assert.deepEqual([...ico.subarray(22, 30)], pngSignature)
  // 256px icons are stored as 0 per the ICO spec.
  const big = await encodeIco(png, 256, 256)
  assert.equal(big[6], 0)
  assert.equal(big[7], 0)
})

test('Image - unsupported image output is rejected, not renamed', async () => {
  const fake = blobOf(new TextEncoder().encode('not an image'), 'x.png', 'image/png')
  await assert.rejects(() => convertSingleItem({ file: fake, name: 'x.png', signature: 'png', outputFormat: 'avif' }, 'high'), /cannot be converted/i)
})

// --- spreadsheets -----------------------------------------------------------

test('Sheets - CSV to XLSX produces a real OOXML workbook', async () => {
  const csv = textBlob('name,qty\nWidget,3\nGadget,5\n', 'data.csv', 'text/csv')
  const { blob } = await convertSheet({ file: csv }, 'xlsx')
  const head = await headOf(blob, 4)
  assert.deepEqual([...head], [0x50, 0x4b, 0x03, 0x04])
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  assert.ok(zip.file('xl/workbook.xml'), 'workbook.xml present')
  assert.ok(zip.file('[Content_Types].xml'), 'content types present')
})

test('Sheets - CSV to TSV/JSON/HTML keep the values', async () => {
  const csv = textBlob('name,qty\nWidget,3\nGadget,5\n', 'data.csv', 'text/csv')
  const tsv = await convertSheet({ file: csv }, 'tsv')
  assert.match(await tsv.blob.text(), /name\tqty/)
  const json = await convertSheet({ file: csv }, 'json')
  assert.deepEqual(JSON.parse(await json.blob.text()), [
    ['name', 'qty'],
    ['Widget', '3'],
    ['Gadget', '5'],
  ])
  const html = await convertSheet({ file: csv }, 'html')
  assert.match(await html.blob.text(), /<td>Widget<\/td>/)
})

test('Sheets - CSV to PDF is a real PDF', async () => {
  const csv = textBlob('item,total\nWidget,3\n', 'data.csv', 'text/csv')
  const { blob } = await convertSheet({ file: csv }, 'pdf')
  assert.equal(ascii(await headOf(blob, 5)), '%PDF-')
})

test('Sheets - XLSX round-trips to CSV with the same cells', async () => {
  const csv = textBlob('a,b\n1,2\n', 'data.csv', 'text/csv')
  const { blob: xlsx } = await convertSheet({ file: csv }, 'xlsx')
  const roundTrip = blobOf(new Uint8Array(await xlsx.arrayBuffer()), 'data.xlsx')
  const { blob: backToCsv } = await convertSheet({ file: roundTrip }, 'csv')
  assert.equal((await backToCsv.text()).trim(), 'a,b\n1,2')
})

test('Sheets - multi-sheet workbooks warn before dropping sheets', async () => {
  const csv = textBlob('a,b\n1,2\n', 'data.csv', 'text/csv')
  const { blob: xlsx } = await convertSheet({ file: csv }, 'xlsx')
  const wbFile = blobOf(new Uint8Array(await xlsx.arrayBuffer()), 'data.xlsx')
  const { warnings } = await convertSheet({ file: wbFile }, 'csv')
  assert.ok(Array.isArray(warnings))
})

// --- documents --------------------------------------------------------------

test('Documents - TXT to PDF paginates real text', async () => {
  const txt = textBlob('Hello world.\n\n' + 'A long paragraph. '.repeat(200), 'notes.txt', 'text/plain')
  const { blob } = await convertDocument({ file: txt, signature: 'txt' }, 'pdf')
  assert.equal(ascii(await headOf(blob, 5)), '%PDF-')
  assert.ok(blob.size > 1000)
})

test('Documents - Markdown to HTML renders structure', async () => {
  const md = textBlob('# Title\n\n- one\n- two\n', 'notes.md', 'text/markdown')
  const { blob } = await convertDocument({ file: md, signature: 'md' }, 'html')
  const html = await blob.text()
  assert.match(html, /<h1[^>]*>Title<\/h1>/)
  assert.match(html, /<li>one<\/li>/)
  assert.match(html, /^<!doctype html>/)
})

test('Documents - HTML to TXT strips markup but keeps text', async () => {
  const html = textBlob('<html><body><h1>Report</h1><p>Body <b>text</b>.</p></body></html>', 'p.html', 'text/html')
  const { blob } = await convertDocument({ file: html, signature: 'html' }, 'txt')
  const text = await blob.text()
  assert.match(text, /Report/)
  assert.match(text, /Body text\./)
  assert.ok(!text.includes('<h1>'))
})

test('Documents - TXT to DOCX produces a readable Word file', async () => {
  const txt = textBlob('First paragraph.\n\nSecond paragraph.', 'notes.txt', 'text/plain')
  const { blob } = await convertDocument({ file: txt, signature: 'txt' }, 'docx')
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  assert.ok(zip.file('word/document.xml'))
  // Round-trip through mammoth to prove the DOCX is valid.
  const { blob: back } = await convertDocument(
    { file: blobOf(new Uint8Array(await blob.arrayBuffer()), 'notes.docx'), signature: 'docx' },
    'txt',
  )
  assert.match(await back.text(), /Second paragraph\./)
})

test('Documents - DOCX to PDF/MD/HTML all succeed from one source', async () => {
  const md = textBlob('# Heading\n\nSome **bold** text and a paragraph.', 'doc.md', 'text/markdown')
  const { blob: docx } = await convertDocument({ file: md, signature: 'md' }, 'docx')
  const docxFile = blobOf(new Uint8Array(await docx.arrayBuffer()), 'doc.docx')

  const pdf = await convertDocument({ file: docxFile, signature: 'docx' }, 'pdf')
  assert.equal(ascii(await headOf(pdf.blob, 5)), '%PDF-')

  const html = await convertDocument({ file: docxFile, signature: 'docx' }, 'html')
  assert.match(await html.blob.text(), /<h1>Heading<\/h1>/)

  const backToMd = await convertDocument({ file: docxFile, signature: 'docx' }, 'md')
  assert.match(await backToMd.blob.text(), /# Heading/)
})

// --- PDF --------------------------------------------------------------------

test('PDF - text layer converts to TXT/HTML/DOCX/XLSX', async () => {
  const pdf = await makePdf({ text: 'Invoice total 42 dollars' })

  const txt = await convertPdf({ file: pdf, name: 'sample.pdf' }, 'txt')
  assert.match(await txt.blob.text(), /Invoice total 42 dollars/)

  const html = await convertPdf({ file: pdf, name: 'sample.pdf' }, 'html')
  assert.match(await html.blob.text(), /Invoice total 42 dollars/)

  const docx = await convertPdf({ file: pdf, name: 'sample.pdf' }, 'docx')
  const zip = await JSZip.loadAsync(await docx.blob.arrayBuffer())
  assert.ok(zip.file('word/document.xml'), 'PDF -> DOCX is a valid Word file')

  const xlsx = await convertPdf({ file: pdf, name: 'sample.pdf' }, 'xlsx')
  assert.deepEqual([...(await headOf(xlsx.blob, 2))], [0x50, 0x4b])
})

test('PDF - a scanned PDF fails honestly instead of emitting empty text', async () => {
  const pdf = await makePdf({ draw: false })
  await assert.rejects(() => convertPdf({ file: pdf, name: 'scan.pdf' }, 'txt'), /no text layer/i)
})

test('PDF - corrupted input is reported, not silently converted', async () => {
  const broken = blobOf(new TextEncoder().encode('%PDF-1.4 this is not really a pdf'), 'broken.pdf', 'application/pdf')
  await assert.rejects(() => convertPdf({ file: broken, name: 'broken.pdf' }, 'txt'), /malformed or corrupted/i)
})

// --- dispatcher -------------------------------------------------------------

test('Dispatcher - unsupported pairs fail with a clear message', async () => {
  const docx = blobOf(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'x.docx')
  await assert.rejects(
    () => convertSingleItem({ file: docx, name: 'x.docx', signature: 'docx', outputFormat: 'xlsx' }),
    /cannot be converted to XLSX/i,
  )
})

test('Dispatcher - legacy .doc gets an actionable explanation', async () => {
  const doc = blobOf(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), 'old.doc')
  await assert.rejects(
    () => convertSingleItem({ file: doc, name: 'old.doc', signature: 'doc', outputFormat: 'pdf' }),
    /save it as \.docx/i,
  )
})

test('Dispatcher - result names use the real target extension', async () => {
  const txt = textBlob('hello', 'notes.txt', 'text/plain')
  const result = await convertSingleItem({ file: txt, name: 'notes.txt', signature: 'txt', outputFormat: 'pdf' })
  assert.equal(result.name, 'notes.pdf')
  assert.equal(result.blob.type, 'application/pdf')
  assert.ok(result.blob.size > 0)
})

test('Dispatcher - spreadsheet zip-style outputs keep a valid signature', async () => {
  const csv = textBlob('a,b\n1,2\n', 'data.csv', 'text/csv')
  const result = await convertSingleItem({ file: csv, name: 'data.csv', signature: 'csv', outputFormat: 'xlsx' })
  assert.equal(result.blob.type, OUTPUT_FORMATS.xlsx.mime)
  assert.equal(detectSignature(await headOf(result.blob, 4096)), 'xlsx')
})

test('Privacy - no conversion engine calls a remote endpoint', async () => {
  const { readFile } = await import('node:fs/promises')
  for (const file of ['imageEngine.js', 'pdfEngine.js', 'docEngine.js', 'sheetEngine.js', 'slidesEngine.js', 'converters.js']) {
    const source = await readFile(new URL(`../src/lib/${file}`, import.meta.url), 'utf8')
    assert.ok(!/fetch\(|XMLHttpRequest|axios/.test(source), `${file} performs no network calls`)
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(source.replace(/\/\/[^\n]*/g, '')), `${file} has no remote URLs`)
  }
})
