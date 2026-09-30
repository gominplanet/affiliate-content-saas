'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Creator Connections campaigns for products the creator already sells
// (lib/sold-campaigns). Accepting one adds its commission to every sale after
// that, for a product whose content already exists.
//
// SCOUT accepts them one at a time in the creator's own Amazon session, and
// each row says what actually happened: accepted, already joined, or not
// accepted with the reason. Nothing is marked accepted that Amazon did not
// accept. A match on another colour or size says so, and names the version the
// campaign pays on. The daily run (SoldCampaignsDaily) accepts new ones on its
// own unless it is switched off here, and its last result is shown here. Labs.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Check, AlertCircle, Handshake } from 'lucide-react'
import { acceptSoldMatch, stopsTheRun, DAILY_RESULT_KEY, type SoldMatchRow as Match, type AcceptOutcome as Outcome, type DailyResult } from '@/lib/sold-accept'

const money = (c: number) => (c / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })

export default function SoldCampaigns() {
  const [data, setData] = useState<{ matches: Match[]; soldProducts: number; synced: boolean; days: number; auto?: boolean; autoAt?: string | null } | null>(null)
  const [auto, setAuto] = useState(true)
  const [daily, setDaily] = useState<DailyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<Record<string, Outcome>>({})
  const [current, setCurrent] = useState<string | null>(null)
  const stop = useRef(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/campaigns/sold-matches', { cache: 'no-store' })
      if (r.status === 403) return // not in Labs for this account: nothing shown
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setError(j.error || 'Could not read your campaigns.'); return }
      setData(j)
      setAuto(j.auto !== false)
      try { const d = localStorage.getItem(DAILY_RESULT_KEY); if (d) setDaily(JSON.parse(d)) } catch { /* ignore */ }
    } catch { setError('Could not reach MVP.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const acceptOne = (m: Match): Promise<Outcome> => acceptSoldMatch(m)

  const switchAuto = async (on: boolean) => {
    setAuto(on)
    const r = await fetch('/api/campaigns/sold-matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto: on }) }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) { setAuto(!on); toast.error((j as { error?: string }).error || 'Could not save that.'); return }
    toast.success(on ? 'MVP will accept new matches once a day.' : 'Daily accepting is off. Accept them here by hand.')
  }

  const acceptAll = async (list: Match[]) => {
    setRunning(true); stop.current = false
    let ok = 0, failed = 0
    try {
      for (const m of list) {
        if (stop.current) break
        if (outcome[m.campaignId]?.state === 'accepted' || outcome[m.campaignId]?.state === 'already') continue
        setCurrent(m.campaignId)
        const o = await acceptOne(m)
        setOutcome((p) => ({ ...p, [m.campaignId]: o }))
        if (o.state === 'failed') {
          failed++
          if (stopsTheRun(o.note)) { toast.error(o.note!); break }
        } else ok++
      }
    } finally {
      setCurrent(null); setRunning(false)
      if (ok || failed) toast[failed ? 'warning' : 'success'](`${ok} accepted${failed ? `, ${failed} not accepted (each row says why)` : ''}.`)
    }
  }

  if (error) return <p className="text-[12.5px] text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={13} /> {error}</p>
  if (!data) return null
  if (!data.synced) return null // no earnings synced yet: the page above already asks for that
  const open = data.matches.filter((m) => outcome[m.campaignId]?.state !== 'accepted' && outcome[m.campaignId]?.state !== 'already')

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <Handshake size={18} className="text-[#7C3AED] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {data.matches.length
              ? `${data.matches.length} Creator Connections campaign${data.matches.length === 1 ? '' : 's'} for products you already sell`
              : 'No open campaigns for products you already sell'}
          </p>
          <p className="text-[12.5px] text-[#4b4b4f] dark:text-[#b0b0b5] mt-0.5">
            {data.matches.length
              ? `These products sold through your links in the last ${data.days} days, and their brands are running campaigns you have not joined. Accept one and its commission is added to every sale after that. SCOUT accepts them in your own Amazon session, one at a time.`
              : `MVP checked the ${data.soldProducts} product${data.soldProducts === 1 ? '' : 's'} that sold in the last ${data.days} days against every open campaign it knows of.`}
          </p>
        </div>
        {open.length > 0 && (
          <div className="flex gap-2 shrink-0 items-center">
            {running
              ? <button onClick={() => { stop.current = true }} className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20">Stop after this one</button>
              : <button onClick={() => acceptAll(open)} className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg text-white bg-[#7C3AED] hover:opacity-90">Accept all {open.length}</button>}
          </div>
        )}
      </div>
      <label className="mt-3 flex items-start gap-2 text-[12.5px] text-[#4b4b4f] dark:text-[#b0b0b5] cursor-pointer">
        <input type="checkbox" checked={auto} onChange={(e) => void switchAuto(e.target.checked)} className="mt-0.5" />
        <span>
          <b className="text-[#1d1d1f] dark:text-[#f5f5f7]">Accept new matches every day.</b> The first time you open MVP each day,
          SCOUT accepts up to 10 new ones in your Amazon session and tells you what it did.
          {data.autoAt ? ` Last run ${new Date(data.autoAt).toLocaleString()}.` : ' It has not run yet.'}
        </span>
      </label>
      {daily && (daily.accepted.length > 0 || daily.failed.length > 0 || daily.stopped) && (
        <div className="mt-2 text-[12px] rounded-lg bg-gray-50 dark:bg-white/5 px-3 py-2">
          <div className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Daily run on {daily.day}{daily.stopped ? ': stopped' : ''}</div>
          {daily.stopped && <div className="text-[#ff3b30]">{daily.stopped}</div>}
          {daily.accepted.length > 0 && <div className="text-[#10B981]">Accepted: {daily.accepted.join(', ')}</div>}
          {daily.failed.map((f) => <div key={f.name} className="text-[#ff3b30]">{f.name}: {f.note}</div>)}
        </div>
      )}
      {data.matches.length > 0 && (
        <div className="mt-3 divide-y divide-gray-100 dark:divide-white/5">
          {data.matches.map((m) => {
            const o = outcome[m.campaignId]
            const busy = current === m.campaignId
            return (
              <div key={m.campaignId} className="py-2 flex items-center gap-3 text-[12.5px]">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{m.brand || m.campaignName} · {m.commissionPct}% commission</div>
                  <div className="text-[#86868b] truncate">
                    {m.productTitle || m.asin}: {m.orders} order{m.orders === 1 ? '' : 's'}, {money(m.earningsCents)} earned · ends {m.endsAt}{m.slotsLeft != null ? ` · ${m.slotsLeft} slot${m.slotsLeft === 1 ? '' : 's'} left` : ''}
                  </div>
                  {m.matchKind === 'variant' && (
                    <div className="text-[#b45309] text-[12px] mt-0.5">
                      Another colour or size: you sold {m.soldAttrs ? `the ${m.soldAttrs} one` : 'one version'}; this campaign pays on {m.campaignAsin || 'another version'}. Link that version to earn the campaign rate.
                    </div>
                  )}
                  {o?.state === 'failed' && <div className="text-[#ff3b30] text-[12px] mt-0.5">{o.note}</div>}
                </div>
                {busy ? <span className="inline-flex items-center gap-1 text-[#86868b]"><Loader2 size={13} className="animate-spin" /> Accepting…</span>
                  : o?.state === 'accepted' ? <span className="inline-flex items-center gap-1 text-[#10B981] font-medium"><Check size={13} /> Accepted</span>
                  : o?.state === 'already' ? <span className="inline-flex items-center gap-1 text-[#10B981] font-medium"><Check size={13} /> Already joined</span>
                  : <button disabled={running} onClick={() => acceptAll([m])} className="text-[12px] font-semibold px-2.5 py-1 rounded-md border border-[#7C3AED]/40 text-[#7C3AED] disabled:opacity-50">Accept</button>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
