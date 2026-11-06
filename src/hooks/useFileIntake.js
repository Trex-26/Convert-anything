import { useCallback, useState } from 'react'
import { useApp } from '../context/AppContext'
import { useImageIngestion } from './useImageProcessing'
import { validateFile, validateFileContent } from '../lib/fileValidation'

/**
 * Shared file intake: size/extension check, content-signature validation, then
 * ingestion into the queue. Shared by the homepage dropzone and the panel's
 * "Replace File" action. The app converts one file at a time, so a new file
 * replaces whatever was selected before.
 */
export function useFileIntake() {
  const { addFiles, clearFiles } = useApp()
  const { ingest } = useImageIngestion()
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const intake = useCallback(
    async (incoming) => {
      setError(null)
      const file = Array.from(incoming ?? [])[0]
      if (!file) return false

      const msg = validateFile(file)
      if (msg) {
        setError(msg)
        return false
      }

      const content = await validateFileContent(file)
      if (typeof content === 'string') {
        setError(content)
        return false
      }

      setBusy(true)
      try {
        const records = await ingest([{ file, content }])
        clearFiles()
        addFiles(records)
        return true
      } catch (e) {
        setError(e?.message ?? 'Could not read the file.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [addFiles, clearFiles, ingest],
  )

  return { intake, error, setError, busy }
}
