/**
 * converters.js — conversion dispatcher.
 *
 * One entry point (`convertSingleItem`) resolves the file's *detected
 * signature*, looks up the route in the registry, and hands the work to the
 * matching engine. Unsupported pairs fail loudly; nothing is produced by
 * renaming an extension.
 */
import { ROUTES, OUTPUT_FORMATS, LIMITATIONS, UNSUPPORTED_INPUTS, outputsFor } from './registry.js'
import { detectSignature, guessFamily } from './fileValidation.js'
import { convertImage, imageToPdf } from './imageEngine.js'
import { convertPdf, repackagePdf } from './pdfEngine.js'
import { convertDocument } from './docEngine.js'
import { convertSheet } from './sheetEngine.js'
import { convertPptx } from './slidesEngine.js'

export { OUTPUT_FORMATS, LIMITATIONS }

/** Quality presets for raster-ish outputs. */
export const QUALITY_PRESETS = {
  high: { id: 'high', jpeg: 0.92, pdfScale: 2, label: 'High quality' },
  balanced: { id: 'balanced', jpeg: 0.8, pdfScale: 1.5, label: 'Balanced' },
  small: { id: 'small', jpeg: 0.65, pdfScale: 1, label: 'Smaller file' },
}

// Family values come from fileValidation.guessFamily ('doc' covers DOCX/TXT/MD/HTML).
const FAMILY_SIGNATURE = {
  image: 'png',
  pdf: 'pdf',
  doc: 'docx',
  sheet: 'xlsx',
  text: 'txt',
  slides: 'pptx',
}

export function familyLabel(record) {
  const signature = record?.signature
  if (signature && ROUTES[signature]) return ROUTES[signature].label
  const family = record?.family ?? guessFamily(record?.file ?? record)
  if (family === 'doc') return 'Document'
  return family ? family.charAt(0).toUpperCase() + family.slice(1) : 'File'
}

/** Resolve a signature from bytes when the record does not already carry one. */
export async function signatureOf(record) {
  if (record?.signature) return record.signature
  const file = record?.file ?? record
  if (!file?.slice) return null
  // ZIP-based Office files keep their type marker further in, so read a window.
  const head = new Uint8Array(await file.slice(0, 16384).arrayBuffer())
  return detectSignature(head)
}

/** Outputs advertised for this specific file (registry-driven). */
export function availableFormatsFor(record) {
  if (record?.signature && ROUTES[record.signature]) return outputsFor(record.signature)
  const family = record?.family ?? guessFamily(record?.file ?? record)
  const signature = FAMILY_SIGNATURE[family]
  return signature ? outputsFor(signature) : []
}

/** Outputs every file in the set supports (single-file UI still uses this shape). */
export function commonFormatsForFiles(files = []) {
  if (!files.length) return []
  const lists = files.map((record) => availableFormatsFor(record).map((f) => f.id))
  if (!lists.length || lists.some((l) => l.length === 0)) return []
  const shared = lists[0].filter((id) => lists.every((l) => l.includes(id)))
  return shared.map((id) => OUTPUT_FORMATS[id]).filter(Boolean)
}

/** Human-readable warnings for the chosen pair (never silent data loss). */
export function warningsFor(signature, format) {
  const category = ROUTES[signature]?.category
  const out = []
  const imageKey = `image:${format}`
  if (category === 'image' && LIMITATIONS[imageKey]) out.push(LIMITATIONS[imageKey])
  if (category === 'pdf' && LIMITATIONS[`pdf:${format}`]) out.push(LIMITATIONS[`pdf:${format}`])
  if (category === 'document' && LIMITATIONS[`document:${format}`]) out.push(LIMITATIONS[`document:${format}`])
  if (format === 'csv' || format === 'tsv' || format === 'json') {
    if (LIMITATIONS[`sheet:${format}`]) out.push(LIMITATIONS[`sheet:${format}`])
  }
  if (format === 'pdf' && category === 'spreadsheet' && LIMITATIONS['sheet:pdf']) {
    out.push(LIMITATIONS['sheet:pdf'])
  }
  if (category === 'image' && format === 'jpg' && !out.length) out.push(LIMITATIONS['image:jpg'])
  return out
}

const MIME_OVERRIDES = {
  jpg: 'image/jpeg',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
}

/**
 * Convert a single queue item.
 * @param {object} item `{ id, file, name, signature?, family?, outputFormat }`
 * @param {string} qualityId key of QUALITY_PRESETS
 * @param {object} settings extra engine settings
 * @param {AbortSignal} [signal]
 * @returns {Promise<{blob: Blob, name: string, warnings: string[]}>}
 */
export async function convertSingleItem(item, qualityId = 'high', settings = {}, signal) {
  const signature = await signatureOf(item)
  if (signal?.aborted) throw new Error('Conversion cancelled.')

  const route = ROUTES[signature]
  if (!route) {
    throw new Error(
      UNSUPPORTED_INPUTS[signature] ??
        'This file type is not supported. Supported inputs are images, PDF, DOCX, TXT, MD, HTML, spreadsheets and PPTX.',
    )
  }

  const format = item.outputFormat
  if (!route.outputs.includes(format)) {
    throw new Error(`${route.label} files cannot be converted to ${String(format).toUpperCase()}.`)
  }

  const preset = QUALITY_PRESETS[qualityId] ?? QUALITY_PRESETS.high
  const settingsNext = { ...settings, pageSize: settings.pageSize ?? 'Letter' }
  const stem = (item.name ?? 'converted').replace(/\.[^.]+$/, '')
  const ext = OUTPUT_FORMATS[format]?.ext ?? `.${format}`
  const input = { file: item.file, name: item.name, signature }

  let result
  switch (route.category) {
    case 'image':
      if (format === 'pdf') {
        result = {
          blob: await imageToPdf(item.file, {
            signature,
            pageSize: 'fit',
            orientation: 'portrait',
          }),
          warnings: [],
        }
      } else {
        result = {
          blob: await convertImage(item.file, format, preset.jpeg, { signature }),
          warnings: warningsFor(signature, format),
        }
      }
      break
    case 'pdf':
      result =
        format === 'pdf'
          ? await repackagePdf(input)
          : await convertPdf(input, format, { scale: preset.pdfScale, quality: preset.jpeg, pageSize: settingsNext.pageSize })
      break
    case 'document':
      result = await convertDocument(input, format, settingsNext)
      break
    case 'spreadsheet':
      result = await convertSheet(input, format, settingsNext)
      break
    case 'presentation':
      result = await convertPptx(input, format)
      break
    default:
      throw new Error(`No engine is registered for ${route.label}.`)
  }

  if (!result?.blob || result.blob.size === 0) {
    throw new Error(`The ${format.toUpperCase()} output was empty, so it was not saved.`)
  }
  if (signal?.aborted) throw new Error('Conversion cancelled.')

  const isZip = result.zip || format === 'tiff' && false
  const name = isZip ? `${stem}.zip` : `${stem}${ext}`
  const blob = result.blob.type ? result.blob : new Blob([result.blob], { type: MIME_OVERRIDES[format] ?? 'application/octet-stream' })

  return {
    blob,
    name,
    warnings: [...new Set([...warningsFor(signature, format), ...(result.warnings ?? [])])],
  }
}
