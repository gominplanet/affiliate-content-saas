'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Start here — the one thing on this page for someone who does not know SEO.
//
// The page opened with eight crawler names all ticked green, then a score of 80
// with nothing to compare it against, then six tool tabs. Someone who already
// knows SEO can read that. Someone who does not learns nothing from it, and the
// button that actually helps was three cards down.
//
// This sits above all of it and says, in order, what is wrong, what it is
// costing, and what to do next. The judgement lives in lib/seo-next-steps.ts as
// a pure function so the wording and the ranking are tested rather than eyeballed.

import { useEffect, useState } from 'react'
import { Loader2, ListChecks, ArrowRight, ExternalLink, CheckCircle2 } from 'lucide-react'
import { seoNextSteps, type SeoSignals, type SeoStep } from '@/lib/seo-next-steps'

interface Props {
  /** From the page's own overview fetch, so this does not ask for it twice. */
  summary: {
    total: number; indexed: number; notIndexed: number; unknown: number
    notInSitemap: number; recentlyDropped: number; sitemapFound: boolean
    totalClicks: number; totalImpressions: number
  } | null
  connected: boolean
  /** Scrolls the page to the green get-found card, which is where the buttons
   *  these steps point at actually live. */
  onGoToGetFound: () => void
}

const toneColour = (t: SeoStep['tone']) => (t === 'blocked' ? '#e11d48' : t === 'good' ? '#059669' : '#7C3AED')

export default function StartHere({ summary, connected, onGoToGetFound }: Props) {
  const [aio, setAio] = useState<{ scored: number; avgScore: number; topFixes?: { label: string; hint: string; share: number; count: number }[] } | null>(null)
  const [crawlers, setCrawlers] = useState<{ blockedCount?: number; crawlers?: unknown[] } | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      const [a, c] = await Promise.all([
        fetch('/api/seo/aio-summary').then(r => r.json()).catch(() => null),
        fetch('/api/seo/ai-crawlers').then(r => r.json()).catch(() => null),
      ])
      if (!live) return
      setAio(a)
      setCrawlers(c)
      setReady(true)
    })()
    return () => { live = false }
  }, [])

  if (!summary || !ready) {
    return (
      <div className="rounded-2xl border p-4 mb-5 flex items-center gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <Loader2 size={15} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
        <span className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Working out what to do next…</span>
      </div>
    )
  }

  const signals: SeoSignals = {
    posts: summary.total,
    connected,
    indexed: summary.indexed,
    notIndexed: summary.notIndexed,
    unknown: summary.unknown,
    notInSitemap: summary.notInSitemap,
    recentlyDropped: summary.recentlyDropped,
    sitemapFound: summary.sitemapFound,
    totalClicks: summary.totalClicks,
    totalImpressions: summary.totalImpressions,
    crawlersBlocked: crawlers?.blockedCount ?? 0,
    crawlersTotal: crawlers?.crawlers?.length ?? 0,
    aio: aio && aio.scored
      ? { scored: aio.scored, avgScore: aio.avgScore, topFix: aio.topFixes?.[0] ?? null }
      : null,
  }
  const steps = seoNextSteps(signals)
  const allClear = steps.length === 1 && steps[0].id === 'all-clear'

  return (
    <div
      className="rounded-2xl border mb-5 overflow-hidden"
      style={{
        borderColor: allClear ? 'rgba(5,150,105,0.35)' : 'var(--border)',
        background: allClear ? 'rgba(5,150,105,0.06)' : 'var(--surface)',
      }}
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-lg grid place-items-center flex-shrink-0" style={{ background: allClear ? 'rgba(5,150,105,0.14)' : 'rgba(124,58,237,0.12)' }}>
            {allClear ? <CheckCircle2 size={17} style={{ color: '#059669' }} /> : <ListChecks size={17} style={{ color: '#7C3AED' }} />}
          </div>
          <div>
            <p className="text-[14px] font-bold" style={{ color: 'var(--text)' }}>Start here</p>
            <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
              {allClear ? 'Nothing needs fixing today.' : 'What is worth your time on this blog, biggest first.'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-3.5">
          {steps.map((step, i) => (
            <div key={step.id} className="flex gap-3">
              {!allClear && (
                <span
                  className="mt-0.5 w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold flex-shrink-0"
                  style={{ background: `${toneColour(step.tone)}1a`, color: toneColour(step.tone) }}
                >
                  {i + 1}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>{step.title}</p>
                <p className="text-[12.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{step.why}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text)' }}>{step.doThis}</span>
                  {step.action === 'connect-gsc' && (
                    <a
                      href="/api/auth/gsc"
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold rounded-lg px-2.5 py-1"
                      style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}
                    >
                      Connect it <ExternalLink size={12} />
                    </a>
                  )}
                  {step.action === 'get-found' && (
                    <button
                      onClick={onGoToGetFound}
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold rounded-lg px-2.5 py-1"
                      style={{ background: 'rgba(52,199,89,0.14)', color: '#2fb350' }}
                    >
                      Take me to it <ArrowRight size={12} />
                    </button>
                  )}
                  {step.action === 'write' && (
                    <a
                      href="/articles"
                      className="inline-flex items-center gap-1 text-[12.5px] font-semibold rounded-lg px-2.5 py-1"
                      style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}
                    >
                      Write a post <ArrowRight size={12} />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
