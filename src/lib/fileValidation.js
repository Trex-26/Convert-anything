// fileValidation.js
// Security layer: file signature (magic-byte) inspection so we never trust
// extensions or reported MIME types alone, input-family classification for
// the conversion registry, and per-family resource caps.

// Maximum bytes read from a file for signature inspection.
const SNIFF_BYTES = 4096

// Per-family per-file caps, derived from practical browser memory limits.
export const MAX_FILE_SIZE_BY_FAMILY = {
  image: 25 * 1024 * 1024,       // 25 MB — canvas/raster decode is memory hungry
  pdf: 50 * 1024 * 1024,         // 50 MB — pdf-lib page ops stream to fewer copies
  doc: 20 * 1024 * 1024,         // 20 MB — mammoth DOM-based parsing
  sheet: 20 * 1024 * 1024,       // 20 MB — SheetJS workbook model
  text: 5 * 1024 * 1024,         // 5 MB — decoded to one string
}
// Legacy single cap used by older callers/tests.
export const MAX_FILE_SIZE = MAX_FILE_SIZE_BY_FAMILY.image

// Soft cap so a runaway batch doesn't crash the browser tab.
export const MAX_FILES = 100

// ---------------------------------------------------------------------------
// Signature detection (pure byte inspection — safe to unit test in Node)
// ---------------------------------------------------------------------------

function startsWith(bytes, sig, offset = 0) {
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false
  }
  return true
}

function asciiAt(bytes, offset, str) {
  if (offset + str.length > bytes.length) return false
  for (let i = 0; i < str.length; i++) {
    if (bytes[offset + i] !== str.charCodeAt(i)) return false
  }
  return true
}

function indexOfAscii(bytes, str, limit = bytes.length) {
  const max = Math.min(limit - str.length, bytes.length - str.length)
  outer: for (let i = 0; i <= max; i++) {
    for (let j = 0; j < str.length; j++) {
      if (bytes[i + j] !== str.charCodeAt(j)) continue outer
    }
    return i
  }
  return -1
}

/**
 * Detect the real content type of a buffer. Returns a signature id string:
 * 'jpeg' 'png' 'gif' 'webp' 'bmp' 'ico' 'tiff' 'avif' 'heic' 'svg'
 * 'pdf' 'docx' 'xlsx' 'ods' 'unknown'
 */
export function detectSignature(bytes) {
  if (!bytes || bytes.length < 12) return 'unknown'

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return 'gif'
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return 'webp'
  if (asciiAt(bytes, 0, 'BM')) return 'bmp'
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'ico'
  if (asciiAt(bytes, 0, 'II') && bytes[2] === 0x2a && bytes[3] === 0x00) return 'tiff'
  if (asciiAt(bytes, 0, 'MM') && bytes[2] === 0x00 && bytes[3] === 0x2a) return 'tiff'
  if (asciiAt(bytes, 4, 'ftypavif')) return 'avif'
  if (asciiAt(bytes, 4, 'ftypheic') || asciiAt(bytes, 4, 'ftypheif') || asciiAt(bytes, 4, 'ftypmif1')) return 'heic'
  if (asciiAt(bytes, 0, '%PDF-')) return 'pdf'

  // XML text that declares an SVG root — also catches SVG without XML header.
  const textHead = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 512))
  if (/<svg[\s>]/i.test(textHead) || (textHead.includes('<?xml') && /<svg[\s>]/i.test(textHead.slice(512)))) return 'svg'
  if (textHead.includes('<?xml') && bytes.length > 512) {
    const more = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(512, SNIFF_BYTES))
    if (/<svg[\s>]/i.test(more)) return 'svg'
  }

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // OOXML / ODS packages are ZIP archives — probe early local-file headers.
    if (indexOfAscii(bytes, 'word/document.xml', 2048) !== -1 ||
        indexOfAscii(bytes, 'wordprocessingml', 2048) !== -1) return 'docx'
    if (indexOfAscii(bytes, 'xl/workbook.xml', 2048) !== -1 ||
        indexOfAscii(bytes, 'spreadsheetml', 2048) !== -1) return 'xlsx'
    if (indexOfAscii(bytes, 'application/vnd.oasis.opendocument.spreadsheet', 2048) !== -1) return 'ods'
    if (indexOfAscii(bytes, 'mimetype', 2048) !== -1) return 'ods' // ODF packs put mimetype first
    return 'unknown'
  }

  return 'unknown'
}

/**
 * Does a GIF contain the NETSCAPE2.0 application extension (i.e. is animated)?
 * Call with the first SNIFF_BYTES of the file.
 */
export function isAnimatedGif(bytes) {
  if (detectSignature(bytes) !== 'gif') return false
  return indexOfAscii(bytes, 'NETSCAPE2.0') !== -1
}

// ---------------------------------------------------------------------------
// Family classification
// ---------------------------------------------------------------------------

const SIGNATURE_FAMILY = {
  jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image',
  ico: 'image', tiff: 'image', avif: 'image', heic: 'image', svg: 'image',
  pdf: 'pdf', docx: 'doc', xlsx: 'sheet', ods: 'sheet', csv: 'sheet',
}

// Sync fallback used by the reducer between renders — family is confirmed
// asynchronously by validateFileContent() before a file ever reaches the queue.
const EXT_FAMILY = (ext) => {
  if (/\.(jpe?g|png|gif|webp|bmp|ico|tiff?|avif|heic|heif|svg)$/i.test(ext)) return 'image'
  if (/\.pdf$/i.test(ext)) return 'pdf'
  if (/\.docx$/i.test(ext)) return 'doc'
  if (/\.(xlsx|ods|csv)$/i.test(ext)) return 'sheet'
  if (/\.(txt|md)$/i.test(ext)) return 'text'
  return null
}

export const ACCEPTED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif', 'image/svg+xml', 'image/bmp', 'image/avif',
  'image/tiff', 'image/x-icon', 'image/vnd.microsoft.icon',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv', 'text/plain', 'text/markdown',
  'text/html',
]

// Sync family guess from reported type — used only for pre-classification.
export function guessFamily(file) {
  const t = file?.type ?? ''
  const name = file?.name ?? ''
  if (t.startsWith('image/')) return 'image'
  if (t === 'application/pdf') return 'pdf'
  if (t.includes('wordprocessingml') || /\.docx$/i.test(name)) return 'doc'
  if (t.includes('spreadsheetml') || t.includes('opendocument.spreadsheet') || /\.(xlsx|ods|csv)$/i.test(name)) return 'sheet'
  const byText = /\.(txt|md)$/i.test(name) || (t.startsWith('text/') && t !== 'text/csv')
  if (byText) return 'text'
  return EXT_FAMILY(name)
}

/**
 * Async, content-checked validation. Returns null when the file is accepted.
 * Throws/returns an error string otherwise — messages are user-facing.
 * @param {File} file
 * @param {{bytes?: ArrayBuffer}} [preRead] optionally pass already-read head bytes
 * @returns {Promise<{family: string, signature: string, isAnimated?: boolean} | string>} object on success, error string on failure
 */
export async function validateFileContent(file, preRead) {
  if (!file || typeof file.size !== 'number') return 'Invalid file.'

  const family = guessFamily(file)

  // Text formats have no magic bytes: verify decodability + low binary ratio.
  if (family === 'text') {
    const size = file.size
    if (size > MAX_FILE_SIZE_BY_FAMILY.text) {
      return `“${file.name}” is larger than 5 MB.`
    }
    const head = preRead ?? await file.slice(0, SNIFF_BYTES).arrayBuffer()
    const bytes = new Uint8Array(head)
    let printable = 0
    for (const b of bytes) {
      if (b === 9 || b === 10 || b === 13 || (b >= 32 && b !== 127)) printable++
    }
    const ratio = bytes.length ? printable / bytes.length : 1
    if (ratio < 0.85) {
      return `“${file.name}” doesn't look like a text document.`
    }
    const ext = /\.md$/i.test(file.name) ? 'md' : /\.csv$/i.test(file.name) ? 'csv' : 'txt'
    return { family: 'text', signature: ext, isAnimated: false }
  }

  const cap = MAX_FILE_SIZE_BY_FAMILY[family]
  if (cap && file.size > cap) {
    const mb = Math.round(cap / (1024 * 1024))
    return `“${file.name}” is larger than ${mb} MB.`
  }

  const head = preRead ?? await file.slice(0, SNIFF_BYTES).arrayBuffer()
  const bytes = new Uint8Array(head)
  let signature = detectSignature(bytes)

  // CSV has no magic bytes — trust the extension and let SheetJS's parser
  // surface malformed content during conversion.
  if (signature === 'unknown' && /\.csv$/i.test(file.name)) {
    signature = 'csv'
  }

  const expected = SIGNATURE_FAMILY[signature]
  if (!expected) {
    return `“${file.name}” is not a supported format (or the file is corrupted).`
  }
  // Gently flag extension/heartbeat mismatch but only reject on hard mismatch
  // between detected family classes (e.g. an .html file that is actually a PDF is still useful).
  const guessed = EXT_FAMILY(file.name)
  if (guessed && guessed !== expected && !(expected === 'image' && guessed === 'image')) {
    return `“${file.name}” has a “.${(file.name.split('.').pop() || '')}” extension but its contents are ${describeSignature(signature)}.`
  }

  const result = { family: expected, signature, isAnimated: false }
  if (signature === 'gif') result.isAnimated = isAnimatedGif(bytes)
  return result
}

function describeSignature(signature) {
  switch (signature) {
    case 'jpeg': return 'a JPEG image'
    case 'png': return 'a PNG image'
    case 'gif': return 'a GIF image'
    case 'webp': return 'a WebP image'
    case 'bmp': return 'a BMP image'
    case 'ico': return 'an ICO icon'
    case 'tiff': return 'a TIFF image'
    case 'avif': return 'an AVIF image'
    case 'heic': return 'a HEIC image'
    case 'svg': return 'an SVG image'
    case 'pdf': return 'a PDF document'
    case 'docx': return 'a Word document'
    case 'xlsx': return 'an Excel workbook'
    case 'ods': return 'an OpenDocument spreadsheet'
    default: return 'an unrecognized format'
  }
}

// ---------------------------------------------------------------------------
// Legacy sync validation (kept for compatibility; screens obvious bad input)
// ---------------------------------------------------------------------------

export function isHeicFile(file) {
  if (file?.type === 'image/heic' || file?.type === 'image/heif') return true
  return /\.(heic|heif)$/i.test(file?.name || '')
}

export function validateFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    return `“${file.name}” is larger than 25 MB.`
  }
  const okMime = ACCEPTED_MIME.includes(file.type)
  const hasTextExt = /\.(txt|md|csv)$/i.test(file.name || '')
  const okExt = /\.(jpe?g|png|webp|gif|svg|bmp|heic|heif|avif|ico|tiff?|pdf|docx|xlsx|ods)$/i.test(file.name || '')
  if (!okMime && !okExt && !(hasTextExt && file.type.startsWith('text/'))) {
    return `“${file.name}” is not a supported format.`
  }
  return null
}
