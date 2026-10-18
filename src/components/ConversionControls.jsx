import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { QUALITY_PRESETS, commonFormatsForFiles } from '../lib/converters'
import MoreOptionsModal from './MoreOptionsModal'

export default function ConversionControls() {
  const {
    targetFormat,
    setTargetFormat,
    quality,
    setQuality,
    mergePdf,
    setMergePdf,
    files,
    batchStatus,
  } = useApp()

  const [showMore, setShowMore] = useState(false)
  const isConverting = batchStatus === 'converting'
  const hasFiles = files.length > 0

  // Only formats genuinely reachable by the current queue (or the default
  // image set before any file is added).
  const options = useMemo(() => commonFormatsForFiles(files), [files])
  const optionIds = useMemo(() => new Set(options.map((f) => f.id)), [options])
  const noCommonOutput = hasFiles && options.length === 0
  const displayValue = optionIds.has(targetFormat) ? targetFormat : (options[0]?.id ?? '')

  // Keep stored selection valid whenever the queue changes.
  useEffect(() => {
    if (!noCommonOutput && hasFiles && !optionIds.has(targetFormat) && options[0]) {
      setTargetFormat(options[0].id)
    }
  }, [hasFiles, noCommonOutput, optionIds, options, setTargetFormat, targetFormat])

  const doneCount = files.filter((f) => f.convStatus === 'done').length
  const failedCount = files.filter((f) => f.convStatus === 'error').length
  const liveMessage = !hasFiles
    ? ''
    : isConverting
      ? 'Converting files, please wait.'
      : batchStatus === 'done'
        ? `Conversion finished: ${doneCount} succeeded${failedCount ? `, ${failedCount} failed` : ''}.`
        : ''

  return (
    <>
      {/* Screen-reader announcements for status changes */}
      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {/* Controls row */}
      <div className="w-full flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-white p-3 sm:p-3.5 rounded-xl border border-slate-200/90 shadow-sm">

        {/* Convert to format */}
        <div className="flex items-center gap-2 flex-1 sm:flex-initial">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap flex-shrink-0">
            Convert to
          </span>
          <div className="relative flex-1 sm:flex-initial">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-600 pointer-events-none flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>            <select
              id="global-format-select"
              value={displayValue}
              onChange={(e) => setTargetFormat(e.target.value)}
              disabled={isConverting || noCommonOutput}
              aria-label="Target format"
              className="w-full sm:w-auto pl-8 pr-8 py-2 text-sm font-medium bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg appearance-none text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer transition-colors shadow-none"
            >
              {noCommonOutput ? (
                <option value="">No common output</option>
              ) : (
                options.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} ({f.ext})
                  </option>
                ))
              )}
            </select>
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
        </div>

        {/* Quality preset */}
        <div className="flex items-center gap-2 flex-1 sm:flex-initial">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap flex-shrink-0">
            Quality
          </span>
          <div className="relative flex-1 sm:flex-initial">
            <select
              id="quality-select"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              disabled={isConverting}
              aria-label="Conversion quality"
              className="w-full sm:w-auto px-3 pr-8 py-2 text-sm font-medium bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg appearance-none text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer transition-colors"
            >
              {QUALITY_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
        </div>

        {/* Merge into one PDF (shown when PDF selected and multiple files or mode toggle) */}
        {targetFormat === 'pdf' && (
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none py-1">
            <input
              type="checkbox"
              checked={mergePdf}
              onChange={(e) => setMergePdf(e.target.checked)}
              disabled={isConverting}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
            />
            <span className="whitespace-nowrap">Merge to 1 PDF</span>
          </label>
        )}

        {/* More options button */}
        <button
          type="button"
          onClick={() => setShowMore(true)}
          disabled={isConverting}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-40 flex-shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-slate-400">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
          </svg>
          Options
        </button>
      </div>

      {/* Privacy badges row */}
      <div className="w-full flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <PrivacyBadge icon={<ShieldIcon />} label="100% Private (Runs locally in your browser)" />
          <PrivacyBadge icon={<BoltIcon />} label="No Uploads or Sign Up" />
          <PrivacyBadge icon={<FilesIcon />} label="Batch Processing" />
        </div>
        {targetFormat === 'pdf' && mergePdf && (
          <span className="text-xs text-blue-600 font-medium">
            Pages will combine into 1 PDF
          </span>
        )}
      </div>

      {showMore && <MoreOptionsModal onClose={() => setShowMore(false)} />}
    </>
  )
}

function PrivacyBadge({ icon, label }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
      <span className="text-slate-400 flex-shrink-0">{icon}</span>
      <span>{label}</span>
    </div>
  )
}

function BoltIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-emerald-500">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function FilesIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}
