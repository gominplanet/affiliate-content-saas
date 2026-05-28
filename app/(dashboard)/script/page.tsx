'use client'

/**
 * Video Script & Shot List generator — the pre-production tool.
 *
 * Workflow:
 *   1. Paste an Amazon ASIN / URL OR any product URL.
 *   2. Pick a style — Unboxing (~4 min), Quick Test (~6 min), Full Review (~12 min).
 *   3. Hit "Generate script" → Claude returns a structured script: hook,
 *      scenes, shot list, B-roll, on-camera tips, per-section duration.
 *   4. Read it off-camera while filming. Copy whole sections. Or come back
 *      to an old one from the "Recent scripts" strip below.
 *
 * Companion to the YouTube Co-Pilot (which handles POST-production
 * metadata). Lives in the same CREATE & PUBLISH sidebar section.
 */
import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/Header'
import {
  Loader2, AlertCircle, Sparkles, ChevronRight, ChevronDown,
  Camera, Film, FileText, Copy, CheckCircle, Trash2, Package,
  Zap, Star, Clock, Image as ImageIcon, ExternalLink,
} from 'lucide-react'

type Style = 'unboxing' | 'quick_test' | 'full_review'

interface ScriptSection {
  id: string
  label: string
  durationSec: number
  script: string
  shots: string[]
  bRoll: string[]
  tips: string[]
}
interface ScriptPayload {
  summary: string
  totalDurationSec: number
  sections: ScriptSection[]
}
interface ScriptSummary {
  id: string
  style: Style
  input: string
  asin: string | null
  product_title: string | null
  product_image_url: string | null
  created_at: string
}

const STYLE_META: Record<Style, { label: string; tag: string; runtime: string; icon: typeof Package; accent: string }> = {
  unboxing:    { label: 'Unboxing',    tag: 'First reveal',   runtime: '~4 min', icon: Package, accent: '#5856d6' },
  quick_test:  { label: 'Quick Test',  tag: 'Does it work?',  runtime: '~6 min', icon: Zap,     accent: '#ff9500' },
  full_review: { label: 'Full Review', tag: 'The deep dive',  runtime: '~12 min', icon: Star,   accent: '#34c759' },
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

export default function ScriptPage() {
  const [input, setInput] = useState('')
  const [style, setStyle] = useState<Style>('full_review')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<{
    script: ScriptPayload
    productTitle: string
    productImage: string | null
    asin: string | null
    scriptId?: string
  } | null>(null)
  const [recent, setRecent] = useState<ScriptSummary[]>([])

  const loadRecent = useCallback(async () => {
    try {
      const r = await fetch('/api/script/list')
      const d = await r.json()
      if (r.ok) setRecent(d.scripts || [])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { void loadRecent() }, [loadRecent])

  async function generate() {
    if (!input.trim()) { setError('Paste an Amazon ASIN or product URL first.'); return }
    setGenerating(true)
    setError(null)
    setOutput(null)
    try {
      const r = await fetch('/api/script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.trim(), style }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Generation failed')
      setOutput({
        script: d.script,
        productTitle: d.productTitle || '',
        productImage: d.productImage || null,
        asin: d.asin || null,
        scriptId: d.scriptId,
      })
      void loadRecent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function openRecent(scriptId: string) {
    setError(null)
    try {
      const r = await fetch(`/api/script/${scriptId}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed to open')
      const row = d.script
      setOutput({
        script: row.script,
        productTitle: row.product_title || '',
        productImage: row.product_image_url || null,
        asin: row.asin || null,
        scriptId: row.id,
      })
      setInput(row.input || '')
      setStyle(row.style as Style)
      // Scroll the output into view so the page change is visible.
      setTimeout(() => window.scrollTo({ top: 280, behavior: 'smooth' }), 80)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open')
    }
  }

  async function deleteRecent(id: string) {
    if (!confirm('Delete this script?')) return
    await fetch(`/api/script/${id}`, { method: 'DELETE' })
    setRecent(prev => prev.filter(s => s.id !== id))
    if (output?.scriptId === id) setOutput(null)
  }

  return (
    <>
      <Header
        title="Video Script & Shot List"
        subtitle="Paste a product, pick a style, get a script you can film from — written in your voice, grounded in the real product info."
      />

      {/* ── Input form ───────────────────────────────────────────────────── */}
      <div className="card p-5 mb-5">
        <label className="block text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Product</label>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Amazon ASIN (B08TT4YHG1), Amazon URL, Geniuslink, or any product page URL"
          className="w-full text-sm px-3 py-2.5 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] mb-4"
        />

        <label className="block text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-2">Style</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
          {(Object.keys(STYLE_META) as Style[]).map(s => {
            const meta = STYLE_META[s]
            const Icon = meta.icon
            const active = style === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStyle(s)}
                className={`flex items-start gap-2.5 p-3 rounded-lg border-2 text-left transition-all ${active ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#0071e3]/40'}`}
              >
                <span
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0"
                  style={{ background: `${meta.accent}1f`, color: meta.accent }}
                  aria-hidden
                >
                  <Icon size={14} strokeWidth={2.5} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{meta.label}</p>
                  <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">{meta.tag} · {meta.runtime}</p>
                </div>
              </button>
            )
          })}
        </div>

        {error && (
          <div className="mb-3 card p-3 border-[#ff3b30]/20 bg-[#ff3b30]/5">
            <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Claude writes it in your brand voice, grounded in the product info we scrape.</p>
          <button
            onClick={() => void generate()}
            disabled={generating || !input.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50"
          >
            {generating ? <><Loader2 size={13} className="animate-spin" /> Generating…</> : <><Sparkles size={13} /> Generate script</>}
          </button>
        </div>
      </div>

      {/* ── Generated script ─────────────────────────────────────────────── */}
      {output && (
        <ScriptOutput script={output.script} productTitle={output.productTitle} productImage={output.productImage} asin={output.asin} style={style} />
      )}

      {/* ── Recent scripts ───────────────────────────────────────────────── */}
      {recent.length > 0 && (
        <div className="card p-5 mt-6">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Recent scripts</p>
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3">Click any to re-open it. The script body stays exactly as Claude wrote it the first time — no re-generation, no token cost.</p>
          <div className="flex flex-col gap-1.5">
            {recent.map(s => {
              const meta = STYLE_META[s.style]
              const StyleIcon = meta.icon
              return (
                <div key={s.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-[#f5f5f7]/60 dark:hover:bg-white/5 group">
                  <button
                    onClick={() => void openRecent(s.id)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    {s.product_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.product_image_url} alt="" className="w-10 h-10 object-cover rounded border border-gray-200 dark:border-white/10 flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center flex-shrink-0"><ImageIcon size={13} className="text-[#86868b]" /></div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{s.product_title || s.input}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="inline-flex items-center gap-0.5 text-[10px]" style={{ color: meta.accent }}>
                          <StyleIcon size={9} strokeWidth={2.5} /> {meta.label}
                        </span>
                        <span className="text-[10px] text-[#86868b]">· {new Date(s.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => void deleteRecent(s.id)}
                    className="text-[#86868b] hover:text-[#ff3b30] opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Delete script"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

// ── Rendered output ─────────────────────────────────────────────────────────
function ScriptOutput({
  script, productTitle, productImage, asin, style,
}: {
  script: ScriptPayload
  productTitle: string
  productImage: string | null
  asin: string | null
  style: Style
}) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const meta = STYLE_META[style]

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedSection(key)
      setTimeout(() => setCopiedSection(null), 1500)
    }).catch(() => { /* ignore */ })
  }

  function copyEntireScript() {
    const parts: string[] = []
    parts.push(`${productTitle} — ${meta.label}`)
    if (script.summary) parts.push(`\n${script.summary}\n`)
    for (const sec of script.sections) {
      parts.push(`\n### ${sec.label} (${fmtDuration(sec.durationSec)})`)
      if (sec.script) parts.push(`\n${sec.script}`)
      if (sec.shots?.length) parts.push(`\nShots:\n${sec.shots.map(x => `  • ${x}`).join('\n')}`)
      if (sec.bRoll?.length) parts.push(`\nB-roll:\n${sec.bRoll.map(x => `  • ${x}`).join('\n')}`)
      if (sec.tips?.length) parts.push(`\nTips:\n${sec.tips.map(x => `  • ${x}`).join('\n')}`)
    }
    copy(parts.join('\n'), 'whole')
  }

  return (
    <div className="card p-5">
      {/* Header — product hero + total runtime + style chip */}
      <div className="flex items-start gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-white/10">
        {productImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={productImage} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-200 dark:border-white/10 flex-shrink-0" />
        ) : (
          <div className="w-20 h-20 rounded-lg bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center flex-shrink-0"><ImageIcon size={20} className="text-[#86868b]" /></div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${meta.accent}1f`, color: meta.accent }}>
              {meta.label}
            </span>
            <span className="inline-flex items-center gap-0.5 text-[11px] text-[#6e6e73]"><Clock size={11} /> {fmtDuration(script.totalDurationSec)}</span>
            {asin && (
              <a href={`https://www.amazon.com/dp/${asin}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-[#0071e3] hover:underline">
                {asin} <ExternalLink size={9} />
              </a>
            )}
          </div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug">{productTitle}</h2>
          {script.summary && <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-1.5 leading-relaxed">{script.summary}</p>}
        </div>
        <button
          onClick={copyEntireScript}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-white/10 hover:border-[#0071e3] text-[#3a3a3c] dark:text-[#d2d2d7] flex-shrink-0"
        >
          {copiedSection === 'whole' ? <><CheckCircle size={11} /> Copied</> : <><Copy size={11} /> Copy all</>}
        </button>
      </div>

      {/* Sections */}
      <div className="flex flex-col gap-2.5">
        {script.sections.map((sec, idx) => {
          const isCollapsed = collapsed[sec.id]
          return (
            <div key={sec.id} className="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setCollapsed(prev => ({ ...prev, [sec.id]: !prev[sec.id] }))}
                className="w-full flex items-center gap-2.5 p-3 bg-[#f5f5f7]/50 dark:bg-white/5 hover:bg-[#f5f5f7] dark:hover:bg-white/10 text-left"
                aria-expanded={!isCollapsed}
              >
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#1d1d1f] text-white text-[11px] font-bold flex-shrink-0">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{sec.label}</p>
                </div>
                <span className="text-[11px] text-[#86868b] flex-shrink-0">{fmtDuration(sec.durationSec)}</span>
                {isCollapsed ? <ChevronRight size={14} className="text-[#86868b] flex-shrink-0" /> : <ChevronDown size={14} className="text-[#86868b] flex-shrink-0" />}
              </button>
              {!isCollapsed && (
                <div className="p-4 flex flex-col gap-4">
                  {sec.script && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-[#86868b] font-semibold flex items-center gap-1"><FileText size={10} /> Script</p>
                        <button
                          onClick={() => copy(sec.script, `${sec.id}:script`)}
                          className="text-[10px] text-[#0071e3] hover:underline flex items-center gap-0.5"
                        >
                          {copiedSection === `${sec.id}:script` ? <><CheckCircle size={9} /> Copied</> : <><Copy size={9} /> Copy</>}
                        </button>
                      </div>
                      <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed whitespace-pre-wrap">{sec.script}</p>
                    </div>
                  )}
                  {sec.shots?.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[#86868b] font-semibold flex items-center gap-1 mb-1.5"><Camera size={10} /> Shots</p>
                      <ul className="flex flex-col gap-1">
                        {sec.shots.map((s, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[13px] text-[#3a3a3c] dark:text-[#d2d2d7]">
                            <span className="text-[#0071e3] flex-shrink-0 mt-0.5">•</span> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {sec.bRoll?.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[#86868b] font-semibold flex items-center gap-1 mb-1.5"><Film size={10} /> B-roll</p>
                      <ul className="flex flex-col gap-1">
                        {sec.bRoll.map((s, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[13px] text-[#3a3a3c] dark:text-[#d2d2d7]">
                            <span className="text-[#34c759] flex-shrink-0 mt-0.5">•</span> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {sec.tips?.length > 0 && (
                    <div className="rounded-md bg-[#ff9500]/8 border border-[#ff9500]/20 p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-[#9a5d00] font-semibold mb-1">On-set tips</p>
                      <ul className="flex flex-col gap-0.5">
                        {sec.tips.map((s, i) => (
                          <li key={i} className="text-[12px] text-[#9a5d00] leading-snug">→ {s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
