'use client'

/**
 * OnboardingFunnel — the guided 7-step new-user setup experience (epic Phase 2).
 *
 * Self-contained (no dashboard chrome): a brand-new user with nothing connected
 * sees ONLY this, never the full sidebar of options. Walks them through, in
 * order: WordPress → YouTube → Affiliate Links → Brand Profile → Voice Training
 * → Customize Blog → Face Models, then drops them on the dashboard.
 *
 * Gate model (per product decision): WordPress is the one HARD requirement —
 * step 1 can't be advanced past until a site is connected. Everything after is
 * guided-but-skippable ("Skip for now"), and once WordPress is connected the
 * user may jump to the dashboard early.
 *
 * Step 1 (WordPress) is fully inline here so it works while the rest of the app
 * is still gated. Steps 2–7 open the existing, proven editors (reachable once
 * WordPress is connected) and the funnel tracks completion by polling
 * /api/onboarding. Styled with explicit dark colors because top-level routes
 * don't inherit the dashboard's dark CSS tokens.
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  Check, Wrench, Youtube, Link2, Palette, Sparkles, Brush, UserSquare,
  ArrowRight, ArrowLeft, ExternalLink, Loader2, PartyPopper, Lock,
} from 'lucide-react'

const HOSTINGER_URL = 'https://geni.us/ANaArQ'
const GENIUSLINK_URL = 'https://geni.us/Y70p9R'
const PLUGIN_ZIP = '/mvp-affiliate.zip'

interface Status {
  wpConnected: boolean
  ytConnected: boolean
  affiliateConnected: boolean
  brandStarted: boolean
  voiceStarted: boolean
  faceReady: boolean
}

interface StepDef {
  n: number
  key: string
  title: string
  icon: React.ReactNode
  done: (s: Status) => boolean
  /** Hard requirement — can't advance past until done. Only WordPress. */
  required?: boolean
  /** Manual-completion steps the funnel can't auto-detect (Customize Blog). */
  manual?: boolean
}

const STEPS: StepDef[] = [
  { n: 1, key: 'wp', title: 'Connect WordPress', icon: <Wrench size={16} />, done: (s) => s.wpConnected, required: true },
  // YouTube is also required-to-proceed: the user can't advance to or jump to
  // any later section until both WordPress AND YouTube are connected.
  { n: 2, key: 'yt', title: 'Connect YouTube', icon: <Youtube size={16} />, done: (s) => s.ytConnected, required: true },
  { n: 3, key: 'aff', title: 'Affiliate Links', icon: <Link2 size={16} />, done: (s) => s.affiliateConnected },
  { n: 4, key: 'brand', title: 'Brand Profile', icon: <Palette size={16} />, done: (s) => s.brandStarted },
  { n: 5, key: 'voice', title: 'Voice Training', icon: <Sparkles size={16} />, done: (s) => s.voiceStarted },
  { n: 6, key: 'customize', title: 'Customize Blog', icon: <Brush size={16} />, done: () => false, manual: true },
  { n: 7, key: 'face', title: 'Face Models', icon: <UserSquare size={16} />, done: (s) => s.faceReady },
]

const ACCENT = '#7C3AED'

/**
 * Navigation lock: a user can't reach step 2 until WordPress (1) is connected,
 * and can't reach any later section (3-7) until BOTH WordPress and YouTube are
 * connected. Step 1 is always open. Drives both the rail (click) and the
 * Save & next button.
 */
function stepUnlocked(n: number, s: Status): boolean {
  if (n <= 1) return true
  if (n === 2) return s.wpConnected
  return s.wpConnected && s.ytConnected
}

export default function OnboardingFunnel({
  email, initialStep, status: initialStatus,
}: {
  email: string
  initialStep: number
  status: Status
}) {
  const router = useRouter()
  const [step, setStep] = useState(initialStep)
  const [status, setStatus] = useState<Status>(initialStatus)
  const [saving, setSaving] = useState(false)
  const current = STEPS.find((s) => s.n === step) ?? STEPS[0]

  // ── Live status polling — picks up out-of-band completions (WordPress
  //    connected in a new tab, YouTube OAuth return, brand saved in another
  //    tab). Light cadence; runs the whole time the funnel is open.
  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding')
      if (res.ok) {
        const data = await res.json()
        if (data?.status) setStatus(data.status as Status)
      }
    } catch { /* transient — next tick retries */ }
  }, [])
  useEffect(() => {
    const t = setInterval(refreshStatus, 5000)
    // Also refresh on tab refocus (user came back from a connect tab).
    const onFocus = () => refreshStatus()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [refreshStatus])

  const persistStep = useCallback(async (n: number) => {
    try { await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: n }) }) }
    catch { /* best-effort resume point */ }
  }, [])

  const goToStep = useCallback((n: number) => {
    const clamped = Math.min(STEPS.length, Math.max(1, n))
    setStep(clamped)
    void persistStep(clamped)
  }, [persistStep])

  const next = useCallback(() => {
    if (current.required && !current.done(status)) {
      toast.error(current.key === 'wp'
        ? 'Connect your WordPress site to continue — everything starts here.'
        : 'Connect your YouTube to continue — it’s required before the rest of setup.')
      return
    }
    if (step >= STEPS.length) return
    goToStep(step + 1)
  }, [current, status, step, goToStep])

  const finish = useCallback(async () => {
    // WordPress is the hard gate — never let a user "finish" without it, or
    // they'd land on a dashboard the layout would just bounce back here.
    if (!status.wpConnected) {
      toast.error('Connect your WordPress site first — it’s the one required step.')
      return
    }
    setSaving(true)
    try {
      await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) })
      router.push('/dashboard')
    } catch {
      setSaving(false)
      toast.error('Could not finish setup. Try again.')
    }
  }, [router, status.wpConnected])

  const completedCount = STEPS.filter((s) => s.done(status)).length

  return (
    <div className="min-h-screen w-full text-[#f5f5f7]" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, rgba(124,58,237,0.18), transparent), #0a0a0f' }}>
      <div className="mx-auto max-w-5xl px-5 py-8 md:py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2.5">
            <div className="grid place-items-center w-8 h-8 rounded-lg font-bold text-sm" style={{ background: ACCENT }}>M</div>
            <span className="font-semibold tracking-tight">MVP Affiliate</span>
          </div>
          {status.wpConnected && (
            <button
              onClick={() => router.push('/dashboard')}
              className="text-xs text-[#a1a1a6] hover:text-white transition-colors"
            >
              Skip to dashboard →
            </button>
          )}
        </div>

        <div className="grid md:grid-cols-[240px_1fr] gap-8">
          {/* Progress rail */}
          <nav className="hidden md:block">
            <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#86868b] mb-3">
              Set up · {completedCount}/{STEPS.length}
            </p>
            <ol className="flex flex-col gap-1">
              {STEPS.map((s) => {
                const done = s.done(status)
                const active = s.n === step
                const locked = !stepUnlocked(s.n, status)
                return (
                  <li key={s.key}>
                    <button
                      onClick={() => { if (locked) { toast.error('Finish WordPress and YouTube first.'); return } goToStep(s.n) }}
                      aria-disabled={locked}
                      className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
                      style={{ background: active ? 'rgba(124,58,237,0.16)' : 'transparent', cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.4 : 1 }}
                    >
                      <span
                        className="grid place-items-center w-6 h-6 rounded-full text-[11px] font-semibold shrink-0"
                        style={{
                          background: done ? '#34c759' : active ? ACCENT : 'rgba(255,255,255,0.08)',
                          color: done || active ? '#fff' : '#a1a1a6',
                        }}
                      >
                        {done ? <Check size={13} /> : locked ? <Lock size={11} /> : s.n}
                      </span>
                      <span className="text-sm" style={{ color: active ? '#fff' : '#c7c7cc' }}>{s.title}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>

          {/* Step card */}
          <main>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8 min-h-[420px] flex flex-col">
              <div className="flex items-center gap-2.5 mb-1.5 text-[#a1a1a6]">
                <span className="grid place-items-center w-7 h-7 rounded-lg" style={{ background: 'rgba(124,58,237,0.16)', color: ACCENT }}>{current.icon}</span>
                <span className="text-xs uppercase tracking-wider">Step {current.n} of {STEPS.length}</span>
                {current.done(status) && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-[#34c759]"><Check size={13} /> Done</span>
                )}
              </div>

              <div className="flex-1">
                <StepBody stepKey={current.key} status={status} onConnected={refreshStatus} />
              </div>

              {/* Footer nav */}
              <div className="flex items-center justify-between pt-6 mt-6 border-t border-white/10">
                {/* Single working Back: hidden on step 1 (nothing precedes it;
                    the WordPress card has its own internal back for its
                    sub-screens). Spacer preserves the footer's space-between. */}
                {step > 1 ? (
                  <button
                    onClick={() => goToStep(step - 1)}
                    className="inline-flex items-center gap-1.5 text-sm text-[#a1a1a6] hover:text-white transition-colors"
                  >
                    <ArrowLeft size={15} /> Back
                  </button>
                ) : <span />}

                <div className="flex items-center gap-3">
                  {/* Skip — optional steps only */}
                  {!current.required && step < STEPS.length && (
                    <button onClick={next} className="text-sm text-[#a1a1a6] hover:text-white transition-colors">
                      Skip for now
                    </button>
                  )}
                  {step < STEPS.length ? (
                    <button
                      onClick={next}
                      className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ background: ACCENT }}
                    >
                      Save &amp; next <ArrowRight size={15} />
                    </button>
                  ) : (
                    <button
                      onClick={finish}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                      style={{ background: ACCENT }}
                    >
                      {saving ? <Loader2 size={15} className="animate-spin" /> : <PartyPopper size={15} />}
                      Finish &amp; go to dashboard
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="text-center text-xs text-[#6e6e73] mt-4">
              Signed in as {email} · Your progress saves automatically.
            </p>
          </main>
        </div>
      </div>
    </div>
  )
}

/* ── Per-step bodies ─────────────────────────────────────────────────────── */

function StepBody({ stepKey, status, onConnected }: { stepKey: string; status: Status; onConnected: () => void }) {
  switch (stepKey) {
    case 'wp': return <WordPressStep connected={status.wpConnected} onConnected={onConnected} />
    case 'yt': return <YouTubeStep connected={status.ytConnected} />
    case 'aff': return <AffiliateStep done={status.affiliateConnected} onSaved={onConnected} />
    case 'brand': return <ToolStep
      title="Build your Brand Profile"
      blurb="Your name, niches, tone of voice, logo and disclosures. This is what every generated post is branded with — fill it out as completely as you can."
      href="/brand" cta="Open Brand Profile" done={status.brandStarted} />
    case 'voice': return <ToolStep
      title="Train your writing voice"
      blurb="Paste a writing sample and tell MVP who you are and who you're writing for. Strongly recommended — it's the difference between generic AI copy and posts that sound like you. You can leave fields blank and come back later."
      href="/learn" cta="Open Voice Training" done={status.voiceStarted} />
    case 'customize': return <ToolStep
      title="Customize your blog"
      blurb="Set your colors, homepage Editor's Picks, author trust block and footer. You can refine this anytime, but a quick pass now makes your first posts look polished."
      href="/customize" cta="Open Customize Blog" done={false} />
    case 'face': return <ToolStep
      title="Create your face model"
      blurb="Upload up to 20 selfies and MVP trains a reference model so your real face can appear in AI thumbnails and social images. Takes a few minutes to train in the background."
      href="/photobooth" cta="Open Face Models" done={status.faceReady} />
    default: return null
  }
}

function StepHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <>
      {/* Explicit color: globals.css sets `h1,h2 { color: var(--text) }`, and on
          this top-level route --text resolves to the LIGHT value (dark text),
          which rendered the titles invisible on the dark funnel. Force light. */}
      <h1 className="text-2xl font-semibold tracking-tight mb-2" style={{ color: '#f5f5f7' }}>{title}</h1>
      <p className="text-[15px] leading-relaxed text-[#c7c7cc] mb-6">{blurb}</p>
    </>
  )
}

/* Step 1 — WordPress (inline, the hard gate) */
function WordPressStep({ connected, onConnected }: { connected: boolean; onConnected: () => void }) {
  const [mode, setMode] = useState<'choose' | 'have' | 'need'>('choose')
  const [siteUrl, setSiteUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  if (connected) {
    return (
      <>
        <StepHeading title="WordPress connected" blurb="Your blog is linked to MVP Affiliate. This is the foundation — everything else builds on it." />
        <div className="inline-flex items-center gap-2 rounded-xl bg-[#34c759]/10 border border-[#34c759]/30 px-4 py-3 text-sm text-[#34c759]">
          <Check size={16} /> Site connected. Hit “Save &amp; next” to continue.
        </div>
      </>
    )
  }

  async function connectWithToken() {
    const t = token.trim()
    if (!t) { toast.error('Paste your connection token first.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/wordpress/connect-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not connect. Check the token and try again.'); return }
      toast.success(`Connected ${data.siteUrl || 'your site'}.`)
      onConnected()
    } catch { toast.error('Something went wrong. Try again.') }
    finally { setBusy(false) }
  }

  function connectOneClick() {
    const u = siteUrl.trim()
    if (!u) { toast.error('Enter your WordPress site URL first.'); return }
    // Opens the WP authorize flow in a new tab; the funnel polls for the
    // connection and flips this step to ✓ when it lands.
    window.open(`/api/wordpress/oauth-start?siteUrl=${encodeURIComponent(u)}`, '_blank', 'noopener')
    toast('Finish the authorization in the new tab — this page updates automatically.')
  }

  if (mode === 'choose') {
    return (
      <>
        <StepHeading title="Let’s connect your blog" blurb="MVP Affiliate publishes to your own WordPress site. It all starts here — pick the option that fits you." />
        <div className="grid sm:grid-cols-2 gap-3">
          <button onClick={() => setMode('have')} className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-5 hover:border-[#7C3AED]/50 transition-colors">
            <p className="font-semibold mb-1">I have a WordPress blog</p>
            <p className="text-sm text-[#a1a1a6]">Connect your existing site in under a minute.</p>
          </button>
          <button onClick={() => setMode('need')} className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-5 hover:border-[#7C3AED]/50 transition-colors">
            <p className="font-semibold mb-1">I don’t have one yet</p>
            <p className="text-sm text-[#a1a1a6]">Get a blog set up the right way in ~10 minutes.</p>
          </button>
        </div>
      </>
    )
  }

  if (mode === 'need') {
    return (
      <>
        <StepHeading title="Get your blog" blurb="You’ll need WordPress hosting. Hostinger is what we recommend — cheap, fast, and one-click WordPress. Set it up, then come back and connect it." />
        <ol className="space-y-2.5 text-sm text-[#c7c7cc] mb-6 list-decimal pl-5">
          <li>Grab a plan + domain on Hostinger (Premium is plenty).</li>
          <li>Use Hostinger’s one-click WordPress installer.</li>
          <li>Come back here and choose “I have a WordPress blog”.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <a href={HOSTINGER_URL} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: ACCENT }}>
            Get hosting on Hostinger <ExternalLink size={14} />
          </a>
          <button onClick={() => setMode('have')} className="text-sm text-[#a1a1a6] hover:text-white transition-colors">
            I’ve set it up — connect now →
          </button>
        </div>
      </>
    )
  }

  // mode === 'have'
  return (
    <>
      <StepHeading title="Connect your WordPress site" blurb="Two ways — one-click is fastest. Either one links your site so MVP can publish to it." />

      {/* One-click */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-4">
        <p className="font-semibold text-sm mb-1">Option A · One-click (recommended)</p>
        <p className="text-sm text-[#a1a1a6] mb-3">Enter your site URL and authorize in a new tab. This page updates on its own when it’s done.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://yourblog.com"
            className="flex-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]/60"
          />
          <button onClick={connectOneClick} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: ACCENT }}>
            Connect
          </button>
        </div>
      </div>

      {/* Plugin + token */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <p className="font-semibold text-sm mb-1">Option B · Plugin + connection token</p>
        <p className="text-sm text-[#a1a1a6] mb-3">
          Install our plugin, then paste the token it gives you (wp-admin → MVP Affiliate).
        </p>
        <a href={PLUGIN_ZIP} className="inline-flex items-center gap-1.5 text-sm text-[#7C3AED] hover:underline mb-3">
          Download the MVP Affiliate plugin <ExternalLink size={13} />
        </a>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="Paste connection token"
            className="flex-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]/60"
          />
          <button onClick={connectWithToken} disabled={busy} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-60 inline-flex items-center gap-1.5" style={{ background: 'rgba(255,255,255,0.1)' }}>
            {busy && <Loader2 size={14} className="animate-spin" />} Connect
          </button>
        </div>
      </div>

      <button onClick={() => setMode('choose')} className="text-xs text-[#6e6e73] hover:text-white transition-colors mt-4">← back</button>
    </>
  )
}

/* Step 2 — YouTube (one-click OAuth) */
function YouTubeStep({ connected }: { connected: boolean }) {
  if (connected) {
    return (
      <>
        <StepHeading title="YouTube connected" blurb="MVP can now pull your videos and drafts. That’s all it needs." />
        <div className="inline-flex items-center gap-2 rounded-xl bg-[#34c759]/10 border border-[#34c759]/30 px-4 py-3 text-sm text-[#34c759]">
          <Check size={16} /> Connected. Continue when you’re ready.
        </div>
      </>
    )
  }
  return (
    <>
      <StepHeading title="Connect your YouTube" blurb="One click — authorize with Google and you’re done. MVP figures out your channel automatically (no IDs to paste). This is how it turns your videos into blog posts." />
      <a href="/api/auth/youtube" className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: ACCENT }}>
        <Youtube size={16} /> Connect YouTube
      </a>
      <p className="text-xs text-[#6e6e73] mt-4">Not ready? You can skip this and connect later from Set up.</p>
    </>
  )
}

/* Step 3 — Affiliate Links (Geniuslink / Amazon) */
function AffiliateStep({ done, onSaved }: { done: boolean; onSaved: () => void }) {
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [tag, setTag] = useState('')
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)

  // Prefill any values the account already saved (so re-visits aren't blank).
  useEffect(() => {
    (async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any).from('integrations')
          .select('geniuslink_api_key, geniuslink_api_secret, amazon_associates_tag')
          .eq('user_id', user.id).maybeSingle()
        if (data) {
          setKey(data.geniuslink_api_key ?? '')
          setSecret(data.geniuslink_api_secret ?? '')
          setTag(data.amazon_associates_tag ?? '')
        }
      } catch { /* leave blank */ }
    })()
  }, [])

  async function save() {
    setSaving(true)
    try {
      const supabase = createBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { toast.error('Session expired — refresh and try again.'); return }
      // Mirrors how /brand persists these (client-side update on integrations).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('integrations').upsert({
        user_id: user.id,
        geniuslink_api_key: key.trim() || null,
        geniuslink_api_secret: secret.trim() || null,
        amazon_associates_tag: tag.trim() || null,
      }, { onConflict: 'user_id' })
      if (error) { toast.error(error.message || 'Could not save.'); return }
      toast.success('Affiliate settings saved.')
      onSaved()
    } catch { toast.error('Something went wrong. Try again.') }
    finally { setSaving(false) }
  }

  async function verifyGroups() {
    setVerifying(true)
    try {
      const res = await fetch('/api/geniuslink/setup', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not reach Geniuslink — check your key + secret.'); return }
      toast.success('Geniuslink connected — link groups are ready.')
      onSaved()
    } catch { toast.error('Verification failed. Check your key + secret.') }
    finally { setVerifying(false) }
  }

  const inputCls = 'w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]/60'

  return (
    <>
      <StepHeading
        title="Set up affiliate link routing"
        blurb="This is how your product links earn commissions. If you use Geniuslink, paste your API key + secret and we’ll create the two link groups MVP needs. No Geniuslink? Just add your Amazon Associates tag instead — that works too."
      />
      {done && (
        <div className="inline-flex items-center gap-2 rounded-xl bg-[#34c759]/10 border border-[#34c759]/30 px-4 py-3 text-sm text-[#34c759] mb-5">
          <Check size={16} /> Affiliate routing configured.
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-4">
        <p className="font-semibold text-sm mb-1">Geniuslink (recommended)</p>
        <p className="text-sm text-[#a1a1a6] mb-3">Find these in your Geniuslink dashboard under API access. We’ll auto-create your two link groups when you verify.</p>
        <div className="flex flex-col gap-2">
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Geniuslink API key" className={inputCls} />
          <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Geniuslink API secret" type="password" className={inputCls} />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <button onClick={verifyGroups} disabled={verifying || !key.trim() || !secret.trim()} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50" style={{ background: ACCENT }}>
            {verifying && <Loader2 size={14} className="animate-spin" />} Verify &amp; create groups
          </button>
          <a href={GENIUSLINK_URL} target="_blank" rel="noopener noreferrer" className="text-sm text-[#a1a1a6] hover:text-white transition-colors">
            Don’t have Geniuslink? Sign up →
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-4">
        <p className="font-semibold text-sm mb-1">Or use your Amazon Associates tag</p>
        <p className="text-sm text-[#a1a1a6] mb-3">Your storefront tracking ID (e.g. <span className="text-[#c7c7cc]">yourtag-20</span>). Used when Geniuslink isn’t set.</p>
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="yourtag-20" className={inputCls} />
      </div>

      <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-60" style={{ background: 'rgba(255,255,255,0.1)' }}>
        {saving && <Loader2 size={14} className="animate-spin" />} Save affiliate settings
      </button>
    </>
  )
}

/* Steps 4–7 — open the existing editor in a new tab; funnel tracks completion */
function ToolStep({ title, blurb, href, cta, done }: { title: string; blurb: string; href: string; cta: string; done: boolean }) {
  return (
    <>
      <StepHeading title={title} blurb={blurb} />
      {done && (
        <div className="inline-flex items-center gap-2 rounded-xl bg-[#34c759]/10 border border-[#34c759]/30 px-4 py-3 text-sm text-[#34c759] mb-5">
          <Check size={16} /> Looks good — you’ve started this.
        </div>
      )}
      <a href={href} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: ACCENT }}>
        {cta} <ExternalLink size={14} />
      </a>
      <p className="text-xs text-[#6e6e73] mt-4">Opens in a new tab — come back here to continue. This page updates automatically.</p>
    </>
  )
}
