import { supportChart } from '../lib/registry'

export default function SupportedFormats() {
  const groups = supportChart()

  return (
    <section className="w-full">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
        Supported conversions
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-bold text-slate-800">{group.label}</h3>
            <ul className="mt-2 space-y-1">
              {group.rows.map((row) => (
                <li key={row.signature} className="flex items-start gap-1.5 text-[11px] leading-snug">
                  <span className="w-11 flex-shrink-0 font-semibold text-slate-700">{row.label}</span>
                  <span className="text-slate-300">→</span>
                  <span className="text-slate-500">{row.outputs.map((o) => o.label).join(', ')}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-slate-400">
        Everything runs in your browser. Legacy .doc, .ppt, .odt and .rtf files are detected but
        need saving as .docx / .pptx first.
      </p>
    </section>
  )
}
