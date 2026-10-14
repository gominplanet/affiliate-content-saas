'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FIND BRANDS, THE CREATOR'S WAY (Seb, 2026-10-14, after Rob's Oink Blue
// video: "build all 4"): the filters, a brand's name, "Your priorities" for
// Best bets, and what each brand shows about Amazon and TRYBE's own numbers.
// The reading and filtering is on the server (lib/trybe-finder); this only
// asks and shows, and says how many brands a filter hid or could not check.

import { useState } from 'react'
import { Star, Search, X, ExternalLink, SlidersHorizontal, PlayCircle, ShoppingBag, Ban, RotateCcw } from 'lucide-react'
import { FACTORS, type Factor, type Priorities, type Weight } from '@/lib/trybe-pick'
import { FILTER_WORDS, type FilterId, type FinderFilters, type DirStats } from '@/lib/trybe-finder'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }
const chip = 'text-[12px] font-semibold rounded-full px-2.5 py-1 border inline-flex items-center gap-1'

export interface LiveAmazon {
  yourVideos: number; storefront: number; ccCampaigns: number; ccBestPct: number | null
  videoLinks: string[]; productUrl: string | null
}

export const NO_FILTERS: FinderFilters = { minPerVideo: null, maxCreators: null, maxVideos: null, paidCreators: false, samples: false, onAmazon: false, starred: false }
export const filtersOn = (f: FinderFilters) => !!(f.minPerVideo || f.maxCreators || f.maxVideos || f.paidCreators || f.samples || f.onAmazon || f.starred)

const WEIGHTS: Array<{ w: Weight; label: string }> = [{ w: 0, label: 'Skip' }, { w: 1, label: 'Normal' }, { w: 2, label: 'A lot' }]

/** The filter row and the brand name search. */
export function FinderFilterBar({ filters, onFilters, name, onName }: {
  filters: FinderFilters
  onFilters: (f: FinderFilters) => void
  name: string
  onName: (n: string) => void
}) {
  const toggle = (k: 'paidCreators' | 'samples' | 'onAmazon' | 'starred', label: string, icon?: React.ReactNode, title?: string) => (
    <button onClick={() => onFilters({ ...filters, [k]: !filters[k] })} aria-pressed={!!filters[k]} title={title}
      className={chip} style={filters[k] ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border-2)' }}>
      {icon}{label}
    </button>
  )
  const numberBox = (k: 'minPerVideo' | 'maxCreators' | 'maxVideos', before: string, after: string, title: string) => (
    <label className={`${chip} cursor-text`} style={filters[k] ? { borderColor: PURPLE, color: PURPLE } : { borderColor: 'var(--border-2)' }} title={title}>
      {before}
      <input type="number" inputMode="numeric" min={1} value={filters[k] ?? ''} placeholder="any"
        onChange={(e) => { const n = Number(e.target.value); onFilters({ ...filters, [k]: e.target.value && Number.isFinite(n) && n > 0 ? n : null }) }}
        className="w-14 bg-transparent outline-none text-center tabular-nums font-semibold" style={{ color: 'inherit' }} aria-label={`${before} ${after}`} />
      {after}
    </label>
  )
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3" role="group" aria-label="Filter brands">
      <span className="text-[11px] font-semibold uppercase tracking-wider mr-1" style={soft}>Filter</span>
      <label className={`${chip} cursor-text`} style={{ borderColor: name ? PURPLE : 'var(--border-2)' }}>
        <Search size={12} />
        <input value={name} onChange={(e) => onName(e.target.value)} placeholder="A brand's name" aria-label="Find a brand by name"
          className="w-36 bg-transparent outline-none font-normal" style={{ color: 'var(--text)' }} />
        {name && <button onClick={() => onName('')} aria-label="Clear the name"><X size={12} /></button>}
      </label>
      {toggle('starred', 'Starred', <Star size={12} />)}
      {toggle('onAmazon', 'On Amazon', <ShoppingBag size={12} />, 'Brands you already filmed on Amazon, have in your storefront, or that run Creator Connections on Amazon.')}
      {toggle('paidCreators', 'Has paid creators', undefined, 'TRYBE says it has paid creators.')}
      {toggle('samples', 'Sends samples')}
      {numberBox('minPerVideo', 'At least $', 'a video', 'A flat fee per video of at least this much.')}
      {numberBox('maxCreators', 'Up to', 'creators', 'Fewer creators means more of the budget for you.')}
      {numberBox('maxVideos', 'Up to', 'videos approved', 'Few videos approved so far: room for you.')}
      {(filtersOn(filters) || name) && (
        <button onClick={() => { onFilters(NO_FILTERS); onName('') }} className="text-[12px] font-semibold underline ml-1" style={{ color: PURPLE }}>Clear filters</button>
      )}
    </div>
  )
}

/** What the filters did, counted: hidden, and not known (listed after). */
export function FinderFilterNote({ hiddenBy, unknownBy }: { hiddenBy?: Partial<Record<FilterId, number>>; unknownBy?: Partial<Record<FilterId, number>> }) {
  const hid = Object.entries(hiddenBy || {}).filter(([, n]) => (n ?? 0) > 0) as Array<[FilterId, number]>
  const unk = Object.entries(unknownBy || {}).filter(([, n]) => (n ?? 0) > 0) as Array<[FilterId, number]>
  if (!hid.length && !unk.length) return null
  return (
    <p className="text-[12px] mt-3" style={soft}>
      {hid.length > 0 && <>Hidden by your filters: {hid.map(([f, n]) => `${n.toLocaleString()} by ${FILTER_WORDS[f]}`).join(', ')}. </>}
      {unk.length > 0 && <>TRYBE&rsquo;s list does not give {unk.map(([f, n]) => `the ${FILTER_WORDS[f]} of ${n.toLocaleString()} brand${n === 1 ? '' : 's'}`).join(', ')}, so {unk.length === 1 && unk[0][1] === 1 ? 'it is' : 'they are'} listed after the ones that pass. Open a brand on TRYBE to check.</>}
    </p>
  )
}

/** Your priorities: what matters to you, weighing Best bets. */
export function FinderPriorities({ priorities, onChange, note }: {
  priorities: Priorities
  onChange: (p: Priorities) => void
  note: { text: string; tone: 'ok' | 'warn' } | null
}) {
  const [open, setOpen] = useState(false)
  const changed = FACTORS.filter((f) => priorities[f.id] !== 1)
  return (
    <div className="rounded-xl border mb-3" style={{ borderColor: 'var(--border-2)' }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex flex-wrap items-center gap-2 px-3 py-2.5 text-left">
        <SlidersHorizontal size={14} style={{ color: PURPLE }} />
        <span className="text-[13px] font-bold">Your priorities</span>
        <span className="text-[12px]" style={soft}>
          {changed.length ? changed.map((f) => `${f.label}: ${priorities[f.id] === 2 ? 'a lot' : 'skip'}`).join(' · ') : 'All normal. Tell MVP what matters to you and Best bets ranks for you.'}
        </span>
        <span className="ml-auto text-[12px] font-semibold underline" style={{ color: PURPLE }}>{open ? 'Done' : 'Change'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 grid gap-2 sm:grid-cols-2">
          {FACTORS.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'var(--surface-2)' }}>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold leading-tight">{f.label}</p>
                <p className="text-[11.5px] leading-snug" style={soft}>{f.says}</p>
              </div>
              <div className="flex shrink-0 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-2)' }} role="group" aria-label={f.label}>
                {WEIGHTS.map(({ w, label }) => {
                  const on = priorities[f.id] === w
                  return (
                    <button key={w} onClick={() => onChange({ ...priorities, [f.id]: w } as Record<Factor, Weight>)} aria-pressed={on}
                      className="text-[11.5px] font-semibold px-2 py-1"
                      style={on ? (w === 0 ? { background: 'var(--text)', color: 'var(--bg)' } : { background: w === 2 ? GREEN : PURPLE, color: '#fff' }) : { color: 'var(--text-2)' }}>{label}</button>
                  )
                })}
              </div>
            </div>
          ))}
          <p className="sm:col-span-2 text-[12px]" style={note?.tone === 'warn' ? { color: AMBER } : soft}>
            {note ? note.text : 'Best bets ranks by these. A lot counts double, Skip leaves it out.'}
          </p>
        </div>
      )}
    </div>
  )
}

// The long Amazon lines flow as text, so on a phone they wrap as a sentence.
const LINE = 'text-[11px] font-semibold rounded-md px-2 py-0.5 leading-snug max-w-full'
const ICON = 'inline align-[-2px] mr-1'
const LINK = 'ml-1 underline whitespace-nowrap'

/** A brand on Amazon, as pills: your Amazon videos of its products (or its
 *  products in your storefront), and its Creator Connections campaigns.
 *  `links` off inside a button, where a link cannot go. Nothing shows when
 *  MVP found nothing. */
export function amazonPills(amazon: LiveAmazon | null | undefined, links = true): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  if (!amazon) return parts
  if (amazon.yourVideos) {
    parts.push(
      <span key="v" className={LINE} style={{ background: 'rgba(22,163,74,0.14)', color: GREEN }}>
        <PlayCircle size={11} className={ICON} />You have {amazon.yourVideos} Amazon video{amazon.yourVideos === 1 ? '' : 's'} of its products
        {links && amazon.videoLinks[0] && <a href={amazon.videoLinks[0]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={LINK}>watch <ExternalLink size={9} className="inline align-[-1px]" /></a>}
      </span>,
    )
  } else if (amazon.storefront) {
    parts.push(<span key="s" className={LINE} style={{ background: 'rgba(22,163,74,0.10)', color: GREEN }}><ShoppingBag size={11} className={ICON} />{amazon.storefront} of its products in your storefront</span>)
  }
  if (amazon.ccCampaigns) {
    parts.push(
      <span key="cc" className={LINE} style={{ background: 'rgba(14,116,144,0.10)', color: '#0E7490' }} title="It runs Creator Connections campaigns on Amazon under the same brand name.">
        <ShoppingBag size={11} className={ICON} />On Amazon: Creator Connections{amazon.ccBestPct ? ` up to ${amazon.ccBestPct}%` : ''}
        {links && amazon.productUrl && <a href={amazon.productUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={LINK}>see it <ExternalLink size={9} className="inline align-[-1px]" /></a>}
      </span>,
    )
  }
  return parts
}

/** The brand's Amazon pills on their own line, for any list of TRYBE brands. */
export function AmazonLine({ amazon, links = true, className = 'mt-1.5' }: { amazon: LiveAmazon | null | undefined; links?: boolean; className?: string }) {
  const parts = amazonPills(amazon, links)
  return parts.length ? <span className={`flex flex-wrap items-center gap-1.5 ${className}`}>{parts}</span> : null
}

/** One TRYBE product you already filmed on Amazon. */
export function ProductAmazon({ match, links = true }: { match: { yourVideos: number; videoLinks: string[] } | null | undefined; links?: boolean }) {
  if (!match?.yourVideos) return null
  return (
    <span className={`${LINE} inline-block mt-1`} style={{ background: 'rgba(22,163,74,0.14)', color: GREEN }}>
      <PlayCircle size={11} className={ICON} />You filmed this on Amazon{match.yourVideos > 1 ? ` (${match.yourVideos} videos)` : ''}
      {links && match.videoLinks[0] && <a href={match.videoLinks[0]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={LINK}>watch <ExternalLink size={9} className="inline align-[-1px]" /></a>}
    </span>
  )
}

/** A brand on Amazon, and TRYBE's own numbers for it, on its card. Only what
 *  is known shows; nothing is shown as zero for want of a number. */
export function BrandExtras({ amazon, stats }: { amazon?: LiveAmazon | null; stats?: DirStats | null }) {
  const pill = 'text-[11px] font-semibold rounded-md px-2 py-0.5 inline-flex items-center gap-1'
  const days = stats?.joinedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(stats.joinedAt)) / 86_400_000)) : null
  const parts: React.ReactNode[] = amazonPills(amazon)
  const quiet = { background: 'var(--surface-2)', color: 'var(--text-2)' }
  if (stats?.videosApproved != null) parts.push(<span key="va" className={pill} style={quiet}>{stats.videosApproved.toLocaleString()} video{stats.videosApproved === 1 ? '' : 's'} approved</span>)
  if (stats?.paidOut != null && stats.paidOut > 0) parts.push(<span key="po" className={pill} style={quiet}>Paid creators ${Math.round(stats.paidOut).toLocaleString()}</span>)
  if (stats?.samples === true) parts.push(<span key="sa" className={pill} style={quiet}>Sends samples</span>)
  if (stats?.samples === false) parts.push(<span key="sn" className={pill} style={quiet}>No samples</span>)
  if (days != null) parts.push(<span key="d" className={pill} style={quiet}>{days <= 1 ? 'Joined TRYBE today' : `${days} days on TRYBE`}</span>)
  if (!parts.length) return null
  return <span className="flex flex-wrap items-center gap-1.5 mt-1.5">{parts}</span>
}

/** Star and Pass on a brand's card. */
export function StarButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick() }} aria-pressed={on} aria-label={on ? 'Unstar' : 'Star'} title={on ? 'Starred: in your Starred filter' : 'Star it to find it again under Starred'}
      className="inline-flex items-center" style={{ color: on ? '#CA8A04' : 'var(--text-3)' }}>
      <Star size={15} fill={on ? '#CA8A04' : 'none'} />
    </button>
  )
}

export function PassButton({ passed, onClick, disabled }: { passed: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick() }} disabled={disabled}
      className="self-start shrink-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold border disabled:opacity-50"
      style={{ borderColor: 'var(--border-2)', color: 'var(--text-2)' }} title={passed ? 'Bring it back to the list' : 'Not for you: hide it from the list (you can undo)'}>
      {passed ? <><RotateCcw size={12} /> Undo pass</> : <><Ban size={12} /> Pass</>}
    </button>
  )
}
