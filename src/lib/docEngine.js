/**
 * docEngine.js
 * Document conversions that run entirely in the browser:
 *   DOCX -> PDF / HTML / TXT / MD
 *   TXT  -> PDF / DOCX / HTML / MD
 *   MD   -> HTML / PDF / DOCX / TXT
 *   HTML -> PDF / TXT / MD / DOCX
 *
 * Parsing is done with htmlparser2 so the same code path works in the browser
 * and in Node-based tests. DOCX reading uses mammoth; DOCX writing uses docx.
 */
import { parseDocument } from 'htmlparser2'
import { renderBlocks } from './pdfLayout.js'
import { OUTPUT_FORMATS } from './registry.js'

const HEADING_LEVELS = { 1: 'HEADING_1', 2: 'HEADING_2', 3: 'HEADING_3', 4: 'HEADING_4', 5: 'HEADING_5', 6: 'HEADING_6' }

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

// ---------------------------------------------------------------------------
// HTML -> blocks
// ---------------------------------------------------------------------------

function inlineRuns(nodes, style = {}) {
  const runs = []
  for (const node of nodes ?? []) {
    if (node.type === 'text') {
      runs.push({ text: decodeEntities(node.data), ...style })
      continue
    }
    if (node.type !== 'tag') continue

    const next = { ...style }
    if (node.name === 'b' || node.name === 'strong') next.bold = true
    if (node.name === 'i' || node.name === 'em') next.italic = true
    if (node.name === 'code' || node.name === 'tt' || node.name === 'kbd') next.mono = true
    if (node.name === 'a') next.link = node.attribs?.href

    if (node.name === 'br') {
      runs.push({ text: '\n', ...next })
      continue
    }
    runs.push(...inlineRuns(node.children, next))
  }
  // Merge adjacent runs that share styling so measuring stays cheap.
  const merged = []
  for (const run of runs) {
    const prev = merged[merged.length - 1]
    if (prev && prev.bold === run.bold && prev.italic === run.italic && prev.mono === run.mono) {
      prev.text += run.text
    } else {
      merged.push({ ...run })
    }
  }
  return merged
}

const runsText = (runs) => (runs ?? []).map((r) => r.text).join('')

function textBlocks(html) {
  const doc = parseDocument(html)
  const blocks = []

  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.type !== 'tag') continue
      const name = node.name

      if (/^h[1-6]$/.test(name)) {
        blocks.push({ type: 'heading', level: Number(name[1]), runs: inlineRuns(node.children) })
        continue
      }
      if (name === 'p') {
        const runs = inlineRuns(node.children)
        if (runsText(runs).trim()) blocks.push({ type: 'paragraph', runs })
        continue
      }
      if (name === 'ul' || name === 'ol') {
        const items = (node.children ?? [])
          .filter((c) => c.type === 'tag' && c.name === 'li')
          .map((li) => ({ runs: inlineRuns(li.children) }))
          .filter((item) => runsText(item.runs).trim())
        if (items.length) blocks.push({ type: 'list', ordered: name === 'ol', items })
        continue
      }
      if (name === 'table') {
        const rows = []
        const collectRows = (n) => {
          for (const child of n.children ?? []) {
            if (child.type !== 'tag') continue
            if (child.name === 'tr') {
              const cells = (child.children ?? [])
                .filter((c) => c.type === 'tag' && (c.name === 'td' || c.name === 'th'))
                .map((c) => runsText(inlineRuns(c.children)).replace(/\s+/g, ' ').trim())
              if (cells.length) rows.push(cells)
            } else {
              collectRows(child)
            }
          }
        }
        collectRows(node)
        if (rows.length) blocks.push({ type: 'table', rows })
        continue
      }
      if (name === 'pre') {
        for (const line of runsText(inlineRuns(node.children)).split('\n')) {
          blocks.push({ type: 'paragraph', runs: [{ text: line, mono: true }] })
        }
        continue
      }
      if (name === 'blockquote') {
        blocks.push({ type: 'paragraph', runs: inlineRuns(node.children).map((r) => ({ ...r, italic: true })) })
        continue
      }
      if (name === 'img') {
        const src = node.attribs?.src ?? ''
        if (src.startsWith('data:image/')) {
          const [meta, b64] = src.split(',')
          if (b64) {
            const binary = atob(b64)
            const data = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
            blocks.push({
              type: 'image',
              data,
              format: /png/i.test(meta) ? 'png' : 'jpg',
              alt: node.attribs?.alt ?? '',
            })
          }
        }
        continue
      }
      if (name === 'hr') {
        blocks.push({ type: 'spacer', height: 8 })
        continue
      }
      if (name === 'br') {
        blocks.push({ type: 'paragraph', runs: [{ text: '' }] })
        continue
      }
      // Containers: recurse into children.
      walk(node.children)
    }
  }

  walk(doc.children)
  return blocks
}

/** Blocks -> plain text (readable line breaks, no HTML). */
function blocksToText(blocks) {
  const out = []
  for (const b of blocks) {
    if (b.type === 'heading' || b.type === 'paragraph') out.push(runsText(b.runs))
    else if (b.type === 'list') b.items.forEach((item) => out.push(`- ${runsText(item.runs)}`))
    else if (b.type === 'table') b.rows.forEach((row) => out.push(row.join('\t')))
    else if (b.type === 'pagebreak') out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function htmlToText(html) {
  return blocksToText(textBlocks(html))
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

async function mammothModule() {
  const mod = await import('mammoth')
  return mod.default ?? mod
}

export async function docxToHtml(file) {
  const mammoth = await mammothModule()
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer, buffer: new Uint8Array(arrayBuffer) })
  return { html: result.value, warnings: (result.messages ?? []).map((m) => m.message) }
}

export async function docxToText(file) {
  const mammoth = await mammothModule()
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer, buffer: new Uint8Array(arrayBuffer) })
  return result.value
}

async function markdownModule() {
  const mod = await import('marked')
  return mod.marked ?? mod.default ?? mod
}

async function turndownModule() {
  const mod = await import('turndown')
  const Turndown = mod.default ?? mod
  return new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
}

function textFileToHtml(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .split(/\r?\n\s*\r?\n/)
    .map((para) => `<p>${para.replace(/\r?\n/g, '<br>')}</p>`)
    .join('\n')
}

function textToBlocks(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((paragraph) => ({
      type: 'paragraph',
      runs: paragraph.split('\n').flatMap((line, i) =>
        i === 0 ? [{ text: line }] : [{ text: '\n' }, { text: line }],
      ),
    }))
}

// ---------------------------------------------------------------------------
// DOCX writer
// ---------------------------------------------------------------------------

async function blocksToDocx(blocks) {
  const docx = await import('docx')
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } = docx
  const { HeadingLevel } = docx

  const runs = (list) =>
    (list ?? []).map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: Boolean(r.bold),
          italics: Boolean(r.italic),
          font: r.mono ? 'Courier New' : undefined,
        }),
    )

  const children = []
  for (const block of blocks) {
    if (block.type === 'heading') {
      children.push(
        new Paragraph({
          children: runs(block.runs),
          heading: HeadingLevel[HEADING_LEVELS[block.level] ?? 'HEADING_3'],
          spacing: { before: 240, after: 120 },
        }),
      )
    } else if (block.type === 'paragraph') {
      children.push(new Paragraph({ children: runs(block.runs), spacing: { after: 120 } }))
    } else if (block.type === 'list') {
      for (const item of block.items) {
        children.push(
          new Paragraph({
            children: runs(item.runs),
            bullet: block.ordered ? undefined : { level: 0 },
            numbering: block.ordered ? { reference: 'ordered', level: 0 } : undefined,
          }),
        )
      }
    } else if (block.type === 'table') {
      const rows = block.rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun(String(cell))] })] }),
            ),
          }),
      )
      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }))
      children.push(new Paragraph({}))
    }
  }

  if (!children.length) children.push(new Paragraph({ children: [new TextRun('')] }))

  const doc = new Document({ sections: [{ children }] })
  if (typeof Packer.toBlob === 'function') {
    const blob = await Packer.toBlob(doc)
    return new Blob([blob], { type: OUTPUT_FORMATS.docx.mime })
  }
  const buffer = await Packer.toBuffer(doc)
  return new Blob([buffer], { type: OUTPUT_FORMATS.docx.mime })
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * @param {{file: File|Blob, name: string, signature: string}} input
 * @param {string} format output format id
 * @param {{pageSize?: string, margin?: number}} [options]
 * @returns {Promise<{blob: Blob, warnings: string[]}>}
 */
export async function convertDocument(input, format, options = {}) {
  const { file, signature } = input
  const warnings = []

  const htmlFor = async () => {
    if (signature === 'docx') {
      const { html, warnings: w } = await docxToHtml(file)
      warnings.push(...w.slice(0, 3))
      return html
    }
    if (signature === 'md') {
      const text = await file.text()
      return (await markdownModule())(text, { async: false })
    }
    if (signature === 'html') return file.text()
    // txt
    return textFileToHtml(await file.text())
  }

  if (format === 'html') {
    const html = await htmlFor()
    const body = html.includes('<body') ? html : `<!doctype html>\n<html><head><meta charset="utf-8"></head><body>\n${html}\n</body></html>`
    return { blob: new Blob([body], { type: OUTPUT_FORMATS.html.mime }), warnings }
  }

  if (format === 'txt') {
    if (signature === 'docx') return { blob: new Blob([await docxToText(file)], { type: OUTPUT_FORMATS.txt.mime }), warnings }
    if (signature === 'md') {
      const text = (await markdownModule())(await file.text(), { async: false })
      return { blob: new Blob([htmlToText(text)], { type: OUTPUT_FORMATS.txt.mime }), warnings }
    }
    if (signature === 'html') return { blob: new Blob([htmlToText(await file.text())], { type: OUTPUT_FORMATS.txt.mime }), warnings }
    return { blob: new Blob([await file.text()], { type: OUTPUT_FORMATS.txt.mime }), warnings }
  }

  if (format === 'md') {
    if (signature === 'txt') return { blob: new Blob([await file.text()], { type: OUTPUT_FORMATS.md.mime }), warnings }
    const html = await htmlFor()
    const turndown = await turndownModule()
    return { blob: new Blob([turndown.turndown(html)], { type: OUTPUT_FORMATS.md.mime }), warnings }
  }

  if (format === 'docx') {
    const blocks = textBlocks(await htmlFor())
    return { blob: await blocksToDocx(blocks), warnings }
  }

  if (format === 'pdf') {
    const blocks = textBlocks(await htmlFor())
    const { bytes, unsupportedChars } = await renderBlocks(blocks, {
      pageSize: options.pageSize === 'A4' ? 'A4' : 'Letter',
      margin: 56,
    })
    if (unsupportedChars > 0) {
      warnings.push(`${unsupportedChars} character(s) outside the standard font were replaced with "?".`)
    }
    return { blob: new Blob([bytes], { type: OUTPUT_FORMATS.pdf.mime }), warnings }
  }

  throw new Error(`No document engine builds .${format} from a ${signature.toUpperCase()} file.`)
}

export { textBlocks, textToBlocks }
