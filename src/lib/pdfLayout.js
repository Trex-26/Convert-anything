/**
 * pdfLayout.js
 * Small, dependency-light document layout engine on top of pdf-lib.
 *
 * It renders a block list (headings, paragraphs with bold/italic runs, lists,
 * tables, images) into a real paginated PDF. Used by the document, markdown,
 * HTML, plain-text and spreadsheet converters so they all behave consistently.
 *
 * Limitation: standard PDF fonts cover WinAnsi, so characters outside that set
 * are transliterated to '?' rather than dropped silently — callers surface the
 * `unsupportedChars` count to the user.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PAGE_SIZES = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
}

const COLOR_TEXT = rgb(0.08, 0.1, 0.15)
const COLOR_MUTED = rgb(0.35, 0.4, 0.47)
const COLOR_RULE = rgb(0.85, 0.88, 0.91)

const HEADING_SIZES = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 11 }

/**
 * @param {Array} blocks
 * @param {{pageSize?: 'A4'|'Letter', margin?: number}} [options]
 * @returns {Promise<{bytes: Uint8Array, unsupportedChars: number}>}
 */
export async function renderBlocks(blocks, options = {}) {
  const [pageW, pageH] = PAGE_SIZES[options.pageSize] ?? PAGE_SIZES.Letter
  const margin = options.margin ?? 54
  const contentW = pageW - margin * 2

  const doc = await PDFDocument.create()
  doc.setProducer('Convert-anything')
  doc.setCreator('Convert-anything')

  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  }

  let unsupportedChars = 0

  const sanitize = (text, font) => {
    let out = ''
    for (const ch of String(text ?? '')) {
      try {
        font.encodeText(ch)
        out += ch
      } catch {
        // Common typographic characters the WinAnsi standard font lacks.
        const map = { '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...', '\u00a0': ' ', '\u2022': '-' }
        if (map[ch] !== undefined) {
          out += map[ch]
        } else {
          out += '?'
          unsupportedChars++
        }
      }
    }
    return out
  }

  const pickFont = (run) => {
    const bold = Boolean(run?.bold)
    const italic = Boolean(run?.italic)
    if (run?.mono) return fonts.mono
    if (bold && italic) return fonts.boldItalic
    if (bold) return fonts.bold
    if (italic) return fonts.italic
    return fonts.regular
  }

  let page = null
  let cursorY = 0

  const newPage = () => {
    page = doc.addPage([pageW, pageH])
    cursorY = pageH - margin
  }
  const ensureSpace = (needed) => {
    if (!page || cursorY - needed < margin) newPage()
  }

  const measure = (text, font, size) => font.widthOfTextAtSize(text, size)

  /** Draw runs of text with wrapping. Returns the height consumed. */
  const drawRuns = (runs, { size = 11, lineHeight = 1.45, indent = 0, color = COLOR_TEXT } = {}) => {
    const maxW = contentW - indent
    const lead = size * lineHeight
    const words = []
    for (const run of runs) {
      const font = pickFont(run)
      const text = sanitize(run.text, font)
      // Keep whitespace so inline formatting does not glue words together.
      for (const token of text.split(/(\s+)/)) {
        if (token) words.push({ text: token, font, run })
      }
    }

    let line = []
    let lineW = 0
    const flush = () => {
      ensureSpace(lead)
      let x = margin + indent
      for (const piece of line) {
        if (piece.text.trim()) {
          page.drawText(piece.text, { x, y: cursorY - size, size, font: piece.font, color })
        }
        x += measure(piece.text, piece.font, size)
      }
      cursorY -= lead
      line = []
      lineW = 0
    }

    for (const word of words) {
      const w = measure(word.text, word.font, size)
      if (lineW + w > maxW && line.length) flush()
      // Hard-split tokens wider than the page.
      if (w > maxW) {
        let chunk = ''
        for (const ch of word.text) {
          if (measure(chunk + ch, word.font, size) > maxW && chunk) {
            line.push({ text: chunk, font: word.font })
            flush()
            chunk = ''
          }
          chunk += ch
        }
        if (chunk) {
          line.push({ text: chunk, font: word.font })
          lineW += measure(chunk, word.font, size)
        }
        continue
      }
      line.push(word)
      lineW += w
    }
    if (line.length) flush()
  }

  const drawTable = (rows) => {
    if (!rows?.length) return
    const cols = Math.max(...rows.map((r) => r.length))
    const size = 9
    const pad = 4
    const colW = contentW / cols
    const font = fonts.regular
    const bold = fonts.bold

    const cellLines = (cell, f) => {
      const text = sanitize(cell ?? '', f)
      if (!text) return ['']
      const out = []
      let cur = ''
      for (const word of text.split(/(\s+)/)) {
        if (measure(cur + word, f, size) > colW - pad * 2 && cur.trim()) {
          out.push(cur.trim())
          cur = word.trimStart()
        } else {
          cur += word
        }
      }
      if (cur.trim()) out.push(cur)
      return out.slice(0, 12) // cap runaway cells
    }

    rows.forEach((row, rowIndex) => {
      const isHeader = rowIndex === 0
      const f = isHeader ? bold : font
      const lines = []
      for (let c = 0; c < cols; c++) lines.push(cellLines(row[c], f))
      const rowH = Math.max(...lines.map((l) => l.length)) * (size * 1.35) + pad * 2

      if (cursorY - rowH < margin) newPage()

      const top = cursorY
      for (let c = 0; c < cols; c++) {
        const x = margin + c * colW
        page.drawRectangle({
          x,
          y: top - rowH,
          width: colW,
          height: rowH,
          borderColor: COLOR_RULE,
          borderWidth: 0.6,
          color: isHeader ? rgb(0.96, 0.97, 0.98) : undefined,
        })
        lines[c].forEach((textLine, i) => {
          page.drawText(textLine, {
            x: x + pad,
            y: top - pad - size - i * size * 1.35,
            size,
            font: f,
            color: COLOR_TEXT,
          })
        })
      }
      cursorY -= rowH
    })
    cursorY -= 8
  }

  for (const block of blocks ?? []) {
    switch (block.type) {
      case 'heading': {
        const size = HEADING_SIZES[block.level] ?? 12
        ensureSpace(size * 2.2)
        cursorY -= 6
        drawRuns(block.runs ?? [{ text: block.text ?? '' }], { size, lineHeight: 1.3 })
        cursorY -= 4
        break
      }
      case 'paragraph': {
        drawRuns(block.runs ?? [{ text: block.text ?? '' }])
        cursorY -= 6
        break
      }
      case 'list': {
        (block.items ?? []).forEach((item, i) => {
          const marker = block.ordered ? `${i + 1}.` : '\u2022'
          const runs = item.runs ?? [{ text: item.text ?? '' }]
          ensureSpace(14)
          page.drawText(marker, {
            x: margin,
            y: cursorY - 11,
            size: 11,
            font: fonts.regular,
            color: COLOR_MUTED,
          })
          drawRuns(runs, { indent: 18 })
        })
        cursorY -= 4
        break
      }
      case 'table':
        drawTable(block.rows)
        break
      case 'image': {
        try {
          const embedded =
            block.format === 'jpg' ? await doc.embedJpg(block.data) : await doc.embedPng(block.data)
          const scale = Math.min(1, contentW / embedded.width)
          const w = embedded.width * scale
          const h = embedded.height * scale
          ensureSpace(h)
          page.drawImage(embedded, { x: margin, y: cursorY - h, width: w, height: h })
          cursorY -= h + 8
        } catch {
          // A broken inline image must not abort the whole document.
        }
        break
      }
      case 'pagebreak':
        newPage()
        break
      case 'spacer':
        cursorY -= block.height ?? 10
        break
      default:
        if (block.text) drawRuns([{ text: block.text }])
    }
  }

  if (!page) newPage()

  return { bytes: await doc.save(), unsupportedChars }
}
