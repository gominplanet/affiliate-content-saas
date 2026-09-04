// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Earnings — every stream in one place.
//
// Amazon never shows a creator what they actually earned. Creator Connections
// reporting covers CC and EPC but only for the store you have selected, the
// Associates page covers commissions and bounties but only for your offsite
// tracking id, and the same CC figure appears in both at very different values.
// Exports are worse: a month's file held 0.4% of the earnings its own dashboard
// showed for that month.
//
// So SCOUT replays what the pages themselves call, and this shows the result
// with the split intact. Two rules the UI holds to: nothing is a total unless it
// came from Amazon, and a metric Amazon did not report renders as "not reported"
// rather than as a zero.
'use client'

import { useCallback, useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, RefreshCw, TrendingUp, Store, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { requestEarningsSync, requestEarningsStatus, type EarningsSyncStatus } from '@/lib/extension-frame'

const label = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

interface Row {
  period_start: string; stream: string; store_id: string; store_scope: string | null
  clicks: number | null; orders: number | null; quantity: number | null
  earnings_cents: number | null; revenue_cents: number | null; synced_at: string
}
interface Totals {
  earningsCents: number | null; revenueCents: number | null
  clicks: number | null; orders: number | null
  onsiteCents: number | null; offsiteCents: number | null
  byStream: Record<string, number | null>
}

/** Cents to money. `null` is NOT zero: it means Amazon didn't report the metric,
 *  and showing $0.00 for that is the single easiest way to make honest data lie. */
function money(cents: number | null | undefined): string {
  if (cents == null) return 'not reported'
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}
const num = (n: number | null | undefined) => (n == null ? 'not reported' : n.toLocaleString())

const STREAM_LABEL: Record<string, string> = {
  cc: 'Creator Connections',
  epc: 'Sponsored Products (EPC)',
  commissions: 'Associates commissions',
  bounties: 'Bounties',
}
/** Postgres hands rows back in whatever order it likes, which made one month read
 *  CC, EPC, CC, EPC and the next read EPC, EPC, CC, CC. Same figures, but the eye
 *  can't compare months down a column when the rows move. Fixed order: stream
 *  first, then onsite above offsite. */
const STREAM_RANK: Record<string, number> = { cc: 0, epc: 1, commissions: 2, bounties: 3 }
const rowRank = (r: Row) =>
  (STREAM_RANK[r.stream] ?? 9) * 10 + (r.store_scope === 'onsite' ? 0 : 1)

/** Add up a month's rows the same way the page totals do: a null is skipped, and
 *  if every value for a metric was null the sum stays null rather than becoming a
 *  zero that Amazon never reported. */
function sumRows(rs: Row[]) {
  const add = (pick: (r: Row) => number | null) => {
    let total = 0, seen = false
    for (const r of rs) { const v = pick(r); if (v == null) continue; total += v; seen = true }
    return seen ? total : null
  }
  return { clicks: add(r => r.clicks), orders: add(r => r.orders), earningsCents: add(r => r.earnings_cents) }
}

/** True when Amazon answered for this row but every figure in it was zero. That's
 *  a real answer ("nothing happened here"), not a missing one, so it's hidden by
 *  default and counted rather than dropped. */
const isQuiet = (r: Row) =>
  !r.clicks && !r.orders && !r.earnings_cents && !r.revenue_cents

export default function EarningsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sync, setSync] = useState<EarningsSyncStatus | null>(null)
  const [starting, setStarting] = useState(false)
  // Amazon's own header prints this as "StoreID: …". Auto-discovery reads it off
  // the reporting page when it can, but that page is a SPA and does not always
  // expose it, so the creator can just tell us rather than being stuck.
  const [storeId, setStoreId] = useState('')
  const [showQuiet, setShowQuiet] = useState(false)
  useEffect(() => { try { setStoreId(localStorage.getItem('mvp_amazon_store_id') || '') } catch { /* ignore */ } }, [])

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/amazon-earnings').then(r => r.json())
      if (d?.error) setLoadError(d.error)
      setRows(Array.isArray(d?.rows) ? d.rows : [])
      setTotals(d?.totals ?? null)
      setLastSyncedAt(d?.lastSyncedAt ?? null)
    } catch { setLoadError('Could not load your earnings.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  // Poll only while a sync is running, and reload the table each tick so a long
  // backfill fills in month by month instead of landing all at once at the end.
  useEffect(() => {
    if (!sync?.running) return
    const iv = setInterval(async () => {
      const s = await requestEarningsStatus()
      if (s) setSync(s)
      void load()
      if (s && !s.running) {
        clearInterval(iv)
        if (s.error) toast.error(s.error)
        else toast.success(`Synced ${s.savedPeriods ?? 0} monthly totals from Amazon.`)
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [sync?.running, load])

  async function startSync() {
    setStarting(true)
    try {
      const year = new Date().getUTCFullYear()
      const clean = storeId.trim().toLowerCase()
      const stores = /^(?:onamz)?[a-z0-9]{3,}-\d{2}$/.test(clean) ? [clean] : undefined
      try { if (stores) localStorage.setItem('mvp_amazon_store_id', clean) } catch { /* ignore */ }
      const res = await requestEarningsSync(`${year}-01-01`, undefined, stores)
      if (!res.ok) {
        toast.error(res.error === 'not-installed'
          ? 'Install SCOUT and sign in to Amazon to read your earnings.'
          : (res.error || 'Could not start the sync.'))
        return
      }
      toast('Reading your Amazon earnings. This opens a background tab and takes a minute per few months.')
      setSync({ running: true })
    } finally { setStarting(false) }
  }

  const shown = showQuiet ? rows : rows.filter(r => !isQuiet(r))
  const quietCount = rows.length - shown.length
  const byMonth = Array.from(new Set(shown.map(r => r.period_start))).sort().reverse()

  return (
    <>
      <PageHero
        title="Amazon Earnings"
        subtitle="Every Amazon income stream in one place: Creator Connections, Sponsored Products, commissions and bounties, split by onsite and offsite. Read straight from Amazon's own reporting, not from an export."
      />

      <div className="max-w-5xl pb-24 space-y-5">
        <div className="card p-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={label}>
              {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}` : 'Not synced yet'}
            </p>
            <p className="text-[12px] mt-0.5" style={muted}>
              SCOUT reads these figures in your own Amazon session, the same calls the reporting pages make. Amazon&apos;s CSV exports are not used, because every one we tested returned a fraction of the real numbers.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              placeholder="Store ID (e.g. yourname-20)"
              className="px-3 py-2 rounded-lg border text-sm bg-transparent w-56"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              title='Optional. Amazon shows this in its own header as "StoreID: …". Only needed if the sync cannot find it on its own.'
            />
          <button type="button" onClick={() => void startSync()} disabled={starting || !!sync?.running}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#7C3AED,#2563eb)' }}>
            {(starting || sync?.running)
              ? <><Loader2 size={15} className="animate-spin" /> {sync?.months ? `Month ${sync.monthsDone ?? 0} of ${sync.months}` : 'Starting…'}</>
              : <><RefreshCw size={15} /> {rows.length ? 'Re-sync this year' : 'Sync from Amazon'}</>}
          </button>
          </div>
        </div>

        {loadError && (
          <div className="card p-4" style={{ borderColor: '#e0554b55' }}>
            <p className="text-[13px]" style={{ color: '#e0554b' }}>{loadError}</p>
          </div>
        )}

        {/* Sync diagnostics render REGARDLESS of whether any rows landed. Putting
            them behind "we have data" hid them at the only moment they matter. */}
        {sync && (sync.diag?.stores?.length || sync.diag?.errors?.length || sync.error) && (
          <div className="card p-4 space-y-2">
            <p className="text-[12px] font-semibold" style={label}>Sync detail</p>
            {sync.diag?.stores?.length ? (
              <p className="text-[11px]" style={muted}>
                Amazon stores found: {sync.diag.stores.join(', ')}
              </p>
            ) : sync.done ? (
              <p className="text-[11px]" style={{ color: '#e0554b' }}>
                No Amazon store ids could be read from the reporting page, so there was nothing to ask for.
              </p>
            ) : null}
            {sync.error && <p className="text-[11px]" style={{ color: '#e0554b' }}>{sync.error}</p>}
            {sync.diag?.errors?.length ? (
              <ul className="text-[11px] space-y-0.5" style={muted}>
                {sync.diag.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            ) : null}
            {sync.diag?.assoc && (
              <details className="text-[11px]" style={muted}>
                <summary className="cursor-pointer">Associates response ({sync.diag.assoc.status})</summary>
                <pre className="mt-1 p-2 rounded overflow-x-auto text-[10px]" style={{ background: 'var(--surface-2)' }}>{sync.diag.assoc.body?.slice(0, 1500)}</pre>
              </details>
            )}
          </div>
        )}

        {loading ? (
          <div className="card p-8 flex items-center justify-center gap-2 text-sm" style={muted}>
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="card p-8 text-center">
            <TrendingUp size={26} style={{ color: '#7C3AED' }} className="mx-auto mb-3" />
            <p className="text-[15px] font-semibold mb-1" style={label}>No earnings synced yet</p>
            <p className="text-[13px] max-w-lg mx-auto" style={muted}>
              Hit Sync from Amazon above. SCOUT opens a background tab on your Amazon reporting page and reads each month. Nothing is uploaded to Amazon and nothing is changed there.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { k: 'Total earnings', v: money(totals?.earningsCents), accent: '#10B981' },
                { k: 'Revenue driven', v: money(totals?.revenueCents), accent: '#7C3AED' },
                { k: 'Clicks', v: num(totals?.clicks), accent: '#0EA5A4' },
                { k: 'Orders', v: num(totals?.orders), accent: '#d97706' },
              ].map(c => (
                <div key={c.k} className="card p-4">
                  <p className="text-[11px] font-medium uppercase tracking-wide" style={muted}>{c.k}</p>
                  <p className="text-[22px] font-bold mt-1 tabular-nums" style={{ color: c.accent }}>{c.v}</p>
                </div>
              ))}
            </div>

            {/* Say what the total is before someone assumes it's everything. Right
                now it's Creator Connections plus Sponsored Products. Associates
                commissions and bounties come from a separate endpoint that still
                answers 401, so they are absent, and absent has to be visible. */}
            <p className="text-[11px] -mt-1" style={muted}>
              Counts Creator Connections and Sponsored Products, onsite and offsite. Associates commissions and bounties are not in this figure yet: Amazon serves those from a different report that SCOUT cannot read in your session, so leaving them out is more honest than guessing at them.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="card p-4">
                <p className="text-[12px] font-semibold mb-2 inline-flex items-center gap-1.5" style={label}><Store size={14} /> Onsite</p>
                <p className="text-[20px] font-bold tabular-nums" style={label}>{money(totals?.onsiteCents)}</p>
                <p className="text-[11px] mt-1" style={muted}>Your storefront and shoppable videos on Amazon.</p>
              </div>
              <div className="card p-4">
                <p className="text-[12px] font-semibold mb-2 inline-flex items-center gap-1.5" style={label}><Globe size={14} /> Offsite</p>
                <p className="text-[20px] font-bold tabular-nums" style={label}>{money(totals?.offsiteCents)}</p>
                <p className="text-[11px] mt-1" style={muted}>Traffic you sent in from YouTube, your blog and socials.</p>
              </div>
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h2 className="text-sm font-semibold" style={label}>By month</h2>
                {quietCount > 0 || showQuiet ? (
                  <button
                    type="button"
                    onClick={() => setShowQuiet(v => !v)}
                    className="text-[12px] underline underline-offset-2"
                    style={muted}
                  >
                    {showQuiet
                      ? 'Hide the rows where Amazon reported all zeros'
                      : `Show ${quietCount} row${quietCount === 1 ? '' : 's'} where Amazon reported all zeros`}
                  </button>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={muted}>
                      <th className="text-left font-medium py-2 pr-3">Month</th>
                      <th className="text-left font-medium py-2 pr-3">Stream</th>
                      <th className="text-left font-medium py-2 pr-3">Store</th>
                      <th className="text-right font-medium py-2 pr-3">Clicks</th>
                      <th className="text-right font-medium py-2 pr-3">Orders</th>
                      <th className="text-right font-medium py-2">Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMonth.map(m => {
                      // Every row for the month, sorted, INCLUDING the all-zero ones
                      // even when they're folded away. The subtotal has to be the
                      // month's real total, not the total of what's on screen.
                      const monthRows = rows.filter(r => r.period_start === m)
                      const visible = shown.filter(r => r.period_start === m).sort((a, b) => rowRank(a) - rowRank(b))
                      const sub = sumRows(monthRows)
                      return [
                        ...visible.map((r, i) => (
                          <tr key={`${m}-${r.stream}-${r.store_id}`} className="border-t" style={{ borderColor: 'var(--border)' }}>
                            <td className="py-2 pr-3" style={label}>
                              {i === 0 ? new Date(`${m}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''}
                            </td>
                            <td className="py-2 pr-3" style={muted}>{STREAM_LABEL[r.stream] || r.stream}</td>
                            <td className="py-2 pr-3" style={muted}>
                              {r.store_scope || 'unknown'} <span className="font-mono text-[11px]">{r.store_id}</span>
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(r.clicks)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(r.orders)}</td>
                            <td className="py-2 text-right tabular-nums font-medium" style={label}>{money(r.earnings_cents)}</td>
                          </tr>
                        )),
                        // Amazon's own page shows onsite and offsite added together
                        // whenever Store is set to All. This row is that same sum, so
                        // the two screens can be compared without doing the addition
                        // in your head.
                        <tr key={`${m}-total`} className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
                          <td className="py-2 pr-3" />
                          <td className="py-2 pr-3 font-semibold" style={label} colSpan={2}>
                            Month total, onsite plus offsite
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums font-semibold" style={label}>{num(sub.clicks)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums font-semibold" style={label}>{num(sub.orders)}</td>
                          <td className="py-2 text-right tabular-nums font-bold" style={label}>{money(sub.earningsCents)}</td>
                        </tr>,
                      ]
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] mt-3" style={muted}>
                Figures come from Amazon&apos;s own reporting calls, so they should match what you see on Amazon for the same month and store. Where a cell reads &ldquo;not reported&rdquo;, Amazon returned nothing for that metric, which is not the same as zero. Rows where Amazon answered with all zeros are folded away by the link above rather than deleted.
              </p>
            </div>

          </>
        )}
      </div>
    </>
  )
}
