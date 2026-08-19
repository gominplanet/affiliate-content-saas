'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One-click CC catalog refresh (admin-only). Replaces the weekly manual flow
// (download two ZIPs from Amazon → unzip → drag CSVs into staging → merge).
// SCOUT does all of it in a background tab: clicks Amazon's "Download all
// available/accepted campaigns" exports, waits out the server-side build,
// captures + unzips + parses the CSVs, stages every row, and arms the drain.
//
// Amazon builds the export server-side (minutes), so this button sits in a long
// "working" state. The returned summary shows exactly what was staged + how the
// CSV headers mapped, so a first run can be verified before trusting it.

import { useState } from 'react'
import { Loader2, Zap, CheckCircle2, AlertTriangle } from 'lucide-react'
import { requestCcCatalogScan, type CcCatalogScanResult, type CcExportSummary } from '@/lib/extension-frame'

export default function CcScoutRefresh({ onDone }: { onDone?: () => void }) {
  const [running, setRunning] = useState(false)
  const [res, setRes] = useState<CcCatalogScanResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setRunning(true); setErr(null); setRes(null)
    try {
      const r = await requestCcCatalogScan()
      setRes(r)
      if (!r.ok) {
        const e = r.error || ''
        if (e === 'not-installed') {
          setErr('SCOUT isn’t installed or didn’t answer. Install/enable it, open Amazon Creator Connections once, then try again.')
        } else if (e.startsWith('outdated-scout')) {
          const have = e.split(':')[1] || 'older'
          setErr(`Your SCOUT (${have}) is too old for this — it needs 1.16.25+. If you’re on the Chrome Web Store build, open chrome://extensions and click “Update”, then retry. (Store auto-update can lag a few hours.)`)
        } else {
          setErr(e === 'timeout'
            ? 'SCOUT didn’t finish in time. Make sure you’re on 1.16.25+, signed into Amazon Creator Connections, then retry.'
            : e)
        }
      }
      onDone?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Refresh failed.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="card p-5 mb-5" style={{ border: '1px solid rgba(124,58,237,0.35)' }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold mb-1 inline-flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
            <Zap size={15} style={{ color: '#7C3AED' }} /> One-click refresh (SCOUT)
          </p>
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            Skip the manual download + upload. SCOUT clicks Amazon&rsquo;s <b>Download all available campaigns</b> and
            <b> Download all accepted campaigns</b> in a background tab, unzips + parses the CSVs, stages them, and starts
            the background merge. Amazon builds the export server-side, so this can take a few minutes — leave the tab open.
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="btn-primary text-sm whitespace-nowrap"
          style={{ background: '#7C3AED' }}
        >
          {running
            ? <><Loader2 size={16} className="animate-spin" /> Refreshing… (may take minutes)</>
            : <>Refresh catalog from CC</>}
        </button>
      </div>

      {err && (
        <div className="mt-3 rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed" style={{ background: 'rgba(255,59,48,0.10)', border: '1px solid rgba(255,59,48,0.35)', color: 'var(--text)' }}>
          <div className="inline-flex items-start gap-2">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#ff3b30' }} />
            <span>{err}</span>
          </div>
          {/* Per-export diagnostics — what SCOUT actually saw on the page. */}
          {(res?.available || res?.accepted) && (
            <div className="mt-2">
              <ExportLine label="Available" s={res?.available} />
              <ExportLine label="Accepted" s={res?.accepted} />
            </div>
          )}
        </div>
      )}

      {res?.ok && (
        <div className="mt-3 rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed" style={{ background: 'rgba(52,199,89,0.10)', border: '1px solid rgba(52,199,89,0.35)', color: 'var(--text)' }}>
          <p className="font-semibold inline-flex items-center gap-1.5">
            <CheckCircle2 size={15} style={{ color: '#34c759' }} />
            Staged {res.staged?.toLocaleString() ?? 0} campaigns
            {res.armed ? ' · background merge started' : res.armError ? ' · merge NOT started' : ''}
          </p>
          {res.armError && (
            <p className="mt-1" style={{ color: 'var(--text-soft)' }}>
              Merge didn&rsquo;t start: {res.armError}
              {res.needsConfirm ? ' — staging looks smaller than the live catalog; check the mapping below, then merge manually if it&rsquo;s correct.' : ''}
            </p>
          )}
          <ExportLine label="Available" s={res.available} />
          <ExportLine label="Accepted" s={res.accepted} />
        </div>
      )}
    </div>
  )
}

// Per-export detail: row count + how the CSV headers mapped (so a first run is
// verifiable). Shows the mapping only when something looks off (few rows).
function ExportLine({ label, s }: { label: string; s?: CcExportSummary | null }) {
  if (!s) return null
  if (!s.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = s.diag as any
    return (
      <div className="mt-1.5" style={{ color: 'var(--text-soft)' }}>
        <p><b>{label}:</b> failed — {s.error}</p>
        {d && (
          <div className="mt-1 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
            {d.campaignsCount != null && <div>Grid showed: {String(d.campaignsCount)} campaigns</div>}
            {Array.isArray(d.sawDownload) && d.sawDownload.length > 0 && (
              <div>Download-ish buttons seen: {d.sawDownload.join(' · ')}</div>
            )}
            {d.url && <div className="truncate">Page: {d.url}</div>}
          </div>
        )}
      </div>
    )
  }
  const mapped = s.headerMap ? Object.keys(s.headerMap).length : 0
  return (
    <div className="mt-1.5">
      <p style={{ color: 'var(--text-soft)' }}>
        <b>{label}:</b> {s.rows?.toLocaleString() ?? 0} rows · {mapped} columns mapped
        {s.files?.length ? ` · ${s.files.length} CSV file${s.files.length === 1 ? '' : 's'}` : ''}
      </p>
      {s.headerMap && mapped < 11 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
            {mapped < 6 ? '⚠ Some columns didn’t map — review' : 'Column mapping'}
          </summary>
          <pre className="mt-1 text-[11px] overflow-x-auto p-2 rounded" style={{ background: 'rgba(0,0,0,0.04)', color: 'var(--text-soft)' }}>
{JSON.stringify(s.headerMap, null, 2)}
{s.headers?.length ? `\nCSV headers seen:\n${s.headers.join(' | ')}` : ''}
          </pre>
        </details>
      )}
    </div>
  )
}
