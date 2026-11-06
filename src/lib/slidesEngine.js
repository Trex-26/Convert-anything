/**
 * slidesEngine.js
 * PowerPoint conversion with pptx-browser, which renders real slide canvases
 * (text, shapes, images, backgrounds) rather than guessing at the XML.
 *
 *  PPTX -> JPG / PNG : one image per slide (ZIP when there is more than one)
 *  PPTX -> PDF       : every rendered slide becomes a PDF page
 *  PPTX -> PPTX      : byte-for-byte copy
 */
import { PDFDocument } from 'pdf-lib'
import { OUTPUT_FORMATS } from './registry.js'

function makeCanvas() {
  if (typeof document === 'undefined') {
    throw new Error('Rendering presentations requires a browser.')
  }
  return document.createElement('canvas')
}

async function canvasJpeg(canvas, quality = 0.92) {
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Slide rendering failed.'))), 'image/jpeg', quality),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

async function canvasPng(canvas) {
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Slide rendering failed.'))), 'image/png'),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

async function renderSlides(file, width = 1600) {
  const mod = await import('pptx-browser')
  const PptxRenderer = mod.PptxRenderer ?? mod.default
  const renderer = new PptxRenderer()
  try {
    await renderer.load(file)
    const count = renderer.slideCount ?? 0
    if (!count) throw new Error('This presentation contains no slides.')
    const slides = []
    for (let i = 0; i < count; i++) {
      const canvas = makeCanvas()
      await renderer.renderSlide(i, canvas, width)
      slides.push({ index: i, canvas, width: canvas.width, height: canvas.height })
    }
    return slides
  } catch (err) {
    throw new Error(err?.message ?? 'This presentation could not be rendered.', { cause: err })
  } finally {
    renderer.destroy?.()
  }
}

export async function convertPptx(input, format) {
  const warnings = []
  const stem = (input.name ?? 'presentation').replace(/\.[^.]+$/, '')

  if (format === 'pptx') {
    const blob = new Blob([await input.file.arrayBuffer()], { type: OUTPUT_FORMATS.pptx.mime })
    return { blob, warnings }
  }

  const slides = await renderSlides(input.file)

  if (format === 'jpg' || format === 'png') {
    if (slides.length === 1) {
      const bytes = format === 'jpg' ? await canvasJpeg(slides[0].canvas) : await canvasPng(slides[0].canvas)
      return { blob: new Blob([bytes], { type: OUTPUT_FORMATS[format].mime }), warnings }
    }
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    for (const slide of slides) {
      const bytes = format === 'jpg' ? await canvasJpeg(slide.canvas) : await canvasPng(slide.canvas)
      zip.file(`${stem}-slide-${slide.index + 1}.${format}`, bytes)
    }
    warnings.push(`${slides.length} slides exported as a ZIP of ${format.toUpperCase()} images.`)
    return { blob: await zip.generateAsync({ type: 'blob' }), warnings, zip: true }
  }

  if (format === 'pdf') {
    const doc = await PDFDocument.create()
    doc.setProducer('Convert-anything')
    doc.setCreator('Convert-anything')
    for (const slide of slides) {
      const jpeg = await canvasJpeg(slide.canvas, 0.94)
      const embedded = await doc.embedJpg(jpeg)
      // 1 rendered pixel ≈ 0.5pt keeps slide pages at a sane physical size.
      const page = doc.addPage([slide.width * 0.5, slide.height * 0.5])
      page.drawImage(embedded, { x: 0, y: 0, width: slide.width * 0.5, height: slide.height * 0.5 })
    }
    warnings.push('Each slide is rendered as a full-page image, so text is not selectable in the PDF.')
    return { blob: new Blob([await doc.save()], { type: OUTPUT_FORMATS.pdf.mime }), warnings }
  }

  throw new Error(`No presentation engine builds .${format}.`)
}
