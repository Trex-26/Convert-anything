Live demo: https://convert-anythings.netlify.app/


# Convert-anything

> A high-performance, 100% client-side file conversion web application built with React, Vite, Tailwind CSS, pdf-lib, and JSZip.

All files are read and processed locally in your browser memory. No files are ever uploaded to any remote server or stored in persistent browser storage.

---

## Table of Contents

1. [Features & Capabilities](#features--capabilities)
2. [Architecture & Technology Decisions](#architecture--technology-decisions)
3. [Project Directory Structure](#project-directory-structure)
4. [Conversion Compatibility Matrix](#conversion-compatibility-matrix)
5. [Privacy & Security Guarantees](#privacy--security-guarantees)
6. [How to Add a New Format Handler](#how-to-add-a-new-format-handler)
7. [How to Modify the UI and Styles](#how-to-modify-the-ui-and-styles)
8. [Configuring Quality Presets and Options](#configuring-quality-presets-and-options)
9. [Coordinated File Changes Reference](#coordinated-file-changes-reference)
10. [Local Development & Building](#local-development--building)
11. [Testing & Quality Assurance](#testing--quality-assurance)
12. [Deployment Guide](#deployment-guide)
13. [Dependencies & Licensing](#dependencies--licensing)

---

## 1. Features & Capabilities

- **Instant Zero-Friction Workflow**: Drag and drop or browse files with immediate format selection and conversion controls right on the home screen.
- **100% Local Browser Processing**: Built strictly for client-side execution using HTML5 Canvas, OffscreenCanvas, and lazy-loaded WebAssembly/JS engines. Original files and converted outputs never touch a network connection.
- **Image Conversion**: JPG, PNG, WebP, GIF, BMP, SVG, HEIC/HEIF, AVIF, ICO → PDF, JPG, PNG, WebP with quality presets.
- **PDF Page Operations**: Merge, split (one PDF per page → ZIP), rotate, extract/reorder pages (page-spec like `1,3,5-7`), and repackage/compress (object streams + metadata stripping).
- **Document Conversion**: DOCX → HTML / plain text (mammoth). Sheet conversion: XLSX, ODS, CSV → CSV, HTML table, plain text, or a rebuilt XLSX workbook (SheetJS).
- **Text → PDF**: TXT/MD converted into a genuinely paginated PDF with a standard Type-1 font.
- **Content-Sniffing Validation**: Every file's magic bytes are inspected (JPEG/PNG/GIF/WebP/BMP/ICO/TIFF/AVIF/HEIC/SVG signatures, `%PDF-`, OOXML/ODF ZIP probing) — extensions are never trusted alone.
- **Batch Processing & ZIP Download**: Convert multiple files in a batch with individual progress tracking, individual downloads, or single-click ZIP archive bundling (deduplicated entry names).
- **Honesty Guarantees**: Animated GIFs are flagged "Animated → first frame" before conversion; unsupported conversions never appear in output selectors.
- **Robust Resource Management**: Immediate cleanup of `blob:` URLs and in-memory canvas objects upon removal or batch completion.
- **Responsive & Accessible**: Clean, modern interface optimized for mobile, tablet, and desktop viewports with keyboard navigation, high-contrast indicators, and `aria-live` announcement of conversion status for screen readers.

---

## 2. Architecture & Technology Decisions

### Core Stack
- **Framework**: React 19 (Hooks, Context, useReducer for predictable state transitions).
- **Build Tool**: Vite 8 with `@vitejs/plugin-react`. Heavy engines (heic2any, SheetJS) are emitted as separate lazy-loaded chunks so first paint stays fast.
- **Styling**: Tailwind CSS v4 with modern theme tokens and responsive flex/grid layouts; system font stack (no external font requests).
- **Images → PDF**: `pdf-lib` (pure JavaScript client-side PDF builder; embeds raster images without server overhead).
- **PDF Page Operations**: `pdf-lib` (`src/lib/pdfOps.js`) — merge, split, rotate, extract/reorder, repackage.
- **PDF Reading & Rasterising**: `pdfjs-dist` (`src/lib/pdfEngine.js`) — text-layer extraction plus real page rendering to canvas.
- **DOCX Parsing**: `mammoth` (`src/lib/docEngine.js`, lazy-loaded) — semantic HTML / raw text extraction from OOXML.
- **DOCX Writing**: `docx` (`src/lib/docEngine.js`) — builds valid Word packages for TXT/MD/HTML/PDF sources.
- **Presentations**: `pptx-browser` (`src/lib/slidesEngine.js`) — renders real slide canvases for PDF/JPG/PNG output.
- **Raster Encoders**: Canvas (JPG/PNG/WebP), `gifenc` (GIF), `utif` (TIFF), hand-written BMP and ICO writers (`src/lib/imageEngine.js`).
- **Spreadsheet Engine**: `xlsx` (SheetJS) v0.20.3 installed from the official `cdn.sheetjs.com` channel because the npm registry copy (0.18.5) carries unpatched advisories.
- **Text → PDF**: `pdf-lib` with StandardFonts; CJK/emoji glyphs transliterated to `?` (surfaced in the UI/README).
- **HEIC Transcoding**: `heic2any` (decodes Apple HEIC/HEIF images locally; lazy-loaded).
- **Archive Generation**: `jszip` (assembles client-side ZIP archives in memory with standard Deflate compression).
- **Drag & Drop**: `react-dropzone` for accessible, native HTML5 drag-and-drop file ingestion.

### Architectural Principles
1. **Zero Server Footprint**: No conversion backend, no upload endpoints, no telemetry or tracking scripts, no external fonts or CDNs. The CSP allowlists no third-party origin at all.
2. **Content-Sniffing Validation First**: `src/lib/fileValidation.js` classifies files by actual byte signatures and refuses family mismatches (e.g. a `.png` whose bytes are JPEG), with per-family size caps (images 25 MB, PDFs 50 MB, Office files 20 MB, text 5 MB).
3. **Signature-Driven Registry**: `src/lib/registry.js` maps a *detected file signature* to the outputs an engine can actually produce. `src/lib/converters.js` only dispatches routes listed there, and the UI renders whatever the registry returns — so an unimplemented conversion can never appear as an option. The homepage support chart is generated from the same table.
4. **Memory Safety**: Files are tracked as in-memory `File` and `Blob` references. When jobs finish or when the user triggers "Clear all", object URLs are explicitly revoked via `URL.revokeObjectURL()`.

---

## 3. Project Directory Structure

```
convert-anything/
├── dist/                      # Production build output
├── public/
│   ├── _headers               # Cloudflare Pages security headers and strict CSP
│   ├── favicon.svg            # Vector site icon
│   ├── icons.svg              # SVG sprite system
│   ├── robots.txt             # Search engine crawler directives
│   └── sitemap.xml            # XML sitemap for SEO discoverability
├── src/
│   ├── components/
│   │   ├── ConversionPanel.jsx      # Single conversion panel: file info, output selector, convert/download
│   │   ├── Dropzone.jsx             # Homepage drag-and-drop upload area + Select Files button
│   │   ├── Header.jsx               # Brand + "100% Private" badge (no navigation bar)
│   │   ├── SupportedFormats.jsx     # Homepage input → output chart (generated from registry)
│   │   └── Spinner.jsx              # Accessible loading indicator
│   ├── context/
│   │   └── AppContext.jsx           # Global state manager (file queue, formats, pdfOptions, batch status)
│   ├── hooks/
│   │   ├── useFileIntake.js         # Shared intake: validation → queue (dropzone and Replace File)
│   │   └── useImageProcessing.js    # Ingestion pipeline: content validation, previews, HEIC preprocessing
│   ├── lib/
│   │   ├── acceptTypes.js           # Accepted MIME/extensions for the picker
│   │   ├── converters.js            # Dispatcher: signature → engine, output validation
│   │   ├── docEngine.js             # DOCX/TXT/MD/HTML → PDF/HTML/TXT/MD/DOCX
│   │   ├── fileValidation.js        # Magic-byte signature sniffing, families, size caps
│   │   ├── imageEngine.js           # Canvas + gifenc/UTIF/BMP/ICO raster conversion
│   │   ├── pdfEngine.js             # pdf.js rasterising + text/DOCX/XLSX/PPTX rebuild
│   │   ├── pdfLayout.js             # Paginated PDF layout engine (headings, runs, tables)
│   │   ├── pdfOps.js                # PDF page operations: merge, split, rotate, extract, compress
│   │   ├── registry.js              # Single source of truth for every supported route
│   │   ├── sheetEngine.js           # SheetJS workbook conversions
│   │   └── slidesEngine.js          # pptx-browser slide rendering
│   ├── App.jsx                      # Primary layout assembler
│   ├── index.css                    # Tailwind CSS imports and design tokens
│   └── main.jsx                     # Application entry point
├── tests/
│   ├── converters.test.js           # Registry integrity + real conversions for every engine
│   ├── pdfOps.test.js               # Merge/split/rotate/extract/reorder/compress against real PDFs
│   └── validation.test.js           # Signature detection, family routing, animated-GIF detection, caps
├── eslint.config.js                 # ESLint flat configuration
├── index.html                       # HTML5 entry with metadata, canonical, Open Graph, Twitter tags
├── package.json                     # Scripts and dependencies
└── vite.config.js                   # Vite configuration
```

---

## 4. Conversion Compatibility Matrix

This table is generated from `src/lib/registry.js` — the same data the homepage chart and the
output selector use. Anything not listed here is rejected with a message instead of being faked.

| Input | Outputs | Engine | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **JPG / PNG / WebP / GIF / BMP** | JPG, PNG, WebP, GIF, BMP, TIFF, ICO, PDF | Canvas, `gifenc`, `utif` | **Supported** | JPG/BMP flatten alpha onto white; ICO is capped at 256×256; GIF output is a 256-colour still |
| **TIFF** | JPG, PNG, WebP, BMP, PDF | `utif` decode → Canvas | **Supported** | Multi-page TIFFs convert their first page |
| **SVG** | PNG, JPG, WebP, PDF | Browser SVG rasteriser | **Supported** | Rendered at the declared viewBox size |
| **ICO** | PNG, JPG, WebP | Browser ICO decode | **Supported** | Largest embedded frame is used |
| **HEIC / HEIF** | JPG, PNG, WebP, TIFF | `heic2any` → Canvas | **Supported** | Decoded locally at full quality |
| **AVIF** | JPG, PNG, WebP, GIF | Browser AVIF decode | **Supported (input only)** | Browsers can decode but not encode AVIF, so AVIF is never offered as an output |
| **PDF** | JPG, PNG, WebP, TIFF | `pdfjs-dist` page render | **Supported** | Rendered at 2× scale; multi-page results arrive as a ZIP |
| **PDF** | TXT, HTML, DOCX, XLSX | `pdfjs-dist` text layer | **Supported** | Headings/tables inferred from font size and x-positions |
| **PDF** | PPTX | page raster → `pptxgenjs` | **Supported (image)** | One slide per page; appearance kept, text not editable |
| **PDF** | PDF | `pdf-lib` repackage | **Supported (limited)** | Strips metadata and rebuilds object streams; embedded images are not recompressed |
| **DOCX** | PDF, HTML, TXT, MD | `mammoth` → layout engine | **Supported** | Fonts, colours and floating shapes are not reproduced |
| **TXT** | PDF, DOCX, HTML, MD | layout engine + `docx` | **Supported** | Blank-line paragraphs; winansi-only glyphs become `?` |
| **MD** | HTML, PDF, DOCX, TXT | `marked` + layout engine | **Supported** | GitHub-flavoured basics: headings, lists, emphasis, tables |
| **HTML** | PDF, TXT, MD, DOCX | `htmlparser2` + `turndown` | **Supported** | Block structure is preserved; CSS layout is not |
| **XLSX / XLS / ODS / CSV / TSV** | XLSX, XLS, ODS, CSV, TSV, JSON, HTML, PDF | SheetJS | **Supported** | Workbooks keep all sheets; CSV/TSV/JSON export the first sheet and warn first |
| **PPTX** | PDF, JPG, PNG, PPTX | `pptx-browser` | **Supported** | Real slide canvases; multi-slide image output arrives as a ZIP |
| **DOC / ODT / RTF / PPT / ODP** | — | — | *Unsupported* | No reliable in-browser parser; the intake rejects them with "save as .docx/.pptx first" |
| **Scanned PDF (no text layer)** | TXT / DOCX / XLSX / HTML | — | *Unsupported* | Refused honestly; no OCR engine is bundled. Choose an image format instead |
| **Audio / Video** | — | — | *Unsupported by choice* | FFmpeg.wasm would add ~30 MB and cross-origin isolation requirements |

---

## 5. Privacy & Security Guarantees

1. **Strictly Local Execution**: No user file, filename, or byte stream leaves the browser tab.
2. **No Persistent Tracking**: Neither files nor filenames are saved to `localStorage`, `sessionStorage`, `IndexedDB`, or cookies.
3. **Session-Only Memory**: Refreshing or closing the tab immediately releases all file buffers from RAM.
4. **URL Cleanup**: Every generated `blob:` URL is explicitly tracked and revoked upon file removal or queue clear.
5. **Strict Content Security Policy (CSP)**:
   - `connect-src 'none'` blocks all outbound network requests from scripts.
   - `object-src 'none'` prevents Flash or untrusted object injection.
   - `frame-ancestors 'none'` protects against clickjacking.

---

## 6. How to Add a New Format Handler

1. **Declare the route in `src/lib/registry.js`**: add the output to the input signature's
   `outputs` array (plus an `OUTPUT_FORMATS` entry if the format is new). If the target cannot
   keep something the source has, add a line to `LIMITATIONS` too — the panel shows it after
   conversion.
2. **Implement the transform in the matching engine** (`imageEngine`, `pdfEngine`, `docEngine`,
   `sheetEngine`, `slidesEngine`) and return `{ blob, warnings }` with a real MIME type.
3. **Wire the dispatch** in `src/lib/converters.js` if the engine is new to that category.
4. **Test the bytes, not the label**: extend `tests/converters.test.js` and assert the produced
   blob's magic signature via `detectSignature` (PNG/JPEG/PDF/OOXML magic), plus a round-trip
   where possible.

The UI needs no change: the selector and the homepage chart both read the registry.

## 7. How to Modify the UI and Styles

- **Colors and Tokens**: Edit `@theme` variables in `src/index.css` for custom color palettes, borders, and typography.
- **Header & Branding**: Modify `src/components/Header.jsx` to update the logo and brand text.
- **Conversion Panel**: Edit `src/components/ConversionPanel.jsx` for the output selector, convert button, progress and result actions.
- **Upload Area**: Edit `src/components/Dropzone.jsx` for the drag-and-drop area and Select Files button.
- **Support Chart**: Edit `src/components/SupportedFormats.jsx` for layout only — the rows come from `registry.js`.

---

## 8. Configuring Quality Presets and Options

Quality presets are defined in `src/lib/converters.js`:
```javascript
export const QUALITY_PRESETS = [
  { id: 'low',    label: 'Low',    jpegQ: 0.55 },
  { id: 'medium', label: 'Medium', jpegQ: 0.78 },
  { id: 'high',   label: 'High',   jpegQ: 0.92 },
]
```
To adjust quality compression levels or add presets (e.g., `maximum: 1.0`), modify this array. The UI dropdown automatically reflects all entries in this array.

---

## 9. Coordinated File Changes Reference

When modifying shared features, ensure coordinated updates across these linked files:

| Feature / System | Primary File | Coordinated Files |
| :--- | :--- | :--- |
| **Supported File Types** | `src/lib/fileValidation.js` | `src/lib/converters.js`, `src/components/Dropzone.jsx` |
| **State & Batch Actions** | `src/context/AppContext.jsx` | `src/components/ConversionPanel.jsx` |
| **Quality Presets** | `src/lib/converters.js` | `src/components/ConversionPanel.jsx` |
| **Security Headers & CSP** | `public/_headers` | `index.html` |

---

## 10. Local Development & Building

### Prerequisites
- Node.js v18+ (tested on Node v24.15.0)
- npm v9+

### Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run ESLint linter
npm run lint

# Run automated unit tests
npm test

# Build optimized production bundle
npm run build

# Preview production build locally
npm run preview
```

---

## 11. Testing & Quality Assurance

The test suite runs via the native Node.js test runner (`node --test`), requiring zero external test runners:

```bash
npm test
```

### Verified Test Cases (35 tests, all passing)
- **Validation (9)**:
  - Magic-byte signature detection for JPEG/PNG/GIF/WebP/BMP/ICO/TIFF/AVIF/HEIC/SVG/PDF
  - OOXML/ODF ZIP sniffing (DOCX vs XLSX vs ODS)
  - Animated-GIF detection via the `NETSCAPE2.0` extension
  - Family routing (MIME + extension classification for every accepted type)
  - Rejection of executables and family mismatches
  - Per-family size caps (images 25 MB, PDFs 50 MB, Office 20 MB, text 5 MB)
- **PDF Operations (7)**:
  - Page-spec parsing (`1,3,5-7`) including order preservation, dedupe, out-of-range errors
  - Merge (2 + 3 pages → 5 pages, valid `%PDF-` header)
  - Split (one single-page PDF per page)
  - Rotate (every page's `/Rotate` = 90)
  - Extract/reorder verified by distinct page sizes establishing page identity
  - Repackage/compress preserves page count and strips metadata
  - Friendly errors (no stack traces) for malformed input
- **Document Engine (9)**:
  - Real in-memory XLSX → CSV with parsed cell values
  - XLSX → HTML table
  - XLSX round-trip to a valid `.xlsx` package re-parsed by SheetJS
  - CSV routed through the sheet family to XLSX/TXT
  - Real bundled OOXML DOCX → raw text and HTML via mammoth
  - Text → PDF pagination across multiple pages, transliteration of unmappable glyphs, empty-file error
- **Registry & Privacy (10)**:
  - Registry integrity, quality presets, PDF operation catalogue
  - Per-family availability — unknown families never advertise conversions
  - Validates `%PDF-` headers and `PK\x03\x04` ZIP magic
  - Privacy invariant: no external conversion endpoints in code

Note: automated tests run in Node exercising the *actual* conversion libraries against in-memory real Office packages. Full browser-based network-interception privacy testing (e.g. Playwright with request blocking) is listed as a manual verification step in § Deployment below.

---

## 12. Deployment Guide

### Deploying to Cloudflare Pages (Recommended)
1. Link your Git repository in the Cloudflare Pages dashboard.
2. Build Settings:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Build Output Directory**: `dist`
3. Custom Domain & SSL: Cloudflare Pages automatically provides a free SSL certificate and CDN distribution.
4. Security Headers: The included `public/_headers` file will automatically be deployed to configure strict CSP and security policies.

### Deploying to GitHub Pages
1. In repository settings, set Pages source to GitHub Actions.
2. Build workflow runs `npm ci` and `npm run build`.
3. Upload `dist` artifact to `actions/deploy-pages`.

---

## 13. Dependencies & Licensing

| Package | Version | License | Purpose |
| :--- | :--- | :--- | :--- |
| **react** / **react-dom** | `^19.2.6` | MIT | Core UI component framework and renderer |
| **pdf-lib** | `^1.17.1` | MIT | PDF creation, page ops, and text→PDF |
| **mammoth** | `^1.13.0` | BSD-2-Clause | DOCX → HTML / raw text extraction (OOXML parsing) |
| **xlsx** (SheetJS) | `0.20.3` | Apache-2.0 | XLSX/ODS/CSV parsing + XLSX/CSS/HTML output; installed from cdn.sheetjs.com (official channel) because npm hosts an outdated fork |
| **heic2any** | `^0.0.4` | MIT | Client-side HEIC/HEIF decoding (lazy-chunk) |
| **jszip** | `^3.10.2` | MIT / GPLv3 | In-memory ZIP archive generation |
| **react-dropzone** | `^15.0.0` | MIT | Accessible drag-and-drop file ingestion |
| **@dnd-kit/*** | `^6/^10/^3` | MIT | Keyboard-accessible queue reordering |
| **tailwindcss** | `^4.3.0` | MIT | Utility-first styling engine |
| **vite** | `^8.0.12` | MIT | Build tool and dev server |

Supply-chain notes: `npm audit` for production dependencies reports only a moderate advisory in mammoth's transitive `argparse` (Node-CLI-only code path, tree-shaken from the browser bundle but not removable from the lockfile). SheetJS deliberately pinned to the maintained 0.20.3 build from the vendor's own channel to avoid the unpatched advisories in the npm-registry copy. Content-sniffing validation means the app never executes uploaded content — mammoth/SheetJS receive bytes only as data.
