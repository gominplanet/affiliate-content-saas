'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Joined campaigns — the work queue for what you joined THROUGH MVP.
//
// The scope is the whole design. This is not a mirror of Amazon. A creator can
// have tens of thousands of accepted campaigns in Amazon's own console, built up
// over years, and pulling those in here buries the handful they actually chose to
// work on. Amazon's console is where you browse Amazon's list; this is where you
// see what MVP did and what came of it.
//
// It exists because MVP used to accept campaigns silently, in bulk, as a side
// effect of sending a message, on the belief that Amazon opened a brand chat only
// after you joined. It does not. Joining is now something you do when you are
// ready to make something, and this is where you see what you took on: what is
// still open, what has content, what closed empty. Ordered as a work queue, so
// the first row is the thing to make next rather than the first row
// alphabetically.
//
// Every count, every state and every sentence comes from lib/campaign-library.ts
// and is tested there, including the two rules this page must not break: never
// credit a campaign with money Amazon reported against a product, and never call
// a campaign with no end date urgent or late.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, ExternalLink, Sparkles, ArrowUpDown, CircleAlert, CircleCheck, CircleDashed, CircleDollarSign } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import CreateForCampaignModal from '@/components/campaigns/CreateForCampaignModal'
import { ROUTE_EXPLAINER, type BestRoute } from '@/lib/campaign-runway'
import { buildCampaignLibrary, type CampaignLibrary, type CampaignState, type LibraryRow } from '@/lib/campaign-library'

type Filter = 'all' | CampaignState

/** What the creator is deciding to make. The whole reason the page needs this:
 *  the same 20 days is a fine window for a social push and a useless one for a
 *  sample that has to arrive before anything can be filmed. */
type Route = 'any' | 'video' | 'blog' | 'social'

const ROUTES: { key: Route; label: string; hint: string }[] = [
  { key: 'any', label: 'Anything', hint: 'Everything you have joined that still needs something made.' },
  { key: 'video', label: 'Amazon video', hint: 'Windows with time for the sample to arrive, be filmed, and still earn. The sample is usually only a few days, so this covers most open campaigns.' },
  { key: 'blog', label: 'Blog post', hint: 'Windows long enough for search to find the post before the boost ends, which takes about three weeks on its own.' },
  { key: 'social', label: 'Social post', hint: 'Anything still open. A social post reaches people the same day.' },
]

const ROUTE_CHIP: Record<BestRoute, { label: string; color: string }> = {
  'video-long': { label: 'Video, earns for weeks', color: '#047857' },
  video: { label: 'Video, still time', color: '#059669' },
  'social-now': { label: 'Social today or skip', color: '#e11d48' },
  unknown: { label: 'No end date', color: '#78716c' },
  closed: { label: 'Closed', color: '#78716c' },
}

const STATE: Record<CampaignState, { label: string; color: string; icon: typeof CircleAlert; tab: string }> = {
  due: { label: 'Nothing made yet', color: '#e11d48', icon: CircleAlert, tab: 'To make' },
  made: { label: 'Content published', color: '#059669', icon: CircleCheck, tab: 'Made' },
  earning: { label: 'Published and paying', color: '#047857', icon: CircleDollarSign, tab: 'Paying' },
  missed: { label: 'Closed empty', color: '#78716c', icon: CircleDashed, tab: 'Closed' },
}

/** How the creator wants the list ordered.
 *
 *  "next" is the library's own work-queue order: what the remaining window can
 *  still carry, soonest to fall out of that band first. It is the default because
 *  it is the only order that answers "what do I make today". The other three are
 *  the ones a person asks for out loud when they are picking by hand, and they
 *  are deliberately plain: the biggest cheque, the priciest product, the closest
 *  deadline. */
type Sort = 'next' | 'commission' | 'price' | 'ending'
const SORTS: { key: Sort; label: string }[] = [
  { key: 'next', label: 'What to make next' },
  { key: 'commission', label: 'Most per sale' },
  { key: 'price', label: 'Priciest product' },
  { key: 'ending', label: 'Ending soonest' },
]

const money = (cents: number) => cents % 100 === 0 ? `$${(cents / 100).toLocaleString()}` : `$${(cents / 100).toFixed(2)}`

export default function JoinedCampaignsPage() {
  const [data, setData] = useState<CampaignLibrary | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [route, setRoute] = useState<Route>('any')
  const [writing, setWriting] = useState<string | null>(null)
  const [creating, setCreating] = useState<LibraryRow | null>(null)
  const [sort, setSort] = useState<Sort>('next')

  // A blank "could not load" is a page nobody can fix, so the reason is kept and
  // shown. Non-JSON back from the route means it crashed outright rather than
  // answering, and the status is the only clue there is.
  const [loadError, setLoadError] = useState<string | null>(null)

  // Fold Amazon's per-product earnings into the list once they arrive. Rebuilt
  // through buildCampaignLibrary rather than patched in place, so the states, the
  // ordering and the sentences all come from the one tested function no matter
  // which side of the wire runs it.
  const mergeEarnings = useCallback(async (lib: CampaignLibrary) => {
    try {
      const r = await fetch('/api/campaigns/library/earnings')
      const e = await r.json() as { synced?: boolean; totals?: Record<string, { clicks: number; orders: number; cents: number }> }
      if (!e?.synced) return
      const totals = e.totals || {}
      setData(buildCampaignLibrary(lib.rows.map(row => ({
        ...row,
        earned: totals[row.asin] ?? { clicks: 0, orders: 0, cents: 0 },
      }))))
    } catch { /* the list is already right, it is just less precise */ }
  }, [])
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/campaigns/library')
      const text = await r.text()
      let payload: (CampaignLibrary & { error?: string }) | null = null
      try { payload = JSON.parse(text) } catch { payload = null }
      if (!payload) {
        setLoadError(`The server answered ${r.status} with something that was not a campaign list. ${text.slice(0, 160)}`)
        setData(null)
        return
      }
      setLoadError(payload.error || null)
      setData(payload)
      // What Amazon paid comes second, because reading it is what used to time
      // the whole page out. The list is already on screen by now; this only
      // separates "published" from "published and paying", so it is re-derived
      // through the same pure function rather than asking the server again.
      if (payload.rows?.length) void mergeEarnings(payload)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally { setLoading(false) }
  }, [mergeEarnings])
  useEffect(() => { load() }, [load])

  // Write the post for a campaign, from the row that says it is missing.
  const write = useCallback(async (row: LibraryRow) => {
    setWriting(row.asin)
    const tId = `write-${row.asin}`
    toast.loading('Writing your post… (~1-2 min, keep this tab open)', { id: tId, duration: Infinity })
    try {
      const res = await fetch('/api/campaigns/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: row.asin, campaignName: row.product || undefined, endsAt: row.endsAt || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.error) { toast.error(j?.error || `Failed (${res.status})`, { id: tId, duration: 8000 }); return }
      toast.success('Blog post published.', { id: tId, duration: 6000 })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate', { id: tId, duration: 8000 })
    } finally { setWriting(null) }
  }, [load])

  // The route filter only narrows the work queue. A campaign that is already
  // made or already closed is not a decision about what to film.
  const fitsRoute = useCallback((r: LibraryRow) => {
    if (route === 'any' || r.state !== 'due') return true
    // Null is an undated campaign, and hiding one because Amazon left a field
    // blank would quietly drop real work off the list.
    return r.runway[route].viable !== false
  }, [route])

  // Sorting is a view, so it happens here rather than on the server: switching
  // is instant and the library's own order stays available as one of the
  // choices. A missing number always sorts last, never as a zero, because a
  // product whose price we do not know is not a free product.
  const last = (n: number | null | undefined) => (n == null ? -1 : n)
  const sortRows = useCallback((rs: LibraryRow[]) => {
    if (sort === 'next') return rs
    const out = [...rs]
    if (sort === 'commission') out.sort((a, b) => last(b.perSaleCents) - last(a.perSaleCents) || last(b.commissionPct) - last(a.commissionPct))
    if (sort === 'price') out.sort((a, b) => last(b.priceCents) - last(a.priceCents))
    if (sort === 'ending') out.sort((a, b) => (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY))
    return out
  }, [sort])

  const rows = sortRows((data?.rows ?? []).filter(r => (filter === 'all' || r.state === filter) && fitsRoute(r)))
  const s = data?.summary
  const dueRows = (data?.rows ?? []).filter(r => r.state === 'due')
  const routeCount = (k: Route) =>
    k === 'any' ? dueRows.length : dueRows.filter(r => r.runway[k].viable !== false).length

  return (
    <>
      <PageHero
        title="Joined campaigns"
        subtitle="The campaigns you joined through MVP, and what came of each one. Joining is what makes a campaign’s boosted commission apply to what you publish, so a joined campaign with nothing published pays nothing."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] py-10 justify-center" style={{ color: 'var(--text-faint)' }}>
          <Loader2 size={15} className="animate-spin" /> Working out what you joined…
        </div>
      ) : !data ? (
        <div className="rounded-2xl border p-4" style={{ borderColor: 'rgba(225,29,72,0.4)', background: 'rgba(225,29,72,0.05)' }}>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Could not load your campaigns.</p>
          {loadError && <p className="text-[12px] mt-1.5 font-mono break-words" style={{ color: 'var(--text-soft)' }}>{loadError}</p>}
        </div>
      ) : (
        <>
          {loadError && (
            <div className="rounded-2xl border p-3 mb-4" style={{ borderColor: 'rgba(217,119,6,0.4)', background: 'rgba(217,119,6,0.06)' }}>
              <p className="text-[12.5px]" style={{ color: 'var(--text)' }}>
                Some of your campaigns could not be read, so this list may be short.
              </p>
              <p className="text-[11.5px] mt-1 font-mono break-words" style={{ color: 'var(--text-soft)' }}>{loadError}</p>
            </div>
          )}
          {/* The verdict, in the creator's terms, before any list. */}
          <div className="rounded-2xl border p-4 sm:p-5 mb-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <p className="text-[14px] font-bold leading-relaxed" style={{ color: 'var(--text)' }}>{data.verdict}</p>
            <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{data.doThis}</p>
            {s && s.joined > 0 && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 pt-3.5" style={{ borderTop: '1px solid var(--border)' }}>
                {([
                  ['Joined', s.joined, 'var(--text)'],
                  ['To make', s.due, STATE.due.color],
                  ['Made', s.made, STATE.made.color],
                  ['Closed empty', s.missed, STATE.missed.color],
                ] as const).map(([label, n, color]) => (
                  <div key={label}>
                    <p className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>{label}</p>
                    <p className="text-[16px] font-bold tabular-nums" style={{ color }}>{n}</p>
                  </div>
                ))}
                {s.earnedCents != null && (
                  <div>
                    <p className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Amazon paid on these products</p>
                    <p className="text-[16px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>{money(s.earnedCents)}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {s && s.joined > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {([['all', `All ${s.joined}`], ['due', `${STATE.due.tab} ${s.due}`], ['made', `${STATE.made.tab} ${s.made - s.earning}`], ['earning', `${STATE.earning.tab} ${s.earning}`], ['missed', `${STATE.missed.tab} ${s.missed}`]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k as Filter)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border"
                  style={filter === k
                    ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.10)', color: '#7C3AED' }
                    : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                  {label}
                </button>
              ))}
              <label className="ml-auto inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                <ArrowUpDown size={13} />
                <select value={sort} onChange={e => setSort(e.target.value as Sort)}
                  className="px-2 py-1.5 rounded-lg border bg-transparent text-[12px] font-semibold"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                  {SORTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </label>
            </div>
          )}

          {/* What are you making? The question that turns "days left" into an
              answer, because the three routes have opposite shapes. */}
          {s && s.due > 0 && (filter === 'all' || filter === 'due') && (
            <div className="rounded-xl border p-3 mb-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)' }}>
                What are you making?
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ROUTES.map(r => (
                  <button key={r.key} onClick={() => setRoute(r.key)} title={r.hint}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border"
                    style={route === r.key
                      ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.10)', color: '#7C3AED' }
                      : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                    {r.label} <span className="tabular-nums opacity-70">{routeCount(r.key)}</span>
                  </button>
                ))}
              </div>
              <p className="text-[12px] mt-2 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                {route === 'any' ? ROUTE_EXPLAINER : ROUTES.find(r => r.key === route)?.hint}
              </p>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-[13px] py-8 text-center" style={{ color: 'var(--text-faint)' }}>
              {s && s.joined === 0
                ? <>You have not joined a campaign through MVP yet. <Link href="/cc-campaigns" className="font-semibold" style={{ color: '#7C3AED' }}>Browse campaigns</Link>, message any brand you like without joining, and join one when you are ready to make something for it. Campaigns you joined on Amazon itself stay on Amazon; this page is what MVP did.</>
                : 'Nothing in this group.'}
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map(r => {
                const st = STATE[r.state]
                const Icon = st.icon
                const urgent = r.state === 'due' && r.daysLeft != null && r.daysLeft <= 7
                return (
                  <div key={r.asin} className="rounded-xl border p-3 flex items-start gap-3"
                    style={{ borderColor: urgent ? 'rgba(225,29,72,0.35)' : 'var(--border)', background: 'var(--surface)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.imageUrl
                      ? <img src={r.imageUrl} alt="" className="w-12 h-12 rounded-lg object-contain flex-shrink-0" style={{ background: 'var(--surface-2)' }} />
                      : <div className="w-12 h-12 rounded-lg flex-shrink-0" style={{ background: 'var(--surface-2)' }} />}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Icon size={13} style={{ color: st.color, flexShrink: 0 }} />
                        <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                          {r.product || r.brand || r.asin}
                        </span>
                        {r.commissionPct != null && (
                          <span className="text-[10px] font-bold px-1.5 py-[1px] rounded flex-shrink-0" style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}>
                            {r.commissionPct}%{r.perSaleCents != null ? ` · ${money(r.perSaleCents)} a sale` : ''}
                          </span>
                        )}
                        {r.state === 'due' && (
                          <span title={r.runway.headline} className="text-[10px] font-bold px-1.5 py-[1px] rounded flex-shrink-0"
                            style={{ background: `${ROUTE_CHIP[r.runway.best].color}1a`, color: ROUTE_CHIP[r.runway.best].color }}>
                            {ROUTE_CHIP[r.runway.best].label}
                          </span>
                        )}
                        {r.daysLeft != null && r.daysLeft >= 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-[1px] rounded flex-shrink-0 tabular-nums"
                            style={{ background: urgent ? 'rgba(225,29,72,0.12)' : 'var(--surface-2)', color: urgent ? '#e11d48' : 'var(--text-soft)' }}>
                            {r.daysLeft === 0 ? 'ends today' : `${r.daysLeft}d left`}
                          </span>
                        )}
                      </div>
                      {r.brand && r.product && (
                        <p className="text-[11.5px] truncate" style={{ color: 'var(--text-faint)' }}>{r.brand}</p>
                      )}
                      {/* The prose belongs where a decision is being made, not
                          repeated down seven hundred rows. On a campaign waiting
                          to be made the chips already say what the window can
                          carry and how long is left, and the full reasoning is a
                          hover away and spelled out in the Create window. The
                          other states earn their line, because there it differs:
                          what was published, what Amazon paid, when it closed. */}
                      {r.state !== 'due' && (
                        <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{r.note}</p>
                      )}
                      {/* What the product itself is doing. A high commission on
                          something nobody buys is not an opportunity, and these
                          are the numbers that tell them apart. Anything unknown
                          is left out rather than shown as a zero. */}
                      {(r.priceCents != null || r.signals) && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                          {r.priceCents != null && (
                            <span style={{ color: 'var(--text-soft)' }} className="font-semibold">{money(r.priceCents)}</span>
                          )}
                          {r.signals?.discountPct != null && r.signals.discountPct > 0 && (
                            <span style={{ color: '#1c7a35' }}>{r.signals.discountPct}% off</span>
                          )}
                          {r.signals?.dealQuality && <span>{r.signals.dealQuality}</span>}
                          {r.signals?.rating != null && (
                            <span>{r.signals.rating.toFixed(1)}★{r.signals.reviewCount != null ? ` (${r.signals.reviewCount.toLocaleString()})` : ''}</span>
                          )}
                          {r.signals?.monthlySold != null && r.signals.monthlySold > 0 && (
                            <span>{r.signals.monthlySold.toLocaleString()} bought a month</span>
                          )}
                          {r.signals?.salesRank != null && r.signals.salesRank > 0 && (
                            <span>#{r.signals.salesRank.toLocaleString()}{r.signals.salesRankCategory ? ` in ${r.signals.salesRankCategory}` : ''}</span>
                          )}
                        </div>
                      )}
                      {r.content.length > 0 && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                          {r.content.filter(c => c.url).slice(0, 4).map((c, i) => (
                            <a key={i} href={c.url as string} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11.5px] font-medium hover:underline" style={{ color: '#7C3AED' }}>
                              <ExternalLink size={11} /> {c.title || c.kind}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {/* One button, because the choice of WHAT to make belongs
                          inside, next to what the window can carry. Splitting it
                          into three buttons on the card put the decision before
                          the reasoning. */}
                      <button onClick={() => setCreating(r)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white"
                        style={{ background: r.state === 'due' ? 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' : 'var(--text-faint)' }}>
                        <Sparkles size={12} /> {r.state === 'due' ? 'Create' : 'Create more'}
                      </button>
                      {r.detailsUrl && (
                        <a href={r.detailsUrl} target="_blank" rel="noreferrer"
                          className="text-[11.5px] font-medium hover:underline" style={{ color: 'var(--text-faint)' }}>
                          On Amazon
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-[11px] mt-5 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            Only the campaigns you joined through MVP. Your Amazon account may hold tens of thousands more, accepted over
            the years in Amazon&rsquo;s own console, and mirroring those here would bury the ones you actually chose to work on.
            One row per product, because Amazon runs several campaigns for the same product across different windows and
            being joined to three of them is still one thing to make. Ones that have already ended stay listed, under Closed,
            so the ones that ran out before anything was made are countable rather than invisible. Money shown is what Amazon reported against the product
            itself, across every link you have anywhere, so it is never attributed to one post.
          </p>
        </>
      )}
      {creating && (
        <CreateForCampaignModal
          row={creating}
          writing={writing === creating.asin}
          onWrite={write}
          onClose={() => setCreating(null)}
        />
      )}
    </>
  )
}
