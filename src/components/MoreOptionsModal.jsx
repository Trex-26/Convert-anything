import { useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { QUALITY_PRESETS } from '../lib/converters'

export default function MoreOptionsModal({ onClose }) {
  const {
    quality,
    setQuality,
    targetFormat,
    mergePdf,
    setMergePdf,
    settings,
    updateSettings,
  } = useApp()

  const panelRef = useRef(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  function handleReset() {
    setQuality('high')
    setMergePdf(true)
    updateSettings({ pageSize: 'fit', orientation: 'portrait', margin: 'none' })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="More options"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md bg-white rounded-2xl shadow-2xl outline-none max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-slate-900">Conversion Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="px-6 py-5 space-y-6 overflow-y-auto">

          {/* Quality setting */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Image / PDF Quality
            </label>
            <div className="grid grid-cols-3 gap-2">
              {QUALITY_PRESETS.map((p) => {
                const active = quality === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setQuality(p.id)}
                    className={[
                      'px-3 py-2.5 rounded-xl border text-center transition-all',
                      active
                        ? 'border-blue-600 bg-blue-50/70 text-blue-700 font-semibold ring-1 ring-blue-500'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 font-medium',
                    ].join(' ')}
                  >
                    <div className="text-sm">{p.label}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {p.id === 'low' ? 'Smallest' : p.id === 'high' ? 'Lossless/Best' : 'Balanced'}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* PDF Page Settings (when target is PDF) */}
          {targetFormat === 'pdf' && (
            <>
              {/* Merge option */}
              <div className="p-3.5 rounded-xl border border-blue-100 bg-blue-50/40">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mergePdf}
                    onChange={(e) => setMergePdf(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  <div>
                    <span className="text-sm font-semibold text-slate-900">
                      Merge into a Single Multi-Page PDF
                    </span>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Combines all selected files into one single PDF document in the order listed.
                    </p>
                  </div>
                </label>
              </div>

              {/* Page Sizing */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Page Sizing
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'fit', label: 'Fit to Image', desc: 'No margins' },
                    { id: 'A4', label: 'A4 Paper', desc: '210 × 297 mm' },
                    { id: 'Letter', label: 'US Letter', desc: '8.5 × 11 in' },
                  ].map((size) => {
                    const active = (settings.pageSize || 'fit') === size.id
                    return (
                      <button
                        key={size.id}
                        type="button"
                        onClick={() => updateSettings({ pageSize: size.id })}
                        className={[
                          'px-3 py-2.5 rounded-xl border text-center transition-all',
                          active
                            ? 'border-blue-600 bg-blue-50/70 text-blue-700 font-semibold ring-1 ring-blue-500'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700 font-medium',
                        ].join(' ')}
                      >
                        <div className="text-sm">{size.label}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{size.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Orientation (when not fit) */}
              {settings.pageSize !== 'fit' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Orientation
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'portrait', label: 'Portrait', icon: 'M6 3h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z' },
                      { id: 'landscape', label: 'Landscape', icon: 'M3 6h18a2 2 0 012 2v8a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2z' },
                      { id: 'auto', label: 'Auto Detect', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
                    ].map((ori) => {
                      const active = (settings.orientation || 'portrait') === ori.id
                      return (
                        <button
                          key={ori.id}
                          type="button"
                          onClick={() => updateSettings({ orientation: ori.id })}
                          className={[
                            'px-3 py-2 rounded-xl border flex flex-col items-center gap-1 transition-all',
                            active
                              ? 'border-blue-600 bg-blue-50/70 text-blue-700 font-semibold ring-1 ring-blue-500'
                              : 'border-slate-200 hover:border-slate-300 text-slate-700 font-medium',
                          ].join(' ')}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                            <path d={ori.icon} />
                          </svg>
                          <span className="text-xs">{ori.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Margins */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Page Margins
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'none', label: 'None (Full Bleed)' },
                    { id: 'small', label: 'Small (14pt)' },
                    { id: 'normal', label: 'Normal (24pt)' },
                  ].map((m) => {
                    const active = (settings.margin || 'none') === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => updateSettings({ margin: m.id })}
                        className={[
                          'px-2.5 py-2 rounded-xl border text-center transition-all text-xs font-medium',
                          active
                            ? 'border-blue-600 bg-blue-50/70 text-blue-700 font-semibold ring-1 ring-blue-500'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700',
                        ].join(' ')}
                      >
                        {m.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {/* Privacy info */}
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 mb-1">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-emerald-600">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              100% Client-Side Processing
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              Your files never leave your device. All transcoding and PDF rendering happens locally in your browser memory for maximum speed and data privacy.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Reset to Defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-lg transition-all shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
