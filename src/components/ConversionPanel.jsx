import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { useFileIntake } from '../hooks/useFileIntake'
import {
  OUTPUT_FORMATS,
  commonFormatsForFiles,
  convertSingleItem,
  familyLabel,
} from '../lib/converters'
import { ACCEPT_EXT } from '../lib/acceptTypes'
import Spinner from './Spinner'

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(2)} MB`
}

function extensionOf(name = '') {
  const m = /\.[^.\\/]+$/.exec(name)
  return m ? m[0].slice(1).toUpperCase() : ''
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export default function ConversionPanel() {
  const {
    files,
    targetFormat,
    setTargetFormat,
    settings,
    quality,
    batchStatus,
    startBatch,
    removeFile,
    clearFiles,
    fileConverting,
    fileDone,
    fileError,
    resetResults,
  } = useApp()

  const { intake, error: intakeError, setError: setIntakeError } = useFileIntake()
  const [localError, setLocalError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const replaceInputRef = useRef(null)
  const abortRef = useRef(null)

  const isConverting = batchStatus === 'converting'
  const options = commonFormatsForFiles(files)
  const optionIds = new Set(options.map((f) => f.id))
  const noCommonOutput = options.length === 0
  const displayValue = optionIds.has(targetFormat) ? targetFormat : (options[0]?.id ?? '')

  // Keep the stored selection valid whenever the queue changes.
  useEffect(() => {
    if (files.length && !noCommonOutput && !optionIds.has(targetFormat) && options[0]) {
      setTargetFormat(options[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, noCommonOutput, targetFormat])

  const finished = files.filter(
    (f) => f.convStatus === 'done' || f.convStatus === 'error' || f.convStatus === 'cancelled',
  ).length
  const doneItems = files.filter((f) => f.convStatus === 'done' && f.resultBlob)
  const errorItems = files.filter((f) => f.convStatus === 'error')
  const allFinished = files.length > 0 && finished === files.length
  const progressPct = files.length ? Math.round((finished / files.length) * 100) : 0

  async function handleConvert() {
    if (!files.length || isConverting || noCommonOutput) return
    setLocalError(null)
    setWarnings([])
    startBatch()

    const controller = new AbortController()
    abortRef.current = controller
    const collected = []

    for (const item of files) {
      if (controller.signal.aborted) break
      fileConverting(item.id, 0)
      try {
        const result = await convertSingleItem(item, quality, settings, controller.signal)
        collected.push(...(result.warnings ?? []))
        fileDone(item.id, result.blob, result.name)
      } catch (err) {
        if (err?.name === 'AbortError') break
        fileError(item.id, err?.message ?? 'Conversion failed.')
      }
    }
    setWarnings([...new Set(collected)])
  }

  async function handleReplace(event) {
    // Snapshot the files before resetting the input: clearing `value` empties
    // the live FileList, which would otherwise make this look like a no-op.
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!picked.length) return
    setIntakeError(null)
    setLocalError(null)
    setWarnings([])
    await intake(picked)
  }

  function handleDownload() {
    const item = doneItems[0]
    if (!item) return
    const ext = OUTPUT_FORMATS[item.outputFormat]?.ext ?? '.bin'
    downloadBlob(item.resultBlob, item.resultName ?? `${item.name.replace(/\.[^.]+$/, '')}${ext}`)
  }

  function handleConvertAnother() {
    abortRef.current?.abort()
    setLocalError(null)
    setIntakeError(null)
    setWarnings([])
    clearFiles()
  }

  const message = localError ?? intakeError

  return (
    <section className="w-full flex flex-col gap-3">
      {/* One panel: file info + output selector + convert action */}
      <div className="w-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Selected files */}
        <ul className="divide-y divide-slate-100">
          {files.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-slate-100 border border-slate-200 flex items-center justify-center">
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    className="w-4 h-4 text-slate-400"
                    aria-hidden="true"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate" title={item.name}>
                  {item.name}
                </p>
                <p className="text-[11px] text-slate-500">
                  <span className="font-medium">{familyLabel(item)}</span>
                  <span className="text-slate-400"> · {formatBytes(item.file?.size)}</span>
                  {extensionOf(item.name) && (
                    <span className="text-slate-400"> · .{extensionOf(item.name).toLowerCase()}</span>
                  )}
                </p>
              </div>

              {item.convStatus === 'converting' && <Spinner size={16} className="text-blue-600" />}
              {item.convStatus === 'done' && (
                <span className="text-xs font-semibold text-emerald-600 flex-shrink-0">Converted</span>
              )}
              {item.convStatus === 'error' && (
                <button
                  type="button"
                  onClick={() => setLocalError(item.convError ?? 'Conversion failed.')}
                  className="text-xs font-semibold text-red-500 flex-shrink-0"
                  title={item.convError}
                >
                  Failed
                </button>
              )}

              {item.convStatus !== 'done' && (
                <button
                  type="button"
                  onClick={() => removeFile(item.id)}
                  disabled={isConverting}
                  aria-label={`Remove ${item.name}`}
                  className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    className="w-3.5 h-3.5"
                    aria-hidden="true"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>

        {/* Controls */}
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <label
              htmlFor="output-format"
              className="text-xs font-semibold text-slate-500 whitespace-nowrap"
            >
              Convert to
            </label>
            <select
              id="output-format"
              value={displayValue}
              onChange={(e) => setTargetFormat(e.target.value)}
              disabled={isConverting || noCommonOutput || allFinished}
              className="flex-1 sm:flex-none sm:w-48 px-3 py-2 text-sm font-medium bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60 cursor-pointer"
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
          </div>

          {allFinished && doneItems.length > 0 ? (
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={handleDownload}
                className="flex-1 sm:flex-none px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors"
              >
                Download
              </button>
              <button
                type="button"
                onClick={handleConvertAnother}
                className="flex-1 sm:flex-none px-5 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors"
              >
                Convert Another
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={() => replaceInputRef.current?.click()}
                disabled={isConverting}
                className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-blue-600 rounded-lg transition-colors disabled:opacity-40"
              >
                Replace File
              </button>
              <button
                type="button"
                onClick={handleConvert}
                disabled={isConverting || noCommonOutput || !files.length}
                id="convert-files-btn"
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isConverting && <Spinner size={16} />}
                {isConverting ? 'Converting…' : 'Convert'}
              </button>
            </div>
          )}

          <input
            ref={replaceInputRef}
            type="file"
            accept={Object.entries(ACCEPT_EXT)
              .flatMap(([mime, exts]) => [mime, ...exts])
              .join(',')}
            className="hidden"
            onChange={handleReplace}
          />
        </div>

        {/* Progress */}
        {isConverting && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium mb-1">
              <span>
                Converting {finished} of {files.length}
              </span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Result */}
      {allFinished && doneItems.length > 0 && (
        <div className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
          <p className="text-sm font-semibold text-emerald-900">Conversion complete</p>
          <p className="mt-0.5 text-xs text-emerald-800 truncate">
            {doneItems[0].resultName ?? doneItems[0].name}
          </p>
        </div>
      )}

      {/* Honest note about anything the target format cannot keep */}
      {allFinished && doneItems.length > 0 && warnings.length > 0 && (
        <div className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold text-amber-900">What changed in this conversion</p>
          <ul className="mt-1 space-y-0.5 list-disc list-inside">
            {warnings.map((w) => (
              <li key={w} className="text-[11px] text-amber-800">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {allFinished && errorItems.length > 0 && (
        <div className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-semibold text-red-800">Conversion failed</p>
          <ul className="mt-1 space-y-0.5">
            {errorItems.map((item) => (
              <li key={item.id} className="text-xs text-red-700">
                {item.name}: {item.convError ?? 'Unknown error.'}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              resetResults()
              handleConvert()
            }}
            className="mt-2 text-xs font-semibold text-red-700 underline hover:text-red-900"
          >
            Try again
          </button>
        </div>
      )}

      {noCommonOutput && (
        <p role="alert" className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 font-medium">
          This file type has no supported output format. Try an image, PDF, Word (.docx),
          spreadsheet or text file.
        </p>
      )}

      {message && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-medium">
          {message}
        </div>
      )}
    </section>
  )
}
