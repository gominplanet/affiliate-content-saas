'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The shared YouTube quota today (app/api/admin/youtube-quota): spent against
// the day's limit, who and what spent it, what MVP held back, and whether
// YouTube is refusing. A missing log says so instead of showing zero.
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

type Data = {
  ok: boolean; error?: string; day: string; quota: number; reserveAt: number; spent: number
  held: number; refused: number; refusedAt: string | null; msToReset: number | null
  byMethod: Array<{ method: string; calls: number; units: number; failed: number }>
  byUser: Array<{ email: string; calls: number; units: number; top: Array<{ method: string; units: number }> }>
}

export function YouTubeQuota() {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/youtube-quota')
      setD(await r.json().catch(() => ({ ok: false, error: `Could not read (${r.status})` })))
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const pct = d?.ok ? Math.min(100, Math.round((d.spent / d.quota) * 100)) : 0
  const colour = !d?.ok ? '#86868b' : d.refused > 0 || pct >= 100 ? '#ff3b30' : pct >= 60 ? '#ff9500' : '#34c759'
  const hours = d?.msToReset ? Math.max(0, Math.round(d.msToReset / 3_600_000 * 10) / 10) : null

  return (
    <div className="rounded-2xl border border-black/[0.06] dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube quota today</p>
        <button onClick={load} disabled={loading} className="btn-secondary text-xs inline-flex items-center gap-1.5">
          {loading && <Loader2 size={12} className="animate-spin" />} Refresh
        </button>
      </div>
      {!d ? null : !d.ok ? (
        <p className="text-[12px] text-[#ff9500] mt-2">{d.error}</p>
      ) : (
        <>
          <p className="text-[12px] mt-1.5" style={{ color: colour }}>
            {d.spent.toLocaleString()} of {d.quota.toLocaleString()} units ({pct}%) on {d.day}, Pacific.
            {d.refused > 0 ? ` YouTube refused ${d.refused} call${d.refused === 1 ? '' : 's'} for quota${d.refusedAt ? `, last at ${new Date(d.refusedAt).toLocaleTimeString()}` : ''}.` : ''}
            {hours != null ? ` Resets in ${hours} h.` : ''}
          </p>
          <div className="h-2 rounded-full bg-black/[0.06] dark:bg-white/10 mt-2 overflow-hidden relative">
            <div className="h-full" style={{ width: `${pct}%`, background: colour }} />
            <div className="absolute top-0 h-full w-px bg-[#1d1d1f]/40 dark:bg-white/50" style={{ left: `${Math.round(d.reserveAt / d.quota * 100)}%` }} title="After this, searches and caption downloads are held back" />
          </div>
          <p className="text-[11px] text-[#86868b] mt-1">
            Past the line at {d.reserveAt.toLocaleString()}, MVP holds back searches and caption downloads so uploads, comments and Studio settings still work.
            {d.held > 0 ? ` Held back so far today: ${d.held} call${d.held === 1 ? '' : 's'}.` : ''}
          </p>
          <div className="grid gap-4 md:grid-cols-2 mt-3">
            <div className="overflow-x-auto">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#86868b] mb-1">By account</p>
              <table className="w-full text-[12px] tabular-nums">
                <tbody>
                  {d.byUser.length === 0 && <tr><td className="text-[#86868b]">No calls recorded yet today.</td></tr>}
                  {d.byUser.map((u) => (
                    <tr key={u.email} className="border-t border-black/[0.05] dark:border-white/5">
                      <td className="py-1 pr-2 text-[#1d1d1f] dark:text-[#f5f5f7]">{u.email}<div className="text-[10.5px] text-[#86868b]">{u.top.map((t) => `${t.method} ${t.units}`).join(' · ')}</div></td>
                      <td className="py-1 text-right font-medium">{u.units.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#86868b] mb-1">By API method</p>
              <table className="w-full text-[12px] tabular-nums">
                <tbody>
                  {d.byMethod.map((m) => (
                    <tr key={m.method} className="border-t border-black/[0.05] dark:border-white/5">
                      <td className="py-1 pr-2 text-[#1d1d1f] dark:text-[#f5f5f7]">{m.method}<span className="text-[#86868b]"> · {m.calls} calls{m.failed ? `, ${m.failed} failed` : ''}</span></td>
                      <td className="py-1 text-right font-medium">{m.units.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
