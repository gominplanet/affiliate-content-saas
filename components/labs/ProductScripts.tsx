// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// VIDEO SCRIPTS (Labs). Any product in: a TikTok Shop or Amazon link, any
// product page, a screenshot, or its name. Five short videos out (under a
// minute, shorter is better),
// scene by scene, written the way TRYBE's scripts are (lib/product-scripts).
// SCOUT reads an Amazon product and its reviews in the creator's own Chrome;
// what went in is said under the button, never implied.
'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Clapperboard, Copy, Check, ImagePlus, X, Printer, ChevronDown, ChevronUp } from 'lucide-react'
import TrybeFilmIt, { type FilmScript } from '@/components/labs/TrybeFilmIt'
import { BuyersCard, ScriptVideoCard, BuiltOnLine } from '@/components/labs/ScriptParts'
import { HOOK_STYLE_WORDS } from '@/lib/trybe-playbook'
import { PRODUCT_VIDEOS, PRODUCT_OPENER_VIDEOS, PRODUCT_BUILT_ON, productVideoText, productScriptsText, readWords, type ProductScripts as Scripts, type ReadReport } from '@/lib/product-scripts'
import { SCOUT_AMAZON_REVIEWS_MIN_VERSION } from '@/lib/scout-version'
import { readBuyersInChrome, shrinkPicture } from '@/lib/buyer-read-client'

const PURPLE = 'var(--accent)'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RECENT_KEY = 'mvp_product_scripts_v1'
const RECENT_MAX = 6

interface Kept { at: string; input: string; scripts: Scripts; read: ReadReport }

async function api(body: Record<string, unknown>) {
  const r = await fetch('/api/labs/product-scripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof d.error === 'string' ? d.error : `MVP answered ${r.status}.`)
  return d
}

function readKept(): Kept[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, RECENT_MAX) : [] } catch { return [] }
}
function keep(list: Kept[]) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))) } catch { /* private window: shown, not kept */ } }

/** `embedded`: inside TRYBE's Make videos, which shows its own heading. */
export default function ProductScripts({ embedded = false }: { embedded?: boolean } = {}) {
  const [input, setInput] = useState('')
  const [notes, setNotes] = useState('')
  const [notesOpen, setNotesOpen] = useState(false)
  const [image, setImage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Kept | null>(null)
  const [recent, setRecent] = useState<Kept[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [filming, setFilming] = useState<FilmScript | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setRecent(readKept()) }, [])

  const addFile = async (f: File | null | undefined) => {
    if (!f) return
    if (!/^image\//.test(f.type)) { toast.error('Add a picture: a screenshot of the product or its listing.'); return }
    try { setImage(await shrinkPicture(f)) } catch (e) { toast.error(e instanceof Error ? e.message : 'MVP could not open that picture.') }
  }

  const copyText = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 2000) } catch { toast.error('Could not copy. Select the text instead.') }
  }

  const printSet = (k: Kept) => {
    const w = window.open('', '_blank')
    if (!w) { toast.error('Your browser blocked the print window. Allow pop ups for MVP, or use Copy all.'); return }
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Video Scripts</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 16px;color:#111}pre{white-space:pre-wrap;font:inherit}</style><pre>${esc(productScriptsText(k.scripts))}</pre>`)
    w.document.close(); w.focus(); w.print()
  }

  async function write() {
    const text = input.trim()
    if (!text && !image) { setError('Paste a link, type the product, or add a screenshot.'); return }
    setBusy(true); setError(null); setResult(null)
    try {
      // THE BUYERS FIRST (lib/buyer-read-client): which product it is, and an
      // Amazon product's reviews read by SCOUT in this Chrome.
      const got = await readBuyersInChrome(text, (u) => api({ action: 'resolve', url: u }), setStep)
      const { url, asin, amazon, reviews, reviewsWhy } = got
      setStep(`Writing ${PRODUCT_VIDEOS} scripts, scene by scene. This takes about a minute.`)
      const d = await api({ action: 'write', input: text, url, asin, amazon, reviews, reviewsWhy, image, notes })
      const k: Kept = { at: new Date().toISOString(), input: text || 'Screenshot', scripts: d.scripts, read: d.read }
      setResult(k)
      const next = [k, ...recent.filter((x) => x.input !== k.input)].slice(0, RECENT_MAX)
      setRecent(next); keep(next)
    } catch (e) {
      setError(e instanceof Error ? (/abort|timed? ?out/i.test(e.message) ? 'The scripts took too long to write. Try again.' : e.message) : 'MVP could not write the scripts.')
    } finally { setBusy(false); setStep(null) }
  }

  const soft = { color: 'var(--text-soft)' }
  const card = 'rounded-xl border px-4 py-3'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
  const openers = result ? result.scripts.videos.filter((v) => v.opener).length : 0

  return (
    <div className={embedded ? 'flex flex-col gap-5' : 'max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-5'} onPaste={(e) => { const f = Array.from(e.clipboardData?.files || []).find((x) => /^image\//.test(x.type)); if (f) { e.preventDefault(); void addFile(f) } }}>
      {!embedded && <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-faint)' }}>Labs · Make videos</p>
        <h1 className="text-[24px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Video Scripts</h1>
        <p className="text-[13px] max-w-2xl" style={soft}>
          Drop in any product: a TikTok Shop or Amazon link, a product page, a screenshot, or just its name. MVP reads who buys it and why, then writes {PRODUCT_VIDEOS} short videos, scene by scene, under a minute each and nothing wasted, each opening on the real reason someone needs it.
        </p>
      </header>}

      <section className={card} style={cardStyle}>
        <label htmlFor="ps-input" className="text-[12px] font-bold uppercase tracking-wider" style={soft}>The product</label>
        <div className="mt-1.5 flex flex-col sm:flex-row gap-2">
          <input id="ps-input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void write() }}
            placeholder="Paste a TikTok Shop or Amazon link, or type the product"
            className="flex-1 min-w-0 rounded-lg border px-3 py-2 text-[14px]" style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            <ImagePlus size={15} /> {image ? 'Change screenshot' : 'Add a screenshot'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void addFile(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        {image && (
          <div className="mt-2 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="Your screenshot" className="h-16 w-auto rounded-md border" style={{ borderColor: 'var(--border)' }} />
            <button type="button" onClick={() => setImage(null)} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={soft}><X size={13} /> Remove</button>
          </div>
        )}
        <p className="mt-1.5 text-[12px]" style={soft}>You can also paste a screenshot straight onto this page.</p>
        <button type="button" onClick={() => setNotesOpen((o) => !o)} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: PURPLE }}>
          {notesOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Anything to work in (optional)
        </button>
        {notesOpen && (
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1200}
            placeholder="Who you film for, a moment you had with it, what the brand asked for"
            className="mt-1.5 w-full rounded-lg border px-3 py-2 text-[13.5px]" style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void write()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-bold disabled:opacity-60" style={{ background: 'var(--accent)', color: '#fff' }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />} Write {PRODUCT_VIDEOS} scripts
          </button>
          {step && <span className="text-[12.5px]" style={soft}>{step}</span>}
        </div>
        {error && <p className="mt-2 text-[13px]" style={{ color: AMBER }}>{error}</p>}
      </section>

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={soft}>Recent</span>
          {recent.map((k) => {
            const on = result?.at === k.at
            return (
              <button key={k.at} type="button" onClick={() => setResult(k)} aria-pressed={on} className="rounded-full border px-2.5 py-0.5 text-[12px] font-semibold max-w-[260px] truncate"
                style={on ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' } : { borderColor: 'var(--border)', color: 'var(--text)' }}>
                {k.scripts.product || k.input}
              </button>
            )
          })}
        </div>
      )}

      {filming && <TrybeFilmIt script={filming} onClose={() => setFilming(null)} />}

      {result && (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px]" style={{ color: result.read.reviews || result.read.critical || result.read.productRead ? GREEN : AMBER }}>{readWords(result.read, SCOUT_AMAZON_REVIEWS_MIN_VERSION)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyText('all', productScriptsText(result.scripts))} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              {copied === 'all' ? <Check size={13} /> : <Copy size={13} />} {copied === 'all' ? 'Copied' : 'Copy all'}
            </button>
            <button type="button" onClick={() => printSet(result)} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              <Printer size={13} /> Print or save as PDF
            </button>
          </div>

          <BuyersCard b={result.scripts.buyers} fromReviews={result.read.reviews > 0 || result.read.critical > 0 || result.read.customersSay} />

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={soft}>{result.scripts.videos.length} videos{result.scripts.product ? `: ${result.scripts.product}` : ''}</p>
            <BuiltOnLine videos={result.scripts.videos} asked={PRODUCT_BUILT_ON} examples={result.read.examples} />
            <p className="mt-0.5 text-[12px]" style={{ color: openers >= PRODUCT_OPENER_VIDEOS ? GREEN : AMBER }}>
              {openers === 0 ? 'None of these open with one of your proven openers. Write them again for another try.' : `${openers} of ${result.scripts.videos.length} open with one of your proven openers${openers < PRODUCT_OPENER_VIDEOS ? `, fewer than the ${PRODUCT_OPENER_VIDEOS} MVP asked for` : ''}.`}
            </p>
          </div>
          <ol className="flex flex-col gap-2.5">
            {result.scripts.videos.map((v, i) => (
              <ScriptVideoCard key={i} v={v} n={i + 1} copied={copied === `v${i}`}
                onCopy={() => void copyText(`v${i}`, productVideoText(v, i + 1))}
                onFilm={() => setFilming({ title: `${i + 1}. ${v.angle || HOOK_STYLE_WORDS[v.style]}`, say: v.say?.length ? v.say : [v.hook, ...v.beats, v.cta].filter(Boolean), broll: v.broll || [], shot: v.shot || null, onScreen: v.onScreen || null })} />
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

