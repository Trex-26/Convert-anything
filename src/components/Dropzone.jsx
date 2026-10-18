import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useApp } from '../context/AppContext'
import { useImageIngestion } from '../hooks/useImageProcessing'
import { MAX_FILES, validateFile, validateFileContent } from '../lib/fileValidation'
import Spinner from './Spinner'

const ACCEPT_EXT = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/svg+xml': ['.svg'],
  'image/bmp': ['.bmp'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
  'image/avif': ['.avif'],
  'image/tiff': ['.tif', '.tiff'],
  'image/x-icon': ['.ico'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
  'text/csv': ['.csv'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
}

export default function Dropzone({ compact = false }) {
  const { addFiles, files } = useApp()
  const { ingest } = useImageIngestion()
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const onDrop = useCallback(
    async (accepted, rejected) => {
      setError(null)
      if (rejected?.length) {
        setError(rejected[0].errors?.[0]?.message ?? 'Some files were rejected.')
      }
      const valid = []
      for (const file of accepted) {
        const msg = validateFile(file)
        if (msg) {
          setError((prev) => prev ?? msg)
          continue
        }
        if (files.length + valid.length >= MAX_FILES) {
          setError(`You can add up to ${MAX_FILES} files at once.`)
          break
        }
        // Content-level check: sniff the real file signature before queueing.
        const content = await validateFileContent(file)
        if (typeof content === 'string') {
          setError((prev) => prev ?? content)
          continue
        }
        valid.push({ file, content })
      }
      if (!valid.length) return
      setBusy(true)
      try {
        const records = await ingest(valid)
        addFiles(records)
      } catch (e) {
        setError(e?.message ?? 'Could not read one of the files.')
      } finally {
        setBusy(false)
      }
    },
    [addFiles, files.length, ingest],
  )

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    onDrop,
    accept: ACCEPT_EXT,
    multiple: true,
    noClick: true,
    noKeyboard: true,
  })

  // Compact mode — small "Add more files" strip
  if (compact) {
    return (
      <div
        {...getRootProps()}
        className={[
          'w-full rounded-xl border-2 border-dashed transition-all duration-150 px-4 py-3',
          'flex items-center justify-between gap-3',
          isDragActive && !isDragReject
            ? 'border-blue-500 bg-blue-50'
            : isDragReject
              ? 'border-red-300 bg-red-50'
              : 'border-slate-300/80 bg-white hover:border-blue-400 hover:bg-blue-50/20 shadow-sm',
        ].join(' ')}
      >
        <input {...getInputProps()} />
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="text-blue-600 flex-shrink-0">
            {busy ? (
              <Spinner size={16} />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
          </div>
          <span className="text-xs sm:text-sm font-medium text-slate-600 truncate">
            {isDragActive ? 'Drop files to add' : 'Drop more files here to add'}
          </span>
        </div>

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); open() }}
          className="flex-shrink-0 px-3.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
        >
          Add Files
        </button>
        {error && (
          <p className="text-xs text-red-600" role="alert">{error}</p>
        )}
      </div>
    )
  }

  // Full mode — prominent upload hero area
  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={[
          'w-full rounded-2xl border-2 border-dashed transition-all duration-200',
          'flex flex-col items-center justify-center gap-3.5 px-6 py-12 sm:py-16 text-center',
          'cursor-pointer select-none outline-none shadow-sm',
          isDragActive && !isDragReject
            ? 'border-blue-500 bg-blue-50 scale-[1.01]'
            : isDragReject
              ? 'border-red-400 bg-red-50'
              : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50/50',
        ].join(' ')}
        onClick={open}
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
      >
        <input {...getInputProps()} />

        {/* Upload icon circle */}
        <div className={[
          'w-14 h-14 rounded-2xl flex items-center justify-center transition-all',
          isDragActive && !isDragReject
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
            : isDragReject
              ? 'bg-red-100 text-red-500'
              : 'bg-blue-50 text-blue-600 ring-8 ring-blue-50/50',
        ].join(' ')}>
          {busy ? (
            <Spinner size={24} />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
        </div>

        <div>
          <p className="text-base font-bold text-slate-800">
            {busy ? 'Processing files…' : isDragActive ? 'Drop your files here' : 'Drag & drop files here, or click to browse'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Images → PDF/JPG/PNG/WebP · PDF tools · Word · Excel/CSV/ODS · TXT/MD
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); open() }}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold rounded-xl shadow-md shadow-blue-500/20 transition-all active:scale-95"
          id="browse-files-btn"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Select Files
        </button>

        <p className="text-[11px] text-slate-400">
          Up to 100 files · Max 25 MB each · 100% Free & Private in your browser
        </p>
      </div>

      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-medium text-center" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
