/**
 * fileValidation.js
 * Security layer: file-signature (magic-byte) inspection so extensions and
 * reported MIME types are never trusted alone, content-based family
 * classification for the conversion registry, and per-family resource caps.
 *
 * Six input families exist after this overhaul:
 *   image · pdf · doc (Word/specials) · sheet · text · slides (presentations)
 */

// Maximum bytes read from a file for signature inspection.
const SNIFF_BYTES = 4096
// Extra bytes probe for OLE/Office content markers (resets after detection).
const SNIFF_MORE = 12000
// Bytes read for animated WebP detection.
const WEBP_ANIM_BYTES = 32

// Per-family per-file caps, derived from practical browser memory limits.
export const MAX_FILE_SIZE_BY_FAMILY = {
  image: 25 * 1024 * 1024,            // 25 MB — canvas/raster decode is memory hungry
  pdf: 50 * 1024 * 1024,              // 50 MB — pdf-lib / pdf.js page ops
  doc: 20 * 1024 * 1024,              // 20 MB — mammoth / ODF / RTF parses
  sheet: 20 * 1024 * 1024,            // 20 MB — SheetJS workbook model
  text: 5 * 1024 * 1024,              // 5 MB — decoded to one string
  slides: 50 * 1024 * 1024,           // 50 MB — pptx-browser canvas renderer
}
// Legacy single cap used by older callers/tests.
export const MAX_FILE_SIZE = MAX_FILE_SIZE_BY_FAMILY.image
// Soft cap so a runaway batch doesn't crash the browser tab.
export const MAX_FILES = 100

// ---------------------------------------------------------------------------
// Signature detection (pure byte inspection — safe to unit test in Node)
// ---------------------------------------------------------------------------

function startsWith(bytes, sig, offset = 0) {
  if (offset + sig.length > bytes.length) return false
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

/** Determine whether a WebP chunk table contains the ANIM marker (animated WebP). */
function webpIsAnimated(slice) {
  if (!asciiAt(slice, 0, 'RIFF') || !asciiAt(slice, 8, 'WEBP') || slice.length < 16) return false
  const c = new Uint8Array(slice.subarray(12, 16))
  const nChunks = c[0] | (c[1] << 8) | (c[2] << 16) | (c[3] << 24)
  let off = 16
  for (let i = 0; i < nChunks; i++) {
    if (off + 8 > slice.length) break
    if (asciiAt(slice, off, 'ANIM')) return true
    const sz = slice[off + 4] | (slice[off + 5] << 8) | (slice[off + 6] << 16) | (slice[off + 7] << 24)
    off += 8 + sz
  }
  return false
}

// OLE Compound File signatures (CFB) have a 1st stream name after the header;
// we probe the first ~2KB of streams for content markers. This is heuristic and
// intentionally narrow — we only accept well-known Office variants.
function oleProbe(headMore) {
  // Legacy Word — OLE stream/block typically contains "WordDocument".
  if (indexOfAscii(headMore, 'WordDocument', 2048) !== -1) return 'doc'
  // Legacy Excel — 'DBClient', 'Book', or 'workbook'.
  if (indexOfAscii(headMore, 'DBClient', 2048) !== -1 ||
      indexOfAscii(headMore, 'Workbook', 8192) !== -1 ||
      indexOfAscii(headMore, 'workbook', 8192) !== -1) return 'xls'
  // Legacy PowerPoint — "PowerPoint Document" stored in _50000002 etc.
  if (indexOfAscii(headMore, 'PowerPoint Document', 8192) !== -1) return 'ppt'
  return 'ole'
}

/** Detect the real content type of a buffer. Returns a signature id string. */
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
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // OLE/CFB legacy Office — probe further content markers.
    const headMore = new Uint8Array(SNIFF_BYTES > 4096 ? 4096 : bytes.length)
    headMore.set(bytes.subarray(0, Math.min(SNIFF_BYTES, bytes.length)))
    return oleProbe(headMore)
  }
  if (asciiAt(bytes, 0, '%PDF-')) return 'pdf'
  if (asciiAt(bytes, 0, '{\\rtf')) return 'rtf'

  // XML text that declares an SVG root — also catches SVG without XML header.
  const textHead = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 512))
  if (/<svg[\s>]/i.test(textHead) || (textHead.includes('<?xml') && /<svg[\s>]/i.test(textHead.slice(512)))) return 'svg'
  if (/<html/i.test(textHead)) return 'html'
  if (textHead.includes('<?xml') && bytes.length > 512) {
    const more = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(512, SNIFF_BYTES))
    if (/<svg[\s>]/i.test(more)) return 'svg'
  }

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP-based formats (OOXML / ODF). Writers order entries differently, so
    // probe a wider window and accept either a directory entry or a schema URL.
    const ZIP_PROBE = 16384
    if (indexOfAscii(bytes, 'Word/', ZIP_PROBE) !== -1 ||
        indexOfAscii(bytes, 'word/document', ZIP_PROBE) !== -1 ||
        indexOfAscii(bytes, 'word/_rels', ZIP_PROBE) !== -1 ||
        indexOfAscii(bytes, 'wordprocessingml', ZIP_PROBE) !== -1) return 'docx'
    // Presentations must be tested before workbooks: a PPTX can legitimately
    // contain `spreadsheetml` parts (embedded charts) but never `ppt/document`.
    if (indexOfAscii(bytes, 'ppt/presentation', ZIP_PROBE) !== -1 ||
        indexOfAscii(bytes, 'ppt/_rels', ZIP_PROBE) !== -1 ||
        indexOfAscii(bytes, 'presentationml', ZIP_PROBE) !== -1) return 'pptx'
    if (indexOfAscii(bytes, 'xl/workbook', ZIP_PROBE) !== -1 ||
        indexOfAscii(bytes, 'xl/_rels', ZIP_PROBE) !== -1 ||
        indexOfAscii(bytes, 'xl/worksheets', ZIP_PROBE) !== -1 ||
        indexOfAscii(bytes, 'spreadsheetml', ZIP_PROBE) !== -1) return 'xlsx'
    if (indexOfAscii(bytes, 'mimetype', 2048) !== -1 &&
        indexOfAscii(bytes, 'application/vnd.oasis.opendocument', 2048) !== -1) {
      // Determine ODF family from mimetype payload.
      if (indexOfAscii(bytes, 'spreadsheet', 2048) !== -1) return 'ods'
      if (indexOfAscii(bytes, 'text', 2048) !== -1) return 'odt'
      if (indexOfAscii(bytes, 'presentation', 2048) !== -1) return 'odp'
    }
    if (indexOfAscii(bytes, 'mimetype', 2048) !== -1) return 'ods' // generic ODF spreadsheet guess
    if (indexOfAscii(bytes, 'ppt/presentation.xml', 2048) !== -1 ||
        indexOfAscii(bytes, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2048) !== -1 ||
        indexOfAscii(bytes, 'Presentation.xml', 2048) !== -1) return 'pptx'
    return 'unknown'
  }

  return 'unknown'
}

/** Is a GIF animated (NETSCAPE2.0 application extension present)? */
export function isAnimatedGif(bytes) {
  if (detectSignature(bytes) !== 'gif') return false
  return indexOfAscii(bytes, 'NETSCAPE2.0') !== -1
}

/** Is a WebP animated? Requires the first ~32 bytes (chunk header + table). */
export function isAnimatedWebp(bytes) {
  if (detectSignature(bytes) !== 'webp' || bytes.length < WEBP_ANIM_BYTES) return false
  const slice = new Uint8Array(Math.min(WEBP_ANIM_BYTES, bytes.length))
  slice.set(bytes.subarray(0, slice.length))
  return webpIsAnimated(slice)
}

// ---------------------------------------------------------------------------
// Family classification
// ---------------------------------------------------------------------------

const SIGNATURE_FAMILY = {
  jpeg: 'image', png: 'image', webp: 'image', gif: 'image', bmp: 'image',
  ico: 'image', tiff: 'image', svg: 'image', heic: 'image', avif: 'image',
  rtf: 'doc',
  docx: 'doc',
  doc: 'doc',
  odt: 'doc',
  pdf: 'pdf',
  xlsx: 'sheet', xls: 'sheet', ods: 'sheet', csv: 'sheet', tsv: 'sheet',
  txt: 'text', md: 'text', html: 'text',
  pptx: 'slides', ppt: 'slides', odp: 'slides',
}

// Sync fallback used by the reducer between renders — family is confirmed
// asynchronously by validateFileContent() before a file ever reaches the queue.
const EXT_FAMILY = (ext) => {
  if (/\.(jpe?g|png|gif|webp|bmp|ico|tiff?|avif|heic|heif|svg)$/i.test(ext)) return 'image'
  if (/\.pdf$/i.test(ext)) return 'pdf'
  if (/\.docx$/i.test(ext)) return 'doc'
  if (/\.doc$/i.test(ext)) return 'doc'
  if (/\.odt$/i.test(ext)) return 'doc'
  if (/\.rtf$/i.test(ext)) return 'doc'
  if (/\.(xlsx|xls|ods|csv|tsv)$/i.test(ext)) return 'sheet'
  if (/\.(pptx|ppt|odp)$/i.test(ext)) return 'slides'
  if (/\.(txt|md|html)$/i.test(ext)) return 'text'
  if (/\.csv$/i.test(ext) || /\.tsv$/i.test(ext)) return 'sheet'
  return null
}

// Set of MIME types the dropzone will accept at the browser level.
export const ACCEPTED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif', 'image/svg+xml', 'image/bmp', 'image/avif',
  'image/tiff', 'image/x-icon', 'image/vnd.microsoft.icon',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.oasis.opendocument.text',
  'text/rtf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv', 'text/tab-separated-values', 'text/plain', 'text/markdown',
  'text/html',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]

/**
 * Sync family guess from reported type/extension — used only for pre-classification
 * and between renders. It is intentionally permissive: validation will confirm
 * content before a file is queued.
 */
export function guessFamily(file) {
  const t = file?.type ?? ''
  const name = file?.name ?? ''
  // Content-hinted, present before validation.
  if (t.startsWith('image/')) return 'image'
  if (t === 'application/pdf') return 'pdf'
  if (name.endsWith('.docx')) return 'doc'
  if (name.endsWith('.doc')) return 'doc'
  if (name.endsWith('.odt')) return 'doc'
  if (name.endsWith('.rtf')) return 'doc'
  if (t.includes('wordprocessingml') || /docx$/i.test(name)) return 'doc'
  if (t.includes('openxmlformats-officedocument.presentationml')) return 'slides'
  if (/\.pptx$/i.test(name) || /\.ppt$/i.test(name) || /\.odp$/i.test(name)) return 'slides'
  if (/\.ods$/i.test(name)) return 'sheet'
  if (t.includes('spreadsheetml') || t.includes('opendocument.spreadsheet') || /\.(xls|xlsx|csv|tsv)$/i.test(name)) return 'sheet'
  if (/\.csv$/i.test(name) || /\.tsv$/i.test(name)) return 'sheet'
  if (/text\/csv/i.test(t)) return 'sheet'
  if (/\.json$/i.test(name)) return 'text'
  const byText = /\.(txt|md|html)$/i.test(name) || (t.startsWith('text/') && t !== 'text/csv' && t !== 'text/tab-separated-values')
  if (byText) return 'text'
  return EXT_FAMILY(name)
}

/** Human-readable family label for queue rows. */
export function familyLabel(file) {
  const family = guessFamily(file)
  return family_map(family, file)
}

const family_map = (family, file) => {
  if (family === 'image' && file?.type) {
    if (/image\/jpeg/.test(file.type)) return 'JPEG'
    if (/image\/png/.test(file.type)) return 'PNG'
    if (/image\/webp/.test(file.type)) return 'WebP'
    if (/image\/gif/.test(file.type)) return 'GIF'
    if (/image\/svg/.test(file.type)) return 'SVG'
    if (/image\/bmp/.test(file.type)) return 'BMP'
    if (/image\/heic/.test(file.type) || /image\/heif/.test(file.type)) return 'HEIC'
    if (/image\/avif/.test(file.type)) return 'AVIF'
    if (/image\/tiff/.test(file.type)) return 'TIFF'
    if (/image\/x-icon|image\/vnd.microsoft.icon/.test(file.type)) {
      return 'ICO'
    }
  }
  return ({
    image: 'Image',
    pdf: 'PDF document',
    doc: 'Document',
    sheet: 'Spreadsheet',
    text: 'Document',
    slides: 'Presentation',
  }[family] ?? 'File')
}

/**
 * Async, content-checked validation.
 * Returns object on success (added signatures `animated` and `supportsAnimation`),
 * or an error string on failure — messages are user-facing.
 */
export async function validateFileContent(file, preRead) {
  if (!file || typeof file.size !== 'number') return 'Invalid file.'

  const family = guessFamily(file)
  const size = file.size
  const name = file.name
  const ext = (/\.[^/.\\]+$/.exec(name) || [])[0]?.toLowerCase() || ''

  // Per-family size enforcement (fails loud → clear message for the user).
  const cap = MAX_FILE_SIZE_BY_FAMILY[family]
  if (cap && size > cap) {
    const mb = (cap / (1024 * 1024))
    return `“${name}” is larger than ${Math.round(mb)} MB (the ${famLabel(family)} limit).`
  }

  // Formats with no in-browser engine are rejected up front with an actionable
  // message instead of being queued and failing later. Legacy .xls/.ods do have
  // an engine (SheetJS), so they continue through normal validation.
  const NO_ENGINE = {
    '.doc': 'Legacy .doc files cannot be parsed in your browser. Save as .docx first and try again.',
    '.odt': 'ODT text cannot be parsed in your browser. Save as .docx first and try again.',
    '.rtf': 'RTF cannot be parsed in your browser. Save as .docx first and try again.',
    '.ppt': 'Legacy .ppt files cannot be rendered in your browser. Save as .pptx first and try again.',
    '.odp': 'ODP presentations cannot be rendered in your browser. Save as .pptx first and try again.',
  }
  if (NO_ENGINE[ext]) return NO_ENGINE[ext]

  // Text-ish formats: verify decodability + low binary ratio; no magic bytes.
  if (family === 'text') {
    if (size > MAX_FILE_SIZE_BY_FAMILY.text) {
      return `“${name}” is larger than 5 MB.`
    }
    const head = preRead ?? await file.slice(0, SNIFF_BYTES).arrayBuffer()
    const bytes = new Uint8Array(head)
    let printable = 0
    for (const b of bytes) {
      if (b === 9 || b === 10 || b === 13 || (b >= 32 && b !== 127)) printable++
    }
    const ratio = bytes.length ? printable / bytes.length : 1
    if (ratio < 0.85) {
      return `“${name}” doesn't look like a text document.`
    }
    let sig = 'txt'
    if (/\.md$/i.test(name)) sig = 'md'
    else if (/\.csv$/i.test(name)) sig = 'csv'
    else if (/\.tsv$/i.test(name)) sig = 'tsv'
    else if (/\.html$/i.test(name)) sig = 'html'
    return { family: 'text', signature: sig, isAnimated: false }
  }

  // For spreadsheets we special-case CSV/TSV (no signature; trust extension + parser).
  // Read a wide window: ZIP-based Office files can place their type marker well
  // past the first few KB depending on how the writer ordered entries.
  const head = preRead ?? await file.slice(0, 16384).arrayBuffer()
  const bytes = new Uint8Array(head)
  let signature = detectSignature(bytes)

  if (signature === 'unknown' && /\.csv$/i.test(name)) signature = 'csv'
  if (signature === 'unknown' && /\.tsv$/i.test(name)) signature = 'tsv'
  if (signature === 'unknown' && (name.endsWith('.ods') || name.endsWith('.odp') || name.endsWith('.odt'))) {
    const more = new Uint8Array(Math.min(SNIFF_MORE, bytes.length + 4096))
    if (more.length <= bytes.length) more.set(bytes.subarray(0, more.length))
    if (indexOfAscii(more, 'mimetype', 2048) !== -1) {
      const ty = (() => {
        const td = new TextDecoder('utf8', { fatal: true })
        try { return td.decode(more.slice(0, 128)) } catch { return '' }
      })()
      if (ty.includes('spreadsheet')) signature = 'ods'
      else if (ty.includes('text')) signature = 'odt'
      else if (ty.includes('presentation')) signature = 'odp'
    }
  }

  // CSV/TSV are accepted by extension; parsing surfaces malformed content later.
  if (signature === 'unknown' && (name.endsWith('.ods') || name.endsWith('.odp') || name.endsWith('.odt'))) {
    return `“${name}” is not a recognized ${familyname(family)} file (or the file is corrupted).`
  }

  const expected = SIGNATURE_FAMILY[signature]
  if (!expected) {
    return `“${name}” is not a supported format (or the file is corrupted).`
  }
  if (expected !== family) {
    return `“${name}” has a “.${ext}” extension but its contents appear to be ${describeSignature(signature)}.`
  }

  const result = { family: expected, signature, isAnimated: false }

  // Animated WebP handles GIF via signature already.
  if (signature === 'webp') result.isAnimated = isAnimatedWebp(bytes)
  if (signature === 'gif') result.isAnimated = isAnimatedGif(bytes)
  return result
}

// Helpers for errors/text — kept tight so they can be inlined at call sites later.

function famLabel(family) {
  return ({
    image: 'image',
    pdf: 'PDF',
    doc: 'document',
    sheet: 'spreadsheet',
    text: 'text',
    slides: 'presentation',
  }[family] ?? 'file')
}

function familyname(family) {
  return ({
    image: 'image',
    pdf: 'PDF',
    doc: 'document',
    sheet: 'spreadsheet',
    text: 'text',
    slides: 'presentation',
  }[family] ?? 'file')
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
    case 'docx': return 'a Word document (.docx)'
    case 'doc': return 'a Word document (.doc)'
    case 'odt': return 'an OpenDocument text file (.odt)'
    case 'rtf': return 'a Rich Text file (.rtf)'
    case 'xlsx': return 'an Excel workbook (.xlsx)'
    case 'xls': return 'a legacy Excel workbook (.xls)'
    case 'ods': return 'an OpenDocument spreadsheet (.ods)'
    case 'csv': return 'a CSV file'
    case 'tsv': return 'a TSV file'
    case 'txt': return 'a text file'
    case 'md': return 'a Markdown file'
    case 'html': return 'an HTML file'
    case 'pptx': return 'a PowerPoint file (.pptx)'
    case 'ppt': return 'a legacy PowerPoint file (.ppt)'
    case 'odp': return 'an OpenDocument presentation (.odp)'
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
  if (!file || typeof file.size !== 'number') return 'Invalid file.'
  const name = file.name || ''
  if (file.size > MAX_FILE_SIZE) {
    return `“${name}” is larger than 25 MB.`
  }
  const okMime = ACCEPTED_MIME.includes(file.type)
  const hasTextExt = /\.(txt|md|csv|tsv|html|json)$/i.test(name)
  const okExt = /\.(jpe?g|png|webp|gif|svg|bmp|heic|heif|avif|ico|tiff?|pdf|docx|xlsx|ods|csv|tsv|txt|md|html|rtf|doc|pptx|ppt|odp|xls)$/i.test(name)
  if (!okMime && !okExt && !(hasTextExt && file.type.startsWith('text/'))) {
    return `“${name}” is not a supported format.`
  }
  return null
}

// Small, stable set of MIME types accepted at the dropzone level.
export const ACCEPTED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
]


