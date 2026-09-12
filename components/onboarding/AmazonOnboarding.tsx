// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Onboarding for someone who came for the Amazon Influencer product.
//
// The main funnel opens with "Connect YouTube", marked required, with every
// later step locked behind it. An Amazon influencer has no channel and never
// will, so that screen is where they stop. They clicked an ad about turning a
// product link into a finished design and the first thing the app asked for was
// the one thing they cannot give it.
//
// This is the other door. One required field, two optional ones, and a button
// that goes straight to the thing the ad promised. It is short on purpose:
// every question asked before they have seen a design come out is a chance to
// lose them, and the whole argument for the $79 plan is watching that happen
// once.
'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Check, ArrowRight, ShieldCheck, UserSquare, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { amazonOnboardingSteps, onboardingDestination } from '@/lib/onboarding-path'
import { looksLikeAssociatesTag } from '@/lib/free-trial'

const ACCENT = '#C2410C'

export default function AmazonOnboarding({
  email, initialTag, hasFace, hasSocial,
}: {
  email: string
  initialTag: string
  hasFace: boolean
  hasSocial: boolean
}) {
  const router = useRouter()
  const steps = amazonOnboardingSteps()
  const [tag, setTag] = useState(initialTag)
  const [savedTag, setSavedTag] = useState(initialTag)
  const [saving, setSaving] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const tagLooksRight = looksLikeAssociatesTag(tag)
  const ready = looksLikeAssociatesTag(savedTag)

  async function saveTag() {
    const t = tag.trim()
    if (!t) { toast.error('Add your Associates tag first.'); return }
    setSaving(true)
    try {
      // Through the server: this column sits alongside encrypted credentials and
      // is written by the same guarded route the main funnel uses.
      const res = await fetch('/api/affiliate-links/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amazonTag: t }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || j?.error) { toast.error(String(j?.error || 'Could not save that.')); return }
      setSavedTag(t)
      toast.success('Saved. Your links will earn on your account.')
    } catch {
      toast.error('Something went wrong. Try again.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Mark the funnel done, THEN navigate.
   *
   * This used to fire the write and push in the same tick without awaiting. The
   * flag is not decoration: the dashboard layout bounces an account with nothing
   * connected off every content route, and /photobooth is one of them. Photobooth
   * is on the free trial's own feature list ("1 face model and 6 photobooth
   * headshots"), so losing the race meant the trial's headline feature sent them
   * back to this screen, which they had already finished.
   *
   * Still best-effort at the end: a write that will not land must not trap
   * anybody here, so the navigation happens either way.
   */
  const finish = useCallback(async (to: string) => {
    setLeaving(true)
    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: true, path: 'amazon' }),
      })
    } catch { /* go anyway; the gate is recoverable, a locked screen is not */ }
    router.push(to)
  }, [router])

  return (
    <div className="min-h-screen bg-white dark:bg-[#0b0b0d] text-[#1d1d1f] dark:text-[#f5f5f7]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <p className="text-xs font-bold uppercase tracking-[0.14em] mb-3" style={{ color: ACCENT }}>
          Amazon Influencer setup
        </p>
        <h1 className="text-3xl font-bold tracking-tight">One field, then you are making designs.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0]">
          No website, no YouTube channel, no card. Signed in as {email}.
        </p>

        {/* ── Required: the Associates tag ───────────────────────────────── */}
        <div className="mt-8 rounded-2xl border border-gray-200 dark:border-white/10 p-6">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0 text-white" style={{ backgroundColor: ACCENT }}>
              <ShieldCheck size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[15px]">{steps[0].title}</p>
              <p className="text-[13px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">{steps[0].blurb}</p>
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  value={tag}
                  onChange={e => setTag(e.target.value)}
                  placeholder="yourname-20"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Amazon Associates tag"
                  className="input-field flex-1 min-w-0"
                />
                <button onClick={saveTag} disabled={saving || !tag.trim()} className="btn-primary whitespace-nowrap disabled:opacity-60">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : ready && savedTag === tag.trim() ? <Check size={14} /> : null}
                  {saving ? ' Saving…' : ready && savedTag === tag.trim() ? ' Saved' : 'Save tag'}
                </button>
              </div>
              {/* Say it before they hit Save, not after. The shape is the whole
                  check, and "-20" is the part people forget to paste. */}
              {tag.trim() && !tagLooksRight && (
                <p className="mt-2 text-[12px]" style={{ color: '#ff9500' }}>
                  Associates tags end in a store id, like <strong>yourname-20</strong>. Check yours in Amazon Associates under Account Settings.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Optional, and clearly labelled as such ──────────────────────── */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { s: steps[1], icon: <UserSquare size={16} />, href: '/face-training', done: hasFace, cta: 'Add selfies' },
            { s: steps[2], icon: <Share2 size={16} />, href: '/amazon/social', done: hasSocial, cta: 'Connect' },
          ].map(({ s, icon, href, done, cta }) => (
            <div key={s.key} className="rounded-2xl border border-gray-200 dark:border-white/10 p-5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: 'rgba(234,88,12,0.12)', color: ACCENT }}>{icon}</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#86868b]">
                  {done ? 'Done' : 'Optional'}
                </span>
              </div>
              <p className="font-semibold text-[14px]">{s.title}</p>
              <p className="text-[12.5px] leading-relaxed text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">{s.blurb}</p>
              <Link href={href} className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold hover:opacity-80" style={{ color: ACCENT }}>
                {done ? 'Review' : cta} <ArrowRight size={13} />
              </Link>
            </div>
          ))}
        </div>

        {/* ── Out ─────────────────────────────────────────────────────────── */}
        {/* Two ways out, and that is the point. The primary button needs the tag
            because the tag is what makes a free design earn. But a screen whose
            only control is disabled is a locked door: someone who does not have
            their tag to hand right now, or whose tag this app's format check
            reads wrong, had nothing else to click and nothing telling them what
            else to do. Research and Deal Radar are free, uncapped and need no
            tag, so that is the second door. */}
        <div className="mt-8 flex flex-col gap-3">
          <div>
            <button
              onClick={() => void finish(onboardingDestination('amazon'))}
              disabled={!ready || leaving}
              className="btn-primary w-full sm:w-auto disabled:opacity-60"
              style={ready ? { backgroundColor: ACCENT } : undefined}
            >
              {leaving ? <><Loader2 size={14} className="inline animate-spin mr-1" /> Opening…</> : <>Make my first design <ArrowRight size={15} className="inline ml-1" /></>}
            </button>
            {!ready && (
              <p className="mt-2 text-[12.5px] text-[#86868b] dark:text-[#8e8e93]">
                Save your Associates tag above and this opens up. It is what makes your free designs earn on your account.
              </p>
            )}
          </div>
          {!ready && (
            <p className="text-[13px] text-[#6e6e73] dark:text-[#ebebf0]">
              Do not have it to hand?{' '}
              <button
                onClick={() => void finish('/amazon/research')}
                disabled={leaving}
                className="font-semibold hover:underline disabled:opacity-60"
                style={{ color: ACCENT }}
              >
                Look around first
              </button>
              . Product research and Deal Radar are free and need no tag. Add the tag in Setup whenever you are ready and your designs unlock.
            </p>
          )}
        </div>

        {/* The other door, for anyone who took this one by mistake. */}
        <p className="mt-10 text-[13px] text-[#86868b] dark:text-[#8e8e93]">
          Have a YouTube channel or a blog as well?{' '}
          <Link href="/onboarding?for=creator" className="font-semibold hover:underline" style={{ color: '#7C3AED' }}>
            Use the full setup instead
          </Link>
          . You keep everything you do here.
        </p>
      </div>
    </div>
  )
}
