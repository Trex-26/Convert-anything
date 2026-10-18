import Header from './components/Header'
import Dropzone from './components/Dropzone'
import ConversionControls from './components/ConversionControls'
import FileQueue from './components/FileQueue'
import { useApp } from './context/AppContext'

export default function App() {
  const { files, setTargetFormat, setMergePdf } = useApp()
  const hasFiles = files.length > 0

  return (
    <div className="min-h-full flex flex-col bg-slate-50 text-slate-900 font-sans">
      <Header />

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4">
        {/* Dropzone — compact when files are uploaded, hero when empty */}
        <Dropzone compact={hasFiles} />

        {/* Format/quality controls + quick options + convert action */}
        <ConversionControls />

        {/* File queue & results */}
        <FileQueue />

        {/* Quick presets & feature discovery when empty */}
        {!hasFiles && (
          <div className="mt-4 pt-4 border-t border-slate-200/60">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 text-center sm:text-left">
              Popular Quick Conversions
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { title: 'Images to PDF', sub: 'Combine JPG/PNG into 1 PDF', fmt: 'pdf', merge: true },
                { title: 'Convert to JPG', sub: 'WebP, PNG, HEIC to JPG', fmt: 'jpg', merge: false },
                { title: 'Convert to PNG', sub: 'Lossless transparent images', fmt: 'png', merge: false },
                { title: 'Convert to WebP', sub: 'Modern ultra-compressed web', fmt: 'webp', merge: false },
                { title: 'PDF Tools', sub: 'Merge, split, rotate, extract pages', fmt: 'pdf', merge: false },
                { title: 'Word → HTML / TXT', sub: 'DOCX to web or plain text', fmt: 'html', merge: false },
                { title: 'Excel → CSV / XLSX', sub: 'XLSX, ODS, CSV conversions', fmt: 'csv', merge: false },
                { title: 'TXT / MD → PDF', sub: 'Paginated PDF from text', fmt: 'pdf', merge: false },
              ].map((tool) => (
                <button
                  key={tool.title}
                  type="button"
                  onClick={() => {
                    setTargetFormat(tool.fmt)
                    setMergePdf(tool.merge)
                  }}
                  className="p-3 text-left bg-white rounded-xl border border-slate-200/80 hover:border-blue-400 hover:shadow-sm transition-all group"
                >
                  <p className="text-xs font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
                    {tool.title}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                    {tool.sub}
                  </p>
                </button>
              ))}
            </div>

            <div className="mt-8 grid sm:grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-white rounded-xl border border-slate-200/70">
                <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-4 h-4">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <h4 className="text-xs font-bold text-slate-800">100% Private</h4>
                <p className="text-[11px] text-slate-500 mt-1">
                  Files never leave your computer. Transcoding happens right in your browser.
                </p>
              </div>

              <div className="p-4 bg-white rounded-xl border border-slate-200/70">
                <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-4 h-4">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <h4 className="text-xs font-bold text-slate-800">Lightning Fast</h4>
                <p className="text-[11px] text-slate-500 mt-1">
                  No queue, no upload wait, no download delay. Instant processing locally.
                </p>
              </div>

              <div className="p-4 bg-white rounded-xl border border-slate-200/70">
                <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-4 h-4">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                </div>
                <h4 className="text-xs font-bold text-slate-800">Unlimited & Free</h4>
                <p className="text-[11px] text-slate-500 mt-1">
                  No subscriptions, no accounts, and no file limit paywalls ever.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="w-full border-t border-slate-200/70 bg-white py-4 mt-auto">
        <div className="max-w-3xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
          <span>Convert-anything • Free, open and private file converter</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Browser Client-Side Engine Active
          </span>
        </div>
      </footer>
    </div>
  )
}
