/**
 * registry.js — the single source of truth for conversion support.
 *
 * Every route listed here has a real, locally executed handler in the browser
 * engines (imageEngine / pdfEngine / docEngine / sheetEngine / slidesEngine).
 * Formats without a reliable in-browser engine are detected and explained as
 * inputs, but never advertise an output that cannot be produced.
 */

/** Output format catalogue (id → label, extension, MIME, category). */
export const OUTPUT_FORMATS = {
  pdf: { id: 'pdf', label: 'PDF', ext: '.pdf', mime: 'application/pdf', category: 'document' },
  jpg: { id: 'jpg', label: 'JPG', ext: '.jpg', mime: 'image/jpeg', category: 'image' },
  png: { id: 'png', label: 'PNG', ext: '.png', mime: 'image/png', category: 'image' },
  webp: { id: 'webp', label: 'WebP', ext: '.webp', mime: 'image/webp', category: 'image' },
  gif: { id: 'gif', label: 'GIF', ext: '.gif', mime: 'image/gif', category: 'image' },
  bmp: { id: 'bmp', label: 'BMP', ext: '.bmp', mime: 'image/bmp', category: 'image' },
  tiff: { id: 'tiff', label: 'TIFF', ext: '.tiff', mime: 'image/tiff', category: 'image' },
  ico: { id: 'ico', label: 'ICO', ext: '.ico', mime: 'image/x-icon', category: 'image' },

  txt: { id: 'txt', label: 'TXT', ext: '.txt', mime: 'text/plain', category: 'document' },
  html: { id: 'html', label: 'HTML', ext: '.html', mime: 'text/html', category: 'document' },
  md: { id: 'md', label: 'Markdown', ext: '.md', mime: 'text/markdown', category: 'document' },
  docx: {
    id: 'docx',
    label: 'DOCX',
    ext: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    category: 'document',
  },

  csv: { id: 'csv', label: 'CSV', ext: '.csv', mime: 'text/csv', category: 'spreadsheet' },
  tsv: { id: 'tsv', label: 'TSV', ext: '.tsv', mime: 'text/tab-separated-values', category: 'spreadsheet' },
  json: { id: 'json', label: 'JSON', ext: '.json', mime: 'application/json', category: 'spreadsheet' },
  xlsx: {
    id: 'xlsx',
    label: 'XLSX',
    ext: '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    category: 'spreadsheet',
  },
  xls: { id: 'xls', label: 'XLS', ext: '.xls', mime: 'application/vnd.ms-excel', category: 'spreadsheet' },
  ods: {
    id: 'ods',
    label: 'ODS',
    ext: '.ods',
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    category: 'spreadsheet',
  },

  pptx: {
    id: 'pptx',
    label: 'PPTX',
    ext: '.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    category: 'presentation',
  },
}

/**
 * Detected signature → supported outputs.
 * `outputs` is ordered; the first entry is the default selection.
 */
export const ROUTES = {
  // ---- Image -------------------------------------------------------------
  jpeg: { label: 'JPG', category: 'image', engine: 'Canvas', outputs: ['png', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'pdf'] },
  png: { label: 'PNG', category: 'image', engine: 'Canvas', outputs: ['jpg', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'pdf'] },
  webp: { label: 'WebP', category: 'image', engine: 'Canvas', outputs: ['jpg', 'png', 'gif', 'bmp', 'tiff', 'ico', 'pdf'] },
  gif: { label: 'GIF', category: 'image', engine: 'Canvas + gifenc', outputs: ['jpg', 'png', 'webp', 'bmp', 'tiff', 'pdf'] },
  bmp: { label: 'BMP', category: 'image', engine: 'Canvas', outputs: ['jpg', 'png', 'webp', 'gif', 'tiff', 'pdf'] },
  tiff: { label: 'TIFF', category: 'image', engine: 'UTIF + Canvas', outputs: ['jpg', 'png', 'webp', 'bmp', 'pdf'] },
  svg: { label: 'SVG', category: 'image', engine: 'Browser SVG rasteriser', outputs: ['png', 'jpg', 'webp', 'pdf'] },
  ico: { label: 'ICO', category: 'image', engine: 'Browser ICO decode', outputs: ['png', 'jpg', 'webp'] },
  heic: { label: 'HEIC', category: 'image', engine: 'heic2any + Canvas', outputs: ['jpg', 'png', 'webp', 'tiff'] },
  avif: { label: 'AVIF', category: 'image', engine: 'Browser AVIF decode', outputs: ['jpg', 'png', 'webp', 'gif'] },

  // ---- PDF ---------------------------------------------------------------
  pdf: {
    label: 'PDF',
    category: 'pdf',
    engine: 'pdf.js + pdf-lib + docx/SheetJS/pptxgenjs',
    outputs: ['jpg', 'png', 'webp', 'tiff', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'pdf'],
  },

  // ---- Documents ---------------------------------------------------------
  docx: { label: 'DOCX', category: 'document', engine: 'mammoth + layout engine', outputs: ['pdf', 'html', 'txt', 'md'] },
  txt: { label: 'TXT', category: 'document', engine: 'Layout engine + docx', outputs: ['pdf', 'docx', 'html', 'md'] },
  md: { label: 'Markdown', category: 'document', engine: 'marked + layout engine', outputs: ['html', 'pdf', 'docx', 'txt'] },
  html: { label: 'HTML', category: 'document', engine: 'Turndown + layout engine', outputs: ['pdf', 'txt', 'md', 'docx'] },

  // ---- Spreadsheets ------------------------------------------------------
  xlsx: { label: 'XLSX', category: 'spreadsheet', engine: 'SheetJS', outputs: ['xls', 'ods', 'csv', 'tsv', 'json', 'html', 'pdf'] },
  xls: { label: 'XLS', category: 'spreadsheet', engine: 'SheetJS', outputs: ['xlsx', 'ods', 'csv', 'tsv', 'json', 'html', 'pdf'] },
  ods: { label: 'ODS', category: 'spreadsheet', engine: 'SheetJS', outputs: ['xlsx', 'xls', 'csv', 'tsv', 'json', 'html', 'pdf'] },
  csv: { label: 'CSV', category: 'spreadsheet', engine: 'SheetJS', outputs: ['xlsx', 'xls', 'ods', 'tsv', 'json', 'html', 'pdf'] },
  tsv: { label: 'TSV', category: 'spreadsheet', engine: 'SheetJS', outputs: ['xlsx', 'xls', 'ods', 'csv', 'json', 'html', 'pdf'] },

  // ---- Presentations -----------------------------------------------------
  pptx: { label: 'PPTX', category: 'presentation', engine: 'pptx-browser renderer', outputs: ['pdf', 'jpg', 'png', 'pptx'] },
}

/** Inputs we detect but cannot convert in-browser, with the reason. */
export const UNSUPPORTED_INPUTS = {
  doc: 'Legacy binary .doc cannot be parsed reliably in a browser. Save it as .docx first.',
  odt: 'OpenDocument text needs a full ODF engine. Save it as .docx first.',
  rtf: 'RTF layout needs a desktop word processor. Save it as .docx first.',
  ppt: 'Legacy binary .ppt needs LibreOffice. Save it as .pptx first.',
  odp: 'ODP rendering needs LibreOffice. Save it as .pptx first.',
}

/** Per-route limitations shown to the user instead of silent data loss. */
export const LIMITATIONS = {
  'image:jpg': 'JPG has no transparency; transparent pixels are flattened onto white.',
  'image:bmp': 'BMP has no alpha channel; transparent pixels are flattened onto white.',
  'image:ico': 'ICO is capped at 256x256, so larger images are scaled down.',
  'image:gif': 'GIF output is a 256-colour still frame; animation is not re-encoded.',
  'image:tiff': 'TIFF output is lossless RGBA and can be large.',
  'image:avif': 'Browsers cannot encode AVIF, so AVIF is input-only.',
  'pdf:jpg': 'Pages are rasterised; text is no longer selectable.',
  'pdf:docx': 'Text, headings and tables are rebuilt from the PDF text layer. Scanned PDFs have no text layer and are reported as such.',
  'pdf:xlsx': 'Tables are inferred from text positions; complex layouts are approximated.',
  'pdf:pptx': 'Each page becomes a slide image, so appearance is preserved but text is not editable.',
  'pdf:html': 'Paragraphs are reconstructed; exact CSS layout is not reproduced.',
  'pdf:pdf': 'Repackaging strips metadata and rebuilds object streams; embedded images are not recompressed.',
  'docx:md': 'Markdown keeps headings, lists, tables and emphasis; fonts, colours and page layout are dropped.',
  'sheet:csv': 'Only the first worksheet is exported — CSV cannot store extra sheets, formulas, formatting or merged cells.',
  'sheet:tsv': 'Only the first worksheet is exported — TSV cannot store extra sheets, formulas or formatting.',
  'sheet:json': 'JSON contains cell values only — no formulas, styles or merged-cell layout.',
  'sheet:pdf': 'Worksheets are laid out as tables; very wide sheets are scaled to fit.',
  'document:pdf': 'PDF layout approximates Word pagination; floating shapes are not reproduced.',
}

/** Category display metadata, in the order shown on the homepage. */
export const CATEGORY_INFO = [
  { id: 'image', label: 'Image Converter' },
  { id: 'pdf', label: 'PDF Converter' },
  { id: 'document', label: 'Document Converter' },
  { id: 'spreadsheet', label: 'Excel / Spreadsheet Converter' },
  { id: 'presentation', label: 'PowerPoint Converter' },
]

export function outputsFor(signature) {
  return (ROUTES[signature]?.outputs ?? []).map((id) => OUTPUT_FORMATS[id]).filter(Boolean)
}

/** Rows grouped for the homepage support chart. */
export function supportChart() {
  return CATEGORY_INFO.map((cat) => ({
    ...cat,
    rows: Object.entries(ROUTES)
      .filter(([, route]) => route.category === cat.id)
      .map(([signature, route]) => ({
        signature,
        label: route.label,
        engine: route.engine,
        outputs: route.outputs.map((id) => OUTPUT_FORMATS[id]),
      })),
  })).filter((cat) => cat.rows.length > 0)
}
