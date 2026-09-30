'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SOLD-PRODUCT CAMPAIGNS, ACCEPTED ONCE A DAY.
//
// Creator Connections has no API: accepting happens in the creator's own
// Amazon session, through SCOUT. So the daily run happens in their browser,
// the first time they open MVP that day, with nothing on screen until it has
// something to say. It accepts at most DAILY_MAX campaigns, stops at the first
// failure that would fail them all (SCOUT missing, Amazon signed out), and says
// what happened: how many accepted, and which were not and why. The Earnings
// card shows the same result.
//
// It does not run when the creator turned it off (Earnings), outside Labs,
// without SCOUT, or when it already ran in the last 20 hours on any browser.
import { useEffect } from 'react'
import { toast } from 'sonner'
import { isExtensionAvailable } from '@/lib/extension-frame'
import { acceptSoldMatch, stopsTheRun, DAILY_RESULT_KEY, type SoldMatchRow, type DailyResult } from '@/lib/sold-accept'

const DAY_KEY = 'mvp-sold-daily-day'
const DAILY_MAX = 10

export default function SoldCampaignsDaily() {
  useEffect(() => {
    const day = new Date().toISOString().slice(0, 10)
    try { if (localStorage.getItem(DAY_KEY) === day) return } catch { return }
    const mark = () => { try { localStorage.setItem(DAY_KEY, day) } catch { /* private window */ } }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/campaigns/sold-matches', { cache: 'no-store' })
        if (!r.ok) { if (r.status === 403) mark(); return }
        const j = await r.json() as { matches?: SoldMatchRow[]; auto?: boolean; autoAt?: string | null }
        if (!j.auto) { mark(); return }
        if (j.autoAt && Date.now() - Date.parse(j.autoAt) < 20 * 3600_000) { mark(); return }
        const list = (j.matches ?? []).slice(0, DAILY_MAX)
        if (!list.length) { mark(); await fetch('/api/campaigns/sold-matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoRan: true }) }).catch(() => null); return }
        if (!(await isExtensionAvailable())) return // try again on a browser with SCOUT
        mark()
        const result: DailyResult = { day, accepted: [], failed: [] }
        for (const m of list) {
          if (cancelled) break
          const o = await acceptSoldMatch(m, 'sold-match-daily')
          const name = `${m.brand || m.campaignName} (${m.commissionPct}%)`
          if (o.state === 'failed') {
            result.failed.push({ name, note: o.note || 'Not accepted.' })
            if (stopsTheRun(o.note)) { result.stopped = o.note; break }
          } else result.accepted.push(name)
        }
        try { localStorage.setItem(DAILY_RESULT_KEY, JSON.stringify(result)) } catch { /* ignore */ }
        await fetch('/api/campaigns/sold-matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoRan: true }) }).catch(() => null)
        const a = result.accepted.length, f = result.failed.length
        if (result.stopped) toast.error(`Today's Creator Connections campaigns were not accepted: ${result.stopped}`, { duration: 12000 })
        else if (a || f) {
          const msg = `SCOUT accepted ${a} Creator Connections campaign${a === 1 ? '' : 's'} for products you already sell${f ? `; ${f} could not be accepted (Earnings says why)` : ''}.`
          if (f) toast.warning(msg, { duration: 12000 }); else toast.success(msg, { duration: 12000 })
        }
      } catch { /* try again on the next visit */ }
    }, 8000)
    return () => { cancelled = true; clearTimeout(t) }
  }, [])
  return null
}
