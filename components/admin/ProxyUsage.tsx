'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The download proxy's data this billing period (app/api/admin/proxy-usage):
// used against the plan, amber from 80%, red when it runs out, with the date it
// resets. When the plan is used up every YouTube fetch fails for every member,
// so this says so in those words. A missing key says so instead of showing zero.
import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PROXY_WARN_PCT } from '@/lib/proxy-usage'

type Data =
  | { ok: true; usedGb: number; limitGb: number | null; pct: number | null; projectedGb: number | null; periodStart: string; periodEnd: string }
  | { ok: false; error: string }

export function ProxyUsage() {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/proxy-usage', { cache: 'no-store' })
      setD(await r.json().catch(() => ({ ok: false, error: `Could not read (${r.status})` })))
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const pct = d?.ok ? d.pct : null
  const colour = !d?.ok ? '#86868b' : pct == null ? '#34c759' : pct >= 100 ? '#ff3b30' : pct >= PROXY_WARN_PCT ? '#ff9500' : '#34c759'
  const resets = d?.ok && d.periodEnd ? new Date(d.periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null

  return (
    <div className="rounded-2xl border border-black/[0.06] dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Video download proxy (Webshare)</p>
        <button onClick={load} disabled={loading} className="btn-secondary text-xs inline-flex items-center gap-1.5">
          {loading && <Loader2 size={12} className="animate-spin" />} Refresh
        </button>
      </div>
      {!d ? null : !d.ok ? (
        <p className="text-[12px] text-[#ff9500] mt-2">{d.error}</p>
      ) : (
        <>
          <p className="text-[12px] mt-1.5" style={{ color: colour }}>
            {d.usedGb.toLocaleString()} GB used{d.limitGb ? ` of ${d.limitGb.toLocaleString()} GB (${pct}%)` : ' (unlimited plan)'} this billing period{resets ? `, resets ${resets}` : ''}.
            {pct != null && pct >= 100 ? ' The plan is used up: every YouTube fetch fails for every member until you top up or it resets.' : pct != null && pct >= PROXY_WARN_PCT ? ' Running low: top up or upgrade before it runs out, or every YouTube fetch will fail.' : ''}
          </p>
          {d.limitGb ? (
            <div className="h-2 rounded-full bg-black/[0.06] dark:bg-white/10 mt-2 overflow-hidden relative">
              <div className="h-full" style={{ width: `${Math.min(100, pct ?? 0)}%`, background: colour }} />
              <div className="absolute top-0 h-full w-px bg-[#1d1d1f]/40 dark:bg-white/50" style={{ left: `${PROXY_WARN_PCT}%` }} title={`Warning from ${PROXY_WARN_PCT}%`} />
            </div>
          ) : null}
          {d.projectedGb != null && (
            <p className="text-[11px] text-[#86868b] mt-1">At this pace Webshare projects about {d.projectedGb.toLocaleString()} GB by the end of the period.</p>
          )}
        </>
      )}
    </div>
  )
}
