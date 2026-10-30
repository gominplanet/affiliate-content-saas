'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The videos behind Analytics' submission counts (lib/trybe-sub-list): a chip
// per status, the search from the box above it, and one row per video with its brand, product,
// dates and, when the brand did not approve it, what the brand wrote. Still
// reading, a brand TRYBE did not give and nothing matching are each said, so
// an empty list never stands in for one MVP could not read.

import { Loader2, X, AlertTriangle } from 'lucide-react'
import { filterSubs, statusTally, STATUS_WORDS, FILTER_ORDER, type SubFilter } from '@/lib/trybe-sub-list'
import { MAX_LIST_BRANDS, ALL_TIME_BRANDS, type SubList } from '@/components/labs/useTrybeSubmissions'
import { brandPageUrl } from '@/lib/trybe-brand-page'

const PURPLE = '#7C3AED'
const soft = { color: 'var(--text-3)' }
const COLORS: Record<string, string> = { approved: '#16A34A', pending: '#3B82F6', revision: '#CA8A04', rejected: '#DC2626', other: '#6B7280' }
/** Whole days since a video was sent. */
const waited = (at: number | null) => (at ? Math.floor((Date.now() - at) / 86_400_000) : 0)
const day = (ms: number | null) => (ms == null ? null : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))

export default function TrybeSubList({ state, filter, setFilter, query, brandId, brandName, days, onClose }: {
  state: SubList | null
  filter: SubFilter
  setFilter: (f: SubFilter) => void
  /** The search, typed in Analytics' own box above. */
  query: string
  brandId: string | null
  brandName: string | null
  /** The window shown; null is all time (the Submissions tab). */
  days: number | null
  /** Analytics closes it; the Submissions tab is always open. */
  onClose?: () => void
}) {
  const list = state?.list ?? []
  const tally = statusTally(list, query, brandId)
  const shown = filterSubs(list, filter, query, brandId)
  const q = query.trim()
  const word = filter === 'all' ? '' : `${STATUS_WORDS[filter].toLowerCase()} `

  return (
    <div className="rounded-lg border p-3 mb-3" style={{ borderColor: 'var(--border-2)' }} aria-label="Your videos">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="text-[13px] font-bold">Your videos{brandName ? `, ${brandName}` : ''}</p>
        <span className="text-[11.5px]" style={soft}>{days ? `last ${days} days` : 'all time'}</span>
        {onClose && <button type="button" onClick={onClose} className="ml-auto inline-flex items-center gap-1 text-[12px]" style={soft}><X size={12} /> Close</button>}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Status">
        {FILTER_ORDER.filter((f) => f !== 'other' || tally.other > 0).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className="rounded-full border px-2.5 py-0.5 text-[12px] font-semibold"
            style={filter === f ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border)', color: 'var(--text-2)' }}>
            {f === 'all' ? 'All' : STATUS_WORDS[f]} ({tally[f]})
          </button>
        ))}
      </div>

      {state?.loading && (
        <p className="text-[12px] mb-2 inline-flex items-center gap-1.5" style={soft}><Loader2 size={12} className="animate-spin" /> Reading your videos from TRYBE: {state.done} of {state.of} brands</p>
      )}
      {state && state.failed.length > 0 && (
        <p className="text-[12px] mb-2 inline-flex items-start gap-1.5" style={{ color: '#B45309' }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /><span>TRYBE did not give the videos for {state.failed.slice(0, 5).join(', ')}{state.failed.length > 5 ? ` and ${state.failed.length - 5} more` : ''}, so they are missing here. Press Read again.</span>
        </p>
      )}
      {state?.error && <p className="text-[12px] mb-2" style={{ color: '#B91C1C' }}>{state.error}</p>}
      {state && state.skipped > 0 && (
        <p className="text-[12px] mb-2" style={soft}>MVP read your {days ? MAX_LIST_BRANDS : ALL_TIME_BRANDS} busiest brands; {state.skipped} more are not in this list.</p>
      )}

      {!state?.loading && shown.length === 0 && (
        <p className="text-[12.5px] py-2" style={soft}>
          {state?.error ? null : state && state.of === 0
            ? (days ? `No videos sent in the last ${days} days.` : 'TRYBE lists no videos you sent to a brand.')
            : `No ${word}videos${brandName ? ` for ${brandName}` : ''}${days ? ` in the last ${days} days` : ''}${q ? ` match “${q}”` : ''}.`}
          {days && days < 30 ? ' Pick 30 days above to look further back.' : ''}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {shown.map((s) => (
            <li key={`${s.brandId}:${s.id}`} className="flex items-start gap-2.5 rounded-lg border p-2" style={{ borderColor: 'var(--border)' }}>
              {s.thumbnail
                ? <img src={s.thumbnail} alt="" className="w-10 h-14 rounded object-cover shrink-0" referrerPolicy="no-referrer" loading="lazy" />
                : <span className="w-10 h-14 rounded shrink-0" style={{ background: 'var(--surface-2)' }} />}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold leading-snug">{s.product || 'No product tagged'}</p>
                <p className="text-[12px]" style={soft}>
                  {s.brand}{s.at ? `, sent ${day(s.at)}` : ''}{s.decidedAt && (s.status === 'approved' || s.status === 'rejected') ? `, ${s.status} ${day(s.decidedAt)}` : ''}
                  {s.status === 'pending' && waited(s.at) > 0 ? `, in review ${waited(s.at)} ${waited(s.at) === 1 ? 'day' : 'days'}` : ''}
                  {' '}<a href={brandPageUrl(s.brandId)} target="_blank" rel="noopener noreferrer" className="underline">Open {s.brand} on TRYBE</a>
                </p>
                {s.reason && <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>{s.brand} wrote: &ldquo;{s.reason}&rdquo;</p>}
              </div>
              <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${COLORS[s.status]}1F`, color: COLORS[s.status] }}>
                {s.status === 'other' ? (s.rawStatus || 'Unknown') : STATUS_WORDS[s.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && <p className="text-[11px] mt-2" style={soft}>Up to 100 videos per brand, newest first.</p>}
    </div>
  )
}
