// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Live prep: pick the products, get the show.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Radio, Check, Printer, MonitorPlay, Trash2, ChevronLeft, ChevronRight, X, Tag, MessageCircle, Search } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import { clockLabel, LIVE_LENGTHS, LIVE_MAX_PRODUCTS, type LivePlan, type LiveSegment } from '@/lib/live-plan'

const ACCENT = '#0E7C86'

interface PoolProduct { asin: string; title: string; image: string | null; videos: number; inStorefront: boolean; saleLabel: string | null }
interface IdeaList { id: string; title: string; asins: string[] }
interface SavedPlan { id: string; title: string; minutes: number; products: string[]; updated_at: string }

type Filter = 'all' | 'videos' | 'sale' | string

/** One line of the run of show. */
function Row({ at, minutes, label, sub }: { at: number; minutes: number; label: string; sub?: string }) {
  return (
    <li className="grid grid-cols-[64px_1fr_auto] gap-3 items-baseline py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
      <span className="text-[12px] font-mono tabular-nums" style={{ color: ACCENT }}>{clockLabel(at)}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{label}</span>
        {sub && <span className="block text-[11.5px]" style={{ color: 'var(--text-soft)' }}>{sub}</span>}
      </span>
      <span className="text-[11.5px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{minutes} min</span>
    </li>
  )
}

function SegmentCard({ s, n }: { s: LiveSegment; n: number }) {
  return (
    <section className="rounded-2xl border p-4 break-inside-avoid" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-start gap-3">
        {s.image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={s.image} alt="" className="w-14 h-14 rounded-xl object-contain bg-white border shrink-0" />
          : <div className="w-14 h-14 rounded-xl shrink-0" style={{ background: 'var(--surface-hover)' }} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
            <span className="font-mono tabular-nums font-semibold" style={{ color: ACCENT }}>{clockLabel(s.startMin)}</span>
            <span style={{ color: 'var(--text-faint)' }}>· {s.minutes} min · product {n}</span>
            {s.saleLabel && (
              <span className="inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(228,87,46,0.12)', color: '#E4572E' }}>
                <Tag size={10} /> On sale
              </span>
            )}
          </div>
          <p className="text-[14px] font-semibold mt-0.5" style={{ color: 'var(--text)' }}>{s.title}</p>
          {s.fromVideo && <p className="text-[11.5px]" style={{ color: 'var(--text-soft)' }}>From your video &quot;{s.fromVideo}&quot;</p>}
        </div>
      </div>
      <p className="text-[13.5px] mt-3 italic" style={{ color: 'var(--text)' }}>&ldquo;{s.hook}&rdquo;</p>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-soft)' }}>Say</p>
          <ul className="list-disc pl-4 text-[13px] flex flex-col gap-1" style={{ color: 'var(--text)' }}>
            {s.talkingPoints.map((t, k) => <li key={k}>{t}</li>)}
          </ul>
        </div>
        {s.show.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-soft)' }}>Show on camera</p>
            <ul className="list-disc pl-4 text-[13px] flex flex-col gap-1" style={{ color: 'var(--text)' }}>
              {s.show.map((t, k) => <li key={k}>{t}</li>)}
            </ul>
          </div>
        )}
      </div>
      {s.questions.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-soft)' }}>Likely in chat</p>
          <dl className="flex flex-col gap-1.5 text-[12.5px]">
            {s.questions.map((q, k) => (
              <div key={k}>
                <dt className="font-medium" style={{ color: 'var(--text)' }}>{q.q}</dt>
                <dd style={{ color: 'var(--text-soft)' }}>{q.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  )
}

/** Full-screen, large type, one segment at a time, arrow keys to move. */
function Teleprompter({ plan, onClose }: { plan: LivePlan; onClose: () => void }) {
  const cards = useMemo(() => [
    { key: 'open', at: 0, title: 'Opening', lines: [plan.opening.script], extra: [] as string[] },
    ...plan.segments.map((s) => ({
      key: s.asin, at: s.startMin, title: s.title,
      lines: [s.hook, ...s.talkingPoints],
      extra: s.show.map((x) => `Show: ${x}`),
    })),
    { key: 'close', at: plan.closing.startMin, title: 'Closing', lines: [plan.closing.script], extra: [] },
  ], [plan])
  const [i, setI] = useState(0)
  const [started, setStarted] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); setI((v) => Math.min(cards.length - 1, v + 1)) }
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => { window.removeEventListener('keydown', key); clearInterval(t) }
  }, [cards.length, onClose])
  const c = cards[i]
  const elapsed = started ? Math.floor((now - started) / 1000) : 0
  // BEHIND means past the time the NEXT part was due to start, not past the
  // start of this one: two minutes into a four minute slot is on time.
  const nextAt = cards[i + 1]?.at ?? plan.minutes
  const behind = started ? Math.floor(elapsed / 60) - nextAt : 0
  const prompts = plan.chatPrompts.filter((p) => p.atMin >= c.at && p.atMin < (cards[i + 1]?.at ?? Infinity))
  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: '#0b0d0f', color: '#f4f4f5' }} role="dialog" aria-label="Teleprompter">
      <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: '#23272b' }}>
        <span className="text-[13px] font-mono tabular-nums">{clockLabel(c.at)} · {i + 1} of {cards.length}</span>
        {started
          ? <span className="text-[13px] font-mono tabular-nums" style={{ color: behind > 1 ? '#f59e0b' : '#34d399' }}>
              Live {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}{behind > 1 ? `, ${behind} min behind` : ''}
            </span>
          : <button type="button" onClick={() => setStarted(Date.now())} className="text-[13px] px-3 py-1 rounded-lg" style={{ background: '#E4572E' }}>Start the clock</button>}
        <span className="ml-auto text-[12px]" style={{ color: '#9ca3af' }}>Arrow keys or space to move, Esc to close</span>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg" style={{ background: '#1f2328' }}><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 sm:px-16 py-10">
        <p className="text-[18px] mb-4" style={{ color: '#9ca3af' }}>{c.title}</p>
        <div className="flex flex-col gap-6">
          {c.lines.filter(Boolean).map((l, k) => <p key={k} className="text-[34px] sm:text-[44px] leading-tight font-semibold">{l}</p>)}
        </div>
        {c.extra.length > 0 && (
          <ul className="mt-8 flex flex-col gap-2 text-[22px]" style={{ color: '#7dd3fc' }}>
            {c.extra.map((x, k) => <li key={k}>{x}</li>)}
          </ul>
        )}
        {prompts.map((p, k) => (
          <p key={k} className="mt-8 text-[22px] inline-flex items-center gap-2" style={{ color: '#fbbf24' }}>
            <MessageCircle size={20} /> Ask the chat: {p.text}
          </p>
        ))}
      </div>
      <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: '#23272b' }}>
        <button type="button" onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0}
          className="inline-flex items-center gap-1 px-4 py-2 rounded-lg disabled:opacity-30" style={{ background: '#1f2328' }}>
          <ChevronLeft size={18} /> Back
        </button>
        <span className="text-[13px] truncate px-3" style={{ color: '#9ca3af' }}>{cards[i + 1] ? `Next: ${cards[i + 1].title}` : 'Last one'}</span>
        <button type="button" onClick={() => setI((v) => Math.min(cards.length - 1, v + 1))} disabled={i === cards.length - 1}
          className="inline-flex items-center gap-1 px-4 py-2 rounded-lg disabled:opacity-30" style={{ background: '#1f2328' }}>
          Next <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

export default function AmazonLive() {
  const [pool, setPool] = useState<PoolProduct[] | null>(null)
  const [lists, setLists] = useState<IdeaList[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState<number>(45)
  const [notes, setNotes] = useState('')
  const [building, setBuilding] = useState(false)
  const [plan, setPlan] = useState<LivePlan | null>(null)
  const [planId, setPlanId] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedPlan[]>([])
  const [savedErr, setSavedErr] = useState<string | null>(null)
  const [prompter, setPrompter] = useState(false)

  const loadSaved = useCallback(async () => {
    const r = await fetch('/api/live/plans').catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r || !r.ok) { setSavedErr(j?.error || 'Could not load your saved shows.'); return }
    setSavedErr(null)
    setSaved(Array.isArray(j?.plans) ? j.plans : [])
  }, [])

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/live/products').catch(() => null)
      const j = r ? await r.json().catch(() => ({})) : {}
      if (!r || !r.ok) { setLoadErr(j?.error || 'Could not load your products.'); return }
      setPool(j.products ?? [])
      setLists(j.lists ?? [])
    })()
    void loadSaved()
  }, [loadSaved])

  const shown = useMemo(() => {
    if (!pool) return []
    const inList = lists.find((l) => l.id === filter)
    const needle = q.trim().toLowerCase()
    return pool.filter((p) =>
      (filter === 'all' || (filter === 'videos' && p.videos > 0) || (filter === 'sale' && !!p.saleLabel) || (inList && inList.asins.includes(p.asin)))
      && (!needle || p.title.toLowerCase().includes(needle) || p.asin.toLowerCase().includes(needle)))
      .sort((a, b) => Number(!!b.saleLabel) - Number(!!a.saleLabel) || b.videos - a.videos)
  }, [pool, lists, filter, q])

  function toggle(asin: string) {
    if (!picked.includes(asin) && picked.length >= LIVE_MAX_PRODUCTS) {
      toast.error(`A show holds ${LIVE_MAX_PRODUCTS} products at most.`)
      return
    }
    setPicked((cur) => cur.includes(asin) ? cur.filter((a) => a !== asin) : [...cur, asin])
  }
  function move(asin: string, d: -1 | 1) {
    setPicked((cur) => {
      const i = cur.indexOf(asin), j = i + d
      if (i < 0 || j < 0 || j >= cur.length) return cur
      const next = [...cur]; [next[i], next[j]] = [next[j], next[i]]; return next
    })
  }

  async function build() {
    setBuilding(true)
    try {
      await buildInner()
    } catch { toast.error('Could not reach the server.') } finally { setBuilding(false) }
  }
  async function buildInner() {
    const titles: Record<string, string> = {}
    for (const a of picked) { const p = pool?.find((x) => x.asin === a); if (p) titles[a] = p.title }
    const r = await fetch('/api/live/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || 'Amazon Live', minutes, asins: picked, notes, titles }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j?.error || 'Could not build the show.'); return }
    setPlan(j.plan); setPlanId(j.id ?? null)
    if (!j.saved) toast.error(j.saveError || 'The plan was built but not saved.')
    else { toast.success('Show ready and saved'); void loadSaved() }
  }

  async function openSaved(id: string) {
    const r = await fetch(`/api/live/plans/${id}`).catch(() => null)
    if (!r) { toast.error('Could not reach the server.'); return }
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j?.error || 'Could not open that plan.'); return }
    setPlan(j.plan); setPlanId(id)
  }
  async function removeSaved(id: string) {
    const r = await fetch(`/api/live/plans/${id}`, { method: 'DELETE' }).catch(() => null)
    if (!r || !r.ok) { toast.error('Could not delete it.'); return }
    if (planId === id) { setPlan(null); setPlanId(null) }
    void loadSaved()
  }

  const deals = plan?.segments.filter((s) => s.saleLabel) ?? []
  const chip = (on: boolean) => on
    ? { background: ACCENT, color: '#fff' }
    : { background: 'var(--surface-2)', color: 'var(--text-soft)' }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Print only the plan. */}
      <style>{`@media print {
        html, body, body * { overflow: visible !important; height: auto !important; max-height: none !important; }
        body * { visibility: hidden !important; }
        .live-print, .live-print * { visibility: visible !important; color: #111 !important; background: #fff !important; border-color: #ccc !important; }
        .live-print { position: absolute; left: 0; top: 0; width: 100%; }
        .no-print { display: none !important; }
      }`}</style>
      <PageHero
        accent={ACCENT}
        title="Amazon Live prep"
        subtitle="Pick the products, and MVP builds your show: the order, the timings, what to say about each one from your own reviews, and what viewers will ask."
      />

      {loadErr && <p className="text-[13px] py-6 text-center" style={{ color: '#ef4444' }}>{loadErr}</p>}

      {!plan && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {[['all', 'Everything'], ['videos', 'From my videos'], ['sale', 'On sale today']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} className="px-2.5 py-1 rounded-full text-[12px]" style={chip(filter === k)}>{l}</button>
              ))}
              {lists.map((l) => (
                <button key={l.id} type="button" onClick={() => setFilter(l.id)} className="px-2.5 py-1 rounded-full text-[12px] max-w-[180px] truncate" style={chip(filter === l.id)}>{l.title}</button>
              ))}
            </div>
            <label className="relative block mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your products"
                className="w-full rounded-lg border pl-8 pr-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            </label>
            {!pool && !loadErr && (
              <p className="text-[13px] py-8 flex items-center justify-center gap-2" style={{ color: 'var(--text-soft)' }}>
                <Loader2 size={14} className="animate-spin" /> Loading your videos, storefront and idea lists…
              </p>
            )}
            {pool && shown.length === 0 && (
              <p className="text-[13px] py-8 text-center" style={{ color: 'var(--text-soft)' }}>
                {pool.length === 0 ? 'No products yet. Set the product on your videos, sync your storefront, or make an idea list.' : 'Nothing matches that.'}
              </p>
            )}
            <ul className="grid sm:grid-cols-2 gap-2 max-h-[560px] overflow-y-auto pr-1">
              {shown.map((p) => {
                const on = picked.includes(p.asin)
                return (
                  <li key={p.asin}>
                    <button type="button" onClick={() => toggle(p.asin)} aria-pressed={on}
                      className="w-full text-left flex items-center gap-2.5 rounded-xl border p-2.5"
                      style={{ borderColor: on ? ACCENT : 'var(--border)', background: on ? 'rgba(14,124,134,0.06)' : 'transparent' }}>
                      {p.image
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-contain bg-white border shrink-0" />
                        : <div className="w-10 h-10 rounded-lg shrink-0" style={{ background: 'var(--surface-hover)' }} />}
                      <span className="flex-1 min-w-0">
                        <span className="block text-[12.5px] font-medium line-clamp-2" style={{ color: 'var(--text)' }}>{p.title}</span>
                        <span className="block text-[11px]" style={{ color: 'var(--text-faint)' }}>
                          {p.videos > 0 ? `${p.videos} video${p.videos === 1 ? '' : 's'}` : p.inStorefront ? 'Storefront' : 'Idea list'}
                          {p.saleLabel && <span style={{ color: '#E4572E' }}> · {p.saleLabel}</span>}
                        </span>
                      </span>
                      {on && <Check size={15} style={{ color: ACCENT }} className="shrink-0" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          <aside className="flex flex-col gap-3">
            <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <p className="text-[13px] font-semibold mb-2" style={{ color: 'var(--text)' }}>Your show, in order ({picked.length}/{LIVE_MAX_PRODUCTS})</p>
              {picked.length === 0 && <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>Pick products on the left. They go on in the order you pick them; the arrows change it.</p>}
              <ol className="flex flex-col gap-1">
                {picked.map((a, i) => {
                  const p = pool?.find((x) => x.asin === a)
                  return (
                    <li key={a} className="flex items-center gap-1.5 text-[12px]">
                      <span className="w-4 tabular-nums" style={{ color: 'var(--text-faint)' }}>{i + 1}</span>
                      <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text)' }}>{p?.title || a}</span>
                      <button type="button" onClick={() => move(a, -1)} disabled={i === 0} aria-label="Earlier" className="disabled:opacity-25"><ChevronLeft size={13} className="rotate-90" /></button>
                      <button type="button" onClick={() => move(a, 1)} disabled={i === picked.length - 1} aria-label="Later" className="disabled:opacity-25"><ChevronRight size={13} className="rotate-90" /></button>
                      <button type="button" onClick={() => toggle(a)} aria-label="Remove"><X size={13} style={{ color: 'var(--text-faint)' }} /></button>
                    </li>
                  )
                })}
              </ol>
              <label className="block mt-3">
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-soft)' }}>Show title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kitchen finds I actually use"
                  className="mt-1 w-full rounded-lg border px-2.5 py-1.5 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
              </label>
              <div className="mt-3">
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-soft)' }}>Length</span>
                <div className="flex gap-1.5 mt-1">
                  {LIVE_LENGTHS.map((m) => (
                    <button key={m} type="button" onClick={() => setMinutes(m)} className="px-2.5 py-1 rounded-lg text-[12px]" style={chip(minutes === m)}>{m} min</button>
                  ))}
                </div>
              </div>
              <label className="block mt-3">
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-soft)' }}>Anything to include (optional)</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Giveaway at the end, mention my storefront"
                  className="mt-1 w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
              </label>
              <button type="button" onClick={() => void build()} disabled={building || picked.length === 0}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: ACCENT }}>
                {building ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
                {building ? 'Building your show…' : 'Build my show'}
              </button>
              {building && <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-faint)' }}>Reading each product and your videos about it. Up to a minute.</p>}
            </section>

            {savedErr && (
              <p className="text-[12px] rounded-xl border p-3" style={{ borderColor: 'var(--border)', color: '#ef4444' }}>{savedErr}</p>
            )}
            {saved.length > 0 && (
              <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <p className="text-[13px] font-semibold mb-2" style={{ color: 'var(--text)' }}>Saved shows</p>
                <ul className="flex flex-col gap-1">
                  {saved.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-[12px]">
                      <button type="button" onClick={() => void openSaved(s.id)} className="flex-1 min-w-0 text-left truncate underline" style={{ color: 'var(--text)' }}>{s.title}</button>
                      <span className="tabular-nums" style={{ color: 'var(--text-faint)' }}>{s.minutes} min · {(s.products ?? []).length}</span>
                      <button type="button" onClick={() => void removeSaved(s.id)} aria-label="Delete"><Trash2 size={12} style={{ color: 'var(--text-faint)' }} /></button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}

      {plan && (
        <div className="live-print flex flex-col gap-4">
          <div className="no-print flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setPrompter(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-semibold text-white" style={{ background: ACCENT }}>
              <MonitorPlay size={14} /> Teleprompter
            </button>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              <Printer size={14} /> Print
            </button>
            <button type="button" onClick={() => { setPlan(null); setPlanId(null) }} className="ml-auto text-[12.5px] underline" style={{ color: 'var(--text-soft)' }}>
              Back to products
            </button>
          </div>

          <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <h2 className="text-[17px] font-bold" style={{ color: 'var(--text)' }}>{plan.title}</h2>
            <p className="text-[12px] mb-2" style={{ color: 'var(--text-soft)' }}>{plan.minutes} minutes · {plan.segments.length} products</p>
            <ul>
              <Row at={0} minutes={plan.opening.minutes} label="Opening" />
              {plan.segments.map((s, i) => (
                <Row key={s.asin} at={s.startMin} minutes={s.minutes} label={`${i + 1}. ${s.title}`} sub={s.saleLabel ? 'On sale today' : undefined} />
              ))}
              <Row at={plan.closing.startMin} minutes={plan.closing.minutes} label="Closing" />
            </ul>
          </section>

          {deals.length > 0 && (
            <section className="rounded-2xl border p-4" style={{ borderColor: 'rgba(228,87,46,0.35)', background: 'var(--surface)' }}>
              <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text)' }}>Deal board</p>
              <p className="text-[11.5px] mb-2" style={{ color: 'var(--text-soft)' }}>On sale when this plan was built. Check the carousel on the day: prices change during a stream, which is why the script never says a number.</p>
              <ul className="flex flex-col gap-1 text-[13px]">
                {deals.map((d) => (
                  <li key={d.asin} className="flex items-center gap-2">
                    <Tag size={12} style={{ color: '#E4572E' }} />
                    <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text)' }}>{d.title}</span>
                    <span className="font-semibold" style={{ color: '#E4572E' }}>{d.saleLabel}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-soft)' }}>Opening · {plan.opening.minutes} min</p>
            <p className="text-[13.5px]" style={{ color: 'var(--text)' }}>{plan.opening.script}</p>
          </section>
          {plan.segments.map((s, i) => <SegmentCard key={s.asin} s={s} n={i + 1} />)}
          {plan.chatPrompts.length > 0 && (
            <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-soft)' }}>Ask the chat</p>
              <ul className="flex flex-col gap-1 text-[13px]">
                {plan.chatPrompts.map((p, k) => (
                  <li key={k}><span className="font-mono tabular-nums mr-2" style={{ color: ACCENT }}>{clockLabel(p.atMin)}</span><span style={{ color: 'var(--text)' }}>{p.text}</span></li>
                ))}
              </ul>
            </section>
          )}
          <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-soft)' }}>Closing · {clockLabel(plan.closing.startMin)}</p>
            <p className="text-[13.5px]" style={{ color: 'var(--text)' }}>{plan.closing.script}</p>
          </section>
        </div>
      )}

      {prompter && plan && <Teleprompter plan={plan} onClose={() => setPrompter(false)} />}
    </div>
  )
}
