'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Admin: weekly Creator Connections catalog import. The heavy CSV is loaded into
// the STAGING table by your existing process (or SQL COPY / dashboard import),
// then this page MERGES it into the live catalog — upserting campaign economics
// while PRESERVING the enriched product signals, and purging fallen-out
// campaigns. No CSV bytes pass through this page, so file size is irrelevant here.

import { useState, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, RefreshCw, Database, ArrowRight, CheckCircle2, AlertTriangle, Tag } from 'lucide-react'
import { toast } from 'sonner'
import CcCatalogUploader from '@/components/admin/CcCatalogUploader'

interface KeepaStatus { tokensLeft: number | null; refillRate: number | null; refillIn: number | null }
interface Counts { staged: number | null; live: number | null; enriched: number | null; hasStaged: boolean | null; keepa: KeepaStatus | null }

export default function AdminCcImportPage() {
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [result, setResult] = useState<{ upserted: number; purged: number; staged: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [reverifying, setReverifying] = useState(false)
  const [reverifyQueued, setReverifyQueued] = useState<number | null>(null)
  const [reverifyDone, setReverifyDone] = useState(false)

  const loadCounts = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch('/api/admin/import-cc-catalog')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed to load')
      setCounts({ staged: d.staged, live: d.live, enriched: d.enriched, hasStaged: d.hasStaged ?? null, keepa: d.keepa ?? null })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadCounts() }, [loadCounts])

  const merge = useCallback(async () => {
    if (merging) return
    setMerging(true); setResult(null); setErr(null); setRemaining(null)
    let confirm = false
    let totalUpserted = 0
    try {
      // Auto-resume loop: the endpoint does a bounded chunk per call and reports
      // done:false + remaining while work is left. We keep calling until done, so
      // the admin clicks Merge ONCE and just watches the countdown.
      for (let guard = 0; guard < 100; guard++) {
        const r = await fetch('/api/admin/import-cc-catalog', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm }),
        })
        const d = await r.json()
        // Safety prompt: staging far smaller than live — likely a partial upload.
        if (r.status === 409 && d?.needsConfirm) {
          const ok = window.confirm(`${d.error}\n\nMerge anyway and remove ~${Number(d.wouldPurgeApprox).toLocaleString()} campaigns?`)
          if (!ok) { setMerging(false); return }
          confirm = true
          continue
        }
        if (!r.ok) throw new Error(d.detail ? `${d.error || 'Merge failed'} — ${d.detail}` : (d.error || 'Merge failed'))
        confirm = true
        totalUpserted += Number(d.upserted ?? 0)
        if (d.done) {
          setRemaining(null)
          setResult({ upserted: totalUpserted, purged: Number(d.purged ?? 0), staged: Number(d.staged ?? 0) })
          toast.success(`Merged ${totalUpserted.toLocaleString()} campaigns · purged ${Number(d.purged ?? 0).toLocaleString()}`)
          void loadCounts()
          return
        }
        setRemaining(d.remaining == null ? null : Number(d.remaining)) // progress; loop continues (null → "Merging…")
      }
      throw new Error('Merge is taking unusually long — click Merge again to continue.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Merge failed'
      setErr(msg); toast.error(msg)
    } finally { setMerging(false) }
  }, [merging, loadCounts])

  const reverify = useCallback(async () => {
    if (reverifying) return
    if (!window.confirm('Requeue every LIVE catalog product for price re-verification?\n\nThis clears their "last checked" stamp (not the data) so the enrich cron re-prices them with the corrected Buy Box logic over the next runs. It spends no Keepa tokens now; the re-pricing rides the cron’s normal paced budget.')) return
    setReverifying(true); setReverifyDone(false); setReverifyQueued(null); setErr(null)
    let before: string | undefined
    let total = 0
    try {
      for (let guard = 0; guard < 400; guard++) {
        const r = await fetch('/api/admin/reverify-cc-prices', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ before }),
        })
        const d = await r.json()
        if (!r.ok) throw new Error(d.detail ? `${d.error || 'Re-verify failed'} — ${d.detail}` : (d.error || 'Re-verify failed'))
        before = d.before
        total += Number(d.queued ?? 0)
        setReverifyQueued(total)
        if (d.done) {
          setReverifyDone(true)
          toast.success(`Requeued ${total.toLocaleString()} products for re-pricing`)
          void loadCounts()
          return
        }
      }
      throw new Error('Re-verify is taking unusually long — click again to continue.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Re-verify failed'
      setErr(msg); toast.error(msg)
    } finally { setReverifying(false) }
  }, [reverifying, loadCounts])

  // While counts are still loading, show a dash, never a bare "0" — a transient
  // zero on the Live Catalog card reads like the whole shared catalog was wiped
  // and is genuinely alarming. Only show a real number once loaded.
  const num = (n: number | null | undefined) => (loading || n == null ? '—' : n.toLocaleString())
  // "Can I merge?" and "is staging empty?" come from the cheap existence check
  // (hasStaged), NOT the exact staged count — that count can time out on a huge
  // table and come back null, which must NOT read as empty. Only a definitive
  // hasStaged === false disables merge / shows the empty warning; null (unknown)
  // stays enabled (the merge endpoint re-checks existence before doing anything).
  const stagingEmpty = counts?.hasStaged === false
  const canMerge = !loading && !stagingEmpty
  const enrichedPct = counts?.live && counts?.enriched != null && counts.live > 0
    ? Math.round((counts.enriched / counts.live) * 100) : null

  return (
    <>
      <PageHero
        title="CC Catalog Import"
        subtitle="Merge the weekly Creator Connections CSV into the live catalog, safely : campaign economics update, enriched product signals are preserved, and campaigns that fell out of the CSV are purged."
      />

      {/* Steps */}
      <div className="card p-5 mb-5">
        <p className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text)' }}>Weekly steps</p>
        <ol className="text-[13px] leading-relaxed list-decimal pl-5 space-y-1.5" style={{ color: 'var(--text-soft)' }}>
          <li><b>Drag your CSV file(s)</b> into the upload box below and click <b>Upload to staging</b>. Multiple files are fine : they combine automatically.</li>
          <li>Confirm the <b>Staged</b> count looks right (tens of thousands).</li>
          <li>Click <b>Merge into live catalog</b>. Enriched images/sales/ratings survive; campaigns that fell out are purged.</li>
        </ol>
      </div>

      {/* Uploader — parses the CSV in the browser and streams it to staging. */}
      <CcCatalogUploader onDone={loadCounts} />

      {/* Counts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard label="Staged (ready to merge)" value={num(counts?.staged)} icon={<Database size={16} />} accent="#7C3AED" />
        <StatCard label="Live catalog" value={num(counts?.live)} icon={<CheckCircle2 size={16} />} accent="#34c759" />
        <StatCard
          label="Enriched (signals)"
          value={counts?.enriched == null ? '—' : `${num(counts.enriched)}${enrichedPct != null ? ` · ${enrichedPct}%` : ''}`}
          icon={<RefreshCw size={16} />} accent="#0a84ff"
        />
      </div>

      {/* Keepa token headroom — the shared budget that enrichment, Deal Radar,
          and the AMZ Product Finder all draw from. The enrichment cron backs off
          below ~60 so the others are never starved; this is the live readout. */}
      {counts?.keepa && counts.keepa.tokensLeft != null && (
        <div className="card p-4 mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2" style={{ color: '#0a84ff' }}>
            <RefreshCw size={16} />
            <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>Keepa tokens (shared budget)</span>
          </div>
          <div className="text-right">
            <span className="text-[18px] font-extrabold" style={{ color: counts.keepa.tokensLeft < 200 ? '#f59e0b' : 'var(--text)' }}>
              {counts.keepa.tokensLeft.toLocaleString()}
            </span>
            {counts.keepa.refillRate != null && (
              <span className="text-[12px] ml-2" style={{ color: 'var(--text-soft)' }}>+{counts.keepa.refillRate}/min</span>
            )}
          </div>
        </div>
      )}

      {stagingEmpty && !loading && (
        <div className="card p-4 mb-5 flex items-start gap-2.5" style={{ borderColor: 'rgba(245,158,11,0.4)' }}>
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Staging is empty : load your CSV into <code>cc_campaign_catalog_import</code> first. Merge is disabled so it can&rsquo;t purge the live catalog against an empty import.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => merge()}
          disabled={!canMerge || merging}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold text-white disabled:opacity-50"
          style={{ background: '#7C3AED' }}>
          {merging
            ? <><Loader2 size={16} className="animate-spin" /> Merging{remaining != null ? ` — ${remaining.toLocaleString()} left` : '…'}</>
            : <>Merge into live catalog <ArrowRight size={16} /></>}
        </button>
        <button onClick={loadCounts} disabled={loading || merging}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[13px] font-medium border disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {result && (
        <div className="card p-4 mb-5" style={{ borderColor: 'rgba(52,199,89,0.4)' }}>
          <p className="text-[13px] font-semibold mb-1" style={{ color: '#1f8a3a' }}>
            <CheckCircle2 size={14} className="inline -mt-0.5 mr-1" /> Import merged
          </p>
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Staged <b>{result.staged.toLocaleString()}</b> · upserted <b>{result.upserted.toLocaleString()}</b> · purged (fell out) <b>{result.purged.toLocaleString()}</b>.
            New campaigns will enrich over the next runs of the background cron; survivors kept their signals.
          </p>
        </div>
      )}

      {/* Re-verify prices — requeue live rows so the cron re-prices them with the
          Buy Box logic. Separate from the weekly merge; safe to run any time. */}
      <div className="card p-5 mb-5">
        <div className="flex items-center gap-2 mb-1.5" style={{ color: '#0a84ff' }}>
          <Tag size={16} />
          <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>Re-verify prices</span>
        </div>
        <p className="text-[13px] mb-3" style={{ color: 'var(--text-soft)' }}>
          Requeue every live product so the background cron re-prices it using the corrected Buy Box price (the real add-to-cart amount, not the cheapest 3rd-party offer). This only clears the &ldquo;last checked&rdquo; stamp : the existing image/price/rating stay put until each row refreshes, and no Keepa tokens are spent now. Re-pricing runs on the cron&rsquo;s normal paced budget over the next runs.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => reverify()}
            disabled={reverifying || loading || merging}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: '#0a84ff' }}>
            {reverifying
              ? <><Loader2 size={15} className="animate-spin" /> Requeuing{reverifyQueued != null ? ` — ${reverifyQueued.toLocaleString()}` : '…'}</>
              : <><Tag size={15} /> Re-verify all live prices</>}
          </button>
          {reverifyDone && reverifyQueued != null && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: '#1f8a3a' }}>
              <CheckCircle2 size={15} /> Requeued {reverifyQueued.toLocaleString()} products. The cron will re-price them over the next runs.
            </span>
          )}
        </div>
      </div>

      {err && <div className="text-[13px] mb-5" style={{ color: '#ff3b30' }}>{err}</div>}
    </>
  )
}

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1.5" style={{ color: accent }}>{icon}<span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>{label}</span></div>
      <p className="text-[22px] font-extrabold" style={{ color: 'var(--text)' }}>{value}</p>
    </div>
  )
}
