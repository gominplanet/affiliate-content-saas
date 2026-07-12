'use client'

// Live self-diagnostic for the Facebook comment→DM chain. Calls
// /api/facebook/dm-debug (which checks the Page token's messaging scopes, the
// app- + Page-level `feed` webhook subscriptions, the webhook secret, the
// Auto-DM toggle, and the recent send log) and renders a plain verdict + a
// green/red checklist so an admin can see exactly which link is broken without
// reading raw JSON. See project_ig_comment_to_dm.

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw, CheckCircle2, XCircle, MinusCircle, Facebook } from 'lucide-react'

interface Checks {
  pageConnected: boolean
  pageName: string | null
  appSecretSet: boolean
  verifyTokenSet: boolean
  tokenHasMessagingScopes: boolean | null
  missingScopes: string[]
  appSubscribedToFeed: boolean | null
  feedSubscribed: boolean | null
  subscribedFields: string[]
  autoDmEnabled: boolean
  keyword: string | null
}
interface SendRow {
  platform?: string
  status?: string
  error?: string | null
  keyword?: string | null
  link_sent?: string | null
  created_at?: string
}
interface DebugResult {
  verdict: string
  checks: Checks
  recentSends: SendRow[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphErrors?: Record<string, any>
}

function Indicator({ state }: { state: boolean | null }) {
  if (state === true) return <CheckCircle2 size={15} className="text-[#34c759] flex-shrink-0" />
  if (state === false) return <XCircle size={15} className="text-[#ff3b30] flex-shrink-0" />
  return <MinusCircle size={15} className="text-[#c7c7cc] dark:text-[#48484a] flex-shrink-0" />
}

export default function FacebookDmStatus() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<DebugResult | null>(null)

  useEffect(() => { run() }, [])

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/facebook/dm-debug')
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Diagnostic failed')
      setData(d as DebugResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Diagnostic failed')
    } finally {
      setLoading(false)
    }
  }

  const verdict = data?.verdict || ''
  const tone = verdict.startsWith('✅') ? 'ok' : verdict.startsWith('⚠️') ? 'warn' : 'bad'
  const toneStyle = {
    ok:   { background: 'rgba(52,199,89,0.08)',  borderColor: 'rgba(52,199,89,0.35)' },
    warn: { background: 'rgba(255,149,0,0.08)',  borderColor: 'rgba(255,149,0,0.35)' },
    bad:  { background: 'rgba(255,59,48,0.07)',  borderColor: 'rgba(255,59,48,0.30)' },
  }[tone]

  const c = data?.checks

  return (
    <div className="rounded-2xl border p-4 flex flex-col gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2">
        <Facebook size={16} className="text-[#1877F2]" />
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Facebook Auto-DM — connection status</p>
        <button onClick={run} disabled={loading}
          className="ml-auto text-[11px] inline-flex items-center gap-1 disabled:opacity-50" style={{ color: 'var(--text-faint)' }}>
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Re-run
        </button>
      </div>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm py-3 justify-center" style={{ color: 'var(--text-faint)' }}>
          <Loader2 size={15} className="animate-spin" /> Checking Facebook…
        </div>
      ) : error ? (
        <p className="text-[13px]" style={{ color: '#ff3b30' }}>{error}</p>
      ) : data ? (
        <>
          {/* Verdict */}
          <div className="rounded-xl border p-3 text-[13px]" style={{ ...toneStyle, color: 'var(--text-soft)' }}>
            {verdict}
          </div>

          {/* Checklist */}
          {c && (
            <div className="flex flex-col gap-1.5 text-[13px]" style={{ color: 'var(--text-soft)' }}>
              <Row state={c.pageConnected} label={c.pageConnected ? `Page connected${c.pageName ? ` — ${c.pageName}` : ''}` : 'No Facebook Page connected'} />
              <Row state={c.appSecretSet} label="Webhook signature secret set (FACEBOOK_APP_SECRET)" />
              <Row state={c.tokenHasMessagingScopes} label={c.tokenHasMessagingScopes === false ? `Token messaging scopes — missing: ${c.missingScopes.join(', ')}` : 'Token has messaging scopes (pages_messaging…)'} />
              <Row state={c.appSubscribedToFeed} label="App subscribed to Page “feed” webhook (Meta dashboard)" />
              <Row state={c.feedSubscribed} label={c.feedSubscribed === false ? 'This Page subscribed to “feed” — no' : `This Page subscribed to “feed”${c.subscribedFields.length ? ` (${c.subscribedFields.join(', ')})` : ''}`} />
              <Row state={c.autoDmEnabled} label={c.autoDmEnabled ? `Auto-DM enabled — keyword “${c.keyword ?? '—'}”` : 'Auto-DM toggle is OFF'} />
            </div>
          )}

          {/* Recent sends */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)' }}>Recent attempts</p>
            {data.recentSends.length === 0 ? (
              <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                No rows yet — meaning no webhook has fired. Comment your keyword on a Page post, then Re-run. If it stays empty, Meta isn’t delivering the event (an app/Page feed-subscription issue above).
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr style={{ color: 'var(--text-faint)' }}>
                      <th className="text-left font-semibold px-2.5 py-1.5">When</th>
                      <th className="text-left font-semibold px-2.5 py-1.5">Platform</th>
                      <th className="text-left font-semibold px-2.5 py-1.5">Status</th>
                      <th className="text-left font-semibold px-2.5 py-1.5">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSends.map((r, i) => (
                      <tr key={i} style={{ color: 'var(--text-soft)' }}>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                        <td className="px-2.5 py-1.5">{r.platform ?? '—'}</td>
                        <td className="px-2.5 py-1.5">
                          <span style={{ color: r.status === 'sent' ? '#34c759' : r.status === 'failed' ? '#ff3b30' : 'var(--text-faint)' }}>{r.status ?? '—'}</span>
                        </td>
                        <td className="px-2.5 py-1.5">{r.error || r.link_sent || (r.keyword ? `keyword “${r.keyword}”` : '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

function Row({ state, label }: { state: boolean | null; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Indicator state={state} />
      <span>{label}</span>
    </div>
  )
}
