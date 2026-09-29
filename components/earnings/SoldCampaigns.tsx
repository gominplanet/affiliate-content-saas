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
// accept. Labs (admin) while it is tested.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Check, AlertCircle, Handshake } from 'lucide-react'
import { requestAcceptCampaign } from '@/lib/extension-frame'

type Match = {
  campaignId: string; campaignName: string; brand: string | null; commissionPct: number; endsAt: string
  slotsLeft: number | null; asin: string; productTitle: string | null; orders: number; earningsCents: number; detailsUrl: string
}
type Outcome = { state: 'accepted' | 'already' | 'failed'; note?: string }

const money = (c: number) => (c / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })

function reasonText(error?: string, reason?: string): string {
  const r = `${error || ''} ${reason || ''}`
  if (/not-installed/.test(r)) return 'SCOUT is not installed in this browser.'
  if (/sign|login|auth/i.test(r)) return 'Amazon asked you to sign in. Sign in to your Associates account, then try again.'
  if (/full|no.?slot|closed|ended|expired/i.test(r)) return 'The campaign is full or has closed.'
  if (/button/i.test(r)) return 'Amazon did not show an Accept button for this campaign.'
  if (/timeout/.test(r)) return 'Amazon took too long to answer.'
  return r.trim() ? `Not accepted (${r.trim()}).` : 'Not accepted.'
}

export default function SoldCampaigns() {
  const [data, setData] = useState<{ matches: Match[]; soldProducts: number; synced: boolean; days: number } | null>(null)
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
    } catch { setError('Could not reach MVP.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const acceptOne = async (m: Match): Promise<Outcome> => {
    const res = await requestAcceptCampaign(m.detailsUrl).catch(() => ({ ok: false, error: 'failed' } as { ok: boolean; accepted?: boolean; already?: boolean; error?: string; reason?: string }))
    if (!res.ok) return { state: 'failed', note: reasonText(res.error, res.reason) }
    // Recorded only after Amazon took it, in both places MVP reads accepts from.
    await Promise.all([
      fetch('/api/campaigns/sold-matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: m.campaignId, asin: m.asin, brand: m.brand }) }).catch(() => null),
      fetch('/api/campaigns/mark-accepted', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asin: m.asin, campaignId: m.campaignId, detailsUrl: m.detailsUrl, brand: m.brand, commissionPct: m.commissionPct, productTitle: m.productTitle, source: 'sold-match' }) }).catch(() => null),
    ])
    return { state: res.already ? 'already' : 'accepted' }
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
          if (/SCOUT is not installed|sign in/.test(o.note || '')) { toast.error(o.note!); break }
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
          <div className="flex gap-2 shrink-0">
            {running
              ? <button onClick={() => { stop.current = true }} className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/20">Stop after this one</button>
              : <button onClick={() => acceptAll(open)} className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg text-white bg-[#7C3AED] hover:opacity-90">Accept all {open.length}</button>}
          </div>
        )}
      </div>
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
