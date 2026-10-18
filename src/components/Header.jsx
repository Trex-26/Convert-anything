import { useState } from 'react'
import { useApp } from '../context/AppContext'

const NAV_ITEMS = ['All Tools', 'Images', 'Documents', 'PDF Tools']

export default function Header() {
  const { activeCategory, setActiveCategory } = useApp()
  const [showPrivacyInfo, setShowPrivacyInfo] = useState(false)

  return (
    <>
      <header className="w-full bg-white border-b border-slate-200/80 sticky top-0 z-40 backdrop-blur-md bg-white/95">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 flex-shrink-0 cursor-pointer" onClick={() => setActiveCategory('All Tools')}>
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm shadow-blue-500/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-slate-900 text-sm tracking-tight leading-tight">
                Convert-anything
              </span>
              <span className="text-[10px] text-slate-400 font-medium leading-tight">
                Private & In-Browser
              </span>
            </div>
          </div>

          {/* Navigation Categories */}
          <nav className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl">
            {NAV_ITEMS.map((item) => {
              const active = activeCategory === item
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setActiveCategory(item)}
                  className={[
                    'px-3 py-1 text-xs font-semibold rounded-lg transition-all',
                    active
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50',
                  ].join(' ')}
                >
                  {item}
                </button>
              )
            })}
          </nav>

          {/* Privacy badge */}
          <button
            type="button"
            onClick={() => setShowPrivacyInfo(true)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3.5 h-3.5 text-emerald-500"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span className="hidden sm:inline font-medium">100% Private</span>
          </button>
        </div>
      </header>

      {/* Privacy modal */}
      {showPrivacyInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowPrivacyInfo(false)} />
          <div className="relative z-10 w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 space-y-4">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-900">Zero Server Processing</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Unlike traditional online converters, your files never upload to any remote server or third-party cloud.
              Everything is transcoded right inside your browser memory using HTML5 Canvas and local WebAssembly.
            </p>
            <button
              type="button"
              onClick={() => setShowPrivacyInfo(false)}
              className="w-full py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
