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
- **DOCX Parsing**: `mammoth` (`src/lib/docs.js`, lazy-loaded) — semantic HTML / raw text extraction from OOXML.
- **Spreadsheet Engine**: `xlsx` (SheetJS) v0.20.3 installed from the official `cdn.sheetjs.com` channel because the npm registry copy (0.18.5) carries unpatched advisories.
- **Text → PDF**: `pdf-lib` with StandardFonts; CJK/emoji glyphs transliterated to `?` (surfaced in the UI/README).
- **HEIC Transcoding**: `heic2any` (decodes Apple HEIC/HEIF images locally; lazy-loaded).
- **Archive Generation**: `jszip` (assembles client-side ZIP archives in memory with standard Deflate compression).
- **Drag & Drop**: `react-dropzone` for accessible, native HTML5 drag-and-drop file ingestion.

### Architectural Principles
1. **Zero Server Footprint**: No conversion backend, no upload endpoints, no telemetry or tracking scripts, no external fonts or CDNs. The CSP allowlists no third-party origin at all.
2. **Content-Sniffing Validation First**: `src/lib/fileValidation.js` classifies files by actual byte signatures and refuses family mismatches (e.g. a `.png` whose bytes are JPEG), with per-family size caps (images 25 MB, PDFs 50 MB, Office files 20 MB, text 5 MB).
3. **Dynamic Format Registry**: Conversion capabilities are declared in a centralized registry (`src/lib/converters.js`). Only implemented, tested handlers are ever displayed in the UI.
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
│   │   ├── ConversionControls.jsx   # Top-level format, quality, and options selector
│   │   ├── Dropzone.jsx             # Drag-and-drop dropzone with full/compact modes
│   │   ├── FileQueue.jsx            # Detailed batch queue, PDF-op controls, per-item downloads & ZIP export
│   │   ├── Header.jsx               # Compact branding header with privacy indicator
│   │   ├── MoreOptionsModal.jsx     # Settings modal (page size, orientation, margins)
│   │   └── Spinner.jsx              # Accessible loading indicator
│   ├── context/
│   │   └── AppContext.jsx           # Global state manager (file queue, formats, pdfOptions, batch status)
│   ├── hooks/
│   │   └── useImageProcessing.js    # Ingestion pipeline: content validation, previews, HEIC preprocessing
│   ├── lib/
│   │   ├── converters.js            # Central registry + dispatch engine (all families)
│   │   ├── docs.js                  # DOCX/SheetJS/text→PDF document engine
│   │   ├── fileValidation.js        # Magic-byte signature sniffing, families, size caps
│   │   └── pdfOps.js                # PDF page operations: merge, split, rotate, extract, compress
│   ├── App.jsx                      # Primary layout assembler
│   ├── index.css                    # Tailwind CSS imports and design tokens
│   └── main.jsx                     # Application entry point
├── tests/
│   ├── converters.test.js           # Registry integrity, per-family availability, privacy invariants
│   ├── docs.test.js                 # Real DOCX/XLSX packages → mammoth/SheetJS parsing, text→PDF pagination
│   ├── pdfOps.test.js               # Merge/split/rotate/extract/reorder/compress against real PDFs
│   └── validation.test.js           # Signature detection, family routing, animated-GIF detection, caps
├── eslint.config.js                 # ESLint flat configuration
├── index.html                       # HTML5 entry with metadata, canonical, Open Graph, Twitter tags
├── package.json                     # Scripts and dependencies
└── vite.config.js                   # Vite configuration
```

---

## 4. Conversion Compatibility Matrix

Everything in the **Supported** column has an implemented, unit-tested local handler. Families this app cannot serve do not appear in any output selector.

| Input Format | Output Format | Engine / Method | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **JPG / JPEG** | PDF | `pdf-lib` direct embed | **Supported** | Fast; lossless embed or quality-adjusted JPEG |
| **PNG** | PDF | `pdf-lib` direct embed | **Supported** | Full alpha transparency preserved |
| **WebP / GIF / BMP / SVG / AVIF / ICO** | PDF | Canvas round-trip → `pdf-lib` | **Supported** | WebP/GIF/BMP/SVG rasterize via canvas |
| **HEIC / HEIF** | PDF / JPG / PNG / WebP | `heic2any` → pipeline | **Supported** | Transcoded locally before packaging |
| **Any decodable image** | JPG / PNG / WebP | OffscreenCanvas / Canvas | **Supported** | Configurable JPEG/WebP quality (0.55–0.92) |
| **GIF (animated)** | any raster | Canvas first frame | **Supported (lossy)** | Flagged in the UI; only the first frame is kept — browsers cannot rasterize a full animation loop safely |
| **PDF** | PDF (merged) | `pdf-lib` copyPages | **Supported** | All queue-order PDFs combine into one document |
| **PDF** | PDF (split) | `pdf-lib`, per page | **Supported** | One PDF per page, delivered as a ZIP |
| **PDF** | PDF (rotated) | `pdf-lib` /Rotate | **Supported** | 90/180/270 degrees |
| **PDF** | PDF (extract/reorder) | `pdf-lib` copyPages | **Supported** | Page spec `1,3,5-7`; the listed order is preserved |
| **PDF** | PDF (compressed) | `pdf-lib` object streams | **Supported (limited)** | Repackages + strips metadata; existing image streams cannot be recompressed, so gains are modest |
| **DOCX** | HTML / TXT | `mammoth` | **Supported** | Semantic conversion — complex layout/floating images are approximated or dropped |
| **XLSX / ODS / CSV** | CSV / HTML / TXT / XLSX | `xlsx` (SheetJS) | **Supported** | Parses the first sheet; CSV input is routed through the same engine |
| **TXT / MD** | PDF | `pdf-lib`, StandardFonts | **Supported** | Genuinely paginated with word-wrap; non-WinAnsi glyphs become `?` |
| **PDF** | images (rasterize) | — | *Unsupported* | Would need a full PDF renderer (pdf.js); honesty > fake output |
| **PDF with password** | any | — | *Unsupported* | Password removal/encryption is refused explicitly; no bypass is implemented |
| **DOC / PPTX / ODT / RTF / EPUB** | — | — | *Unsupported* | Legacy binary DOC and presentation engines are not feasible in-page |
| **Audio / Video** | — | FFmpeg.wasm | *Unsupported by choice* | ~30 MB engine, cross-origin isolation headers, heavy mobile memory cost — deliberately not shipped |
| **TIFF** | any | — | *Partially supported* | Validated and accepted, but only converts if the user's browser can decode TIFF (some can); errors are surfaced honestly |

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

To add a new format converter (e.g., SVG to PNG):

1. **Register Format in `src/lib/converters.js`**:
   Add the format definition to `OUTPUT_FORMATS`:
   ```javascript
   export const OUTPUT_FORMATS = {
     // ...
     svg: { id: 'svg', label: 'SVG', ext: '.svg', mime: 'image/svg+xml', category: 'image' },
   }
   ```
2. **Update Availability Logic**:
   Update `availableFormatsFor(file)` in `src/lib/converters.js` to return the new output format when compatible input files are detected.
3. **Implement Conversion Function**:
   Write the transformation routine (e.g., `imageToSvg()` or custom canvas serializer) and integrate it into `convertAll()`.
4. **Add Unit Tests**:
   Create a test case in `tests/converters.test.js` validating that the new format produces valid magic bytes and mime types.

---

## 7. How to Modify the UI and Styles

- **Colors and Tokens**: Edit `@theme` variables in `src/index.css` for custom color palettes, borders, and typography.
- **Header & Branding**: Modify `src/components/Header.jsx` to update links, navigation, and badges.
- **Conversion Controls**: Edit `src/components/ConversionControls.jsx` for button arrangements and dropdown styles.
- **Queue & Results Card**: Edit `src/components/FileQueue.jsx` to customize per-file progress bars, badges, or download actions.

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
| **State & Batch Actions** | `src/context/AppContext.jsx` | `src/components/FileQueue.jsx`, `src/components/ConversionControls.jsx` |
| **Quality Presets** | `src/lib/converters.js` | `src/components/ConversionControls.jsx`, `src/components/FileQueue.jsx` |
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
