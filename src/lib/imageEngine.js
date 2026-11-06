/**
 * imageEngine.js
 * Real raster conversion for the browser. Every encoder here writes an actual
 * file of the target format — nothing is produced by renaming extensions.
 *
 * Supported outputs: JPG, PNG, WebP, GIF, BMP, TIFF, ICO, PDF.
 * AVIF is input-only: browsers can decode AVIF but cannot reliably encode it.
 */
import { PDFDocument } from 'pdf-lib'
import { detectSignature } from './fileValidation.js'

const MIME = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
}

function hasDom() {
  return typeof document !== 'undefined'
}

function createCanvas(width, height) {
  const canvas = hasDom()
    ? Object.assign(document.createElement('canvas'), { width, height })
    : new OffscreenCanvas(width, height)
  return canvas
}

function ctx2d(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser blocked canvas rendering, so the image cannot be converted.')
  return ctx
}

/** Flatten alpha onto a white background (formats without transparency). */
function drawFlattened(canvas, source, width, height) {
  const ctx = ctx2d(canvas)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
}

/** Draw preserving alpha (formats that support transparency). */
function drawAsIs(canvas, source, width, height) {
  const ctx = ctx2d(canvas)
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
}

async function canvasToBlob(canvas, mime, quality) {
  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: mime, quality })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`This browser cannot encode ${mime}.`))),
      mime,
      quality,
    )
  })
}

async function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      /* fall through to <img> */
    }
  }
  if (!hasDom()) throw new Error('Image decoding requires a browser.')
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('The image could not be decoded.'))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
}

/** Read SVG intrinsic size: explicit width/height, else the viewBox. */
function svgIntrinsicSize(text, fallbackW = 1024, fallbackH = 1024) {
  const width = /\bwidth\s*=\s*["']?([\d.]+)/i.exec(text)
  const height = /\bheight\s*=\s*["']?([\d.]+)/i.exec(text)
  const viewBox = /viewBox\s*=\s*["']([^"']+)/i.exec(text)
  let w = width ? parseFloat(width[1]) : 0
  let h = height ? parseFloat(height[1]) : 0
  if ((!w || !h) && viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4) {
      w = w || parts[2]
      h = h || parts[3]
    }
  }
  return { width: Math.max(1, Math.round(w || fallbackW)), height: Math.max(1, Math.round(h || fallbackH)) }
}

/**
 * Decode any supported image blob into a canvas.
 * Handles TIFF (UTIF), HEIC (heic2any) and reports whether alpha is present.
 */
export async function decodeImage(blob, signature) {
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer())
  const sig = signature ?? detectSignature(head)

  if (sig === 'tiff') {
    const buffer = new Uint8Array(await blob.arrayBuffer())
    const mod = await import('utif')
    const UTIF = mod.default ?? mod
    const ifds = UTIF.decode(buffer)
    UTIF.decodeImage(buffer, ifds[0])
    const rgba = UTIF.toRGBA8(ifds[0])
    const { width, height } = ifds[0]
    const canvas = createCanvas(width, height)
    ctx2d(canvas).putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
    return { canvas, width, height, hasAlpha: hasAlpha(rgba) }
  }

  if (sig === 'heic') {
    const mod = await import('heic2any')
    const heic2any = mod.default ?? mod
    const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.95 })
    blob = Array.isArray(out) ? out[0] : out
  }

  let source = await loadBitmap(blob)
  let width = source.width || source.naturalWidth
  let height = source.height || source.naturalHeight

  // SVG without explicit dimensions decodes to a tiny default; re-render at the
  // declared viewBox size so output resolution matches the artwork.
  if (sig === 'svg') {
    const text = await blob.text()
    const size = svgIntrinsicSize(text)
    if (size.width !== width || size.height !== height) {
      const scaled = createCanvas(size.width, size.height)
      drawAsIs(scaled, source, size.width, size.height)
      source = scaled
      width = size.width
      height = size.height
    }
  }

  const canvas = createCanvas(width, height)
  drawAsIs(canvas, source, width, height)
  const data = ctx2d(canvas).getImageData(0, 0, width, height).data
  return { canvas, width, height, hasAlpha: hasAlpha(data) }
}

function hasAlpha(rgba) {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Raw encoders (pure functions — unit-testable without a browser)
// ---------------------------------------------------------------------------

/** Encode RGBA pixels as a 24-bit BMP. BMP has no alpha: flatten onto white. */
export function encodeBmp(rgba, width, height) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4
  const pixelSize = rowSize * height
  const fileSize = 54 + pixelSize
  const out = new Uint8Array(fileSize)
  const view = new DataView(out.buffer)

  out[0] = 0x42 // 'B'
  out[1] = 0x4d // 'M'
  view.setUint32(2, fileSize, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true) // BITMAPINFOHEADER
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, pixelSize, true)
  view.setInt32(38, 2835, true)
  view.setInt32(42, 2835, true)

  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4
    const dstRow = 54 + y * rowSize
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4
      const a = rgba[s + 3] / 255
      const r = Math.round(rgba[s] * a + 255 * (1 - a))
      const g = Math.round(rgba[s + 1] * a + 255 * (1 - a))
      const b = Math.round(rgba[s + 2] * a + 255 * (1 - a))
      const d = dstRow + x * 3
      out[d] = b
      out[d + 1] = g
      out[d + 2] = r
    }
  }
  return out
}

/** Encode RGBA pixels as a single-frame GIF using a 256-colour palette. */
export async function encodeGif(rgba, width, height) {
  const mod = await import('gifenc')
  const { GIFEncoder, quantize, applyPalette } = mod.default ?? mod
  const palette = quantize(rgba, 256)
  const index = applyPalette(rgba, palette)
  const gif = GIFEncoder()
  gif.writeFrame(index, width, height, { palette })
  gif.finish()
  return gif.bytes()
}

/** Encode RGBA pixels as a lossless TIFF (UTIF). */
export async function encodeTiff(rgba, width, height) {
  const mod = await import('utif')
  const UTIF = mod.default ?? mod
  const encoded = UTIF.encodeImage(rgba, width, height)
  // UTIF returns an ArrayBuffer in Node and a typed array in browsers.
  if (encoded instanceof ArrayBuffer) return new Uint8Array(encoded)
  if (ArrayBuffer.isView(encoded)) {
    return new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength)
  }
  return Uint8Array.from(encoded)
}

/**
 * Encode RGBA pixels as an ICO. ICO caps each image at 256×256, so larger
 * artwork is downscaled (the caller is expected to have resized already).
 * The PNG payload form is valid for every modern consumer.
 */
export async function encodeIco(pngBytes, width, height) {
  const png = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes)
  const out = new Uint8Array(22 + png.length)
  const view = new DataView(out.buffer)
  view.setUint16(0, 0, true) // reserved
  view.setUint16(2, 1, true) // type: icon
  view.setUint16(4, 1, true) // image count
  out[6] = width >= 256 ? 0 : width // 0 means 256
  out[7] = height >= 256 ? 0 : height
  out[8] = 0 // palette
  out[9] = 0
  view.setUint16(10, 1, true) // colour planes
  view.setUint16(12, 32, true) // bits per pixel
  view.setUint32(14, png.length, true)
  view.setUint32(18, 22, true) // payload offset
  out.set(png, 22)
  return out
}

// ---------------------------------------------------------------------------
// Public conversion entry points
// ---------------------------------------------------------------------------

const LOSSLESS = new Set(['png', 'webp', 'gif', 'tiff', 'ico'])

/**
 * Convert an image blob to a raster format.
 * @param {Blob} blob
 * @param {string} format one of MIME ids above
 * @param {number} quality 0-1 for lossy formats
 * @param {{signature?: string, resize?: {width?: number, height?: number}}} [opts]
 * @returns {Promise<Blob>}
 */
export async function convertImage(blob, format, quality = 0.92, opts = {}) {
  if (!MIME[format]) throw new Error(`Image output "${format}" is not supported.`)
  const decoded = await decodeImage(blob, opts.signature)
  let { canvas, width, height } = decoded

  if (opts.resize && (opts.resize.width || opts.resize.height)) {
    const targetW = Math.max(1, Math.round(opts.resize.width || (width * opts.resize.height) / height))
    const targetH = Math.max(1, Math.round(opts.resize.height || (height * opts.resize.width) / width))
    const resized = createCanvas(targetW, targetH)
    ctx2d(resized).drawImage(canvas, 0, 0, targetW, targetH)
    canvas = resized
    width = targetW
    height = targetH
  }

  if (format === 'ico' && (width > 256 || height > 256)) {
    const scale = 256 / Math.max(width, height)
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const small = createCanvas(w, h)
    drawAsIs(small, canvas, w, h)
    canvas = small
    width = w
    height = h
  }

  const needsFlatten = format === 'jpg' || format === 'bmp'
  const work = needsFlatten ? createCanvas(width, height) : canvas
  if (needsFlatten) drawFlattened(work, canvas, width, height)

  let outBlob
  if (format === 'jpg' || format === 'png' || format === 'webp') {
    outBlob = await canvasToBlob(work, MIME[format], LOSSLESS.has(format) ? undefined : quality)
  } else {
    const data = ctx2d(work).getImageData(0, 0, width, height).data
    if (format === 'gif') {
      const bytes = await encodeGif(data, width, height)
      outBlob = new Blob([bytes], { type: MIME.gif })
    } else if (format === 'bmp') {
      outBlob = new Blob([encodeBmp(data, width, height)], { type: MIME.bmp })
    } else if (format === 'tiff') {
      outBlob = new Blob([await encodeTiff(data, width, height)], { type: MIME.tiff })
    } else if (format === 'ico') {
      const png = await canvasToBlob(canvas, 'image/png')
      outBlob = new Blob([await encodeIco(new Uint8Array(await png.arrayBuffer()), width, height)], {
        type: MIME.ico,
      })
    }
  }

  if (!outBlob || outBlob.size === 0) {
    throw new Error(`The ${format.toUpperCase()} encoder produced an empty file.`)
  }
  return outBlob
}

/** Place one image on a single PDF page (alpha preserved via PNG embedding). */
export async function imageToPdf(blob, { signature, pageSize = 'fit', orientation = 'portrait', margin = 'none' } = {}) {
  const decoded = await decodeImage(blob, signature)
  const { canvas, width, height, hasAlpha } = decoded
  const doc = await PDFDocument.create()
  doc.setProducer('Convert-anything')
  doc.setCreator('Convert-anything')

  // PNG keeps transparency, JPEG keeps files small for photos.
  const usePng = hasAlpha
  const payload = usePng
    ? await canvasToBlob(canvas, 'image/png')
    : await canvasToBlob(canvas, 'image/jpeg', 0.92)
  const bytes = new Uint8Array(await payload.arrayBuffer())
  const embedded = usePng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)

  let pageW = embedded.width
  let pageH = embedded.height
  let drawW = embedded.width
  let drawH = embedded.height
  let drawX = 0
  let drawY = 0

  const sizes = { A4: [595.28, 841.89], Letter: [612, 792] }
  if (sizes[pageSize]) {
    const landscape = orientation === 'landscape' || (orientation === 'auto' && width > height)
    const [portraitW, portraitH] = sizes[pageSize]
    pageW = landscape ? portraitH : portraitW
    pageH = landscape ? portraitW : portraitH
    const pad = margin === 'none' ? 0 : margin === 'small' ? 14 : 24
    const scale = Math.min((pageW - pad * 2) / embedded.width, (pageH - pad * 2) / embedded.height)
    drawW = embedded.width * scale
    drawH = embedded.height * scale
    drawX = (pageW - drawW) / 2
    drawY = (pageH - drawH) / 2
  }

  const page = doc.addPage([pageW, pageH])
  page.drawImage(embedded, { x: drawX, y: drawY, width: drawW, height: drawH })
  return new Blob([await doc.save()], { type: 'application/pdf' })
}
