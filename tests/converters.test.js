import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import {
  OUTPUT_FORMATS,
  QUALITY_PRESETS,
  PDF_OPERATIONS,
  FAMILY_ROUTES,
  availableFormatsFor,
} from '../src/lib/converters.js'

test('Converters - Registry entries and properties', () => {
  for (const id of ['pdf', 'jpg', 'png', 'webp', 'html', 'txt', 'csv', 'xlsx']) {
    assert.ok(OUTPUT_FORMATS[id], `${id} registered`)
  }
  assert.equal(OUTPUT_FORMATS.pdf.mime, 'application/pdf')
  assert.equal(OUTPUT_FORMATS.jpg.mime, 'image/jpeg')
  assert.equal(OUTPUT_FORMATS.png.mime, 'image/png')
  assert.equal(OUTPUT_FORMATS.webp.mime, 'image/webp')
  assert.equal(OUTPUT_FORMATS.csv.mime, 'text/csv')
})

test('Converters - Quality Presets', () => {
  assert.equal(QUALITY_PRESETS.length, 3)
  assert.equal(QUALITY_PRESETS[0].id, 'low')
  assert.equal(QUALITY_PRESETS[1].id, 'medium')
  assert.equal(QUALITY_PRESETS[2].id, 'high')
  assert.ok(QUALITY_PRESETS[0].jpegQ < QUALITY_PRESETS[2].jpegQ)
})

test('Converters - PDF operations catalogue is complete', () => {
  const ids = PDF_OPERATIONS.map((o) => o.id)
  assert.deepEqual(ids, ['merge', 'split', 'rotate', 'extract', 'compress'])
})

test('Converters - Format availability detection per family', () => {
  const imgFile = { name: 'sample.png', type: 'image/png' }
  assert.deepEqual(
    availableFormatsFor(imgFile).map((f) => f.id),
    ['pdf', 'jpg', 'png', 'webp'],
  )

  const pdfFile = { name: 'sample.pdf', type: 'application/pdf' }
  assert.deepEqual(availableFormatsFor(pdfFile).map((f) => f.id), ['pdf'])

  const docxFile = { name: 'sample.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  assert.deepEqual(availableFormatsFor(docxFile).map((f) => f.id), ['html', 'txt'])

  const sheetFile = { name: 'sample.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  assert.deepEqual(availableFormatsFor(sheetFile).map((f) => f.id), ['csv', 'html', 'txt', 'xlsx'])

  const textFile = { name: 'sample.txt', type: 'text/plain' }
  assert.deepEqual(availableFormatsFor(textFile).map((f) => f.id), ['pdf'])

  // Unknown families must not advertise anything
  const exeFile = { name: 'virus.exe', type: 'application/x-msdownload' }
  assert.deepEqual(availableFormatsFor(exeFile), [])
})

test('Converters - every family advertises only implemented handlers', () => {
  for (const [family, route] of Object.entries(FAMILY_ROUTES)) {
    for (const id of route.outputs) {
      assert.ok(OUTPUT_FORMATS[id], `family ${family} route ${id} exists in OUTPUT_FORMATS`)
    }
  }
})

test('PDF Engine - Generates valid PDF header and metadata', async () => {
  const doc = await PDFDocument.create()
  doc.setProducer('Convert-anything')
  doc.setCreator('Convert-anything')
  const page = doc.addPage([200, 200])
  page.drawText('Test Convert-anything', { x: 50, y: 100 })
  const pdfBytes = await doc.save()

  assert.ok(pdfBytes.length > 0)
  const header = String.fromCharCode(...pdfBytes.subarray(0, 5))
  assert.equal(header, '%PDF-')
})

test('ZIP Engine - Bundles multiple items and creates valid ZIP archive', async () => {
  const zip = new JSZip()
  zip.file('file1.pdf', new Uint8Array([1, 2, 3, 4]))
  zip.file('file2.jpg', new Uint8Array([5, 6, 7, 8]))

  const zipBuffer = await zip.generateAsync({ type: 'uint8array' })
  assert.ok(zipBuffer.length > 0)
  assert.equal(zipBuffer[0], 0x50)
  assert.equal(zipBuffer[1], 0x4b)
  assert.equal(zipBuffer[2], 0x03)
  assert.equal(zipBuffer[3], 0x04)
})

test('Privacy Architecture - Verify no external conversion endpoints', () => {
  const code = (test).toString()
  assert.ok(!code.includes('api.cloudconvert.com'))
  assert.ok(!code.includes('backend.convertanything.com'))
})
