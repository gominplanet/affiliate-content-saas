// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /admin/link-reports — reports about mvpl.ink links, and the switch to stop one.
//
// The link policy on mvpl.ink promises every report is reviewed and a link that
// breaks the rules is switched off. This screen is where that promise is kept,
// and the record to point Pinterest at when asking them to review the domain.
//
// Every button reports what the database did. A switch that changed nothing
// says so, rather than showing the link as off.
'use client'

import { useCallback, useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, AlertTriangle, CheckCircle2, RefreshCw, Link2Off, Link2 } from 'lucide-react'
import { LINK_REPORT_REASONS } from '@/lib/link-trust'

interface Report {
  id: string
  code: string
  reason: string
  details: string | null
  reporterEmail: string | null
  state: 'open' | 'link_disabled' | 'dismissed'
  createdAt: string
  link: { exists: false } | {
    exists: true
    live: boolean
    target: { store: string; address: string | null; product: string | null }
    ownerId: string | null
    ownerEmail: string | null
    ownerLinks: { total: number; off: number } | null
  }
}

const reasonLabel = (k: string) => LINK_REPORT_REASONS.find((r) => r.key === k)?.label ?? k
const STATE: Record<Report['state'], { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-[#ff9500]/15 text-[#c93400]' },
  link_disabled: { label: 'Link switched off', cls: 'bg-[#34c759]/15 text-[#248a3d]' },
  dismissed: { label: 'Dismissed', cls: 'bg-black/5 dark:bg-white/10 text-[#6e6e73] dark:text-[#aeaeb2]' },
}

export default function LinkReportsPage() {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [missingTable, setMissingTable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [lookup, setLookup] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch('/api/admin/link-reports')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setReports(j.reports ?? [])
      setMissingTable(!!j.missingTable)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  async function act(action: string, code: string, id?: string) {
    setBusy(`${action}:${id ?? code}`); setNotice(null)
    try {
      const r = await fetch('/api/admin/link-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, code, id }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || `Nothing changed (HTTP ${r.status}).`)
      setNotice({
        ok: true,
        text: action === 'disable_link' ? `mvpl.ink/${code} is switched off.`
          : action === 'enable_link' ? `mvpl.ink/${code} is live again.`
            : action === 'disable_account_links' ? `${j.changed} link${j.changed === 1 ? '' : 's'} on that account switched off.`
              : 'Report dismissed. The link stays live.',
      })
      await load()
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) }) }
    setBusy(null)
  }

  const lookupCode = (() => { const m = /([A-Za-z0-9]{4,16})\+?\/?$/.exec(lookup.trim()); return m ? m[1] : '' })()
  const open = (reports ?? []).filter((r) => r.state === 'open').length

  return (
    <div className="max-w-5xl mx-auto">
      <PageHero title="Link reports" subtitle="Reports about mvpl.ink links from anyone, and the switch that stops one link without touching anyone else's." />

      {missingTable && (
        <div className="card p-4 mb-4 border border-[#ff9500]/40 text-[13px] flex gap-2">
          <AlertTriangle size={16} className="text-[#ff9500] shrink-0 mt-0.5" />
          <span>The link_reports table does not exist yet (migration 378), so the report form on mvpl.ink cannot save anything. Reports sent now are refused with a message to email abuse@mvpaffiliate.io.</span>
        </div>
      )}
      {error && <div className="card p-4 mb-4 text-[13px] text-[#ff3b30]">Could not load reports: {error}</div>}
      {notice && (
        <div className={`card p-3 mb-4 text-[13px] flex gap-2 ${notice.ok ? 'text-[#248a3d]' : 'text-[#ff3b30]'}`}>
          {notice.ok ? <CheckCircle2 size={16} className="shrink-0" /> : <AlertTriangle size={16} className="shrink-0" />}
          {notice.text}
        </div>
      )}

      <div className="card p-4 mb-5 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-semibold">Any link:</span>
        <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="mvpl.ink/abc123"
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-[var(--border-2,#e5e5e7)] bg-white dark:bg-[#1c1c1e] outline-none" />
        {lookupCode && <a href={`https://www.mvpl.ink/${lookupCode}+`} target="_blank" rel="noreferrer" className="text-[#0a84ff] hover:underline">Preview</a>}
        <button disabled={!lookupCode || !!busy} onClick={() => act('disable_link', lookupCode)} className="px-3 py-1.5 rounded-lg bg-[#ff3b30] text-white font-semibold disabled:opacity-40">Switch off</button>
        <button disabled={!lookupCode || !!busy} onClick={() => act('enable_link', lookupCode)} className="px-3 py-1.5 rounded-lg border border-[var(--border-2,#e5e5e7)] font-semibold disabled:opacity-40">Switch on</button>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-[13px] text-[#6e6e73] dark:text-[#aeaeb2]">
          {reports === null ? 'Loading…' : `${reports.length} report${reports.length === 1 ? '' : 's'}, ${open} open`}
        </p>
        <button onClick={load} className="inline-flex items-center gap-1 text-[12px] text-[#0a84ff]"><RefreshCw size={12} /> Refresh</button>
      </div>

      {reports === null && !error ? <Loader2 className="animate-spin" /> : null}
      {reports?.length === 0 && !missingTable && <div className="card p-6 text-[13px] text-[#6e6e73]">No reports yet.</div>}

      <ul className="flex flex-col gap-3">
        {(reports ?? []).map((r) => (
          <li key={r.id} className="card p-4 text-[13px]">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <a href={`https://www.mvpl.ink/${r.code}+`} target="_blank" rel="noreferrer" className="font-semibold text-[#0a84ff] hover:underline">mvpl.ink/{r.code}</a>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${STATE[r.state]?.cls ?? ''}`}>{STATE[r.state]?.label ?? r.state}</span>
              {r.link.exists && (r.link.live
                ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#0a84ff]/10 text-[#0a84ff] font-semibold">Link live</span>
                : <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#ff3b30]/10 text-[#ff3b30] font-semibold">Link off</span>)}
              <span className="text-[#86868b] ml-auto">{new Date(r.createdAt).toLocaleString()}</span>
            </div>
            <p className="font-medium">{reasonLabel(r.reason)}</p>
            {r.details && <p className="mt-1 whitespace-pre-wrap text-[#3a3a3c] dark:text-[#d1d1d6]">{r.details}</p>}
            {r.reporterEmail && <p className="mt-1 text-[12px] text-[#86868b]">From {r.reporterEmail}</p>}
            {r.link.exists ? (
              <p className="mt-2 text-[12px] text-[#6e6e73] dark:text-[#aeaeb2]">
                Goes to {r.link.target.store}{r.link.target.product ? `: ${r.link.target.product}` : ''}{r.link.target.address ? ` (${r.link.target.address})` : ''}.
                {' '}Made by {r.link.ownerEmail ?? r.link.ownerId ?? 'unknown'}
                {r.link.ownerLinks ? `, who has ${r.link.ownerLinks.total} links (${r.link.ownerLinks.off} off).` : '.'}
              </p>
            ) : (
              <p className="mt-2 text-[12px] text-[#86868b]">No link with this code exists, so there is nothing to switch off.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {r.link.exists && r.link.live && (
                <button disabled={!!busy} onClick={() => act('disable_link', r.code)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#ff3b30] text-white font-semibold disabled:opacity-40">
                  {busy === `disable_link:${r.code}` ? <Loader2 size={12} className="animate-spin" /> : <Link2Off size={12} />} Switch this link off
                </button>
              )}
              {r.link.exists && !r.link.live && (
                <button disabled={!!busy} onClick={() => act('enable_link', r.code)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border-2,#e5e5e7)] font-semibold disabled:opacity-40">
                  <Link2 size={12} /> Switch it back on
                </button>
              )}
              {r.link.exists && (
                <button disabled={!!busy} onClick={() => { if (confirm('Switch off every link this account has made?')) act('disable_account_links', r.code) }}
                  className="px-3 py-1.5 rounded-lg border border-[#ff3b30]/40 text-[#ff3b30] font-semibold disabled:opacity-40">
                  Switch off all of this account&apos;s links
                </button>
              )}
              {r.state === 'open' && (
                <button disabled={!!busy} onClick={() => act('dismiss', r.code, r.id)} className="px-3 py-1.5 rounded-lg border border-[var(--border-2,#e5e5e7)] font-semibold disabled:opacity-40">
                  Dismiss, the link is fine
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
