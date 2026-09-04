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

export default function EarningsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sync, setSync] = useState<EarningsSyncStatus | null>(null)
  const [starting, setStarting] = useState(false)

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
      const res = await requestEarningsSync(`${year}-01-01`)
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

  const byMonth = Array.from(new Set(rows.map(r => r.period_start))).sort().reverse()

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
          <button type="button" onClick={() => void startSync()} disabled={starting || !!sync?.running}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#7C3AED,#2563eb)' }}>
            {(starting || sync?.running)
              ? <><Loader2 size={15} className="animate-spin" /> {sync?.months ? `Month ${sync.monthsDone ?? 0} of ${sync.months}` : 'Starting…'}</>
              : <><RefreshCw size={15} /> {rows.length ? 'Re-sync this year' : 'Sync from Amazon'}</>}
          </button>
        </div>

        {loadError && (
          <div className="card p-4" style={{ borderColor: '#e0554b55' }}>
            <p className="text-[13px]" style={{ color: '#e0554b' }}>{loadError}</p>
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
              <h2 className="text-sm font-semibold mb-3" style={label}>By month</h2>
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
                    {byMonth.map(m => rows.filter(r => r.period_start === m).map((r, i) => (
                      <tr key={`${m}-${r.stream}-${r.store_id}`} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="py-2 pr-3" style={label}>
                          {i === 0 ? new Date(`${m}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''}
                        </td>
                        <td className="py-2 pr-3" style={muted}>{STREAM_LABEL[r.stream] || r.stream}</td>
                        <td className="py-2 pr-3" style={muted}>
                          {r.store_scope || '—'} <span className="font-mono text-[11px]">{r.store_id}</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(r.clicks)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{num(r.orders)}</td>
                        <td className="py-2 text-right tabular-nums font-medium" style={label}>{money(r.earnings_cents)}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] mt-3" style={muted}>
                Figures come from Amazon&apos;s own reporting calls, so they should match what you see on Amazon for the same month and store. Where a cell reads &ldquo;not reported&rdquo;, Amazon returned nothing for that metric, which is not the same as zero.
              </p>
            </div>

            {sync?.diag?.errors && sync.diag.errors.length > 0 && (
              <div className="card p-4">
                <p className="text-[12px] font-semibold mb-1" style={label}>Some months did not come back</p>
                <ul className="text-[11px] space-y-0.5" style={muted}>
                  {sync.diag.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
