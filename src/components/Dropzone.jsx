import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useFileIntake } from '../hooks/useFileIntake'
import { ACCEPT_EXT } from '../lib/acceptTypes'
import Spinner from './Spinner'

export default function Dropzone() {
  const { intake, error, setError, busy } = useFileIntake()

  const onDrop = useCallback(
    async (accepted, rejected) => {
      if (rejected?.length) {
        setError(rejected[0].errors?.[0]?.message ?? 'Some files were rejected.')
      }
      await intake(accepted)
    },
    [intake, setError],
  )

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    onDrop,
    accept: ACCEPT_EXT,
    multiple: false,
    noClick: true,
    noKeyboard: true,
  })

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={[
          'w-full rounded-2xl border-2 border-dashed transition-colors duration-150',
          'flex flex-col items-center justify-center gap-5 px-6 py-14 sm:py-24 sm:min-h-[24rem] text-center',
          'outline-none shadow-sm cursor-pointer select-none',
          isDragActive && !isDragReject
            ? 'border-blue-500 bg-blue-50'
            : isDragReject
              ? 'border-red-400 bg-red-50'
              : 'border-slate-300 bg-white hover:border-blue-400',
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

        <div
          className={[
            'w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center',
            isDragActive && !isDragReject
              ? 'bg-blue-600 text-white'
              : isDragReject
                ? 'bg-red-100 text-red-500'
                : 'bg-blue-50 text-blue-600',
          ].join(' ')}
        >
          {busy ? (
            <Spinner size={28} />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-7 h-7 sm:w-9 sm:h-9"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
        </div>

        <p className="text-base sm:text-lg font-semibold text-slate-800">
          {busy ? 'Reading file…' : isDragActive ? 'Drop your file here' : 'Drag & drop a file here'}
        </p>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
          disabled={busy}
          id="browse-files-btn"
          className="px-6 sm:px-8 py-2.5 sm:py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm sm:text-base font-semibold rounded-xl transition-colors disabled:opacity-60"
        >
          Select Files
        </button>
      </div>

      {error && (
        <div
          className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-medium text-center"
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  )
}
