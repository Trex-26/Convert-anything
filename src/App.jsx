import Header from './components/Header'
import Dropzone from './components/Dropzone'
import ConversionPanel from './components/ConversionPanel'
import SupportedFormats from './components/SupportedFormats'
import { useApp } from './context/AppContext'

export default function App() {
  const { files } = useApp()
  const hasFiles = files.length > 0

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans">
      <Header />

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 flex flex-col justify-center gap-6">
        {hasFiles ? (
          <ConversionPanel />
        ) : (
          <>
            <Dropzone />
            <SupportedFormats />
          </>
        )}
      </main>
    </div>
  )
}
