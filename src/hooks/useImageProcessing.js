import { useCallback, useEffect, useRef } from 'react'
import { isHeicFile, guessFamily } from '../lib/fileValidation'

// Normalize ingestion input: Dropzone passes { file, content } records after
// signature validation; other callers may pass raw File objects.
function asEntry(entry) {
  if (entry instanceof File) {
    return { file: entry, content: { family: guessFamily(entry), signature: null, isAnimated: false } }
  }
  return entry
}

// Decodes a single file into something the browser can render
// (HTMLImageElement) and returns its intrinsic width/height plus a
// data: URL thumbnail. HEIC files are transcoded to JPEG first via the
// lazy-loaded heic2any library.
async function decodeForThumbnail(file) {
  if (isHeicFile(file)) {
    const { default: heic2any } = await import('heic2any')
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 })
    const jpegBlob = Array.isArray(converted) ? converted[0] : converted
    const url = URL.createObjectURL(jpegBlob)
    try {
      const { width, height } = await readDimensions(url)
      return { width, height, decodedBlob: jpegBlob, wasHeic: true }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const { width, height } = await readDimensions(url)
    return { width, height, decodedBlob: null, wasHeic: false }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function readDimensions(objectUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not read image dimensions.'))
    img.src = objectUrl
  })
}

// Custom hook: given a list of raw File objects (typically from dropzone),
// turns them into the structured image records the rest of the app uses.
// Returns an `ingest(files)` callback and a counter of how many are still
// being processed so the UI can show a subtle loading hint.
export function useImageIngestion() {
  const processing = useRef(new Set())
  const listeners = useRef(new Set())
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const subscribe = useCallback((fn) => {
    listeners.current.add(fn)
    return () => listeners.current.delete(fn)
  }, [])

  const notify = useCallback(() => {
    const count = processing.current.size
    listeners.current.forEach((fn) => fn(count))
  }, [])

  const ingest = useCallback(
    async (incoming) => {
      const records = await Promise.all(
        incoming.map(async (rawEntry) => {
          const entry = asEntry(rawEntry)
          const file = entry.file
          const family = entry.content?.family ?? guessFamily(file)
          const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random()
            .toString(36)
            .slice(2, 8)}`
          processing.current.add(id)
          notify()
          try {
            // Only images get decoded/previews; documents keep their original
            // bytes and render with an icon instead of a thumbnail.
            const isImage = family === 'image'
            let width = null
            let height = null
            let decodedBlob = null
            let wasHeic = false
            if (isImage) {
              const decoded = await decodeForThumbnail(file)
              width = decoded.width
              height = decoded.height
              decodedBlob = decoded.decodedBlob
              wasHeic = decoded.wasHeic
            }
            // If we decoded a HEIC, swap the File so downstream code embeds JPEG.
            const effectiveFile = decodedBlob
              ? new File([decodedBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
                  type: 'image/jpeg',
                })
              : file
            return {
              id,
              file: effectiveFile,
              name: file.name,
              thumbnailUrl: isImage ? URL.createObjectURL(effectiveFile) : null,
              isHeic: wasHeic,
              isAnimated: Boolean(entry.content?.isAnimated),
              family,
              width,
              height,
            }
          } finally {
            processing.current.delete(id)
            notify()
          }
        }),
      )
      return records
    },
    [notify],
  )

  return { ingest, subscribe }
}
