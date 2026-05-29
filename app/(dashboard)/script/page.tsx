'use client'

/**
 * Video Script & Shot List generator — UGC pre-production tool.
 *
 * Styles (2026-05-28 reframe — time-based, mapped to buyer-research stage):
 *   • First Look — 60-90s vertical, the just-got-it teaser
 *   • Hands-On Test — 3-6 min horizontal master + auto vertical short cutdown
 *   • Long-Term Review — 8-12 min horizontal + auto vertical short cutdown
 *
 * Pro-only feature. 30 generations / UTC calendar month. Trial / Creator see
 * an upsell card instead of the generator.
 *
 * Output shape:
 *   - 3 hook variants (problem-first / question / trade-off tease) the creator
 *     picks ONE from before filming
 *   - Sections with scripted-or-improvised marker (hook + verdict + close are
 *     word-for-word; middle sections are talking points)
 *   - Subject-only shot list
 *   - Auto vertical short cutdown (hands-on + long-term only) written FRESH
 *
 * Legacy rows (style = unboxing / quick_test / full_review, no hooks array,
 * has bRoll + tips) still render via fallbacks below.
 */
import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/Header'
import {
  Loader2, AlertCircle, Sparkles, ChevronRight, ChevronDown,
  Camera, FileText, Copy, CheckCircle, Trash2, Eye,
  Clock, Image as ImageIcon, ExternalLink, Smartphone,
  Hand, Calendar, Lock, ArrowUpRight, Lightbulb,
} from 'lucide-react'

// New style enum + legacy compatibility for rows generated before the rebuild.
type Style = 'first_look' | 'hands_on' | 'long_term'
type LegacyStyle = 'unboxing' | 'quick_test' | 'full_review'
type AnyStyle = Style | LegacyStyle

interface ScriptSection {
  id: string
  label: string
  durationSec: number
  /** Scripted sections — verbatim voiceover. */
  script: string
  /** Improvised sections — beats + suggested lines. (Legacy rows: undefined.) */
  talkingPoints?: string[]
  /** Subject-only shots. */
  shots: string[]
  /** Legacy fields — only present on old rows; renderer falls back to them. */
  bRoll?: string[]
  tips?: string[]
}

interface ShortCutdown {
  hook: string
  script: string
  shots: string[]
  durationSec: number
}

interface ScriptPayload {
  summary: string
  totalDurationSec: number
  /** 3 hook variants — present on new rows only. Legacy: undefined. */
  hooks?: string[]
  sections: ScriptSection[]
  /** Auto vertical short — hands_on + long_term only. */
  shortCutdown?: ShortCutdown
}

interface ScriptSummary {
  id: string
  style: AnyStyle
  input: string
  asin: string | null
  product_title: string | null
  product_image_url: string | null
  created_at: string
}

interface UsageInfo {
  allowed: boolean
  tier: 'trial' | 'creator' | 'pro' | 'admin'
  used: number
  cap: number | null
  remaining: number | null
  resetLabel: string | null
  upgrade: { tier: string; label: string; limit: number | null } | null
  reason: string | null
}

const STYLE_META: Record<AnyStyle, { label: string; tag: string; runtime: string; icon: typeof Smartphone; accent: string }> = {
  // New (post 2026-05-28)
  first_look: { label: 'First Look',       tag: 'Just got it',         runtime: '60-90 sec',  icon: Smartphone, accent: '#5856d6' },
  hands_on:   { label: 'Hands-On Test',    tag: 'Decision moment',     runtime: '3-6 min',    icon: Hand,       accent: '#0071e3' },
  long_term:  { label: 'Long-Term Review', tag: 'After weeks of use',  runtime: '8-12 min',   icon: Calendar,   accent: '#34c759' },
  // Legacy — kept for old rows so the recent strip doesn't crash. Not
  // selectable from the style picker.
  unboxing:    { label: 'Unboxing',    tag: 'Legacy',               runtime: '~4 min',     icon: Smartphone, accent: '#8e8e93' },
  quick_test:  { label: 'Quick Test',  tag: 'Legacy',               runtime: '~6 min',     icon: Hand,       accent: '#8e8e93' },
  full_review: { label: 'Full Review', tag: 'Legacy',               runtime: '~12 min',    icon: Calendar,   accent: '#8e8e93' },
}

const NEW_STYLES: Style[] = ['first_look', 'hands_on', 'long_term']

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

export default function ScriptPage() {
  const [input, setInput] = useState('')
  const [style, setStyle] = useState<Style>('hands_on')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<{
    script: ScriptPayload
    productTitle: string
    productImage: string | null
    asin: string | null
    scriptId?: string
    style: AnyStyle
  } | null>(null)
  const [recent, setRecent] = useState<ScriptSummary[]>([])
  const [usage, setUsage] = useState<UsageInfo | null>(null)

  const loadRecent = useCallback(async () => {
    try {
      const r = await fetch('/api/script/list')
      const d = await r.json()
      if (r.ok) {
        setRecent(d.scripts || [])
        if (d.usage) setUsage(d.usage as UsageInfo)
      }
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
        style,
      })
      // Server returns the post-increment usage on success.
      if (d.usage) {
        setUsage(prev => prev ? {
          ...prev,
          used: d.usage.used,
          cap: d.usage.cap,
          remaining: d.usage.remaining,
          resetLabel: d.usage.resetLabel ?? prev.resetLabel,
        } : prev)
      }
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
        style: row.style as AnyStyle,
      })
      setInput(row.input || '')
      // Only sync the picker when the row's style is a current one.
      if (NEW_STYLES.includes(row.style as Style)) setStyle(row.style as Style)
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

  const blocked = usage && !usage.allowed
  const subtitle = (() => {
    if (!usage) return 'Paste a product, pick a style, get a film-ready script in your voice.'
    if (!usage.allowed) return 'Pro feature — generate film-ready scripts grounded in real product info.'
    if (usage.cap === null) return 'Pro · unlimited generations. Pick a style and go.'
    return `Pro · ${usage.used} of ${usage.cap} scripts used this month${usage.resetLabel ? ` · resets ${usage.resetLabel}` : ''}.`
  })()

  return (
    <>
      <Header
        title="Video Script & Shot List"
        subtitle={subtitle}
      />

      {/* ── Pro upsell — replaces the form for Trial / Creator ───────────── */}
      {blocked ? (
        <UpsellCard usage={usage!} />
      ) : (
        <>
          {/* Usage meter — only shown for Pro (admin shows unlimited inline above) */}
          {usage && usage.cap !== null && usage.cap > 0 && (
            <UsageMeter used={usage.used} cap={usage.cap} resetLabel={usage.resetLabel} />
          )}

          {/* ── Input form ───────────────────────────────────────────── */}
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
              {NEW_STYLES.map(s => {
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

            {/* Brief "what you'll get" hint — sets expectations before the click. */}
            <div className="mb-4 rounded-lg bg-[#5856d6]/5 border border-[#5856d6]/15 p-3 flex items-start gap-2.5">
              <Lightbulb size={14} className="text-[#5856d6] flex-shrink-0 mt-0.5" />
              <div className="text-[12px] text-[#3a3a3c] dark:text-[#d2d2d7] leading-relaxed">
                You&apos;ll get <strong>3 hook variants</strong> to pick from, a beat-by-beat structure with scripted hook + verdict, talking points for the middle, and a subject-only shot list.
                {(style === 'hands_on' || style === 'long_term') && <> A <strong>vertical short cutdown</strong> is written from scratch for TikTok / Reels / YT Shorts.</>}
              </div>
            </div>

            {error && (
              <div className="mb-3 card p-3 border-[#ff3b30]/20 bg-[#ff3b30]/5">
                <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>
              </div>
            )}

            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">MVP writes it in your brand voice, grounded in the product info we scrape.</p>
              <button
                onClick={() => void generate()}
                disabled={generating || !input.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50"
              >
                {generating ? <><Loader2 size={13} className="animate-spin" /> Generating…</> : <><Sparkles size={13} /> Generate script</>}
              </button>
            </div>
          </div>

          {/* ── Generated script ─────────────────────────────────────── */}
          {output && (
            <ScriptOutput
              script={output.script}
              productTitle={output.productTitle}
              productImage={output.productImage}
              asin={output.asin}
              style={output.style}
            />
          )}
        </>
      )}

      {/* ── Recent scripts (still shown to Trial / Creator if they have any
          legacy rows from earlier access) ─────────────────────────────────── */}
      {recent.length > 0 && (
        <div className="card p-5 mt-6">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Recent scripts</p>
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3">Click any to re-open it. The script body stays exactly as MVP wrote it — no re-generation, no token cost.</p>
          <div className="flex flex-col gap-1.5">
            {recent.map(s => {
              const meta = STYLE_META[s.style] ?? STYLE_META.hands_on
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

// ── Usage meter ─────────────────────────────────────────────────────────────
function UsageMeter({ used, cap, resetLabel }: { used: number; cap: number; resetLabel: string | null }) {
  const pct = Math.min(100, Math.round((used / cap) * 100))
  const remaining = Math.max(0, cap - used)
  const accent = pct >= 90 ? '#ff3b30' : pct >= 70 ? '#ff9500' : '#0071e3'
  return (
    <div className="card p-4 mb-5 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7]">Scripts this month</p>
          <p className="text-xs font-semibold" style={{ color: accent }}>
            {used} / {cap}{remaining === 0 ? ' · cap hit' : ''}
          </p>
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: accent }} />
        </div>
        {resetLabel && (
          <p className="text-[11px] text-[#86868b] mt-1.5">Resets {resetLabel}.</p>
        )}
      </div>
    </div>
  )
}

// ── Pro upsell (Trial + Creator) ────────────────────────────────────────────
function UpsellCard({ usage }: { usage: UsageInfo }) {
  return (
    <div className="card p-6 mb-5 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#5856d6]/10 via-transparent to-[#0071e3]/10 pointer-events-none" aria-hidden />
      <div className="relative">
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#5856d6]/15 text-[#5856d6] text-[11px] font-semibold uppercase tracking-wide mb-3">
          <Lock size={11} /> Pro feature
        </div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Get film-ready scripts in your voice</h2>
        <p className="text-sm text-[#3a3a3c] dark:text-[#d2d2d7] leading-relaxed max-w-xl mb-4">
          {usage.reason || 'Video scripts are a Pro feature.'} Paste a product, pick a style, get a 3-6 min review script with three hook variants to pick from, scripted hook and verdict, beat-by-beat talking points for the middle, and an auto vertical short for TikTok / Reels / YT Shorts.
        </p>
        <ul className="text-[13px] text-[#3a3a3c] dark:text-[#d2d2d7] mb-5 flex flex-col gap-1.5 max-w-lg">
          <li className="flex items-start gap-2"><CheckCircle size={13} className="text-[#34c759] flex-shrink-0 mt-0.5" /> <span>First Look · Hands-On Test · Long-Term Review — three time-based styles</span></li>
          <li className="flex items-start gap-2"><CheckCircle size={13} className="text-[#34c759] flex-shrink-0 mt-0.5" /> <span>Vertical short cutdown written fresh — not lifted from the long master</span></li>
          <li className="flex items-start gap-2"><CheckCircle size={13} className="text-[#34c759] flex-shrink-0 mt-0.5" /> <span>30 generations per month — comfortably 2 per business day</span></li>
        </ul>
        <a
          href="/billing"
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#5856d6] hover:bg-[#4845b4]"
        >
          Upgrade to {usage.upgrade?.label || 'Pro'} <ArrowUpRight size={14} />
        </a>
      </div>
    </div>
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
  style: AnyStyle
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [chosenHook, setChosenHook] = useState<number>(0)
  const meta = STYLE_META[style] ?? STYLE_META.hands_on

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 1500)
    }).catch(() => { /* ignore */ })
  }

  function copyEntireScript() {
    const parts: string[] = []
    parts.push(`${productTitle} — ${meta.label}`)
    if (script.summary) parts.push(`\n${script.summary}\n`)
    if (script.hooks && script.hooks.length > 0) {
      parts.push(`\n## HOOKS (pick one before filming)\n`)
      script.hooks.forEach((h, i) => parts.push(`Hook ${i + 1}: ${h}`))
    }
    for (const sec of script.sections) {
      parts.push(`\n### ${sec.label} (${fmtDuration(sec.durationSec)})`)
      if (sec.script) parts.push(`\n${sec.script}`)
      else if (sec.talkingPoints?.length) parts.push(`\nTalking points:\n${sec.talkingPoints.map(x => `  • ${x}`).join('\n')}`)
      if (sec.shots?.length) parts.push(`\nShots:\n${sec.shots.map(x => `  • ${x}`).join('\n')}`)
      // Legacy fields — only if old row.
      if (sec.bRoll?.length) parts.push(`\nB-roll:\n${sec.bRoll.map(x => `  • ${x}`).join('\n')}`)
      if (sec.tips?.length) parts.push(`\nTips:\n${sec.tips.map(x => `  • ${x}`).join('\n')}`)
    }
    if (script.shortCutdown) {
      const sc = script.shortCutdown
      parts.push(`\n\n## VERTICAL SHORT CUTDOWN (${fmtDuration(sc.durationSec)})`)
      parts.push(`\nHook: ${sc.hook}`)
      parts.push(`\n${sc.script}`)
      if (sc.shots?.length) parts.push(`\nShots:\n${sc.shots.map(x => `  • ${x}`).join('\n')}`)
    }
    copy(parts.join('\n'), 'whole')
  }

  const hasHooks = Array.isArray(script.hooks) && script.hooks.some(h => h && h.trim().length > 0)

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
          <div className="flex items-center gap-2 mb-1 flex-wrap">
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
          {copiedKey === 'whole' ? <><CheckCircle size={11} /> Copied</> : <><Copy size={11} /> Copy all</>}
        </button>
      </div>

      {/* ── 3 Hook Variants ─────────────────────────────────────────────── */}
      {hasHooks && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-wide text-[#5856d6] font-semibold flex items-center gap-1">
              <Eye size={11} /> Pick your hook — 3 options
            </p>
            <p className="text-[10px] text-[#86868b]">Tap one to lock it in for filming.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {script.hooks!.map((h, i) => {
              const active = chosenHook === i
              const labels = ['Problem-first', 'Question / wait-for-it', 'Trade-off tease']
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setChosenHook(i)}
                  className={`text-left p-3 rounded-lg border-2 transition-all ${active ? 'border-[#5856d6] bg-[#5856d6]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#5856d6]/40'}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-[#5856d6]">{labels[i] || `Variant ${i + 1}`}</span>
                    {active && <CheckCircle size={11} className="text-[#5856d6]" />}
                  </div>
                  <p className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug">{h}</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); copy(h, `hook-${i}`) }}
                    className="mt-2 text-[10px] text-[#0071e3] hover:underline inline-flex items-center gap-0.5"
                  >
                    {copiedKey === `hook-${i}` ? <><CheckCircle size={9} /> Copied</> : <><Copy size={9} /> Copy this hook</>}
                  </button>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Sections */}
      <div className="flex flex-col gap-2.5">
        {script.sections.map((sec, idx) => {
          const isCollapsed = collapsed[sec.id]
          const isScripted = !!sec.script && sec.script.length > 0
          const isHook = sec.id === 'hook'
          // For the hook section on a new row, show the user's currently
          // chosen hook variant rather than whatever the model put under
          // section.script.
          const renderedScript = isHook && hasHooks ? (script.hooks![chosenHook] || sec.script) : sec.script
          return (
            <div key={sec.id} className="border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setCollapsed(prev => ({ ...prev, [sec.id]: !prev[sec.id] }))}
                className="w-full flex items-center gap-2.5 p-3 bg-[#f5f5f7]/50 dark:bg-white/5 hover:bg-[#f5f5f7] dark:hover:bg-white/10 text-left"
                aria-expanded={!isCollapsed}
              >
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#1d1d1f] text-white text-[11px] font-bold flex-shrink-0">{idx + 1}</span>
                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{sec.label}</p>
                  {isScripted || isHook
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#5856d6]/12 text-[#5856d6] font-semibold uppercase tracking-wide">Scripted</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#34c759]/12 text-[#34c759] font-semibold uppercase tracking-wide">Improvised</span>
                  }
                </div>
                <span className="text-[11px] text-[#86868b] flex-shrink-0">{fmtDuration(sec.durationSec)}</span>
                {isCollapsed ? <ChevronRight size={14} className="text-[#86868b] flex-shrink-0" /> : <ChevronDown size={14} className="text-[#86868b] flex-shrink-0" />}
              </button>
              {!isCollapsed && (
                <div className="p-4 flex flex-col gap-4">
                  {renderedScript && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-[#86868b] font-semibold flex items-center gap-1"><FileText size={10} /> Script (read off-camera)</p>
                        <button
                          onClick={() => copy(renderedScript, `${sec.id}:script`)}
                          className="text-[10px] text-[#0071e3] hover:underline flex items-center gap-0.5"
                        >
                          {copiedKey === `${sec.id}:script` ? <><CheckCircle size={9} /> Copied</> : <><Copy size={9} /> Copy</>}
                        </button>
                      </div>
                      <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed whitespace-pre-wrap">{renderedScript}</p>
                    </div>
                  )}
                  {sec.talkingPoints && sec.talkingPoints.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[#86868b] font-semibold flex items-center gap-1 mb-1.5"><Lightbulb size={10} /> Talking points (improvise these)</p>
                      <ul className="flex flex-col gap-1">
                        {sec.talkingPoints.map((s, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[13px] text-[#3a3a3c] dark:text-[#d2d2d7]">
                            <span className="text-[#34c759] flex-shrink-0 mt-0.5">•</span> {s}
                          </li>
                        ))}
                      </ul>
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
                  {/* Legacy fields — only render if old row carries them. */}
                  {sec.bRoll && sec.bRoll.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[#86868b] font-semibold mb-1.5">B-roll (legacy)</p>
                      <ul className="flex flex-col gap-1">
                        {sec.bRoll.map((s, i) => <li key={i} className="text-[13px] text-[#3a3a3c] dark:text-[#d2d2d7]">• {s}</li>)}
                      </ul>
                    </div>
                  )}
                  {sec.tips && sec.tips.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[#86868b] font-semibold mb-1.5">Tips (legacy)</p>
                      <ul className="flex flex-col gap-1">
                        {sec.tips.map((s, i) => <li key={i} className="text-[13px] text-[#3a3a3c] dark:text-[#d2d2d7]">→ {s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Vertical Short Cutdown ───────────────────────────────────────── */}
      {script.shortCutdown && (
        <div className="mt-5 rounded-xl border-2 border-[#5856d6]/25 bg-gradient-to-br from-[#5856d6]/5 to-transparent overflow-hidden">
          <div className="p-4 border-b border-[#5856d6]/15 flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#5856d6] text-white flex-shrink-0">
              <Smartphone size={15} strokeWidth={2.5} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Vertical short cutdown</p>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">Written from scratch for TikTok / Reels / YT Shorts · {fmtDuration(script.shortCutdown.durationSec)}</p>
            </div>
            <button
              onClick={() => copy(`${script.shortCutdown!.hook}\n\n${script.shortCutdown!.script}`, 'short')}
              className="text-[11px] text-[#5856d6] hover:underline flex items-center gap-0.5 flex-shrink-0"
            >
              {copiedKey === 'short' ? <><CheckCircle size={10} /> Copied</> : <><Copy size={10} /> Copy short</>}
            </button>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[#5856d6] font-semibold mb-1">Hook (first 3-5s)</p>
              <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed">{script.shortCutdown.hook}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[#86868b] font-semibold mb-1">Script</p>
              <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed whitespace-pre-wrap">{script.shortCutdown.script}</p>
            </div>
            {script.shortCutdown.shots.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[#86868b] font-semibold mb-1 flex items-center gap-1"><Camera size={10} /> Shots</p>
                <ul className="flex flex-col gap-1">
                  {script.shortCutdown.shots.map((s, i) => (
                    <li key={i} className="text-[13px] text-[#3a3a3c] dark:text-[#d2d2d7]">• {s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
