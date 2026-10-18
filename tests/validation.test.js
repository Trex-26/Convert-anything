import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCEPTED_MIME,
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_BY_FAMILY,
  detectSignature,
  isAnimatedGif,
  guessFamily,
  validateFile,
} from '../src/lib/fileValidation.js'

// --- helpers ---------------------------------------------------------------

function bytes(...values) {
  return new Uint8Array(values)
}

function ascii(str) {
  return Uint8Array.from(str, (c) => c.charCodeAt(0) & 0xff)
}

// --- signature detection -----------------------------------------------------

test('Validation - detects major image signatures by magic bytes', () => {
  assert.equal(detectSignature(bytes(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8)), 'jpeg')
  assert.equal(detectSignature(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)), 'png')
  assert.equal(detectSignature(ascii('GIF89a......')), 'gif')
  const webp = new Uint8Array(16)
  webp.set(ascii('RIFF'), 0)
  webp.set(ascii('WEBP'), 8)
  assert.equal(detectSignature(webp), 'webp')
  assert.equal(detectSignature(ascii('BM..........')), 'bmp')
  assert.equal(detectSignature(bytes(0, 0, 1, 0, 1, 2, 3, 4, 5, 6, 7, 8)), 'ico')
  assert.equal(detectSignature(ascii('%PDF-1.4........')), 'pdf')
})

test('Validation - TIFF little/big endian and AVIF/HEIC ftyp boxes', () => {
  assert.equal(detectSignature(ascii('II*\u0000........')), 'tiff')
  assert.equal(detectSignature(ascii('MM\u0000*........')), 'tiff')
  assert.equal(detectSignature(ascii('....ftypavif....')), 'avif')
  assert.equal(detectSignature(ascii('....ftypheic....')), 'heic')
})

test('Validation - OOXML zip sniffing finds docx and xlsx', () => {
  const docx = new Uint8Array(512)
  docx.set(ascii('PK\x03\x04'), 0)
  docx.set(ascii('word/document.xml'), 100)
  assert.equal(detectSignature(docx), 'docx')

  const xlsx = new Uint8Array(512)
  xlsx.set(ascii('PK\x03\x04'), 0)
  xlsx.set(ascii('xl/workbook.xml'), 100)
  assert.equal(detectSignature(xlsx), 'xlsx')

  const ods = new Uint8Array(512)
  ods.set(ascii('PK\x03\x04'), 0)
  ods.set(ascii('mimetype'), 30)
  ods.set(ascii('application/vnd.oasis.opendocument.spreadsheet'), 200)
  assert.equal(detectSignature(ods), 'ods')
})

test('Validation - SVG detected from declared XML root', () => {
  const svg = ascii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')
  assert.equal(detectSignature(svg), 'svg')
})

test('Validation - animated GIF detection via NETSCAPE2.0 extension', () => {
  const gifHeader = new Uint8Array(200)
  gifHeader.set(ascii('GIF89a'), 0)
  assert.equal(isAnimatedGif(gifHeader), false)
  gifHeader.set(ascii('NETSCAPE2.0'), 100)
  assert.equal(isAnimatedGif(gifHeader), true)
  assert.equal(isAnimatedGif(ascii('%PDF-1.4')), false)
})

// --- family classification ---------------------------------------------------

test('Validation - family guessing routes every accepted type', () => {
  assert.equal(guessFamily({ name: 'photo.jpg', type: 'image/jpeg' }), 'image')
  assert.equal(guessFamily({ name: 'doc.pdf', type: 'application/pdf' }), 'pdf')
  assert.equal(guessFamily({ name: 'doc.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'doc')
  assert.equal(guessFamily({ name: 'book.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'sheet')
  assert.equal(guessFamily({ name: 'book.ods', type: 'application/vnd.oasis.opendocument.spreadsheet' }), 'sheet')
  assert.equal(guessFamily({ name: 'table.csv', type: 'text/csv' }), 'sheet')
  assert.equal(guessFamily({ name: 'notes.txt', type: 'text/plain' }), 'text')
  assert.equal(guessFamily({ name: 'notes.md', type: 'text/markdown' }), 'text')
  assert.equal(guessFamily({ name: 'virus.exe', type: 'application/x-msdownload' }), null)
})

// --- limits ------------------------------------------------------------------

test('Validation - MIME list covers all ingestible formats', () => {
  for (const mime of [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    'text/plain',
  ]) {
    assert.ok(ACCEPTED_MIME.includes(mime), `${mime} accepted`)
  }
})

test('Validation - per-family size caps are sane', () => {
  assert.ok(MAX_FILE_SIZE_BY_FAMILY.pdf > MAX_FILE_SIZE_BY_FAMILY.image)
  assert.equal(MAX_FILES, 100)
  assert.equal(MAX_FILE_SIZE, 25 * 1024 * 1024)
})

test('Validation - legacy sync gate still rejects executables', () => {
  const exeFile = { name: 'virus.exe', size: 1024, type: 'application/x-msdownload' }
  const err = validateFile(exeFile)
  assert.match(err, /not a supported format/)
})
