// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ScoutInfoCard — a plain-English explainer for SCOUT, the free MVP Chrome
// extension. New Amazon storefront users see "SCOUT" in a few places and have
// no idea what it is or why they need it; this card removes that confusion and
// shows their live install state.
//
// Once SCOUT is CONNECTED the full explainer is noise, so it collapses to a
// single slim "SCOUT connected" row (with a "What's this?" toggle to expand the
// details again). Not-installed users always get the full card + install CTA.
'use client'

import { useEffect, useState } from 'react'
import { Download, CheckCircle2, ScanSearch, LineChart, ShieldCheck, ChevronUp } from 'lucide-react'
import { getScoutInstallKind } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL } from '@/lib/scout-version'

const ACCENT = '#C2410C'
const GREEN = '#2c9c4a'

const POINTS: { icon: React.ReactNode; title: string; body: string }[] = [
  { icon: <ScanSearch size={16} />, title: 'Reads your Creator Connections', body: 'SCOUT scans the brand campaigns you qualify for on Amazon, so MVP can match them to your content and build your daily digest.' },
  { icon: <LineChart size={16} />, title: 'Syncs your storefront earnings', body: 'It pulls your own storefront sales and commissions into MVP, so you can see what is actually selling and worth posting more of.' },
  { icon: <ShieldCheck size={16} />, title: 'Private by design', body: 'SCOUT only reads your own Amazon pages, in your own browser. Nothing about your sales is scraped, pooled, or sold. Our no-sleaze rule.' },
]

export default function ScoutInfoCard() {
  const [status, setStatus] = useState<{ kind: 'store' | 'sideload' | 'none' } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [sync, setSync] = useState<{ products: number; lastSyncedAt: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    getScoutInstallKind()
      .then((s) => { if (!cancelled) setStatus({ kind: s.kind }) })
      .catch(() => { if (!cancelled) setStatus({ kind: 'none' }) })
    // Earnings-sync status (how many products SCOUT has landed).
    fetch('/api/storefront/ingest')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled && d) setSync({ products: d.products ?? 0, lastSyncedAt: d.lastSyncedAt ?? null }) })
      .catch(() => { /* best-effort */ })
    return () => { cancelled = true }
  }, [])

  const installed = status?.kind === 'store' || status?.kind === 'sideload'
  const syncLabel = sync && sync.products > 0
    ? `${sync.products} product${sync.products === 1 ? '' : 's'} synced`
    : 'No products synced yet — open your Amazon report page'

  // Connected + collapsed → one slim confirmation row.
  if (installed && !expanded) {
    return (
      <section
        className="mb-6 rounded-xl border px-4 py-2.5 flex items-center gap-3"
        style={{ borderColor: 'rgba(52,199,89,0.30)', background: 'rgba(52,199,89,0.06)' }}
      >
        <span className="w-7 h-7 rounded-lg grid place-items-center text-white flex-shrink-0" style={{ backgroundColor: GREEN }}>
          <CheckCircle2 size={15} />
        </span>
        <p className="text-[13px] font-semibold flex-shrink-0" style={{ color: 'var(--text)' }}>SCOUT connected</p>
        <span className="text-[12.5px] truncate hidden sm:inline" style={{ color: 'var(--text-soft)' }}>
          {syncLabel}
        </span>
        <button
          onClick={() => setExpanded(true)}
          className="ml-auto text-[12px] font-semibold whitespace-nowrap hover:opacity-80 transition-opacity"
          style={{ color: ACCENT }}
        >
          What’s this?
        </button>
      </section>
    )
  }

  return (
    <section
      className="mb-6 rounded-2xl border p-5 sm:p-6"
      style={{ borderColor: 'rgba(234,88,12,0.30)', background: 'linear-gradient(180deg, rgba(234,88,12,0.06), transparent)' }}
    >
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-8 h-8 rounded-xl grid place-items-center text-white flex-shrink-0" style={{ backgroundColor: ACCENT }}>
              <ScanSearch size={16} />
            </span>
            <h2 className="text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>What is SCOUT, and do I need it?</h2>
          </div>
          <p className="text-[13.5px] leading-relaxed max-w-3xl" style={{ color: 'var(--text-soft)' }}>
            SCOUT is MVP’s free Chrome extension, the bridge between your Amazon storefront and MVP. You install it once, it runs
            quietly in the background and auto-updates, and it lets MVP see your Creator Connections campaigns and your storefront
            earnings so the brand-deal matching and earnings tracking actually work. Without it, those two features have nothing to read.
          </p>
        </div>
        {installed ? (
          <button
            onClick={() => setExpanded(false)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
            style={{ background: 'rgba(52,199,89,0.12)', color: GREEN }}
          >
            <ChevronUp size={12} /> Minimize
          </button>
        ) : (
          status && (
            <span
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
              style={{ background: 'rgba(234,88,12,0.12)', color: ACCENT }}
            >
              Not installed yet
            </span>
          )
        )}
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {POINTS.map((p) => (
          <li key={p.title} className="rounded-xl border p-3.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-6 h-6 rounded-lg grid place-items-center flex-shrink-0" style={{ background: 'rgba(234,88,12,0.12)', color: ACCENT }}>{p.icon}</span>
              <p className="font-semibold text-[13px]" style={{ color: 'var(--text)' }}>{p.title}</p>
            </div>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{p.body}</p>
          </li>
        ))}
      </ul>

      {!installed && (
        <a
          href={SCOUT_STORE_LISTING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13.5px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5"
          style={{ backgroundColor: ACCENT }}
        >
          <Download size={15} /> Get SCOUT (free, one click)
        </a>
      )}
      {installed && (
        <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
          You’re all set, SCOUT is connected and keeping your campaigns and earnings in sync.
        </p>
      )}
    </section>
  )
}
