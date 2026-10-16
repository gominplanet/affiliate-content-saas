'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FIND BRANDS, THE CREATOR'S WAY (Seb, 2026-10-14, after Rob's Oink Blue
// video: "build all 4"): the filters, a brand's name, "Your priorities" for
// Best bets, and what each brand shows about Amazon and TRYBE's own numbers.
// The reading and filtering is on the server (lib/trybe-finder); this only
// asks and shows, and says how many brands a filter hid or could not check.

import { useState } from 'react'
import { Star, Search, X, ExternalLink, Copy, Check, SlidersHorizontal, PlayCircle, ShoppingBag, Ban, RotateCcw, DollarSign, Users, Sparkles, Clock, ChevronDown, Image as ImageIcon } from 'lucide-react'
import { GRID_FACTORS, FORMATS, DEFAULT_PRIORITIES, verdictOf, VERDICT_WORDS, type Factor, type Priorities, type Weight } from '@/lib/trybe-pick'
import { reviewWords } from '@/lib/trybe-mybrands'
import { FILTER_WORDS, CROWD_WORDS, type FilterId, type FinderFilters, type DirStats, type CrowdRead, type SpendRead } from '@/lib/trybe-finder'
import type { PayBasis } from '@/lib/trybe-pay'
import { SELLS, SELLS_WORDS, type SellsRead } from '@/lib/trybe-sells'

const PURPLE = '#7C3AED'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }
const chip = 'text-[12px] font-semibold rounded-full px-2.5 py-1 border inline-flex items-center gap-1'
/** Purple words that stay readable on the dark theme too. */
const ON_TEXT = 'text-[#7C3AED] dark:text-[#B9A2FF]'

export interface LiveAmazon {
  yourVideos: number; storefront: number; ccCampaigns: number; ccBestPct: number | null
  videoLinks: string[]; productUrl: string | null
  /** Each product filmed: ASIN, its Amazon page, and the creator's videos of it. */
  products?: FilmedLive[]
}
export interface FilmedLive { asin: string; title: string | null; url: string; videos: string[] }

export const NO_FILTERS: FinderFilters = { minPerVideo: null, maxCreators: null, maxVideos: null, paidCreators: false, samples: false, onAmazon: false, starred: false, openOnly: false, spending: false, newOnly: false, fastReview: false, sells: null, minSpend: null }
export const filtersOn = (f: FinderFilters) => !!(f.minPerVideo || f.maxCreators || f.maxVideos || f.paidCreators || f.samples || f.onAmazon || f.starred || f.openOnly || f.spending || f.newOnly || f.fastReview || f.sells || f.minSpend)

const WEIGHTS: Array<{ w: Weight; label: string }> = [{ w: 0, label: 'Skip' }, { w: 1, label: 'Normal' }, { w: 2, label: 'A lot' }]

/** One choice of a dropdown: its words, and what it does (the hover). */
export interface PickOption { id: string; label: string; says?: string }

/** A labelled native dropdown: familiar, keyboard friendly, one line. */
function Picker({ label, value, options, onChange, changed }: { label: string; value: string; options: PickOption[]; onChange: (v: string) => void; changed: boolean }) {
  const now = options.find((o) => o.id === value)
  return (
    <label className="flex sm:inline-flex items-center gap-1.5 rounded-lg border pl-2.5 pr-1.5 py-1.5 text-[13px] min-w-0 focus-within:ring-2 focus-within:ring-[#7C3AED]/40" title={now?.says}
      style={{ borderColor: changed ? PURPLE : 'var(--border-2)' }}>
      <span className="shrink-0" style={soft}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`flex-1 sm:flex-none min-w-0 bg-transparent font-semibold outline-none cursor-pointer ${changed ? ON_TEXT : ''}`} style={changed ? undefined : { color: 'var(--text)' }}>
        {options.map((o) => <option key={o.id} value={o.id} style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>{o.label}</option>)}
      </select>
    </label>
  )
}

type ToggleKey = 'paidCreators' | 'samples' | 'onAmazon' | 'starred' | 'openOnly' | 'spending' | 'newOnly' | 'fastReview'
type NumberKey = 'minPerVideo' | 'maxCreators' | 'maxVideos' | 'minSpend'
export const TOGGLE_WORDS: Record<ToggleKey, string> = {
  starred: 'Starred', onAmazon: 'On Amazon', openOnly: 'Open only', newOnly: 'New', spending: 'Spending on ads',
  fastReview: 'Decides fast', paidCreators: 'Has paid creators', samples: 'Sends samples',
}
export const NUMBER_WORDS: Record<NumberKey, (n: number) => string> = {
  minPerVideo: (n) => `At least $${n.toLocaleString()} a video`,
  minSpend: (n) => `Pays creators $${n.toLocaleString()}+ a month`,
  maxCreators: (n) => `Up to ${n.toLocaleString()} creators`,
  maxVideos: (n) => `Up to ${n.toLocaleString()} videos approved`,
}
/** How many of the panel's filters are on (sort, pay and sells have their own dropdowns). */
export const panelFiltersOn = (f: FinderFilters) =>
  (Object.keys(TOGGLE_WORDS) as ToggleKey[]).filter((k) => f[k]).length + (Object.keys(NUMBER_WORDS) as NumberKey[]).filter((k) => f[k]).length

/** FIND BRANDS, ONE TOOLBAR (Seb, 2026-10-16: "This whole section ... is very
 *  confusing ... at first glance, it is very overwhelming"). Six rows of
 *  chips before the first brand became: brand search, Sort, Pay and Sells as
 *  dropdowns, and a Filters button that opens the rest, grouped. Every choice
 *  that is on shows as a chip with an x under the bar, so a filter inside a
 *  closed panel is never on without being seen. */
export function FinderToolbar({ filters, onFilters, name, onName, sort, sorts, onSort, pay, pays, onPay, panelExtra }: {
  filters: FinderFilters
  onFilters: (f: FinderFilters) => void
  name: string
  onName: (n: string) => void
  sort: string
  sorts: PickOption[]
  onSort: (s: string) => void
  pay: string
  pays: PickOption[]
  onPay: (p: string) => void
  /** Shown at the foot of the open panel (Your priorities, when Best bets is not the sort). */
  panelExtra?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const inPanel = panelFiltersOn(filters)
  const toggle = (k: ToggleKey, icon?: React.ReactNode, title?: string) => (
    <button key={k} onClick={() => onFilters({ ...filters, [k]: !filters[k] })} aria-pressed={!!filters[k]} title={title}
      className={chip} style={filters[k] ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border-2)' }}>
      {icon}{TOGGLE_WORDS[k]}
    </button>
  )
  const numberBox = (k: NumberKey, before: string, after: string, title: string) => (
    <label key={k} className={`${chip} cursor-text focus-within:ring-2 focus-within:ring-[#7C3AED]/40 ${filters[k] ? ON_TEXT : ''}`} style={filters[k] ? { borderColor: PURPLE } : { borderColor: 'var(--border-2)' }} title={title}>
      {before}
      <input type="number" inputMode="numeric" min={1} value={filters[k] ?? ''} placeholder="any"
        onChange={(e) => { const n = Number(e.target.value); onFilters({ ...filters, [k]: e.target.value && Number.isFinite(n) && n > 0 ? n : null }) }}
        className="w-14 bg-transparent outline-none text-center tabular-nums font-semibold" style={{ color: 'inherit' }} aria-label={`${before} ${after}`} />
      {after}
    </label>
  )
  const group = (legend: string, children: React.ReactNode) => (
    <fieldset className="min-w-0">
      <legend className="text-[12px] font-semibold mb-1.5">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  )

  // EVERYTHING THAT IS ON, each with its own x.
  const on: Array<{ key: string; text: string; off: () => void }> = []
  if (name) on.push({ key: 'name', text: `Name: \u201c${name}\u201d`, off: () => onName('') })
  if (sort !== sorts[0]?.id) { const s = sorts.find((x) => x.id === sort); if (s) on.push({ key: 'sort', text: `Sort: ${s.label}`, off: () => onSort(sorts[0].id) }) }
  if (pay !== pays[0]?.id) { const p = pays.find((x) => x.id === pay); if (p) on.push({ key: 'pay', text: `Pay: ${p.label}`, off: () => onPay(pays[0].id) }) }
  if (filters.sells) on.push({ key: 'sells', text: `Sells: ${SELLS_WORDS[filters.sells].label}`, off: () => onFilters({ ...filters, sells: null }) })
  for (const k of Object.keys(NUMBER_WORDS) as NumberKey[]) { const n = filters[k]; if (n) on.push({ key: k, text: NUMBER_WORDS[k](n), off: () => onFilters({ ...filters, [k]: null }) }) }
  for (const k of Object.keys(TOGGLE_WORDS) as ToggleKey[]) if (filters[k]) on.push({ key: k, text: TOGGLE_WORDS[k], off: () => onFilters({ ...filters, [k]: false }) })

  return (
    <div className="mb-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" role="toolbar" aria-label="Find and sort brands">
        <label className="col-span-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] sm:flex-1 sm:min-w-[11rem] sm:max-w-[18rem] focus-within:ring-2 focus-within:ring-[#7C3AED]/40" style={{ borderColor: name ? PURPLE : 'var(--border-2)' }}>
          <Search size={14} style={soft} />
          <input value={name} onChange={(e) => onName(e.target.value)} placeholder="Find a brand by name" aria-label="Find a brand by name"
            className="w-full min-w-0 bg-transparent outline-none" style={{ color: 'var(--text)' }} />
          {name && <button onClick={() => onName('')} aria-label="Clear the name"><X size={13} /></button>}
        </label>
        <Picker label="Sort" value={sort} options={sorts} onChange={onSort} changed={sort !== sorts[0]?.id} />
        <Picker label="Pay" value={pay} options={pays} onChange={onPay} changed={pay !== pays[0]?.id} />
        {/* WHAT IT SELLS (lib/trybe-sells): read from TRYBE and the brand's website. */}
        <Picker label="Sells" value={filters.sells ?? 'any'} changed={!!filters.sells}
          options={[{ id: 'any', label: 'Anything', says: 'Every brand, whatever it sells.' }, ...SELLS.map((k) => ({ id: k, label: SELLS_WORDS[k].label, says: `${SELLS_WORDS[k].says} Read from TRYBE's categories and description, whether it sends samples, and the brand's own website. A brand MVP cannot tell is left out.` }))]}
          onChange={(v) => onFilters({ ...filters, sells: v === 'any' ? null : v as FinderFilters['sells'] })} />
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="finder-filters"
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:ring-[#7C3AED]/40 outline-none ${open || inPanel ? ON_TEXT : ''}`}
          style={open || inPanel ? { borderColor: PURPLE } : { borderColor: 'var(--border-2)' }}>
          <SlidersHorizontal size={14} />Filters
          {inPanel > 0 && <span className="min-w-[1.25rem] rounded-full px-1.5 text-[11px] leading-5 text-center tabular-nums" style={{ background: PURPLE, color: '#fff' }}>{inPanel}</span>}
          <ChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div id="finder-filters" role="region" aria-label="Filters" className="rounded-xl p-3 sm:p-4 space-y-4" style={{ background: 'var(--surface-2)' }}>
          <div className="grid gap-4 sm:grid-cols-3">
            {group('Pay', <>
              {numberBox('minPerVideo', 'At least $', 'a video', 'Pays at least this much per approved video: from your results with it, members\u2019 results, or its flat fee and retainer. A brand with no dollar figure (a % of sales alone, or no pay on TRYBE) is left out.')}
              {numberBox('minSpend', 'Pays creators $', 'a month+', 'Pays TRYBE creators at least this much a month, estimated: its videos approved in the last 30 days times what it pays per approved video. No platform shows a brand\u2019s real ad budget, so this is the honest figure MVP can work out. A brand MVP cannot estimate is left out.')}
              {toggle('paidCreators', undefined, 'TRYBE says it has paid creators.')}
            </>)}
            {group('Room for you', <>
              {toggle('openOnly', <Users size={12} />, 'Brands with room for you: few creators, and few joining or posting in the last 30 days.')}
              {toggle('newOnly', <Sparkles size={12} />, 'New on TRYBE: joined in the last 30 days, or MVP first saw it in the last 14.')}
              {numberBox('maxCreators', 'Up to', 'creators', 'Fewer creators means more of the budget for you.')}
              {numberBox('maxVideos', 'Up to', 'videos approved', 'Few videos approved so far: room for you.')}
            </>)}
            {group('The brand', <>
              {toggle('spending', undefined, 'Meta ads running now, or videos in TRYBE\u2019s Top 100.')}
              {toggle('fastReview', <Clock size={12} />, 'Decides videos in 5 days or less, from MVP members\u2019 results. Brands without enough members\u2019 results are listed after.')}
              {toggle('samples')}
              {toggle('onAmazon', <ShoppingBag size={12} />, 'Brands you already filmed on Amazon, have in your storefront, or that run Creator Connections on Amazon.')}
              {toggle('starred', <Star size={12} />)}
            </>)}
          </div>
          {panelExtra}
          <div className="flex justify-end">
            <button onClick={() => setOpen(false)} className={`text-[12px] font-semibold underline ${ON_TEXT}`}>Done</button>
          </div>
        </div>
      )}

      {on.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="What is on">
          {on.map((o) => (
            <button key={o.key} onClick={o.off} className={`${chip} ${ON_TEXT} focus-visible:ring-2 focus-visible:ring-[#7C3AED]/40 outline-none`} style={{ borderColor: 'rgba(124,58,237,0.35)', background: 'rgba(124,58,237,0.08)' }} aria-label={`Remove: ${o.text}`}>
              {o.text}<X size={11} />
            </button>
          ))}
          {on.length > 1 && (
            <button onClick={() => { onFilters(NO_FILTERS); onName(''); onSort(sorts[0].id); onPay(pays[0].id) }} className={`text-[12px] font-semibold underline px-1 whitespace-nowrap ${ON_TEXT}`}>Clear all</button>
          )}
        </div>
      )}
    </div>
  )
}

/** What the filters did, counted: hidden, and not known (listed after). */
export function FinderFilterNote({ hiddenBy, blankBy, unknownBy }: { hiddenBy?: Partial<Record<FilterId, number>>; blankBy?: Partial<Record<FilterId, number>>; unknownBy?: Partial<Record<FilterId, number>> }) {
  const hid = Object.entries(hiddenBy || {}).filter(([, n]) => (n ?? 0) > 0) as Array<[FilterId, number]>
  const unk = Object.entries(unknownBy || {}).filter(([, n]) => (n ?? 0) > 0) as Array<[FilterId, number]>
  if (!hid.length && !unk.length) return null
  // A pay minimum hides brands with no pay figure too: said apart, so a brand
  // TRYBE gives no pay for never reads as one that pays too little.
  const hidWords = ([f, n]: [FilterId, number]) => {
    const blank = Math.min(n, blankBy?.[f] ?? 0)
    if (f === 'minPerVideo' && blank > 0) {
      const low = n - blank
      return [low > 0 ? `${low.toLocaleString()} paying less` : null, `${blank.toLocaleString()} with no pay figure`].filter(Boolean).join(' and ')
    }
    if (f === 'minSpend' && blank > 0) {
      const low = n - blank
      return [low > 0 ? `${low.toLocaleString()} paying creators less` : null, `${blank.toLocaleString()} MVP cannot estimate yet (no pay figure, or no count of its videos in the last 30 days)`].filter(Boolean).join(' and ')
    }
    if (f === 'sells' && blank > 0) {
      const other = n - blank
      return [other > 0 ? `${other.toLocaleString()} selling something else` : null, `${blank.toLocaleString()} where MVP cannot yet tell what they sell (website not read, or too little on it)`].filter(Boolean).join(' and ')
    }
    return `${n.toLocaleString()} by ${FILTER_WORDS[f]}`
  }
  return (
    <p className="text-[12px] mt-3" style={soft}>
      {hid.length > 0 && <>Hidden by your filters: {hid.map(hidWords).join(', ')}. </>}
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
  const changed = GRID_FACTORS.filter((f) => priorities[f.id] !== DEFAULT_PRIORITIES[f.id])
  const format = FORMATS.find((x) => x.w === priorities.statics) ?? FORMATS[0]
  return (
    <div className="rounded-xl border mb-3" style={{ borderColor: 'var(--border-2)' }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex flex-wrap items-center gap-2 px-3 py-2.5 text-left">
        <SlidersHorizontal size={14} style={{ color: PURPLE }} />
        <span className="text-[13px] font-bold">Your priorities</span>
        <span className="text-[12px]" style={soft}>
          {[format.w ? `You make: ${format.label.toLowerCase()}` : '', ...changed.map((f) => `${f.label}: ${priorities[f.id] === 2 ? 'a lot' : 'skip'}`)].filter(Boolean).join(' · ') || 'All normal. Tell MVP what matters to you and Best bets ranks for you.'}
        </span>
        <span className="ml-auto text-[12px] font-semibold underline" style={{ color: PURPLE }}>{open ? 'Done' : 'Change'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 grid gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'var(--surface-2)' }}>
            <div className="flex-1 min-w-[12rem]">
              <p className="text-[13px] font-semibold leading-tight inline-flex items-center gap-1"><ImageIcon size={13} /> What you make</p>
              <p className="text-[11.5px] leading-snug" style={soft}>{format.says}</p>
            </div>
            <div className="flex flex-wrap shrink-0 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-2)' }} role="group" aria-label="What you make">
              {FORMATS.map((x) => {
                const on = priorities.statics === x.w
                return (
                  <button key={x.w} onClick={() => onChange({ ...priorities, statics: x.w })} aria-pressed={on}
                    className="text-[11.5px] font-semibold px-2 py-1" style={on ? { background: PURPLE, color: '#fff' } : { color: 'var(--text-2)' }}>{x.label}</button>
                )
              })}
            </div>
          </div>
          {GRID_FACTORS.map((f) => (
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

/** THE PRODUCTS YOU FILMED (Seb, 2026-10-15: "show the amazon asin and
 *  product link that direct users to the amazon page or even better to the
 *  content on amazon they already produced"). One row per product: its name
 *  on Amazon, its ASIN (press to copy), its Amazon page and your videos of it.
 *  Nothing shows when MVP matched none. */
export function AmazonFilmedList({ products, title = 'Your Amazon videos of its products', className = 'mt-2' }: { products?: FilmedLive[] | null; title?: string; className?: string }) {
  if (!products?.length) return null
  const a = 'font-semibold underline inline-flex items-center gap-0.5 whitespace-nowrap'
  return (
    <div className={`${className} rounded-xl px-3 py-2.5`} style={{ background: 'rgba(22,163,74,0.07)' }}>
      <p className="text-[12px] font-bold inline-flex items-center gap-1" style={{ color: GREEN }}><PlayCircle size={12} /> {title}</p>
      <ul className="mt-1.5 flex flex-col gap-2">
        {products.map((p) => (
          <li key={p.asin} className="text-[12.5px]">
            <span className="block leading-snug [overflow-wrap:anywhere]" style={{ color: 'var(--text)' }}>{p.title || 'Product on Amazon'}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: GREEN }}>
              <CopyAsin asin={p.asin} />
              <a href={p.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={a}>Amazon page <ExternalLink size={10} /></a>
              {p.videos.map((v, i) => (
                <a key={v} href={v} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={a}>
                  <PlayCircle size={11} /> {p.videos.length === 1 ? 'Your video' : `Video ${i + 1}`}
                </a>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CopyAsin({ asin }: { asin: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" title="Copy the ASIN"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void navigator.clipboard?.writeText(asin).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-semibold" style={{ background: 'rgba(22,163,74,0.12)' }}>
      ASIN {asin} {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  )
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

// ── WHAT A VIDEO PAYS, HOW CROWDED, NEW, STATICS (Seb, 2026-10-14) ─────────

export interface LivePayEst { dollars: number | null; basis: PayBasis; short: string; math: string[]; plus: string[]; capped: boolean; guaranteed: boolean }

const BASIS_WORDS: Record<PayBasis, string> = {
  yours: 'From your own results with it.',
  members: 'From MVP members\u2019 results with it.',
  terms: 'From its pay terms on TRYBE.',
  variable: 'It pays on results only.',
  unknown: 'Not known.',
}

/** The figure per approved video, with the math one press away. A figure
 *  from results, a fixed fee, results-only pay and unread terms each look
 *  different, so "no number" never passes for $0. */
export function PayChip({ est, payText }: { est: LivePayEst | null | undefined; payText?: string | null }) {
  const [open, setOpen] = useState(false)
  if (!est) return payText ? <span className="text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.10)', color: GREEN }}>{payText}</span> : null
  const known = est.dollars != null
  const style = known ? { background: 'rgba(22,163,74,0.12)', color: GREEN }
    : est.basis === 'variable' ? { background: 'rgba(14,116,144,0.10)', color: '#0E7490' }
      : { background: 'var(--surface-2)', color: 'var(--text-3)' }
  return (
    <span className="inline-flex flex-col max-w-full">
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o) }} aria-expanded={open}
        className="text-[11px] font-semibold rounded-md px-2 py-0.5 inline-flex items-center gap-1 text-left" style={style}
        title={`${BASIS_WORDS[est.basis]}${payText ? ` TRYBE says: ${payText}` : ''}`}>
        <DollarSign size={11} />{est.short}{est.capped ? ' (capped)' : ''}{est.guaranteed && est.basis !== 'terms' ? ' · guaranteed part' : ''}
        <span className="underline font-normal ml-0.5">{open ? 'hide' : 'how?'}</span>
      </button>
      {open && (
        <span className="block text-[11.5px] mt-1 rounded-md px-2 py-1.5 leading-snug" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
          {est.math.map((m) => <span key={m} className="block">{m}</span>)}
          {est.plus.map((m) => <span key={m} className="block">{m.charAt(0).toUpperCase() + m.slice(1)}.</span>)}
          {payText && <span className="block mt-0.5" style={soft}>TRYBE says: {payText}</span>}
          <span className="block mt-0.5" style={soft}>{BASIS_WORDS[est.basis]} For choosing brands only: never put a rate in a message to a TRYBE brand.</span>
        </span>
      )}
    </span>
  )
}

const CROWD_STYLE = {
  open: { background: 'rgba(22,163,74,0.14)', color: GREEN },
  filling: { background: 'rgba(180,83,9,0.12)', color: AMBER },
  crowded: { background: 'rgba(220,38,38,0.10)', color: '#DC2626' },
} as const

/** OPEN, FILLING or CROWDED, with why on hover and in words for screen readers. */
export function CrowdChip({ crowd, windowDays }: { crowd: CrowdRead | null | undefined; windowDays?: number | null }) {
  if (!crowd?.level) return null
  const note = crowd.days ? '' : windowDays == null ? ' The last 30 days show once MVP has a week of its own daily copies of TRYBE\u2019s list.' : ''
  return (
    <span className="text-[10.5px] font-extrabold tracking-wider rounded-md px-2 py-0.5 cursor-help inline-flex items-center gap-1" style={CROWD_STYLE[crowd.level]} title={`${crowd.why}${note}`}>
      <Users size={10} />{CROWD_WORDS[crowd.level]}<span className="sr-only">: {crowd.why}</span>
    </span>
  )
}

/** What it pays TRYBE creators a month, estimated, with the math in the
 *  hover. Nothing when MVP cannot estimate it (the filter note counts those). */
export function SpendChip({ spend }: { spend: SpendRead | null | undefined }) {
  if (!spend || spend.dollars == null || !spend.short) return null
  return (
    <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 cursor-help inline-flex items-center gap-1" style={spend.dollars > 0 ? { background: 'rgba(14,116,144,0.10)', color: '#0E7490' } : { background: 'var(--surface-2)', color: 'var(--text-3)' }} title={spend.why}>
      <DollarSign size={11} />{spend.short}<span className="sr-only">: {spend.why}</span>
    </span>
  )
}

/** What the estimates rest on, for the list as a whole: how many brands have
 *  one and from what, and why the rest do not. */
export function SpendNote({ known, windowDays }: { known: { recent: number; lifetime: number; none: number } | null | undefined; windowDays?: number | null }) {
  if (!known) return null
  const have = known.recent + known.lifetime
  const total = have + known.none
  if (!total) return null
  const parts = [`What each brand pays TRYBE creators a month: MVP estimates ${have.toLocaleString()} of these ${total.toLocaleString()}.`]
  if (known.recent) parts.push(`${known.recent.toLocaleString()} from the last ${windowDays ?? 30} days (videos approved times pay per video).`)
  if (known.lifetime) parts.push(`${known.lifetime.toLocaleString()} from the brand\u2019s average since it joined TRYBE (what TRYBE shows creators earned, over its months there).`)
  if (windowDays == null) parts.push('The last 30 days count starts once MVP has a week of its own daily copies of TRYBE\u2019s list.')
  if (known.none) parts.push(`${known.none.toLocaleString()} have no figure yet: TRYBE shows no pay, earnings or join date MVP can use.`)
  parts.push('No platform shows a brand\u2019s real ad budget, so this is the honest figure. Hover one to see the math.')
  return <p className="text-[12px] mt-3" style={soft}>{parts.join(' ')}</p>
}

export function NewChip({ on }: { on: boolean | undefined }) {
  if (!on) return null
  return <span className="text-[10.5px] font-extrabold tracking-wider rounded-md px-2 py-0.5 inline-flex items-center gap-1" style={{ background: PURPLE, color: '#fff' }} title="New on TRYBE: joined in the last 30 days, or MVP first saw it in the last 14."><Sparkles size={10} />NEW</span>
}

/** What it sells, with why in the hover; nothing when MVP cannot tell. */
export function SellsChip({ sells }: { sells: SellsRead | null | undefined }) {
  if (!sells?.kind) return null
  const also = sells.kinds.filter((k) => k !== sells.kind).map((k) => SELLS_WORDS[k].chip.toLowerCase())
  const why = `${SELLS_WORDS[sells.kind].says} Why MVP thinks so: ${sells.why.join('; ')}.${also.length ? ` Also looks like ${also.join(' and ')}.` : ''}`
  return <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 cursor-help" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }} title={why}>{SELLS_WORDS[sells.kind].chip}{also.length ? ` + ${also.join(' + ')}` : ''}</span>
}

export function StaticsChip({ on }: { on: boolean | null | undefined }) {
  if (!on) return null
  return <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 inline-flex items-center gap-1" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }} title="Its own words say it takes photo (static) ads too."><ImageIcon size={11} />Takes statics</span>
}

// ── HUNTR'S IDEAS (Seb, 2026-10-14: "do 1,2,3,4,5") ─────────────────────────

/** One tap lists: each sets the filters and the sort in one go. */
export type PresetId = 'untapped' | 'new' | 'spenders' | 'fast' | 'pays' | 'budgets'
export const PRESETS: Array<{ id: PresetId; label: string; says: string; filters: FinderFilters; sort: 'picks' | 'pay' | 'spend' }> = [
  { id: 'untapped', label: 'Untapped', says: 'Spending on ads (Meta ads or TRYBE’s Top 100) with 30 creators or fewer: the budget is there and few creators share it.', filters: { ...NO_FILTERS, spending: true, maxCreators: 30 }, sort: 'picks' },
  { id: 'new', label: 'New this week', says: 'New on TRYBE, best bets first. Get in early and become one of their top creators.', filters: { ...NO_FILTERS, newOnly: true }, sort: 'picks' },
  { id: 'spenders', label: 'Big spenders', says: 'Every brand spending on ads now, best bets first.', filters: { ...NO_FILTERS, spending: true }, sort: 'picks' },
  { id: 'fast', label: 'Fast deciders', says: 'Brands that decide videos in 5 days or less, from MVP members’ results.', filters: { ...NO_FILTERS, fastReview: true }, sort: 'picks' },
  { id: 'pays', label: 'Pays $25+ a video', says: 'At least $25 per approved video, from your results, members’ results or its fee. A brand with no pay figure is left out. Highest first.', filters: { ...NO_FILTERS, minPerVideo: 25 }, sort: 'pay' },
  { id: 'budgets', label: 'Big creator budgets', says: 'Pays TRYBE creators about $1,000 a month or more, estimated from its videos approved in the last 30 days and its pay per video. Biggest first. A brand MVP cannot estimate is left out.', filters: { ...NO_FILTERS, minSpend: 1000 }, sort: 'spend' },
]
const sameFilters = (a: FinderFilters, b: FinderFilters) => (Object.keys({ ...a, ...b }) as Array<keyof FinderFilters>).every((k) => (a[k] || null) === (b[k] || null))
export const presetOf = (f: FinderFilters, sort: string): PresetId | null => PRESETS.find((p) => p.sort === sort && sameFilters(p.filters, f))?.id ?? null

export function FinderPresets({ filters, sort, onPick }: { filters: FinderFilters; sort: string; onPick: (p: (typeof PRESETS)[number] | null) => void }) {
  const on = presetOf(filters, sort)
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-2.5" role="group" aria-label="Quick lists">
      <span className="text-[12px] mr-1" style={soft}>Quick lists</span>
      {PRESETS.map((p) => (
        <button key={p.id} onClick={() => onPick(on === p.id ? null : p)} aria-pressed={on === p.id} title={p.says}
          className={chip} style={on === p.id ? { background: GREEN, borderColor: GREEN, color: '#fff' } : { borderColor: 'var(--border-2)' }}>{p.label}</button>
      ))}
    </div>
  )
}

const VERDICT_STYLE = {
  strong: { background: 'rgba(22,163,74,0.14)', color: GREEN },
  look: { background: 'rgba(124,58,237,0.10)', color: PURPLE },
  skip: { background: 'var(--surface-2)', color: 'var(--text-3)' },
  unknown: { background: 'var(--surface-2)', color: 'var(--text-3)' },
} as const

/** Strong pick, Worth a look, Skip, or Too little read: the Best bet score in a word. */
export function VerdictChip({ score, read }: { score: number | undefined; read: number | undefined }) {
  if (score == null) return null
  const v = verdictOf(score, read ?? 0)
  return (
    <span className="text-[11px] font-bold rounded-md px-2 py-0.5 cursor-help" style={VERDICT_STYLE[v]}
      title={v === 'unknown' ? 'MVP has read fewer than two signals for this brand, so it does not judge it yet.' : `Best bet ${score}, weighed by Your priorities. 40 and up is a strong pick, under 12 a skip.`}>
      {VERDICT_WORDS[v]}{v !== 'unknown' ? ` · ${score}` : ''}
    </span>
  )
}

/** How fast the brand decides videos, from MVP members' results. */
export function ReviewChip({ review }: { review: { reviewDays?: number | null; slowShare?: number | null } | null | undefined }) {
  const w = reviewWords(review)
  if (!w) return null
  const style = w.tone === 'good' ? { background: 'rgba(22,163,74,0.12)', color: GREEN } : w.tone === 'bad' ? { background: 'rgba(180,83,9,0.12)', color: AMBER } : { background: 'var(--surface-2)', color: 'var(--text-2)' }
  return <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 inline-flex items-center gap-1 cursor-help" style={style} title="From MVP members' own videos with this brand: how long it takes to approve or reject one (the middle member), and how many wait over a week. Shown once 5 members have results."><Clock size={11} />{w.text}</span>
}
