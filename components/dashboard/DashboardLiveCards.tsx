'use client'

/**
 * DashboardLiveCards — the two "slow" dashboard insight cards that hit live
 * external data (Google Search Console for SEO opportunities, Geniuslink for
 * affiliate-link clicks). Rendered client-side and fetched lazily so they
 * NEVER block the server render of the dashboard — each loads independently,
 * shows a skeleton, and degrades to a gentle connect-nudge when the source
 * isn't wired or returns nothing.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, MousePointerClick, ArrowUpRight, Loader2 } from 'lucide-react'

interface SeoSummary { decaying: number; striking: number; notIndexed: number; total: number }
interface ClicksSummary { clicks: number; topTitle: string | null; topClicks: number }

export function DashboardLiveCards() {
  const [seo, setSeo] = useState<SeoSummary | null | 'error'>(null)
  const [clicks, setClicks] = useState<ClicksSummary | null | 'error'>(null)

  useEffect(() => {
    fetch('/api/seo/opportunities')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { summary?: { byKind?: Record<string, number>; total?: number } }) => {
        const k = d.summary?.byKind ?? {}
        setSeo({
          decaying: k.decaying ?? 0,
          striking: k.striking_distance ?? 0,
          notIndexed: k.not_indexed ?? 0,
          total: d.summary?.total ?? 0,
        })
      })
      .catch(() => setSeo('error'))

    fetch('/api/analytics/clicks')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { totals?: { clicks?: number }; posts?: Array<{ title?: string; clicks?: number }> }) => {
        const top = (d.posts ?? [])[0]
        setClicks({
          clicks: d.totals?.clicks ?? 0,
          topTitle: top?.title ?? null,
          topClicks: top?.clicks ?? 0,
        })
      })
      .catch(() => setClicks('error'))
  }, [])

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {/* ── SEO opportunities ─────────────────────────────────────────── */}
      <Card icon={<TrendingUp size={14} />} title="SEO opportunities" href="/seo" cta="Open SEO hub">
        {seo === null ? (
          <Skeleton />
        ) : seo === 'error' || seo.total === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Connect Google Search Console (Brand Profile) to see which posts are decaying or one push from page 1.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <Stat n={seo.striking} label="one push from page 1" tone="#7C3AED" />
            <Stat n={seo.decaying} label="losing rank" tone="#FF9500" />
            <Stat n={seo.notIndexed} label="not indexed" tone="#ff3b30" />
          </div>
        )}
      </Card>

      {/* ── Affiliate-link clicks ─────────────────────────────────────── */}
      <Card icon={<MousePointerClick size={14} />} title="Affiliate link clicks" href="/seo" cta="See clicks">
        {clicks === null ? (
          <Skeleton />
        ) : clicks === 'error' || clicks.clicks === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Connect Geniuslink (Brand Profile) to track how many shoppers your links send to the store.
          </p>
        ) : (
          <div>
            <p className="text-[28px] font-semibold tracking-tight tabular-nums leading-none" style={{ color: 'var(--text)' }}>
              {clicks.clicks.toLocaleString()}
            </p>
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
              total link clicks{clicks.topTitle ? <> · top: <span style={{ color: 'var(--text-soft)' }}>{clicks.topTitle}</span> ({clicks.topClicks})</> : ''}
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}

function Card({ icon, title, href, cta, children }: { icon: React.ReactNode; title: string; href: string; cta: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2" style={{ color: 'var(--text-soft)' }}>
          {icon}
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{title}</span>
        </div>
        <Link href={href} className="text-[11px] font-medium text-[#7C3AED] hover:text-[#9D6BFF] inline-flex items-center gap-1">
          {cta} <ArrowUpRight size={11} />
        </Link>
      </div>
      {children}
    </div>
  )
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div>
      <span className="text-[20px] font-semibold tabular-nums" style={{ color: n > 0 ? tone : 'var(--text-faint)' }}>{n}</span>
      <span className="text-[11px] ml-1.5" style={{ color: 'var(--text-faint)' }}>{label}</span>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="flex items-center gap-2 text-[12px] py-1" style={{ color: 'var(--text-faint)' }}>
      <Loader2 size={13} className="animate-spin" /> Loading…
    </div>
  )
}
