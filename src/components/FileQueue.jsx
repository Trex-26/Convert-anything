import { useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { useApp } from '../context/AppContext'
import {
  OUTPUT_FORMATS,
  QUALITY_PRESETS,
  PDF_OPERATIONS,
  convertAll,
  buildMergedPdf,
  familyLabel,
  availableFormatsFor,
  commonFormatsForFiles,
} from '../lib/converters'
import { mergePdfs } from '../lib/pdfOps'
import { guessFamily } from '../lib/fileValidation'
import Spinner from './Spinner'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(2)} MB`
}

function fileTypeLabel(file) {
  const type = file?.type ?? ''
  if (type === 'image/jpeg') return 'JPEG'
  if (type === 'image/png') return 'PNG'
  if (type === 'image/webp') return 'WebP'
  if (type === 'image/gif') return 'GIF'
  if (type === 'image/svg+xml') return 'SVG'
  if (type === 'image/bmp') return 'BMP'
  if (type === 'image/heic' || type === 'image/heif') return 'HEIC'
  return familyLabel(file)
}

// ---------------------------------------------------------------------------
// SortableFileRow
// ---------------------------------------------------------------------------

function SortableFileRow({
  item,
  index,
  total,
  isConverting,
  onPreview,
  onMoveUp,
  onMoveDown,
}) {
  const { removeFile } = useApp()
  const convStatus = item.convStatus

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : 1,
    opacity: isDragging ? 0.6 : 1,
  }

  const statusBadge = () => {
    if (convStatus === 'converting') {
      return (
        <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
          <Spinner size={14} />
          <span>Converting…</span>
        </span>
      )
    }
    if (convStatus === 'done') {
      return (
        <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span>Done</span>
        </span>
      )
    }
    if (convStatus === 'error') {
      return (
        <span className="flex items-center gap-1 text-xs text-red-500 font-medium" title={item.convError}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>Failed</span>
        </span>
      )
    }
    return null
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'flex items-center gap-2 sm:gap-3 py-2.5 px-3 sm:px-4 bg-white transition-colors group',
        isDragging ? 'bg-blue-50/50 shadow-md ring-1 ring-blue-300 rounded-lg' : 'hover:bg-slate-50/60',
      ].join(' ')}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={isConverting}
        aria-label="Drag to reorder"
        className="text-slate-300 hover:text-slate-600 cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-100 transition-colors disabled:cursor-not-allowed"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <circle cx="9" cy="5" r="1" fill="currentColor" />
          <circle cx="9" cy="12" r="1" fill="currentColor" />
          <circle cx="9" cy="19" r="1" fill="currentColor" />
          <circle cx="15" cy="5" r="1" fill="currentColor" />
          <circle cx="15" cy="12" r="1" fill="currentColor" />
          <circle cx="15" cy="19" r="1" fill="currentColor" />
        </svg>
      </button>

      {/* Index & up/down buttons */}
      <div className="flex flex-col items-center justify-center text-[10px] text-slate-400 font-mono w-4">
        {index > 0 && !isConverting && (
          <button
            type="button"
            onClick={() => onMoveUp(index)}
            title="Move up"
            className="text-slate-300 hover:text-blue-600 transition-colors leading-none"
          >
            ▲
          </button>
        )}
        <span>{index + 1}</span>
        {index < total - 1 && !isConverting && (
          <button
            type="button"
            onClick={() => onMoveDown(index)}
            title="Move down"
            className="text-slate-300 hover:text-blue-600 transition-colors leading-none"
          >
            ▼
          </button>
        )}
      </div>

      {/* Thumbnail */}
      <div
        onClick={() => onPreview(item)}
        title="Click to preview"
        className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-slate-100 border border-slate-200 cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all relative group/thumb"
      >
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
        )}
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs sm:text-sm font-semibold text-slate-900 truncate" title={item.name}>
          {item.name}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>{formatBytes(item.file?.size)}</span>
          <span>•</span>
          <span>{fileTypeLabel(item.file)}</span>
          {item.width && item.height && (
            <>
              <span>•</span>
              <span>{item.width}×{item.height}</span>
            </>
          )}
        </div>
      </div>

      {/* Status indicator */}
      {statusBadge()}

      {/* Download button when done */}
      {convStatus === 'done' && item.resultBlob && (
        <DownloadButton blob={item.resultBlob} name={item.name} resultName={item.resultName} format={item.outputFormat} />
      )}

      {/* Animated GIF honesty badge */}
      {item.isAnimated && convStatus !== 'done' && (
        <span
          className="hidden lg:inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 flex-shrink-0"
          title="Browsers rasterize static frames — output keeps only the first frame"
        >
          Animated → first frame
        </span>
      )}

      {/* Remove button */}
      <button
        type="button"
        onClick={() => removeFile(item.id)}
        disabled={isConverting}
        aria-label={`Remove ${item.name}`}
        className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DownloadButton
// ---------------------------------------------------------------------------

function DownloadButton({ blob, name, resultName, format }) {
  const stem = name.replace(/\.[^.]+$/, '')
  const ext = OUTPUT_FORMATS[format]?.ext ?? `.${format}`
  const filename = resultName ?? `${stem}${ext}`

  function handleDownload() {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="flex items-center gap-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1.5 rounded-lg shadow-sm transition-all"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span>Download</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// FileQueue (Main Component)
// ---------------------------------------------------------------------------

export default function FileQueue() {
  const {
    files,
    quality,
    targetFormat,
    mergePdf,
    settings,
    pdfOptions,
    batchStatus,
    mergedPdfBlob,
    clearFiles,
    reorderFiles,
    startBatch,
    setMergedPdfBlob,
    fileConverting,
    fileDone,
    fileError,
    fileCancelled,
    batchCancelled,
    resetResults,
  } = useApp()

  const abortRef = useRef(null)
  const [previewItem, setPreviewItem] = useState(null)

  const isConverting = batchStatus === 'converting'
  const isDone = batchStatus === 'done'

  const doneCount = files.filter((f) => f.convStatus === 'done').length
  const errorCount = files.filter((f) => f.convStatus === 'error').length
  const totalCount = files.length

  const finishedCount = files.filter(
    (f) => f.convStatus === 'done' || f.convStatus === 'error' || f.convStatus === 'cancelled'
  ).length
  const progressPct = totalCount > 0 ? Math.round((finishedCount / totalCount) * 100) : 0

  // Sensors for dnd-kit
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = files.findIndex((i) => i.id === active.id)
    const newIndex = files.findIndex((i) => i.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    reorderFiles(arrayMove(files, oldIndex, newIndex))
  }

  function handleMoveUp(index) {
    if (index <= 0) return
    reorderFiles(arrayMove(files, index, index - 1))
  }

  function handleMoveDown(index) {
    if (index >= files.length - 1) return
    reorderFiles(arrayMove(files, index, index + 1))
  }

  // Convert all items
  async function handleConvertAll() {
    if (!files.length || isConverting) return
    startBatch()
    const controller = new AbortController()
    abortRef.current = controller

    const q = QUALITY_PRESETS.find((p) => p.id === quality) ?? QUALITY_PRESETS[2]
    const allPdf = files.length > 0 && files.every((f) => guessFamily(f.file) === 'pdf')
    const allImages = files.every((f) => guessFamily(f.file) === 'image')
    const opSettings = {
      ...settings,
      pdfOp: pdfOptions.op,
      rotate: pdfOptions.rotate,
      pages: pdfOptions.pages,
    }

    if (allPdf && pdfOptions.op === 'merge') {
      // Merge every PDF in queue order into one document.
      try {
        files.forEach((f) => fileConverting(f.id, 0))
        const blob = await mergePdfs(files.map((f) => f.file), controller.signal)
        files.forEach((f) => fileDone(f.id, blob, 'convert-anything-merged.pdf'))
        setMergedPdfBlob(blob)
      } catch (err) {
        const msg = err?.message || 'Merge failed'
        files.forEach((f) => (err?.name === 'AbortError' ? fileCancelled(f.id) : fileError(f.id, msg)))
      }
      return
    }

    if (targetFormat === 'pdf' && mergePdf && allImages && files.length > 1) {
      // Merge all images into one multi-page PDF
      try {
        files.forEach((f) => fileConverting(f.id, 0))
        const blob = await buildMergedPdf(
          files,
          q.jpegQ,
          settings,
          controller.signal,
          (curr, tot) => {
            const idx = Math.min(curr - 1, files.length - 1)
            fileConverting(files[idx]?.id, Math.round((curr / tot) * 100))
          }
        )
        files.forEach((f) => fileDone(f.id, blob, 'convert-anything-merged.pdf'))
        setMergedPdfBlob(blob)
      } catch (err) {
        files.forEach((f) => fileError(f.id, err?.message || 'Merge failed'))
      }
      return
    }

    // Convert individually (mixed families skip the merge path honestly)
    await convertAll(files, quality, opSettings, controller.signal, (id, update) => {
      if (update.status === 'converting') fileConverting(id, update.progress)
      else if (update.status === 'done') fileDone(id, update.resultBlob, update.resultName)
      else if (update.status === 'error') fileError(id, update.error)
      else if (update.status === 'cancelled') fileCancelled(id)
    })
  }

  function handleCancelAll() {
    abortRef.current?.abort()
    batchCancelled()
  }

  // Download Merged PDF
  function handleDownloadMergedPdf() {
    if (!mergedPdfBlob) return
    const url = URL.createObjectURL(mergedPdfBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `convert-anything-merged-${Date.now()}.pdf`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  // Download All as ZIP or individual
  async function handleDownloadAll() {
    if (mergedPdfBlob) {
      handleDownloadMergedPdf()
      return
    }

    const done = files.filter((f) => f.convStatus === 'done' && f.resultBlob)
    if (!done.length) return

    if (done.length === 1) {
      const item = done[0]
      const ext = OUTPUT_FORMATS[item.outputFormat]?.ext ?? `.${item.outputFormat}`
      const stem = item.name.replace(/\.[^.]+$/, '')
      const url = URL.createObjectURL(item.resultBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = item.resultName ?? `${stem}${ext}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      return
    }

    // Multiple: create ZIP archive (dedupe entry names)
    const zip = new JSZip()
    const used = new Set()
    for (const item of done) {
      const entry = item.resultName ?? (() => {
        const ext = OUTPUT_FORMATS[item.outputFormat]?.ext ?? `.${item.outputFormat}`
        return `${item.name.replace(/\.[^.]+$/, '')}${ext}`
      })()
      let unique = entry
      let n = 2
      while (used.has(unique)) {
        unique = entry.replace(/(\.[^.]+)$/, `-${n}$1`)
        n++
      }
      used.add(unique)
      zip.file(unique, item.resultBlob)
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `converted-files-${Date.now()}.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  if (!files.length) return null

  return (
    <section className="w-full">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-900">
            Selected Files ({totalCount})
          </h2>
          <span className="text-xs text-slate-400">
            • Drag handle to reorder
          </span>
        </div>
        <button
          type="button"
          onClick={clearFiles}
          disabled={isConverting}
          className="text-xs font-semibold text-rose-600 hover:text-rose-700 transition-colors disabled:opacity-40"
        >
          Clear all
        </button>
      </div>

      {/* File list with dnd-kit sortable */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={files.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y divide-slate-100">
              {files.map((item, index) => (
                <SortableFileRow
                  key={item.id}
                  item={item}
                  index={index}
                  total={files.length}
                  isConverting={isConverting}
                  onPreview={(file) => setPreviewItem(file)}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* Batch settings row */}
        <BatchSettingsRow isConverting={isConverting} files={files} />
      </div>

      {/* Progress bar (while converting) */}
      {isConverting && (
        <div className="mt-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-600 font-medium mb-1.5">
            <span className="flex items-center gap-1.5">
              <Spinner size={14} className="text-blue-600" />
              Processing files ({finishedCount} of {totalCount} completed)
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Conversion complete summary */}
      {isDone && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-900">
                {mergedPdfBlob ? 'Merged PDF Ready!' : 'Conversion Complete!'}
              </p>
              <p className="text-xs text-emerald-700">
                {mergedPdfBlob
                  ? `Combined ${totalCount} pages into 1 PDF (${formatBytes(mergedPdfBlob.size)})`
                  : `${doneCount} file${doneCount !== 1 ? 's' : ''} converted successfully${errorCount > 0 ? ` · ${errorCount} error(s)` : ''}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mergedPdfBlob ? (
              <button
                type="button"
                onClick={handleDownloadMergedPdf}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download PDF
              </button>
            ) : (
              doneCount > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadAll}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all active:scale-95"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {doneCount === 1 ? 'Download File' : 'Download All as ZIP'}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Main bottom Action buttons */}
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        {isConverting ? (
          <button
            type="button"
            onClick={handleCancelAll}
            className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-rose-600 bg-white border border-rose-200 rounded-xl hover:bg-rose-50 transition-colors shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
            Cancel Conversion
          </button>
        ) : isDone ? (
          <>
            <button
              type="button"
              onClick={handleDownloadAll}
              className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl transition-all shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {mergedPdfBlob ? 'Download Merged PDF' : doneCount === 1 ? 'Download File' : 'Download All as ZIP'}
            </button>
            <button
              type="button"
              onClick={resetResults}
              className="flex-shrink-0 flex items-center justify-center gap-2 py-3 px-5 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
            >
              Convert Again
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleConvertAll}
            disabled={!files.length}
            id="convert-files-btn"
            className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl transition-all shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>
              {targetFormat === 'pdf' && mergePdf && totalCount > 1
                ? `Merge ${totalCount} Files into Single PDF`
                : `Convert ${totalCount} File${totalCount !== 1 ? 's' : ''}`}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        )}
      </div>

      {/* Image / Thumbnail Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setPreviewItem(null)} />
          <div className="relative z-10 max-w-xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-xs font-semibold text-slate-800 truncate">{previewItem.name}</span>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="p-4 flex items-center justify-center bg-slate-50 overflow-auto">
              {previewItem.thumbnailUrl && (
                <img
                  src={previewItem.thumbnailUrl}
                  alt={previewItem.name}
                  className="max-h-[60vh] max-w-full object-contain rounded-lg shadow-sm"
                />
              )}
            </div>
            <div className="px-4 py-2.5 bg-white border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>{formatBytes(previewItem.file?.size)}</span>
              <span>{previewItem.width ? `${previewItem.width} × ${previewItem.height} px` : ''}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// Batch settings row
function BatchSettingsRow({ isConverting, files }) {
  const {
    quality,
    setQuality,
    targetFormat,
    setTargetFormat,
    setFileFormat,
    mergePdf,
    setMergePdf,
  } = useApp()

  const allPdf = files.length > 0 && files.every((f) => guessFamily(f.file) === 'pdf')
  const commonOptions = commonFormatsForFiles(files)

  function applyFormatToAll(formatId) {
    setTargetFormat(formatId)
    files.forEach((f) => {
      if (f.convStatus === 'idle' || f.convStatus === 'cancelled') {
        const fmts = availableFormatsFor(f.file)
        if (fmts.some((x) => x.id === formatId)) {
          setFileFormat(f.id, formatId)
        }
      }
    })
  }

  return (
    <div className="px-4 py-3 bg-slate-50/80 border-t border-slate-100 flex flex-wrap items-center gap-3">
      {/* Format selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">Convert all to</span>
        <div className="relative">
          <select
            className="text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg pl-2.5 pr-7 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-none"
            value={commonOptions.some((f) => f.id === targetFormat) ? targetFormat : (commonOptions[0]?.id ?? '')}
            disabled={isConverting || commonOptions.length === 0}
            onChange={(e) => applyFormatToAll(e.target.value)}
            aria-label="Apply format to all files"
          >
            {commonOptions.length === 0 ? (
              <option value="">No common output</option>
            ) : (
              commonOptions.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))
            )}
          </select>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-2.5 h-2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </div>

      {/* Quality selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">Quality</span>
        <div className="relative">
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            disabled={isConverting}
            className="text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 pr-7 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-none"
            aria-label="Output quality"
          >
            {QUALITY_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-2.5 h-2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </div>

      {/* PDF operation controls (when the queue is PDF-only) */}
      {allPdf && (
        <PdfOperationControls isConverting={isConverting} />
      )}

      {/* Merge to 1 PDF checkbox */}
      {targetFormat === 'pdf' && (
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={mergePdf}
            onChange={(e) => setMergePdf(e.target.checked)}
            disabled={isConverting}
            className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
          />
          <span>Merge to 1 PDF</span>
        </label>
      )}

      <span className="text-[11px] text-slate-400 ml-auto hidden sm:inline">
        Settings apply to entire queue
      </span>
    </div>
  )
}

// PDF page-operation controls shown when the whole queue consists of PDFs.
function PdfOperationControls({ isConverting }) {
  const { pdfOptions, setPdfOptions } = useApp()
  const hasMultipleQueue = useApp().files.length > 1

  return (
    <div className="flex flex-wrap items-center gap-2 w-full pt-1">
      <span className="text-xs font-semibold text-slate-500">PDF action</span>
      <select
        value={pdfOptions.op}
        onChange={(e) => setPdfOptions({ op: e.target.value })}
        disabled={isConverting}
        aria-label="PDF operation"
        className="text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 pr-7 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {PDF_OPERATIONS.map((op) => (
          <option key={op.id} value={op.id} disabled={op.multiOnly && !hasMultipleQueue}>
            {op.label}
          </option>
        ))}
      </select>

      {pdfOptions.op === 'rotate' && (
        <select
          value={pdfOptions.rotate}
          onChange={(e) => setPdfOptions({ rotate: Number(e.target.value) })}
          disabled={isConverting}
          aria-label="Rotation angle"
          className="text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 pr-7 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value={90}>90° clockwise</option>
          <option value={180}>180°</option>
          <option value={270}>90° counter-clockwise</option>
        </select>
      )}

      {pdfOptions.op === 'extract' && (
        <input
          type="text"
          value={pdfOptions.pages}
          onChange={(e) => setPdfOptions({ pages: e.target.value })}
          disabled={isConverting}
          placeholder='Pages e.g. 1,3,5-7 (keeps this order)'
          aria-label="Pages to keep, in order"
          className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}

      {pdfOptions.op === 'compress' && (
        <span className="text-[11px] text-slate-400">Repackages the PDF and strips metadata — image-heavy files shrink only slightly.</span>
      )}
      {pdfOptions.op === 'split' && (
        <span className="text-[11px] text-slate-400">Each page becomes its own PDF, delivered as a ZIP.</span>
      )}
      {pdfOptions.op === 'extract' && (
        <span className="text-[11px] text-slate-400">Pages are copied in the order you list them — this also reorders.</span>
      )}
      {pdfOptions.op === 'merge' && (
        <span className="text-[11px] text-slate-400">All PDFs combine into one, in queue order.</span>
      )}
    </div>
  )
}
