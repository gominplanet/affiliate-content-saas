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
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  Check, Wrench, Youtube, Link2, Palette, Sparkles, Brush, UserSquare,
  ArrowRight, ArrowLeft, ExternalLink, Loader2, PartyPopper, Lock, Play,
} from 'lucide-react'

// ── Replace with your real YouTube video ID (e.g. "dQw4w9WgXcQ") ────────────
const ONBOARDING_VIDEO_ID = 'aBo0ruDuVuE'

const HOSTINGER_URL = 'https://geni.us/MVPhosting'
const GENIUSLINK_URL = 'https://geni.us/Y70p9R'
const PLUGIN_ZIP = '/mvp-affiliate.zip'
const THEME_ZIP = '/mvp-affiliate-theme.zip'

// Mirror the option lists from the full Brand Profile editor (app/(dashboard)/
// brand/page.tsx) so the inline funnel card writes identical values.
const NICHES = [
  'Home & Kitchen', 'Electronics & Tech', 'Outdoor & Sports', 'Beauty & Personal Care',
  'Health & Wellness', 'Pet Supplies', 'Tools & Home Improvement', 'Toys & Games',
  'Books & Education', 'Fashion & Apparel', 'Garden & Outdoors', 'Automotive',
  'Baby & Kids', 'Office & Productivity', 'Food & Grocery', 'Travel & Luggage',
  'Arts & Crafts', 'Musical Instruments', 'Software & Apps', 'Finance & Investing',
]
const TONE_OPTIONS = [
  'Professional', 'Conversational', 'Bold', 'Friendly',
  'Educational', 'Persuasive', 'Humorous', 'Inspiring',
]

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
  { n: 0, key: 'intro', title: 'Watch intro', icon: <Play size={16} />, done: () => false },
  { n: 1, key: 'wp', title: 'Connect WordPress', icon: <Wrench size={16} />, done: (s) => s.wpConnected, required: true },
  // YouTube is OPTIONAL — MVP is content-first, so a non-YouTuber affiliate
  // blogger must be able to skip this and still finish setup. WordPress is the
  // only hard gate (see finish()). Leaving this required trapped any user
  // without a Google/YouTube account in onboarding with no way out.
  { n: 2, key: 'yt', title: 'Connect YouTube', icon: <Youtube size={16} />, done: (s) => s.ytConnected },
  { n: 3, key: 'aff', title: 'Affiliate Links', icon: <Link2 size={16} />, done: (s) => s.affiliateConnected },
  { n: 4, key: 'brand', title: 'Brand Profile', icon: <Palette size={16} />, done: (s) => s.brandStarted },
  { n: 5, key: 'voice', title: 'Voice Training', icon: <Sparkles size={16} />, done: (s) => s.voiceStarted },
  { n: 6, key: 'customize', title: 'Customize Blog', icon: <Brush size={16} />, done: () => false, manual: true },
  { n: 7, key: 'face', title: 'Face Models', icon: <UserSquare size={16} />, done: (s) => s.faceReady },
]

const ACCENT = '#7C3AED'

/**
 * Navigation lock: WordPress (1) is the ONLY hard gate. Step 1 is always open;
 * every later step unlocks once WordPress is connected. YouTube (2) is optional
 * and never blocks progress. Drives both the rail (click) and the Save & next
 * button.
 */
function stepUnlocked(n: number, s: Status): boolean {
  if (n <= 1) return true
  return s.wpConnected
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

  // The YouTube OAuth callback returns here (returnTo=/onboarding) with a
  // result marker. Surface it as a toast, refresh status so the step flips to
  // ✓, then strip the params so a refresh doesn't re-toast.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const connected = sp.get('youtube_oauth_connected')
    const ytErr = sp.get('youtube_error')
    if (!connected && !ytErr) return
    if (connected) { toast.success('YouTube connected.'); void refreshStatus() }
    else if (ytErr) { toast.error(`Couldn’t connect YouTube: ${decodeURIComponent(ytErr)}`) }
    const url = new URL(window.location.href)
    url.searchParams.delete('youtube_oauth_connected')
    url.searchParams.delete('youtube_error')
    window.history.replaceState({}, '', url.pathname + url.search)
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
      // WordPress is the only required step.
      toast.error('Connect your WordPress site to continue — everything starts here.')
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

  // Step 0 (intro video) is not a "setup" step — exclude from the setup counter.
  const setupSteps = STEPS.filter((s) => s.n > 0)
  const completedCount = setupSteps.filter((s) => s.done(status)).length

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
              Set up · {completedCount}/{setupSteps.length}
            </p>
            <ol className="flex flex-col gap-1">
              {STEPS.map((s) => {
                const done = s.done(status)
                const active = s.n === step
                const locked = !stepUnlocked(s.n, status)
                return (
                  <li key={s.key}>
                    <button
                      onClick={() => { if (locked) { toast.error('Connect WordPress first.'); return } goToStep(s.n) }}
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
                        {done ? <Check size={13} /> : locked ? <Lock size={11} /> : s.n === 0 ? <Play size={11} /> : s.n}
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
                <span className="text-xs uppercase tracking-wider">
                  {current.n === 0 ? 'Welcome' : `Step ${current.n} of ${setupSteps.length}`}
                </span>
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
    case 'intro': return <IntroVideoStep />
    case 'wp': return <WordPressStep connected={status.wpConnected} onConnected={onConnected} />
    case 'yt': return <YouTubeStep connected={status.ytConnected} />
    case 'aff': return <AffiliateStep done={status.affiliateConnected} onSaved={onConnected} />
    case 'brand': return <BrandStep onSaved={onConnected} />
    case 'voice': return <VoiceStep onSaved={onConnected} />
    case 'customize': return <CustomizeStep onSaved={onConnected} />
    case 'face': return <ToolStep
      title="Last step — create your face model"
      blurb="Open Face Models, upload up to 20 selfies, and MVP trains a reference model so your real face can appear in AI thumbnails and social images. It trains in the background (a few minutes) — you don't have to wait. This is the one step that lives in its own tool; once you've started it, come back and hit “Finish & go to dashboard” below."
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

/* A live install-status row: spinner while checking, green ✓ when done, hollow
   circle while pending. Used on the WordPress connected screen. */
function CheckRow({ ok, checking, label }: { ok: boolean; checking: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <span className="grid place-items-center w-5 h-5 rounded-full shrink-0"
        style={{ background: ok ? '#34c759' : 'rgba(255,255,255,0.08)' }}>
        {checking ? <Loader2 size={12} className="animate-spin text-[#a1a1a6]" />
          : ok ? <Check size={12} className="text-white" />
          : <span className="w-2 h-2 rounded-full border border-[#6e6e73]" />}
      </span>
      <span style={{ color: ok ? '#f5f5f7' : '#a1a1a6' }}>{label}</span>
    </div>
  )
}

/* Step 0 — Intro video (watch before setting up) */
function IntroVideoStep() {
  return (
    <>
      <StepHeading
        title="Welcome to MVP Affiliate"
        blurb="Watch this quick walkthrough to see how MVP turns your YouTube videos into blog posts, affiliate revenue, and cross-platform content — all in your voice. Then hit Save & next below to start connecting your tools."
      />
      {/* Responsive 16:9 iframe container */}
      <div style={{
        position: 'relative',
        paddingBottom: '56.25%',
        height: 0,
        overflow: 'hidden',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.1)',
        marginBottom: 20,
        background: 'rgba(0,0,0,0.4)',
      }}>
        <iframe
          src={`https://www.youtube.com/embed/${ONBOARDING_VIDEO_ID}?rel=0&modestbranding=1`}
          title="MVP Affiliate — getting started"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: 0,
            borderRadius: 12,
          }}
        />
      </div>
      <p className="text-sm text-[#a1a1a6]">
        Prefer to dive straight in? Hit <span className="text-white">Skip for now</span> below.
      </p>
    </>
  )
}

/* Step 1 — WordPress (inline, the hard gate) */
function WordPressStep({ connected, onConnected }: { connected: boolean; onConnected: () => void }) {
  const [mode, setMode] = useState<'choose' | 'have' | 'need'>('choose')
  const [siteUrl, setSiteUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  // The no-plugin "quick connect" is a demoted fallback — collapsed by default
  // so the plugin path (the full customizable-blog experience) leads.
  const [showQuick, setShowQuick] = useState(false)
  // Live plugin/theme install state (from the plugin's /status via
  // /api/wordpress/health) so the connected screen shows real green checks
  // instead of asking the user to self-assess. null = still checking.
  const [wpStatus, setWpStatus] = useState<{ pluginInstalled: boolean; themeActive: boolean } | null>(null)

  useEffect(() => {
    if (!connected) return
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/wordpress/health')
        if (!res.ok || cancelled) return
        const d = await res.json()
        const det = d?.details || {}
        if (!cancelled) setWpStatus({ pluginInstalled: det.pluginInstalled === true, themeActive: det.themeActive === true })
      } catch { /* transient — interval retries */ }
    }
    check()
    const t = setInterval(check, 6000)
    return () => { cancelled = true; clearInterval(t) }
  }, [connected])

  if (connected) {
    const checking = wpStatus === null
    const pluginOk = wpStatus?.pluginInstalled === true
    const themeOk = wpStatus?.themeActive === true
    // Only treat the plugin as missing when we POSITIVELY detect it (a
    // successful health check that says it's absent — the rare no-plugin quick
    // connect). While checking, or on the normal token path, assume it's there
    // (they just activated it to generate the token) and show the one-click
    // theme path — never flash plugin-install steps at someone who just did it.
    const pluginMissing = wpStatus !== null && wpStatus.pluginInstalled === false
    return (
      <>
        <StepHeading
          title="Site connected — one last thing"
          blurb="Your blog is linked and the MVP plugin is active. The only thing left is to switch on the MVP theme — your plugin can do that in one click, no downloads."
        />
        <div className="inline-flex items-center gap-2 rounded-xl bg-[#34c759]/10 border border-[#34c759]/30 px-4 py-3 text-sm text-[#34c759] mb-5">
          <Check size={16} /> Connection successful.
        </div>

        {/* Live status — turns green automatically as each piece lands. */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-5 space-y-2.5">
          <CheckRow ok={pluginOk} checking={checking && !pluginMissing} label="MVP plugin installed & active" />
          <CheckRow ok={themeOk} checking={checking} label="MVP theme installed & active" />
        </div>

        {themeOk ? (
          /* Everything done — no instructions, no consent wall needed. */
          <div className="rounded-xl border border-[#34c759]/30 bg-[#34c759]/10 px-4 py-3.5 text-sm text-[#7ee2a0]">
            <Check size={15} className="inline -mt-0.5 mr-1" /> Plugin and theme are both active — your review site is ready. Hit “Save &amp; next” below.
          </div>
        ) : (
          <>
            {/* Look-and-feel consent — must be unmistakable. */}
            <div className="rounded-xl border border-[#ff9500]/40 bg-[#ff9500]/10 px-4 py-3.5 mb-5">
              <p className="text-sm font-semibold text-[#ff9f0a] mb-1">Heads up: this changes how your blog looks</p>
              <p className="text-sm text-[#e8c9a0] leading-relaxed">
                Activating the MVP theme replaces your current theme’s design — your blog’s layout, colors, fonts and overall look &amp; feel become the MVP review-site style. Your posts and content stay safe; only the styling changes. Want to keep your current design? You can <span className="text-white">skip this</span> and still publish posts — just without the review layout and homepage features.
              </p>
            </div>

            {pluginMissing ? (
              /* Rare no-plugin path: they connected via Application Passwords,
                 so there's no one-click installer. Give the manual route + a
                 nudge to add the plugin for the full experience. */
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                <p className="font-semibold text-sm mb-2">Activate the MVP theme</p>
                <p className="text-sm text-[#a1a1a6] mb-2">You connected without the plugin, so install the theme manually — or <a href={PLUGIN_ZIP} className="text-[#7C3AED] hover:underline">add the MVP plugin</a> to get the one-click installer plus schema, Editor’s Picks and Product Finder.</p>
                <a href={THEME_ZIP} className="inline-flex items-center gap-1.5 text-sm text-[#7C3AED] hover:underline mb-2">
                  Download the MVP theme <ExternalLink size={12} />
                </a>
                <ol className="space-y-1 text-sm text-[#c7c7cc] list-decimal pl-5 marker:text-[#6e6e73]">
                  <li>WordPress admin → <span className="text-white">Appearance → Themes → Add New → Upload Theme</span> → Install &amp; Activate.</li>
                </ol>
              </div>
            ) : (
              /* Normal path: plugin is active → one-click theme install. */
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
                <p className="font-semibold text-sm mb-2">Switch on the MVP theme — one click</p>
                <ol className="space-y-1.5 text-sm text-[#c7c7cc] list-decimal pl-5 marker:text-[#6e6e73]">
                  <li>In your WordPress admin, open the <span className="text-white">MVP Affiliate</span> menu in the left sidebar (the plugin you just installed).</li>
                  <li>Under <span className="text-white">“Step 1 — Install the MVP Affiliate theme,”</span> click <span className="text-white">Install &amp; activate MVP Affiliate theme</span>. The plugin downloads, installs and activates it for you — nothing to download here.</li>
                </ol>
                <p className="text-xs text-[#6e6e73] mt-2">The theme check above turns green automatically once it’s active — no need to refresh.</p>
              </div>
            )}
          </>
        )}
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

  // Convenience for non-technical users: take whatever they typed, normalise it
  // to a URL, and open <site>/wp-admin in a new tab — that's where the plugin
  // install steps happen. Pure navigation, nothing saved.
  function openWpAdmin() {
    let u = siteUrl.trim()
    if (!u) { toast.error('Enter your website address first.'); return }
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u
    u = u.replace(/\/+$/, '')
    window.open(`${u}/wp-admin`, '_blank', 'noopener')
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
        <StepHeading title="Get your blog" blurb="You’ll need WordPress hosting. Hostinger is what we recommend — cheap, fast, one-click WordPress, and 20% off through our link. Set it up, then come back and connect it." />
        <ol className="space-y-2.5 text-sm text-[#c7c7cc] mb-6 list-decimal pl-5">
          <li>Grab a plan + domain on Hostinger (Premium is plenty).</li>
          <li>Use Hostinger’s one-click WordPress installer.</li>
          <li>Come back here and choose “I have a WordPress blog”.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <a href={HOSTINGER_URL} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: ACCENT }}>
            Get hosting on Hostinger — 20% off <ExternalLink size={14} />
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
      <StepHeading title="Connect your WordPress site" blurb="The MVP plugin is what turns your blog into a full review site — the review layout, Editor’s Picks, the AI Product Finder, topic hubs and Google-ready schema. Install it, connect, and you get the whole experience. (Already have a blog whose look you want to keep? There’s a no-plugin quick option at the bottom.)" />

      {/* PRIMARY — plugin + connection token. This is the pushed path: it powers
          the full customizable-blog experience AND works on every host (the
          body-auth proxy sidesteps the Hostinger-style WAF 403s that block the
          no-plugin method). */}
      <div className="rounded-xl border border-[#7C3AED]/45 bg-[#7C3AED]/[0.07] p-5">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-semibold text-sm">Install the MVP plugin, then connect</p>
          <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#7C3AED] text-white">Recommended</span>
        </div>
        <p className="text-sm text-[#c9b8ec] mb-3">Unlocks your fully customizable review blog and works on every host. Do these in order:</p>

        {/* Newbie helper: open their WordPress login for them. Steps 2-5 all
            happen inside wp-admin, so get them there in one click. */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-3 mb-4">
          <p className="text-xs text-[#a1a1a6] mb-2">New to WordPress? Type your site address and we’ll open its login page in a new tab — that’s where steps 2–5 happen.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="yourblog.com"
              className="flex-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#7C3AED]/60"
            />
            <button onClick={openWpAdmin} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity inline-flex items-center gap-1.5 whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.1)' }}>
              Open my WordPress login <ExternalLink size={13} />
            </button>
          </div>
        </div>

        <ol className="space-y-1.5 text-sm text-[#c7c7cc] mb-4 list-decimal pl-5 marker:text-[#7C3AED]">
          <li>
            <a href={PLUGIN_ZIP} className="text-[#a78bfa] hover:underline inline-flex items-center gap-1">Download the MVP Affiliate plugin <ExternalLink size={12} /></a>
            {' '}— it saves a <span className="text-white">.zip</span> file (don’t unzip it).
          </li>
          <li>In your WordPress admin, go to <span className="text-white">Plugins → Add New Plugin → Upload Plugin</span>.</li>
          <li>Choose the .zip you just downloaded, click <span className="text-white">Install Now</span>, then <span className="text-white">Activate</span>.</li>
          <li>A new <span className="text-white">“MVP Affiliate”</span> item appears in your WordPress admin’s left menu. Click it.</li>
          <li>Click <span className="text-white">Generate connection token</span>, then <span className="text-white">copy</span> the token it shows.</li>
          <li>Paste that token below and click <span className="text-white">Connect</span>.</li>
        </ol>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="Paste connection token"
            className="flex-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]/60"
          />
          <button onClick={connectWithToken} disabled={busy} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-60 inline-flex items-center gap-1.5" style={{ background: ACCENT }}>
            {busy && <Loader2 size={14} className="animate-spin" />} Connect
          </button>
        </div>
      </div>

      {/* FALLBACK — WordPress's built-in app authorization (no plugin). Demoted:
          collapsed by default, publishes posts only, no front-end features. */}
      <button
        onClick={() => setShowQuick(v => !v)}
        className="mt-4 text-xs text-[#8e8e93] hover:text-white transition-colors inline-flex items-center gap-1"
      >
        {showQuick ? '▾' : '▸'} Just want to publish quickly, without the customization features?
      </button>
      {showQuick && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mt-2">
          <p className="font-semibold text-sm mb-1">Quick connect · no plugin · ~30 seconds</p>
          <p className="text-sm text-[#a1a1a6] mb-3">
            Publishes posts only — you <span className="text-[#c7c7cc]">won’t</span> get the review layout, Editor’s Picks, Product Finder or schema unless you add the plugin later. Best if you already have a blog whose look you want to keep.
          </p>
          <ol className="space-y-1.5 text-sm text-[#c7c7cc] mb-4 list-decimal pl-5 marker:text-[#6e6e73]">
            <li>Make sure you’re <span className="text-white">logged in to your WordPress admin</span> in this browser (open <span className="text-[#c7c7cc]">yoursite.com/wp-admin</span> in another tab first if you’re not sure).</li>
            <li>Type your site address below and click <span className="text-white">Connect</span>.</li>
            <li>A WordPress page opens in a new tab titled <span className="text-white">“MVP Affiliate would like to connect.”</span> Click <span className="text-white">Yes, I approve.</span></li>
            <li>That tab closes/finishes — come back here and this page turns green automatically.</li>
          </ol>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="https://yourblog.com"
              className="flex-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]/60"
            />
            <button onClick={connectOneClick} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: 'rgba(255,255,255,0.1)' }}>
              Connect
            </button>
          </div>
          <p className="text-xs text-[#6e6e73] mt-2.5">
            Your site must use <span className="text-[#a1a1a6]">https://</span>. If the approve page doesn’t appear or your host blocks it, use the plugin method above — it always works.
          </p>
        </div>
      )}

      <div className="mt-5">
        <button onClick={() => setMode('choose')} className="text-xs text-[#6e6e73] hover:text-white transition-colors">← back</button>
      </div>
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
      {/* returnTo brings the OAuth callback back to the funnel instead of
          dumping the user on /setup (the callback's default). */}
      <a href="/api/auth/youtube?returnTo=/onboarding" className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: ACCENT }}>
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

/* Step 4 — Brand Profile, fully inline as an in-card multi-step form.
   Autosaves to brand_profiles (same columns the full /brand editor writes), so
   whether the user advances via the card's own Next or the funnel footer, their
   work is persisted. No link-out. */
function BrandStep({ onSaved }: { onSaved: () => void }) {
  const [page, setPage] = useState(0) // 0=Basics, 1=Niches & tone, 2=Disclosure
  const [brandName, setBrandName] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [tagline, setTagline] = useState('')
  const [niches, setNiches] = useState<string[]>([])
  const [tone, setTone] = useState<string[]>([])
  const [disclaimer, setDisclaimer] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const loaded = useRef(false)

  // Prefill from any existing brand_profiles row.
  useEffect(() => {
    (async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { loaded.current = true; return }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any).from('brand_profiles')
          .select('name, author_name, tagline, niches, tone, affiliate_disclaimer')
          .eq('user_id', user.id).maybeSingle()
        if (data) {
          setBrandName(data.name ?? '')
          setAuthorName(data.author_name ?? '')
          setTagline(data.tagline ?? '')
          setNiches(Array.isArray(data.niches) ? data.niches : [])
          setTone(Array.isArray(data.tone) ? data.tone : [])
          setDisclaimer(data.affiliate_disclaimer ?? '')
        }
      } catch { /* start blank */ }
      finally { loaded.current = true }
    })()
  }, [])

  // Debounced autosave — fires whenever a field changes after initial load.
  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any).from('brand_profiles').upsert({
          user_id: user.id,
          name: brandName.trim() || null,
          author_name: authorName.trim() || null,
          tagline: tagline.trim() || null,
          niches,
          tone,
          affiliate_disclaimer: disclaimer.trim() || null,
        }, { onConflict: 'user_id' })
        if (!error) { setSavedAt(Date.now()); onSaved() }
      } catch { /* transient */ }
    }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandName, authorName, tagline, niches, tone, disclaimer])

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  const inputCls = 'w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]/60'
  const PAGES = ['Basics', 'Niches & tone', 'Disclosure']

  return (
    <>
      <StepHeading
        title="Build your Brand Profile"
        blurb="This is what every generated post is branded with. Fill it out as completely as you can — it saves automatically as you go."
      />

      {/* In-card page dots */}
      <div className="flex items-center gap-2 mb-5">
        {PAGES.map((label, i) => (
          <button key={label} onClick={() => setPage(i)}
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: i === page ? '#fff' : '#6e6e73' }}>
            <span className="grid place-items-center w-5 h-5 rounded-full text-[10px] font-semibold"
              style={{ background: i === page ? ACCENT : 'rgba(255,255,255,0.08)', color: i === page ? '#fff' : '#a1a1a6' }}>{i + 1}</span>
            {label}
          </button>
        ))}
        {savedAt && <span className="ml-auto inline-flex items-center gap-1 text-xs text-[#34c759]"><Check size={12} /> Saved</span>}
      </div>

      {page === 0 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-[#c7c7cc] mb-1.5">Brand / site name</label>
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g. Gomin Reviews" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-[#c7c7cc] mb-1.5">Your name (the author)</label>
            <input value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="e.g. Seb" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-[#c7c7cc] mb-1.5">Tagline <span className="text-[#6e6e73]">(optional)</span></label>
            <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Honest hands-on reviews of the gear I actually use" className={inputCls} />
          </div>
        </div>
      )}

      {page === 1 && (
        <div className="flex flex-col gap-5">
          <div>
            <label className="block text-sm text-[#c7c7cc] mb-2">Your niches <span className="text-[#6e6e73]">(pick all that apply)</span></label>
            <div className="flex flex-wrap gap-2">
              {NICHES.map((n) => {
                const on = niches.includes(n)
                return (
                  <button key={n} onClick={() => toggle(niches, n, setNiches)}
                    className="rounded-full px-3 py-1.5 text-xs border transition-colors"
                    style={{ background: on ? ACCENT : 'transparent', borderColor: on ? ACCENT : 'rgba(255,255,255,0.14)', color: on ? '#fff' : '#c7c7cc' }}>
                    {n}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="block text-sm text-[#c7c7cc] mb-2">Tone of voice</label>
            <div className="flex flex-wrap gap-2">
              {TONE_OPTIONS.map((t) => {
                const on = tone.includes(t)
                return (
                  <button key={t} onClick={() => toggle(tone, t, setTone)}
                    className="rounded-full px-3 py-1.5 text-xs border transition-colors"
                    style={{ background: on ? ACCENT : 'transparent', borderColor: on ? ACCENT : 'rgba(255,255,255,0.14)', color: on ? '#fff' : '#c7c7cc' }}>
                    {t}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {page === 2 && (
        <div>
          <label className="block text-sm text-[#c7c7cc] mb-1.5">Affiliate disclosure</label>
          <p className="text-xs text-[#6e6e73] mb-2">Shown on your posts to stay FTC-compliant. A simple default works fine.</p>
          <textarea value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} rows={4}
            placeholder="As an Amazon Associate I earn from qualifying purchases. Some links on this site are affiliate links — if you buy through them I may earn a commission at no extra cost to you."
            className={inputCls} />
        </div>
      )}

      {/* In-card prev/next (separate from the funnel's step nav) */}
      <div className="flex items-center justify-between mt-6">
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
          className="text-sm text-[#a1a1a6] hover:text-white disabled:opacity-30 transition-colors">← Previous</button>
        {page < PAGES.length - 1
          ? <button onClick={() => setPage((p) => Math.min(PAGES.length - 1, p + 1))}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: ACCENT }}>Next →</button>
          : <span className="text-xs text-[#6e6e73]">All set — use “Save &amp; next” below to continue.</span>}
      </div>
    </>
  )
}

/* Step 5 — Voice Training, fully inline (2-page). Reuses GET/POST /api/learn
   (which UPDATEs brand_profiles), autosaved on debounce. Skippable. */
function VoiceStep({ onSaved }: { onSaved: () => void }) {
  const [page, setPage] = useState(0)
  const [bio, setBio] = useState('')
  const [audience, setAudience] = useState('')
  const [sample, setSample] = useState('')
  const [avoid, setAvoid] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const loaded = useRef(false)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/learn')
        if (res.ok) {
          const d = await res.json()
          setBio(d.author_bio ?? '')
          setAudience(d.target_audience ?? '')
          setSample(d.writing_sample ?? '')
          setAvoid(d.words_to_avoid ?? '')
        }
      } catch { /* start blank */ }
      finally { loaded.current = true }
    })()
  }, [])

  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/learn', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ author_bio: bio, target_audience: audience, writing_sample: sample, words_to_avoid: avoid }),
        })
        if (res.ok) { setSavedAt(Date.now()); onSaved() }
      } catch { /* transient */ }
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bio, audience, sample, avoid])

  const inputCls = 'w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]/60'
  const PAGES = ['You & your reader', 'Your voice']

  return (
    <>
      <StepHeading
        title="Train your writing voice"
        blurb="The difference between generic AI copy and posts that sound like you. Optional, but strongly recommended — and it saves as you type. You can refine it later."
      />
      <div className="flex items-center gap-2 mb-5">
        {PAGES.map((label, i) => (
          <button key={label} onClick={() => setPage(i)} className="flex items-center gap-1.5 text-xs transition-colors" style={{ color: i === page ? '#fff' : '#6e6e73' }}>
            <span className="grid place-items-center w-5 h-5 rounded-full text-[10px] font-semibold" style={{ background: i === page ? ACCENT : 'rgba(255,255,255,0.08)', color: i === page ? '#fff' : '#a1a1a6' }}>{i + 1}</span>
            {label}
          </button>
        ))}
        {savedAt && <span className="ml-auto inline-flex items-center gap-1 text-xs text-[#34c759]"><Check size={12} /> Saved</span>}
      </div>

      {page === 0 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-[#c7c7cc] mb-1.5">About you</label>
            <p className="text-xs text-[#6e6e73] mb-2">Your background and what makes you credible on your niches.</p>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} placeholder="I've been reviewing pet gear for 4 years and test every product with my own two dogs..." className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-[#c7c7cc] mb-1.5">Your target reader</label>
            <p className="text-xs text-[#6e6e73] mb-2">Who reads you, what they care about, what they already know.</p>
            <textarea value={audience} onChange={(e) => setAudience(e.target.value)} rows={4} placeholder="Busy pet owners comparing options before buying — they want a clear recommendation, not fluff." className={inputCls} />
          </div>
        </div>
      )}

      {page === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm text-[#c7c7cc] mb-1.5">Writing sample</label>
            <p className="text-xs text-[#6e6e73] mb-2">Paste something you’ve written that sounds exactly like you — MVP matches this voice.</p>
            <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={7} placeholder="Paste a few paragraphs in your own voice..." className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-[#c7c7cc] mb-1.5">Words &amp; phrases to avoid <span className="text-[#6e6e73]">(one per line)</span></label>
            <textarea value={avoid} onChange={(e) => setAvoid(e.target.value)} rows={3} placeholder={'game-changer\ngame changer\nin today’s world'} className={inputCls} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-6">
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="text-sm text-[#a1a1a6] hover:text-white disabled:opacity-30 transition-colors">← Previous</button>
        {page < PAGES.length - 1
          ? <button onClick={() => setPage((p) => Math.min(PAGES.length - 1, p + 1))} className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: ACCENT }}>Next →</button>
          : <span className="text-xs text-[#6e6e73]">Looks good — “Save &amp; next” below to continue.</span>}
      </div>
    </>
  )
}

/* Step 6 — Customize Blog, inline. The full editor has dozens of options (ads,
   footer, homepage picks, analytics); the funnel surfaces the two highest-impact
   "look" settings — the author trust block + post-date display — and saves them
   back through the SAME endpoint (GET the full customizations object, merge,
   POST). Everything else stays editable later in the full Customize Blog page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomizeStep({ onSaved }: { onSaved: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [cfg, setCfg] = useState<Record<string, any> | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const loaded = useRef(false)

  // Load the current customizations so we POST back the FULL object (never drop
  // the user's ads/footer/picks just because the funnel only edits two fields).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/wordpress/customizations')
        const data = res.ok ? await res.json() : {}
        setCfg({
          ...data,
          authorBlock: { enabled: true, name: '', tagline: '', photoUrl: '', linkUrl: '', linkLabel: 'More about me', ...(data.authorBlock || {}) },
          postMeta: { showDate: data?.postMeta?.showDate !== false },
        })
      } catch {
        setCfg({ authorBlock: { enabled: true, name: '', tagline: '', photoUrl: '', linkUrl: '', linkLabel: 'More about me' }, postMeta: { showDate: true } })
      } finally { loaded.current = true }
    })()
  }, [])

  // Debounced save of the full (merged) object.
  useEffect(() => {
    if (!loaded.current || !cfg) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/wordpress/customizations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
        })
        if (res.ok) { setSavedAt(Date.now()); onSaved() }
      } catch { /* transient — WP push best-effort */ }
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg])

  const inputCls = 'w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[#7C3AED]/60'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch = (fn: (c: any) => any) => setCfg((c) => c ? fn({ ...c }) : c)

  if (!cfg) {
    return (<><StepHeading title="Customize your blog" blurb="Loading your current settings…" /><Loader2 size={18} className="animate-spin text-[#a1a1a6]" /></>)
  }

  const author = cfg.authorBlock || {}
  const showDate = cfg.postMeta?.showDate !== false

  return (
    <>
      <StepHeading
        title="Customize your blog"
        blurb="Two quick settings that shape how every post reads. Everything else — colors, homepage picks, footer — you can fine-tune anytime in Customize Blog. Saves as you go."
      />

      {/* Author trust block */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <p className="font-semibold text-sm">Reviewer trust block</p>
          <button
            onClick={() => patch((c) => { c.authorBlock = { ...c.authorBlock, enabled: !author.enabled }; return c })}
            className="relative w-10 h-6 rounded-full transition-colors"
            style={{ background: author.enabled ? ACCENT : 'rgba(255,255,255,0.15)' }}
          >
            <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: author.enabled ? '18px' : '2px' }} />
          </button>
        </div>
        <p className="text-xs text-[#6e6e73] mb-3">A short “who reviewed this” intro at the top of every post — builds Google + AI-Overview trust (E-E-A-T). Recommended on.</p>
        {author.enabled && (
          <div className="flex flex-col gap-2">
            <input value={author.name || ''} onChange={(e) => patch((c) => { c.authorBlock = { ...c.authorBlock, name: e.target.value }; return c })} placeholder="Your name (e.g. Seb)" className={inputCls} />
            <input value={author.tagline || ''} onChange={(e) => patch((c) => { c.authorBlock = { ...c.authorBlock, tagline: e.target.value }; return c })} placeholder="Credibility line (e.g. I've tested 200+ kitchen gadgets)" className={inputCls} />
            <p className="text-[11px] text-[#6e6e73]">Your photo pulls from Brand Profile → Headshot automatically.</p>
          </div>
        )}
      </div>

      {/* Show dates */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="font-semibold text-sm">Show post dates</p>
          <button
            onClick={() => patch((c) => { c.postMeta = { ...c.postMeta, showDate: !showDate }; return c })}
            className="relative w-10 h-6 rounded-full transition-colors"
            style={{ background: showDate ? ACCENT : 'rgba(255,255,255,0.15)' }}
          >
            <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: showDate ? '18px' : '2px' }} />
          </button>
        </div>
        <p className="text-xs text-[#6e6e73]">{showDate ? 'Visible publish/updated dates on posts.' : 'Dates hidden — “evergreen” look. SEO freshness signals (schema) are kept either way.'}</p>
      </div>

      <div className="flex items-center justify-between mt-5">
        <a href="/customize" target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-sm text-[#a1a1a6] hover:text-white transition-colors">
          Fine-tune everything else (ads, footer, homepage) <ExternalLink size={13} />
        </a>
        {savedAt && <span className="inline-flex items-center gap-1 text-xs text-[#34c759]"><Check size={12} /> Saved</span>}
      </div>
    </>
  )
}

/* Step 7 — opens the existing editor in a new tab; funnel tracks completion */
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
