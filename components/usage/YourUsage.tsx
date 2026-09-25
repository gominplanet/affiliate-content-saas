// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Your usage: every limit on the creator's plan, in one place, in plain words.
//
// THE SAME NUMBERS THE GATES USE. Monthly limits come from /api/usage/summary,
// which counts the exact rows each cap enforces (it also drives the meter
// under the top bar); daily limits come from /api/usage/daily, built on the
// same constants as their gates. Nothing here is counted a second way, so the
// page cannot say "room left" while the gate says no.
//
// NO AI SPEND ON SCREEN. The spend ceiling is an internal guardrail (see the
// billing page): creators see what they can make, never what it costs MVP.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'

interface Bucket { key: string; label: string; used: number; limit: number | null; remaining: number | null }
interface Summary { tier: string; buckets: Bucket[]; resetLabel: string | null; lifetime: boolean }
interface DailyBucket { key: string; label: string; used: number; limit: number; nextFreeAt: string | null }

const ACCENT = '#7C3AED'

/** What each limit counts, in the creator's words. */
const WHAT: Record<string, string> = {
  generations: 'New blog posts and content pieces MVP writes for you.',
  thumbnails: 'AI thumbnails, from Co-Pilot, Liftoff and blog heroes.',
  shorts: 'Shorts rendered in Shorts Studio.',
  x: 'Posts sent to X. X charges for every post, so it has its own limit.',
  pins: 'Designed Pinterest pins.',
  instagram: 'Designed Instagram posts.',
  facebook: 'Designed Facebook posts.',
  deals: 'Deal posts.',
  collabs: 'Brand collaborations you create.',
  assistant: 'Questions to Ask Me, the MVP help assistant.',
  photobooth: 'Face model photos made in Photobooth.',
  metadata: 'YouTube titles, descriptions and tags written for your videos.',
  scripts: 'Video scripts from the Scriptwriter.',
  igai: 'AI images for Instagram.',
  newsletter: 'Newsletter emails sent to your list.',
  cascade: 'Posts scheduled out to your socials.',
  articles: 'Articles.',
  sale_comments: 'Comments posted on your videos from Encore. YouTube gives all of MVP one shared daily allowance, so each creator gets a share.',
  index_nudges: 'Asking Google to index a page now. Google gives all of MVP one small shared allowance; your pages still get indexed through your sitemap without these.',
}

/** These reset on the 1st of the month; the rest follow the billing date. */
const CALENDAR_MONTH = new Set(['scripts', 'newsletter', 'cascade'])

type Level = 'ok' | 'close' | 'out'
const levelOf = (used: number, limit: number): Level => (used >= limit ? 'out' : used / limit >= 0.8 ? 'close' : 'ok')
const LEVEL = {
  ok: { color: ACCENT, chip: null as string | null, Icon: CheckCircle2 },
  close: { color: '#D97706', chip: 'Almost used up', Icon: AlertTriangle },
  out: { color: '#DC2626', chip: 'Used up', Icon: XCircle },
}

const clock = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

function Row({ label, what, used, limit, reset }: { label: string; what?: string; used: number; limit: number; reset: string }) {
  const lvl = levelOf(used, limit)
  const L = LEVEL[lvl]
  const pct = Math.min(100, Math.round((used / limit) * 100))
  return (
    <li className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{label}</span>
            {L.chip && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded"
                style={{ color: L.color, background: lvl === 'out' ? 'rgba(220,38,38,0.1)' : 'rgba(217,119,6,0.12)' }}>
                <L.Icon size={11} /> {L.chip}
              </span>
            )}
          </div>
          {what && <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{what}</p>}
        </div>
        <span className="text-[14px] font-semibold tabular-nums shrink-0" style={{ color: 'var(--text)' }}>
          {used.toLocaleString()} <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>of {limit.toLocaleString()}</span>
        </span>
      </div>
      <div className="mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-hover)' }}
        role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={`${label}: ${used} of ${limit} used`}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: L.color }} />
      </div>
      <p className="text-[11.5px] mt-1.5" style={{ color: lvl === 'out' ? L.color : 'var(--text-faint)' }}>
        {lvl === 'out' ? `None left. ${reset}.` : `${(limit - used).toLocaleString()} left. ${reset}.`}
      </p>
    </li>
  )
}

export default function YourUsage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [daily, setDaily] = useState<DailyBucket[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try {
      const [s, d] = await Promise.all([
        fetch('/api/usage/summary').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/usage/daily').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (!s || !Array.isArray(s.buckets)) setFailed(true)
      else setSummary(s as Summary)
      setDaily(d && Array.isArray(d.buckets) ? d.buckets : [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const monthly = (summary?.buckets ?? []).filter((b): b is Bucket & { limit: number } => typeof b.limit === 'number' && b.limit > 0)
  const all = [
    ...monthly.map((b) => ({ label: b.label, lvl: levelOf(b.used, b.limit) })),
    ...(daily ?? []).map((b) => ({ label: b.label, lvl: levelOf(b.used, b.limit) })),
  ]
  const out = all.filter((a) => a.lvl === 'out')
  const close = all.filter((a) => a.lvl === 'close')
  const isAdmin = summary?.tier === 'admin'
  const monthlyReset = (key: string) => summary?.lifetime ? 'This is your trial total and does not reset'
    : CALENDAR_MONTH.has(key) ? 'Resets on the 1st of the month'
      : summary?.resetLabel ? `Resets ${summary.resetLabel}` : 'Resets on your billing date'

  return (
    <div className="max-w-3xl mx-auto">
      <PageHero
        accent="rgba(124,58,237,0.25)"
        title="Your usage"
        subtitle="Everything your plan includes that has a limit, how much you have used, and when it resets."
      />

      {loading && (
        <div className="flex items-center gap-2 text-[13px] py-10 justify-center" style={{ color: 'var(--text-soft)' }}>
          <Loader2 size={15} className="animate-spin" /> Counting what you have used…
        </div>
      )}

      {!loading && failed && (
        <div className="rounded-2xl border p-5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
          Your usage could not be counted just now, so no numbers are shown rather than wrong ones.{' '}
          <button type="button" onClick={() => void load()} className="underline font-semibold" style={{ color: 'var(--text)' }}>Try again</button>
        </div>
      )}

      {!loading && summary && (
        <div className="grid gap-6">
          {isAdmin && (
            <p className="rounded-xl border p-3 text-[12.5px]" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
              You are on the admin account, which has no monthly limits. The monthly bars below show the Amazon plan&apos;s limits
              with sample numbers, so you can see the page the way a customer does. The daily limits are your real counts.
            </p>
          )}

          {/* WHAT NEEDS ATTENTION, first: the limits used up or nearly so. */}
          {out.length > 0 ? (
            <div className="rounded-2xl border p-4 flex items-start gap-3" style={{ borderColor: 'rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.06)' }}>
              <XCircle size={18} style={{ color: '#DC2626' }} className="shrink-0 mt-0.5" />
              <div className="text-[13px]" style={{ color: 'var(--text)' }}>
                <b>Used up: {out.map((a) => a.label).join(', ')}.</b>{' '}
                Those pause until they reset. Everything else keeps working.{close.length ? ` Almost used up: ${close.map((a) => a.label).join(', ')}.` : ''}
                {!isAdmin && <> <Link href="/billing" className="underline font-semibold">See plans with more</Link></>}
              </div>
            </div>
          ) : close.length > 0 ? (
            <div className="rounded-2xl border p-4 flex items-start gap-3" style={{ borderColor: 'rgba(217,119,6,0.35)', background: 'rgba(217,119,6,0.06)' }}>
              <AlertTriangle size={18} style={{ color: '#D97706' }} className="shrink-0 mt-0.5" />
              <div className="text-[13px]" style={{ color: 'var(--text)' }}>
                <b>Almost used up: {close.map((a) => a.label).join(', ')}.</b> Over 80% used.
                {!isAdmin && <> <Link href="/billing" className="underline font-semibold">See plans with more</Link></>}
              </div>
            </div>
          ) : all.length > 0 ? (
            <div className="rounded-2xl border p-4 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
              <CheckCircle2 size={18} style={{ color: '#10B981' }} className="shrink-0" />
              <p className="text-[13px]" style={{ color: 'var(--text)' }}>Plenty left on everything.</p>
            </div>
          ) : null}

          <section>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>{summary.lifetime ? 'Your trial' : 'This month'}</h2>
              <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-soft)' }}>
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
            {monthly.length === 0 ? (
              <p className="text-[13px] rounded-xl border p-4" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                Nothing on your plan has a monthly limit.
              </p>
            ) : (
              <ul className="grid gap-2">
                {monthly.map((b) => <Row key={b.key} label={b.label} what={WHAT[b.key]} used={b.used} limit={b.limit} reset={monthlyReset(b.key)} />)}
              </ul>
            )}
          </section>

          {daily && daily.length > 0 && (
            <section>
              <h2 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text)' }}>Every 24 hours</h2>
              <p className="text-[12.5px] mb-2" style={{ color: 'var(--text-soft)' }}>
                These share an allowance an outside service gives all of MVP, so they count the last 24 hours, and each one comes back 24 hours after you used it.
              </p>
              <ul className="grid gap-2">
                {daily.map((b) => (
                  <Row key={b.key} label={b.label} what={WHAT[b.key]} used={b.used} limit={b.limit}
                    reset={b.nextFreeAt ? `The next one frees up ${clock(b.nextFreeAt)}` : 'None used in the last 24 hours'} />
                ))}
              </ul>
            </section>
          )}

          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Anything not listed here has no limit on your plan, or is not part of it. When a limit runs out, only that action pauses until it resets;
            nothing you already made is affected.{!isAdmin && <> Need more? <Link href="/billing" className="underline">Plan &amp; Billing</Link>.</>}
          </p>
        </div>
      )}
    </div>
  )
}
