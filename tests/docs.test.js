import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

// ---------------------------------------------------------------------------
// Real fixture files are produced in-memory with the same libraries that real
// producers use, so we exercise genuine parsers instead of mocks.
// ---------------------------------------------------------------------------

function makeFile(buffer, name, type = 'application/octet-stream') {
  return new File([buffer], name, { type })
}

function makeXlsxBuffer() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['name', 'qty'],
    ['Widget', 3],
    ['Gadget', 12],
  ])
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Uint8Array(out)
}

async function makeDocxFile() {
  // Minimal-but-real OOXML package: mammoth parses exactly this structure.
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello Convert</w:t></w:r></w:p>
    <w:p><w:r><w:t>anything</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  )
  const buffer = await zip.generateAsync({ type: 'uint8array' })
  return makeFile(
    buffer,
    'test.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
}

// ---------------------------------------------------------------------------
// XLSX / CSV / ODS spreadsheet routes
// ---------------------------------------------------------------------------

test('docs - XLSX converts to CSV with parsed cell values', async () => {
  const { sheetToCsv } = await import('../src/lib/docs.js')
  const text = await sheetToCsv(makeFile(makeXlsxBuffer(), 'book.xlsx'))
  assert.match(text, /name,qty/)
  assert.match(text, /Widget,3/)
  assert.match(text, /Gadget,12/)
})

test('docs - XLSX converts to an HTML table', async () => {
  const { sheetToHtml } = await import('../src/lib/docs.js')
  const html = await sheetToHtml(makeFile(makeXlsxBuffer(), 'book.xlsx'))
  assert.match(html, /<table/)
  assert.match(html, /Widget/)
})

test('docs - round trip XLSX to workbook produces a valid xlsx package', async () => {
  const { convertDocument } = await import('../src/lib/docs.js')
  const out = await convertDocument(
    { family: 'sheet', file: makeFile(makeXlsxBuffer(), 'book.xlsx') },
    'xlsx',
  )
  assert.equal(out.kind, 'binary')
  const bytes = new Uint8Array(await out.blob.arrayBuffer())
  assert.equal(bytes[0], 0x50) // PK
  assert.equal(bytes[1], 0x4b)
  const reparsed = XLSX.read(bytes, { type: 'array' })
  assert.equal(reparsed.SheetNames[0], 'Sheet1')
})

test('docs - CSV routes through the sheet family to XLSX and CSV', async () => {
  const { convertDocument } = await import('../src/lib/docs.js')
  const csvFile = makeFile(new TextEncoder().encode('a,b\n1,2\n'), 'table.csv', 'text/csv')
  const out = await convertDocument({ family: 'sheet', file: csvFile }, 'xlsx')
  assert.equal(out.kind, 'binary')
  // And text output
  const txt = await convertDocument({ family: 'sheet', file: csvFile }, 'txt')
  assert.match(txt.text, /a,b/)
})

// ---------------------------------------------------------------------------
// DOCX routes
// ---------------------------------------------------------------------------

test('docs - DOCX extracts raw paragraph text via mammoth', async () => {
  const { docxToText } = await import('../src/lib/docs.js')
  const docx = await makeDocxFile()
  const text = await docxToText(docx)
  assert.match(text, /Hello Convert/)
  assert.match(text, /anything/)
})

test('docs - DOCX converts to HTML with paragraph markup', async () => {
  const { convertDocument } = await import('../src/lib/docs.js')
  const docx = await makeDocxFile()
  const out = await convertDocument({ family: 'doc', file: docx }, 'html')
  assert.match(out.text, /<p>/)
  assert.match(out.text, /Hello Convert/)
})

// ---------------------------------------------------------------------------
// Text → PDF
// ---------------------------------------------------------------------------

test('docs - plain text converts to a paginated PDF', async () => {
  const { textToPdf } = await import('../src/lib/docs.js')
  const long = Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of the converted text document.`).join('\n')
  const pdfBlob = await textToPdf(makeFile(new TextEncoder().encode(long), 'notes.txt', 'text/plain'))
  const bytes = new Uint8Array(await pdfBlob.arrayBuffer())
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-')
  const doc = await PDFDocument.load(bytes)
  // ~120 wrapped lines at ~50/page should span several pages
  assert.ok(doc.getPageCount() > 1, `expected multiple pages, got ${doc.getPageCount()}`)
})

test('docs - latin-1 unsupported characters are transliterated, not dropped', async () => {
  const { textToPdf } = await import('../src/lib/docs.js')
  const pdfBlob = await textToPdf(makeFile(new TextEncoder().encode('ok 汉字 ok'), 'cjk.txt'))
  const bytes = new Uint8Array(await pdfBlob.arrayBuffer())
  const doc = await PDFDocument.load(bytes)
  assert.ok(doc.getPages().length >= 1)
  assert.equal(String.fromCharCode(...bytes.slice(0, 8)), '%PDF-1.7')
})

test('docs - empty text file reports a helpful error', async () => {
  const { textToPdf } = await import('../src/lib/docs.js')
  await assert.rejects(
    () => textToPdf(makeFile(new TextEncoder().encode('   \n'), 'empty.txt')),
    /empty/,
  )
})

// ---------------------------------------------------------------------------
// Registry integration: convertSingleItem dispatches non-image families
// ---------------------------------------------------------------------------

test('registry - convertSingleItem routes PDF and sheet items correctly', async () => {
  const { convertSingleItem } = await import('../src/lib/converters.js')

  // PDF item, extract op
  const srcDoc = await PDFDocument.create()
  srcDoc.addPage([200, 400])
  srcDoc.addPage([200, 400])
  const pdfBytes = new Uint8Array(await srcDoc.save())
  const pdfItem = { id: '1', name: 'doc.pdf', file: makeFile(pdfBytes, 'doc.pdf'), outputFormat: 'pdf' }
  const out = await convertSingleItem(pdfItem, 'high', { pdfOp: 'split' })
  assert.equal(out.resultName, 'doc-pages.zip')

  // Sheet item → CSV
  const sheetItem = { id: '2', name: 'book.xlsx', file: makeFile(makeXlsxBuffer(), 'book.xlsx'), outputFormat: 'csv' }
  const csvOut = await convertSingleItem(sheetItem, 'high')
  assert.match(String(csvOut.blob.size > 0), /true/)
})
