/**
 * converters.js
 * Central conversion registry + dispatch engine. Every advertised conversion
 * has an implemented, locally running handler — no fake format pairs.
 * All processing runs 100% in the browser.
 */
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import { guessFamily } from './fileValidation.js'
import {
  mergePdfsBytes,
  splitPdf,
  rotatePdf,
  extractPdfPages,
  compressPdf,
} from './pdfOps.js'
import { convertDocument } from './docs.js'

// ---------------------------------------------------------------------------
// Format catalogue
// ---------------------------------------------------------------------------

/** All output formats the app can produce, keyed by id. */
export const OUTPUT_FORMATS = {
  pdf:  { id: 'pdf',  label: 'PDF',  ext: '.pdf',  mime: 'application/pdf',        category: 'document' },
  jpg:  { id: 'jpg',  label: 'JPG',  ext: '.jpg',  mime: 'image/jpeg',             category: 'image' },
  png:  { id: 'png',  label: 'PNG',  ext: '.png',  mime: 'image/png',              category: 'image' },
  webp: { id: 'webp', label: 'WebP', ext: '.webp', mime: 'image/webp',             category: 'image' },
  html: { id: 'html', label: 'HTML', ext: '.html', mime: 'text/html',              category: 'document' },
  txt:  { id: 'txt',  label: 'TXT',  ext: '.txt',  mime: 'text/plain',             category: 'document' },
  csv:  { id: 'csv',  label: 'CSV',  ext: '.csv',  mime: 'text/csv',               category: 'spreadsheet' },
  xlsx: { id: 'xlsx', label: 'XLSX', ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'spreadsheet' },
}

/**
 * Registry: for each input family (validated at ingestion), the output routes
 * that have a real, locally implemented handler.
 */
export const FAMILY_ROUTES = {
  image: { outputs: ['pdf', 'jpg', 'png', 'webp'] },
  pdf:   { outputs: ['pdf'] },
  doc:   { outputs: ['html', 'txt'] },
  sheet: { outputs: ['csv', 'html', 'txt', 'xlsx'] },
  text:  { outputs: ['pdf'] },
}

/**
 * Output conversions supported by EVERY file currently in the queue
 * (intersection). With an empty queue this is the image-family default.
 * Used to display only genuinely reachable formats in the global selector.
 */
export function commonFormatsForFiles(files) {
  if (!files || !files.length) {
    return FAMILY_ROUTES.image.outputs.map((id) => OUTPUT_FORMATS[id]).filter(Boolean)
  }
  const first = availableFormatsFor(files[0].file)
  return first.filter((fmt) =>
    files.every((f) => availableFormatsFor(f.file).some((x) => x.id === fmt.id)),
  )
}

/**
 * Given a File (or any object with type/name), return which output formats
 * have real, implemented conversion handlers for it.
 */
export function availableFormatsFor(file) {
  const family = guessFamily(file)
  const route = FAMILY_ROUTES[family]
  if (!route) return []
  return route.outputs.map((id) => OUTPUT_FORMATS[id]).filter(Boolean)
}

/** Human-readable family label for queue rows. */
export function familyLabel(file) {
  const family = guessFamily(file)
  return {
    image: 'Image',
    pdf: 'PDF document',
    doc: 'Word document',
    sheet: 'Spreadsheet',
    text: 'Text document',
  }[family] ?? 'File'
}

export const QUALITY_PRESETS = [
  { id: 'low',    label: 'Low',    jpegQ: 0.55 },
  { id: 'medium', label: 'Medium', jpegQ: 0.78 },
  { id: 'high',   label: 'High',   jpegQ: 0.92 },
]

/** Available PDF page operations for inputs of family 'pdf'. */
export const PDF_OPERATIONS = [
  { id: 'merge',    label: 'Merge into one PDF', multiOnly: false },
  { id: 'split',    label: 'Split — one PDF per page' },
  { id: 'rotate',   label: 'Rotate pages' },
  { id: 'extract',  label: 'Extract / reorder pages' },
  { id: 'compress', label: 'Compress (repackage, strip metadata)' },
]

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

/**
 * Render a File onto an Image and export as Blob.
 * Uses fallback between OffscreenCanvas and HTML5 Canvas.
 * @param {File} file
 * @param {'image/jpeg'|'image/png'|'image/webp'} mime
 * @param {number} quality 0–1
 * @returns {Promise<Blob>}
 */
export function imageToBlob(file, mime, quality = 0.92) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = async () => {
      URL.revokeObjectURL(url)
      const w = img.naturalWidth || img.width || 800
      const h = img.naturalHeight || img.height || 600

      try {
        if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas.prototype.convertToBlob) {
          const offscreen = new OffscreenCanvas(w, h)
          const ctx = offscreen.getContext('2d')
          if (mime === 'image/jpeg') {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, w, h)
          }
          ctx.drawImage(img, 0, 0, w, h)
          const blob = await offscreen.convertToBlob({ type: mime, quality })
          resolve(blob)
          return
        }

        // Standard DOM Canvas fallback
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (mime === 'image/jpeg') {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, w, h)
        }
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob)
            else reject(new Error('Canvas export failed.'))
          },
          mime,
          quality
        )
      } catch (err) {
        reject(err)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Could not decode "${file.name}".`))
    }

    img.src = url
  })
}

// ---------------------------------------------------------------------------
// Single-file converters
// ---------------------------------------------------------------------------

/**
 * Convert one image file to a single-page PDF Blob.
 * @param {File} file
 * @param {number} jpegQ  0–1 for JPEG quality when embedding
 * @param {object} [settings]  { pageSize, orientation, margin }
 * @param {AbortSignal} [signal]
 * @returns {Promise<Blob>}
 */
export async function imageToPdf(file, jpegQ = 0.92, settings = {}, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const doc = await PDFDocument.create()
  doc.setProducer('Convert-anything')
  doc.setCreator('Convert-anything')

  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name)

  let embedded
  if (isPng) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    try {
      embedded = await doc.embedPng(bytes)
    } catch {
      // If PNG embedding fails (e.g. malformed chunks or indexed color), fallback to JPEG
      const jpegBlob = await imageToBlob(file, 'image/jpeg', jpegQ)
      const jBytes = new Uint8Array(await jpegBlob.arrayBuffer())
      embedded = await doc.embedJpg(jBytes)
    }
  } else {
    // Canvas round-trip → JPEG for everything else (WebP, GIF, SVG, BMP, etc.)
    const jpegBlob = await imageToBlob(file, 'image/jpeg', jpegQ)
    const bytes = new Uint8Array(await jpegBlob.arrayBuffer())
    embedded = await doc.embedJpg(bytes)
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  let pageW = embedded.width
  let pageH = embedded.height
  let drawX = 0
  let drawY = 0
  let drawW = embedded.width
  let drawH = embedded.height

  if (settings.pageSize === 'A4') {
    const isLand = settings.orientation === 'landscape' || (settings.orientation === 'auto' && embedded.width > embedded.height)
    pageW = isLand ? 841.89 : 595.28
    pageH = isLand ? 595.28 : 841.89
    const margin = settings.margin === 'none' ? 0 : settings.margin === 'small' ? 14 : 24
    const availW = pageW - margin * 2
    const availH = pageH - margin * 2
    const scale = Math.min(availW / embedded.width, availH / embedded.height)
    drawW = embedded.width * scale
    drawH = embedded.height * scale
    drawX = (pageW - drawW) / 2
    drawY = (pageH - drawH) / 2
  } else if (settings.pageSize === 'Letter') {
    const isLand = settings.orientation === 'landscape' || (settings.orientation === 'auto' && embedded.width > embedded.height)
    pageW = isLand ? 792 : 612
    pageH = isLand ? 612 : 792
    const margin = settings.margin === 'none' ? 0 : settings.margin === 'small' ? 14 : 24
    const availW = pageW - margin * 2
    const availH = pageH - margin * 2
    const scale = Math.min(availW / embedded.width, availH / embedded.height)
    drawW = embedded.width * scale
    drawH = embedded.height * scale
    drawX = (pageW - drawW) / 2
    drawY = (pageH - drawH) / 2
  }

  const page = doc.addPage([pageW, pageH])
  page.drawImage(embedded, { x: drawX, y: drawY, width: drawW, height: drawH })

  const bytes = await doc.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

/**
 * Convert one image file to a raster format Blob.
 * @param {File} file
 * @param {'image/jpeg'|'image/png'|'image/webp'} targetMime
 * @param {number} quality 0–1
 * @param {AbortSignal} [signal]
 * @returns {Promise<Blob>}
 */
export async function imageToRaster(file, targetMime, quality, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return imageToBlob(file, targetMime, quality)
}

/**
 * Combine multiple images into a single multi-page PDF document.
 * @param {Array<{id, file, name}>} items
 * @param {number} jpegQ
 * @param {object} settings { pageSize, orientation, margin }
 * @param {AbortSignal} signal
 * @param {(current:number, total:number) => void} onProgress
 * @returns {Promise<Blob>}
 */
export async function buildMergedPdf(items, jpegQ = 0.92, settings = {}, signal, onProgress) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!items.length) throw new Error('No files to convert.')

  const doc = await PDFDocument.create()
  doc.setTitle('Convert-anything Export')
  doc.setProducer('Convert-anything')
  doc.setCreator('Convert-anything')

  const total = items.length

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const file = items[i].file
    const name = items[i].name || file.name || `image_${i + 1}`
    const isPng = file.type === 'image/png' || /\.png$/i.test(name)

    let embedded
    if (isPng) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      try {
        embedded = await doc.embedPng(bytes)
      } catch {
        const jpegBlob = await imageToBlob(file, 'image/jpeg', jpegQ)
        const jBytes = new Uint8Array(await jpegBlob.arrayBuffer())
        embedded = await doc.embedJpg(jBytes)
      }
    } else {
      const jpegBlob = await imageToBlob(file, 'image/jpeg', jpegQ)
      const bytes = new Uint8Array(await jpegBlob.arrayBuffer())
      embedded = await doc.embedJpg(bytes)
    }

    let pageW = embedded.width
    let pageH = embedded.height
    let drawX = 0
    let drawY = 0
    let drawW = embedded.width
    let drawH = embedded.height

    if (settings.pageSize === 'A4') {
      const isLand = settings.orientation === 'landscape' || (settings.orientation === 'auto' && embedded.width > embedded.height)
      pageW = isLand ? 841.89 : 595.28
      pageH = isLand ? 595.28 : 841.89
      const margin = settings.margin === 'none' ? 0 : settings.margin === 'small' ? 14 : 24
      const availW = pageW - margin * 2
      const availH = pageH - margin * 2
      const scale = Math.min(availW / embedded.width, availH / embedded.height)
      drawW = embedded.width * scale
      drawH = embedded.height * scale
      drawX = (pageW - drawW) / 2
      drawY = (pageH - drawH) / 2
    } else if (settings.pageSize === 'Letter') {
      const isLand = settings.orientation === 'landscape' || (settings.orientation === 'auto' && embedded.width > embedded.height)
      pageW = isLand ? 792 : 612
      pageH = isLand ? 612 : 792
      const margin = settings.margin === 'none' ? 0 : settings.margin === 'small' ? 14 : 24
      const availW = pageW - margin * 2
      const availH = pageH - margin * 2
      const scale = Math.min(availW / embedded.width, availH / embedded.height)
      drawW = embedded.width * scale
      drawH = embedded.height * scale
      drawX = (pageW - drawW) / 2
      drawY = (pageH - drawH) / 2
    }

    const page = doc.addPage([pageW, pageH])
    page.drawImage(embedded, { x: drawX, y: drawY, width: drawW, height: drawH })

    onProgress?.(i + 1, total)
  }

  const bytes = await doc.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

/**
 * Convert a single item based on its family and outputFormat.
 * Returns { blob, resultName? } — resultName overrides the download filename.
 */
export async function convertSingleItem(item, qualityId = 'high', settings = {}, signal) {
  const q = QUALITY_PRESETS.find((p) => p.id === qualityId) ?? QUALITY_PRESETS[2]
  const fmt = item.outputFormat
  const family = guessFamily(item.file)
  const stem = item.name.replace(/\.[^.]+$/, '')

  if (family === 'image') {
    if (fmt === 'pdf') return { blob: await imageToPdf(item.file, q.jpegQ, settings, signal), resultName: stem + '.pdf' }
    const mime = OUTPUT_FORMATS[fmt]?.mime ?? 'image/jpeg'
    return { blob: await imageToRaster(item.file, mime, q.jpegQ, signal), resultName: stem + (OUTPUT_FORMATS[fmt]?.ext ?? '.jpg') }
  }

  if (family === 'pdf') {
    return convertPdfItem(item, settings, signal)
  }

  // Documents, spreadsheets and text files.
  const out = await convertDocument({ family, file: item.file }, fmt, settings, signal)
  if (out.kind === 'binary') {
    return { blob: out.blob, resultName: stem + (OUTPUT_FORMATS[fmt]?.ext ?? '.bin') }
  }
  const blob = new Blob([out.text], { type: OUTPUT_FORMATS[fmt]?.mime ?? 'text/plain' })
  return { blob, resultName: stem + (OUTPUT_FORMATS[fmt]?.ext ?? '.txt') }
}

/**
 * Run the selected PDF page operation on one file.
 * `merge` is orchestrated at the batch level, not here.
 */
export async function convertPdfItem(item, settings = {}, signal) {
  const stem = item.name.replace(/\.[^.]+$/, '')
  const op = settings.pdfOp || 'merge'
  switch (op) {
    case 'merge': {
      // Single-file "merge" = repackage in place.
      const bytes = await mergePdfsBytes([item.file], signal)
      return { blob: new Blob([bytes], { type: 'application/pdf' }), resultName: `${stem}.pdf` }
    }
    case 'split': {
      const pageBlobs = await splitPdf(item.file, signal)
      if (pageBlobs.length === 1) {
        return { blob: pageBlobs[0], resultName: `${stem}.pdf` }
      }
      const zip = new JSZip()
      pageBlobs.forEach((part, i) => zip.file(`${stem}-page-${i + 1}.pdf`, part))
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      return { blob: zipBlob, resultName: `${stem}-pages.zip` }
    }
    case 'rotate': {
      const degrees = Number(settings.rotate ?? 90)
      return { blob: await rotatePdf(item.file, degrees, signal), resultName: `${stem}.pdf` }
    }
    case 'extract': {
      return { blob: await extractPdfPages(item.file, settings.pages || '1', signal), resultName: `${stem}.pdf` }
    }
    case 'compress': {
      return { blob: await compressPdf(item.file, signal), resultName: `${stem}.pdf` }
    }
    default:
      throw new Error('Unknown PDF operation.')
  }
}

// ---------------------------------------------------------------------------
// Batch conversion
// ---------------------------------------------------------------------------

/**
 * Convert a list of file records in sequence, calling callbacks for progress.
 * Supports flexible argument patterns for full backward compatibility.
 */
export async function convertAll(items, qualityId, settingsOrSignal, signalOrUpdate, maybeUpdate) {
  let settings = {}
  let signal
  let onItemUpdate

  if (settingsOrSignal && (settingsOrSignal instanceof AbortSignal || 'aborted' in settingsOrSignal)) {
    signal = settingsOrSignal
    onItemUpdate = signalOrUpdate
  } else {
    settings = settingsOrSignal || {}
    signal = signalOrUpdate
    onItemUpdate = maybeUpdate
  }

  const q = QUALITY_PRESETS.find((p) => p.id === qualityId) ?? QUALITY_PRESETS[2]

  for (const item of items) {
    if (signal?.aborted) {
      onItemUpdate?.(item.id, { status: 'cancelled' })
      continue
    }

    onItemUpdate?.(item.id, { status: 'converting', progress: 0 })

    try {
      const family = guessFamily(item.file)
      let blob
      let resultName

      if (family === 'image') {
        if (item.outputFormat === 'pdf') {
          blob = await imageToPdf(item.file, q.jpegQ, settings, signal)
        } else {
          const mime = OUTPUT_FORMATS[item.outputFormat]?.mime ?? 'image/jpeg'
          blob = await imageToRaster(item.file, mime, q.jpegQ, signal)
        }
      } else if (family === 'pdf') {
        if ((settings.pdfOp || 'merge') === 'merge' && items.length > 1) {
          throw new Error('Merge is applied to the whole batch above — convert PDFs individually with another operation, or turn Merge off.')
        }
        const out = await convertPdfItem(item, settings, signal)
        blob = out.blob
        resultName = out.resultName
      } else {
        const out = await convertDocument({ family, file: item.file }, item.outputFormat, settings, signal)
        if (out.kind === 'binary') {
          blob = out.blob
        } else {
          blob = new Blob([out.text], { type: OUTPUT_FORMATS[item.outputFormat]?.mime ?? 'text/plain' })
        }
      }

      if (signal?.aborted) {
        onItemUpdate?.(item.id, { status: 'cancelled' })
      } else {
        onItemUpdate?.(item.id, { status: 'done', progress: 100, resultBlob: blob, resultName: resultName ?? null })
      }
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        onItemUpdate?.(item.id, { status: 'cancelled' })
      } else {
        onItemUpdate?.(item.id, { status: 'error', error: err?.message ?? 'Conversion failed.' })
      }
    }
  }
}
