// pdfOps.js
// Client-side PDF page operations built on pdf-lib.
// Everything runs locally; the only inputs are the user's own file bytes.
// All core functions return PDF bytes as Uint8Array; the browser wrappers
// below convert them to Blobs with the correct MIME type.

import { PDFDocument } from 'pdf-lib'

const PDF_MIME = 'application/pdf'

function friendly(err) {
  const msg = String(err?.message ?? err ?? '')
  if (err?.name === 'AbortError' || err?.message === 'Aborted') throw err
  if (/encrypt|password/i.test(msg)) {
    return new Error('This PDF is password-protected. Remove the password in your PDF app first, then try again.')
  }
  if (/invalid|corrupt|parse/i.test(msg)) {
    return new Error('This PDF appears to be malformed or corrupted.')
  }
  return new Error(`PDF operation failed: ${msg.slice(0, 140)}`)
}

async function loadPdf(source, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const bytes = source instanceof Uint8Array
    ? source
    : new Uint8Array(await source.arrayBuffer())
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  if (doc.isEncrypted) {
    throw new Error('This PDF is password-protected. Remove the password in your PDF app first, then try again.')
  }
  return doc
}

function finish(doc) {
  return doc.save({ useObjectStreams: true })
}

// ---------------------------------------------------------------------------
// Page specification parser — "1,3,5-7" → ordered 0-based indices.
// Used for both page extraction and page reordering (order is preserved).
// ---------------------------------------------------------------------------

export function parsePageSpec(spec, pageCount) {
  const text = String(spec ?? '').trim()
  if (!text) throw new Error('Enter the pages to keep, e.g. "1", "1,3,5-7".')
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) throw new Error('Enter the pages to keep, e.g. "1", "1,3,5-7".')
  const out = []
  const seen = new Set()
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!m) throw new Error(`“${part}” is not a valid page or range.`)
    let a = parseInt(m[1], 10)
    let b = m[2] !== undefined ? parseInt(m[2], 10) : a
    if (a < 1 || b < 1) throw new Error('Page numbers start at 1.')
    if (a > pageCount || b > pageCount) {
      throw new Error(`This document has ${pageCount} page${pageCount !== 1 ? 's' : ''}; page ${Math.max(a, b)} is out of range.`)
    }
    if (b < a) [a, b] = [b, a]
    for (let i = a; i <= b; i++) {
      const idx = i - 1
      if (seen.has(idx)) continue
      seen.add(idx)
      out.push(idx)
    }
  }
  if (!out.length) throw new Error('No pages selected.')
  return out
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Merge multiple PDFs into one document, in the given order. */
export async function mergePdfsBytes(sources, signal) {
  try {
    if (!sources?.length) throw new Error('Select at least one PDF to merge.')
    const out = await PDFDocument.create()
    out.setProducer('Convert-anything')
    out.setCreator('Convert-anything')
    for (const src of sources) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const donor = await loadPdf(src, signal)
      const pages = await out.copyPages(donor, donor.getPageIndices())
      pages.forEach((p) => out.addPage(p))
    }
    return await finish(out)
  } catch (err) {
    throw friendly(err)
  }
}

/** Split a PDF into one single-page PDF per page. */
export async function splitPdfBytes(source, signal) {
  try {
    const donor = await loadPdf(source, signal)
    const n = donor.getPageCount()
    if (n < 1) throw new Error('This document has no pages.')
    const out = []
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const doc = await PDFDocument.create()
      doc.setProducer('Convert-anything')
      const [page] = await doc.copyPages(donor, [i])
      doc.addPage(page)
      out.push(await finish(doc))
    }
    return out
  } catch (err) {
    throw friendly(err)
  }
}

/** Rotate every page of a PDF. degrees must be a multiple of 90. */
export async function rotatePdfBytes(source, degrees, signal) {
  try {
    const angle = Number(degrees)
    if (![90, 180, 270, -90, -180, -270].includes(angle)) {
      throw new Error('Rotation must be 90, 180 or 270 degrees.')
    }
    const doc = await loadPdf(source, signal)
    for (const page of doc.getPages()) {
      const current = page.getRotation().angle
      const next = ((current + angle) % 360 + 360) % 360
      // pdf-lib validates the { type, angle } shape — type must be 'degrees'.
      page.setRotation({ type: 'degrees', angle: next })
    }
    return await finish(doc)
  } catch (err) {
    throw friendly(err)
  }
}

/** Extract (or effectively reorder) pages of a PDF according to a spec string. */
export async function extractPdfPagesBytes(source, pageSpec, signal) {
  try {
    const donor = await loadPdf(source, signal)
    const indices = parsePageSpec(pageSpec, donor.getPageCount())
    const out = await PDFDocument.create()
    out.setProducer('Convert-anything')
    out.setCreator('Convert-anything')
    const pages = await out.copyPages(donor, indices)
    pages.forEach((p) => out.addPage(p))
    return await finish(out)
  } catch (err) {
    throw friendly(err)
  }
}

/**
 * Repackage a PDF with cross-reference + content object streams and strip
 * metadata. Honest note: pdf-lib cannot recompress existing image streams,
 * so gains are typically modest (structure + metadata only).
 */
export async function compressPdfBytes(source, signal) {
  try {
    const doc = await loadPdf(source, signal)
    doc.setTitle('')
    doc.setSubject('')
    doc.setKeywords([])
    doc.setAuthor('')
    doc.setProducer('Convert-anything')
    doc.setCreator('Convert-anything')
    return await finish(doc)
  } catch (err) {
    throw friendly(err)
  }
}

// ---------------------------------------------------------------------------
// Browser wrappers (Blob output, correct MIME)
// ---------------------------------------------------------------------------

const toBlob = (bytes) => new Blob([bytes], { type: PDF_MIME })

export async function mergePdfs(sources, signal) {
  return toBlob(await mergePdfsBytes(sources, signal))
}

export async function splitPdf(source, signal) {
  const parts = await splitPdfBytes(source, signal)
  return parts.map(toBlob)
}

export async function rotatePdf(source, degrees, signal) {
  return toBlob(await rotatePdfBytes(source, degrees, signal))
}

export async function extractPdfPages(source, pageSpec, signal) {
  return toBlob(await extractPdfPagesBytes(source, pageSpec, signal))
}

export async function compressPdf(source, signal) {
  return toBlob(await compressPdfBytes(source, signal))
}
