import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { MAX_FILES } from '../lib/fileValidation'
import { availableFormatsFor } from '../lib/converters'

const AppContext = createContext(null)

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

const initialState = {
  files: [],
  targetFormat: 'pdf',
  mergePdf: true,
  quality: 'high',
  batchStatus: 'idle', // 'idle' | 'converting' | 'done'
  mergedPdfBlob: null,
  activeCategory: 'All Tools',
  settings: {
    pageSize: 'fit', // 'fit' | 'A4' | 'Letter'
    orientation: 'portrait', // 'portrait' | 'landscape' | 'auto'
    margin: 'none', // 'none' | 'small' | 'normal'
  },
  pdfOptions: {
    op: 'merge', // 'merge' | 'split' | 'rotate' | 'extract' | 'compress'
    rotate: 90, // degrees for the rotate operation
    pages: '', // page spec for extract/reorder, e.g. "1,3,5-7"
  },
}

function defaultOutputFormat(file, preferredFormat) {
  const formats = availableFormatsFor(file)
  if (!formats.length) return 'pdf'
  if (preferredFormat && formats.some((f) => f.id === preferredFormat)) {
    return preferredFormat
  }
  return formats[0]?.id ?? 'pdf'
}

function reducer(state, action) {
  switch (action.type) {

    case 'ADD_FILES': {
      const incoming = action.files.map((f) => ({
        ...f,
        outputFormat: defaultOutputFormat(f.file, state.targetFormat),
        convStatus: 'idle',
        convProgress: 0,
        resultBlob: null,
        convError: null,
      }))
      const merged = [...state.files, ...incoming].slice(0, MAX_FILES)
      return { ...state, files: merged, batchStatus: 'idle', mergedPdfBlob: null }
    }

    case 'REMOVE_FILE': {
      const removed = state.files.find((f) => f.id === action.id)
      if (removed?.thumbnailUrl) URL.revokeObjectURL(removed.thumbnailUrl)
      const next = state.files.filter((f) => f.id !== action.id)
      return {
        ...state,
        files: next,
        batchStatus: next.length === 0 ? 'idle' : state.batchStatus,
        mergedPdfBlob: next.length === 0 ? null : state.mergedPdfBlob,
      }
    }

    case 'REORDER_FILES': {
      return { ...state, files: action.files }
    }

    case 'CLEAR_FILES': {
      state.files.forEach((f) => {
        if (f.thumbnailUrl) URL.revokeObjectURL(f.thumbnailUrl)
      })
      return { ...initialState, targetFormat: state.targetFormat, settings: state.settings }
    }

    case 'SET_FILE_FORMAT': {
      const files = state.files.map((f) =>
        f.id === action.id
          ? { ...f, outputFormat: action.format, convStatus: 'idle', resultBlob: null, convError: null }
          : f
      )
      return { ...state, files, mergedPdfBlob: null }
    }

    case 'SET_TARGET_FORMAT': {
      const fmt = action.format
      const files = state.files.map((f) => {
        if (f.convStatus === 'done' || f.convStatus === 'converting') return f
        const available = availableFormatsFor(f.file)
        if (available.some((x) => x.id === fmt)) {
          return { ...f, outputFormat: fmt, convStatus: 'idle', resultBlob: null, convError: null }
        }
        return f
      })
      return { ...state, targetFormat: fmt, files, mergedPdfBlob: null }
    }

    case 'SET_MERGE_PDF': {
      return { ...state, mergePdf: action.mergePdf, mergedPdfBlob: null }
    }

    case 'SET_QUALITY': {
      return { ...state, quality: action.quality }
    }

    case 'UPDATE_SETTINGS': {
      return { ...state, settings: { ...state.settings, ...action.settings } }
    }

    case 'SET_PDF_OPTIONS': {
      return { ...state, pdfOptions: { ...state.pdfOptions, ...action.pdfOptions } }
    }

    case 'SET_ACTIVE_CATEGORY': {
      let targetFmt = state.targetFormat
      let mergePdf = state.mergePdf
      if (action.category === 'Images') {
        targetFmt = state.targetFormat === 'pdf' ? 'jpg' : state.targetFormat
      } else if (action.category === 'PDF Tools' || action.category === 'Documents') {
        targetFmt = 'pdf'
        mergePdf = true
      }
      return {
        ...state,
        activeCategory: action.category,
        targetFormat: targetFmt,
        mergePdf,
      }
    }

    case 'BATCH_START': {
      const files = state.files.map((f) => ({
        ...f,
        convStatus: 'idle',
        convProgress: 0,
        resultBlob: null,
        convError: null,
      }))
      return { ...state, files, batchStatus: 'converting', mergedPdfBlob: null }
    }

    case 'SET_MERGED_PDF_BLOB': {
      return { ...state, mergedPdfBlob: action.blob, batchStatus: 'done' }
    }

    case 'FILE_CONVERTING': {
      const files = state.files.map((f) =>
        f.id === action.id ? { ...f, convStatus: 'converting', convProgress: action.progress ?? 0 } : f
      )
      return { ...state, files }
    }

    case 'FILE_DONE': {
      const files = state.files.map((f) =>
        f.id === action.id ? { ...f, convStatus: 'done', convProgress: 100, resultBlob: action.blob, resultName: action.resultName ?? null } : f
      )
      const allDone = files.every((f) => f.convStatus === 'done' || f.convStatus === 'error' || f.convStatus === 'cancelled')
      return { ...state, files, batchStatus: allDone ? 'done' : 'converting' }
    }

    case 'FILE_ERROR': {
      const files = state.files.map((f) =>
        f.id === action.id ? { ...f, convStatus: 'error', convError: action.error } : f
      )
      const allDone = files.every((f) => f.convStatus === 'done' || f.convStatus === 'error' || f.convStatus === 'cancelled')
      return { ...state, files, batchStatus: allDone ? 'done' : 'converting' }
    }

    case 'FILE_CANCELLED': {
      const files = state.files.map((f) =>
        f.id === action.id ? { ...f, convStatus: 'cancelled' } : f
      )
      const allDone = files.every((f) => f.convStatus === 'done' || f.convStatus === 'error' || f.convStatus === 'cancelled')
      return { ...state, files, batchStatus: allDone ? 'done' : state.batchStatus }
    }

    case 'BATCH_CANCELLED': {
      const files = state.files.map((f) =>
        f.convStatus === 'idle' || f.convStatus === 'converting'
          ? { ...f, convStatus: 'cancelled' }
          : f
      )
      return { ...state, files, batchStatus: 'idle' }
    }

    case 'RESET_RESULTS': {
      const files = state.files.map((f) => ({
        ...f,
        convStatus: 'idle',
        convProgress: 0,
        resultBlob: null,
        convError: null,
      }))
      return { ...state, files, batchStatus: 'idle', mergedPdfBlob: null }
    }

    // Legacy compat
    case 'ADD_IMAGES':
      return reducer(state, { type: 'ADD_FILES', files: action.images })
    case 'REMOVE_IMAGE':
      return reducer(state, { type: 'REMOVE_FILE', id: action.id })
    case 'CLEAR_IMAGES':
      return reducer(state, { type: 'CLEAR_FILES' })
    case 'REORDER_IMAGES':
      return reducer(state, { type: 'REORDER_FILES', files: action.images })

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const addFiles          = useCallback((files)          => dispatch({ type: 'ADD_FILES', files }), [])
  const removeFile        = useCallback((id)             => dispatch({ type: 'REMOVE_FILE', id }), [])
  const clearFiles        = useCallback(()               => dispatch({ type: 'CLEAR_FILES' }), [])
  const reorderFiles      = useCallback((files)          => dispatch({ type: 'REORDER_FILES', files }), [])
  const setFileFormat     = useCallback((id, format)     => dispatch({ type: 'SET_FILE_FORMAT', id, format }), [])
  const setTargetFormat   = useCallback((format)         => dispatch({ type: 'SET_TARGET_FORMAT', format }), [])
  const setMergePdf       = useCallback((mergePdf)       => dispatch({ type: 'SET_MERGE_PDF', mergePdf }), [])
  const setQuality        = useCallback((quality)        => dispatch({ type: 'SET_QUALITY', quality }), [])
  const updateSettings    = useCallback((settings)       => dispatch({ type: 'UPDATE_SETTINGS', settings }), [])
  const setPdfOptions     = useCallback((pdfOptions)     => dispatch({ type: 'SET_PDF_OPTIONS', pdfOptions }), [])
  const setActiveCategory = useCallback((category)       => dispatch({ type: 'SET_ACTIVE_CATEGORY', category }), [])
  const startBatch        = useCallback(()               => dispatch({ type: 'BATCH_START' }), [])
  const setMergedPdfBlob  = useCallback((blob)           => dispatch({ type: 'SET_MERGED_PDF_BLOB', blob }), [])
  const fileConverting    = useCallback((id, prog)       => dispatch({ type: 'FILE_CONVERTING', id, progress: prog }), [])
  const fileDone          = useCallback((id, blob, resultName) => dispatch({ type: 'FILE_DONE', id, blob, resultName }), [])
  const fileError         = useCallback((id, error)      => dispatch({ type: 'FILE_ERROR', id, error }), [])
  const fileCancelled     = useCallback((id)             => dispatch({ type: 'FILE_CANCELLED', id }), [])
  const batchCancelled    = useCallback(()               => dispatch({ type: 'BATCH_CANCELLED' }), [])
  const resetResults      = useCallback(()               => dispatch({ type: 'RESET_RESULTS' }), [])

  const value = useMemo(
    () => ({
      ...state,
      addFiles,
      removeFile,
      clearFiles,
      reorderFiles,
      setFileFormat,
      setTargetFormat,
      setMergePdf,
      setQuality,
      updateSettings,
      setPdfOptions,
      setActiveCategory,
      startBatch,
      setMergedPdfBlob,
      fileConverting,
      fileDone,
      fileError,
      fileCancelled,
      batchCancelled,
      resetResults,

      // Legacy aliases
      addImages: addFiles,
      removeImage: removeFile,
      clearImages: clearFiles,
      reorderImages: reorderFiles,
      resetResult: resetResults,
      images: state.files,
      stateRef,
    }),
    [
      state,
      addFiles,
      removeFile,
      clearFiles,
      reorderFiles,
      setFileFormat,
      setTargetFormat,
      setMergePdf,
      setQuality,
      updateSettings,
      setPdfOptions,
      setActiveCategory,
      startBatch,
      setMergedPdfBlob,
      fileConverting,
      fileDone,
      fileError,
      fileCancelled,
      batchCancelled,
      resetResults,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
