import Link from 'next/link'
import Image from 'next/image'
import { SALES_PAUSED, SALES_PAUSED_MESSAGE } from '@/lib/sales-paused'
import {
  CheckCircle,
  ArrowRight,
  Zap,
  Globe,
  Sparkles,
  Wand2,
  LayoutTemplate,
  Star,
  Tag,
  Play,
  ShieldCheck,
  Clock,
} from 'lucide-react'

// ─── Honest platform availability ──────────────────────────────────────────
// Live = working today. Soon = built / scoped, awaiting external approval.
// Roadmap = on the list, not promised by date.
// Order matters for the strip layout: Live -> Pro -> Soon -> Roadmap.
// With 10 platforms we render as a 5x2 grid for a clean split, with the
// "ship today" platforms on the top row.
const platforms = [
  // Top row — live integrations (WordPress + Facebook are on every plan;
  // Threads / Bluesky / LinkedIn unlock on Creator — see pricing).
  { label: 'WordPress',    status: 'live'    as const, color: '#21759b', logo: 'wordpress' },
  { label: 'Facebook',     status: 'live'    as const, color: '#1877f2', logo: 'facebook' },
  { label: 'Threads',      status: 'live'    as const, color: '#000000', logo: 'threads' },
  { label: 'Bluesky',      status: 'live'    as const, color: '#1185fe', logo: 'bluesky' },
  { label: 'LinkedIn',     status: 'live'    as const, color: '#0a66c2', logo: 'linkedin' },
  // Bottom row — Pro-gated, coming soon, roadmap
  { label: 'Instagram',    status: 'pro'     as const, color: '#E1306C', logo: 'instagram' },
  { label: 'Twitter / X',  status: 'pro'     as const, color: '#000000', logo: 'x' },
  { label: 'Telegram',     status: 'pro'     as const, color: '#229ED9', logo: 'telegram' },
  { label: 'Pinterest',    status: 'soon'    as const, color: '#e60023', logo: 'pinterest' },
  { label: 'Email digest', status: 'roadmap' as const, color: '#34c759', logo: 'email' },
]

const statusBadge: Record<typeof platforms[number]['status'], { text: string; bg: string; fg: string }> = {
  live:    { text: 'Live now',     bg: 'bg-[#34c759]/10',  fg: 'text-[#1f8a3a]' },
  pro:     { text: 'Pro plan',     bg: 'bg-[#0071e3]/10',  fg: 'text-[#0071e3]' },
  soon:    { text: 'Coming soon',  bg: 'bg-[#ff9500]/10',  fg: 'text-[#9a5d00]' },
  roadmap: { text: 'On roadmap',   bg: 'bg-gray-100',      fg: 'text-[#6e6e73]' },
}

const plans = [
  {
    tier: 'Free Trial',
    price: 0,
    regular: 0,
    limit: '5 posts — no card',
    bonus: '',
    features: ['Free themed review site', 'YouTube Co-Pilot autopilot', 'Facebook auto-post', 'No card · no time limit'],
    cta: 'Start free',
    href: '/signup',
    highlight: false,
  },
  {
    tier: 'Creator',
    price: 49,
    regular: 99,
    limit: '40 posts / month',
    bonus: '',
    features: ['Free themed review site', 'Facebook, Threads, Bluesky, LinkedIn, Pinterest *', 'In-body AI product images (up to 3 / post)', '5 brand-collab pitch emails / month', 'Built-in AI assistant that knows your brand — one less subscription'],
    cta: 'Get Creator',
    href: '/pricing',
    highlight: false,
  },
  {
    tier: 'Pro',
    price: 199,
    regular: 499,
    limit: '200 posts / month',
    bonus: '140 + 60 bonus posts',
    features: ['Everything in Creator', '100 brand-collab pitch emails / month', 'For Amazon influencers & associates — scout Creator Connections campaigns by commission & EPC, publish in one click', 'Native AI Instagram image — your face + the product, 4:5', 'Custom face training for AI thumbnails', 'Near-unlimited AI assistant that knows your business', 'Adds Instagram, X & Telegram', 'One-click Apply to YouTube (playlist, schedule, paid-promotion, made-for-kids)', 'One-click Publish All to socials', 'Priority support'],
    cta: 'Get Pro',
    href: '/pricing',
    highlight: true,
  },
]

const faqs = [
  {
    q: 'How does the YouTube workflow actually work?',
    a: 'Upload an unlisted draft to YouTube Studio. Dropping the Amazon ASIN in the title gives the most precise match, but it\'s optional — MVP detects the product from your title and description on its own. The agent team then generates the YouTube description (with your affiliate link), 10 SEO video tags, 5 hashtags, and a click-magnet thumbnail. One click pushes everything back into your YouTube draft. Pro adds one-click batch settings: playlist, schedule, paid-promotion disclosure, and made-for-kids flag.',
  },
  {
    q: 'Do I have to promote Amazon products?',
    a: 'No. Amazon is the easiest path, but if you promote a product on a brand site or store, just put that link in your video description — MVP uses it as your product link, wraps it with your Geniuslink for tracking, and writes the review and YouTube metadata around the real product. Not an Amazon associate? You\'re still fully covered.',
  },
  {
    q: 'Can I track my traffic with Google Analytics?',
    a: 'Yes. Add your GA4 Measurement ID (or a Google Tag Manager container) in Customize Blog and we inject the tracking for you — no code to paste. There\'s a step-by-step guide right in the dashboard, plus a clicks dashboard for your affiliate links when Geniuslink is connected.',
  },
  {
    q: 'Do I need my own WordPress site?',
    a: 'You need a domain and a WordPress install (any host — we test on Hostinger). Connect it once and we install the MVP Affiliate theme + plugin automatically. Your reviews land on a real editorial homepage from day one — no setup, no theme shopping, no plugin hunting.',
  },
  {
    q: 'Is the content AI-generated?',
    a: 'Yes — but not by a single chatbot. We orchestrate an army of specialized agents: one researches the product, one designs the outline for SEO, one matches your voice — trained from your Brand Profile and refined from the posts you publish (your Learning profile) — one drafts the body section by section, one writes the verdict + Buy/Skip block, one inserts affiliate links cleanly, one writes the FAQ, one tags and categorizes. The output is reviewed in Studio before publish — you always have the final say.',
  },
  {
    q: 'What\'s the built-in AI assistant?',
    a: 'A business-aware chat assistant included in every plan (with higher limits as you move up). It already knows your brand, your recent posts and campaigns, and helps with setup, affiliate strategy, and content questions. It remembers context across chats, and you can import your history from ChatGPT or Claude so it picks up where you left off — one less $20/mo subscription to keep.',
  },
  {
    q: 'What are the brand-collab pitch emails?',
    a: 'A Pro feature for landing brand deals. Name a brand or product you want to work with and we generate a personalized outreach email — built on your real storefront, Linktree and channel stats, with a brand-specific angle and your full cross-platform reach as proof of distribution. Pro includes up to 100 pitches a month; Creator gets a taster of 5 / month.',
  },
  {
    q: 'Do I own the content?',
    a: 'You own everything generated for your account. We don\'t reuse, resell, or train models on your content.',
  },
  {
    q: 'What happens after my 5 free posts?',
    a: 'You can upgrade to Creator or Pro to keep going — no time limit on the trial, so upgrade whenever you\'re ready. Your existing posts and connected site stay exactly as they are; nothing gets taken down.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes — one click in your billing portal. No contracts, no exit fees. You keep access through the end of the period you paid for.',
  },
  {
    q: 'Why is Pinterest "coming soon"?',
    a: 'Pinterest requires apps to pass their developer review before live API access. We\'re going through that process now. Once approved, every paid plan gets Pinterest auto-publish — no upgrade required.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-[#1d1d1f]">

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-6 py-3 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/mvp-affiliate-logo.png" alt="MVP Affiliate" width={36} height={36} className="rounded-xl" />
          <span className="font-semibold text-[#1d1d1f] hidden sm:inline">MVP Affiliate</span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <a
            href="https://mvp-affiliate.getrewardful.com/signup"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline-flex items-center gap-1.5 text-sm font-medium text-[#1f8a3a] hover:text-[#136b2c] transition-colors px-3 py-2"
            title="Earn 10% recurring for every creator you refer"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#34c759]" />
            Earn 10%
          </a>
          <Link href="/pricing" className="hidden sm:block text-sm text-[#6e6e73] hover:text-[#1d1d1f] transition-colors px-3 py-2">
            Pricing
          </Link>
          <Link href="/login" className="hidden sm:block text-sm text-[#6e6e73] hover:text-[#1d1d1f] transition-colors px-3 py-2">
            Sign in
          </Link>
          {SALES_PAUSED ? (
            <span className="text-sm font-semibold bg-gray-200 dark:bg-white/10 text-[#86868b] px-4 py-2 rounded-xl cursor-not-allowed" title={SALES_PAUSED_MESSAGE}>
              Sign-ups paused
            </span>
          ) : (
            <Link href="/signup" className="text-sm font-semibold bg-[#0071e3] hover:bg-[#0062c4] text-white px-4 py-2 rounded-xl transition-colors">
              Start free
            </Link>
          )}
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="pt-28 sm:pt-36 pb-12 sm:pb-20 px-5 sm:px-6 relative overflow-hidden bg-gradient-to-b from-[#f0f7ff] via-white to-white">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[600px] bg-[#0071e3]/8 rounded-full blur-[120px] pointer-events-none" />
        <div className="relative max-w-5xl mx-auto flex flex-col items-center text-center">

          {/* Free-posts pill */}
          <div className="inline-flex items-center gap-2 bg-white border border-[#0071e3]/20 rounded-full px-3 py-1.5 text-xs sm:text-sm text-[#0071e3] font-medium mb-6 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34c759] animate-pulse" />
            5 free posts. No card. No catch.
          </div>

          {/* Main title */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-10 text-[#1d1d1f]">
            Start your <span className="text-[#0071e3]">affiliate engine</span>!
          </h1>

          {/* Centered infographic */}
          <div className="relative w-full max-w-4xl mb-10">
            <Image
              src="/automation-hub.png"
              alt="MVP Affiliate automation hub — YouTube, Instagram, Facebook, Threads, LinkedIn, X, Pinterest, Bluesky, Telegram"
              width={1400}
              height={788}
              priority
              className="w-full h-auto rounded-2xl shadow-xl"
            />
          </div>

          {/* Subtext */}
          <p className="text-lg sm:text-xl text-[#3a3a3c] max-w-3xl mb-8 leading-relaxed">
            Record the video. We do everything else. From one unlisted YouTube draft, an army of
            AI agents ships a long-form, SEO-optimized review on your branded review site, a
            click-tuned YouTube description with affiliate links inserted cleanly, video tags and
            hashtags ranked for discovery, a click-magnet thumbnail — plus fan-out posts to
            Instagram (Reels, Feed posts and Stories), Facebook, Threads, LinkedIn, Pinterest, X,
            Bluesky and Telegram.
            <span className="font-semibold text-[#1d1d1f]"> Two clicks: one ships it to YouTube, one publishes the post + every social. ~2 hours of unpaid post-production per video → gone.</span>
          </p>

          {SALES_PAUSED && (
            <div className="mx-auto mb-5 max-w-2xl rounded-2xl bg-[#ff9500]/10 border border-[#ff9500]/30 px-5 py-3 text-center">
              <p className="text-sm font-semibold text-[#1d1d1f] mb-0.5">Sign-ups & purchases temporarily paused</p>
              <p className="text-xs text-[#6e6e73] leading-relaxed">{SALES_PAUSED_MESSAGE}</p>
            </div>
          )}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {SALES_PAUSED ? (
              <span className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gray-200 text-[#86868b] font-semibold px-7 py-3.5 rounded-2xl text-base cursor-not-allowed">
                Sign-ups paused — back soon
              </span>
            ) : (
              <Link href="/signup" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#0071e3] hover:bg-[#0062c4] text-white font-semibold px-7 py-3.5 rounded-2xl text-base transition-colors shadow-lg shadow-[#0071e3]/25">
                Start free — 5 posts <ArrowRight size={17} />
              </Link>
            )}
            <Link href="/pricing" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white hover:bg-gray-50 border border-gray-200 text-[#1d1d1f] font-semibold px-7 py-3.5 rounded-2xl text-base transition-colors">
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-sm text-[#86868b]">
            Includes a free themed review site · Cancel anytime
          </p>
        </div>
      </section>

      {/* ── Platform strip ─────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-20 border-y border-gray-100 bg-[#fafafa]">
        <div className="max-w-5xl mx-auto px-5 sm:px-6">
          <p className="text-center text-sm text-[#3a3a3c] mb-10 uppercase tracking-widest font-semibold">
            One click fans every review out to every platform that matters
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 max-w-4xl mx-auto">
            {platforms.map(({ label, status, color, logo }) => {
              const badge = statusBadge[status]
              return (
                <div
                  key={label}
                  className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-white border border-gray-100 hover:border-gray-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                >
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm"
                    style={{ background: color }}
                  >
                    <PlatformLogo name={logo} />
                  </div>
                  <span className="text-sm font-semibold text-[#1d1d1f] text-center leading-tight">{label}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full ${badge.bg} ${badge.fg}`}>
                    {badge.text}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-10 text-center text-sm text-[#3a3a3c] max-w-2xl mx-auto leading-relaxed">
            We only ship what works. Pinterest auto-publish is built and in Pinterest&apos;s developer
            review queue — activates automatically once approved. Email digests are on the roadmap.
            No false promises.
          </p>
        </div>
      </section>

      {/* ── YouTube Co-Pilot autopilot ─────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14 max-w-3xl mx-auto">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#ff0000] uppercase tracking-wider mb-3">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              For YouTubers
            </span>
            <h2 className="text-3xl sm:text-5xl font-bold mb-4 text-[#1d1d1f] leading-[1.1]">Your YouTube Co-Pilot, on autopilot.</h2>
            <p className="text-[#3a3a3c] text-lg sm:text-xl leading-relaxed">
              Save an unlisted draft in YouTube Studio. MVP Affiliate pulls the video, identifies the
              product — from your title, or the Amazon or store link in your description — deploys an
              agent team to write everything you&apos;d normally hate writing, and pushes the finished
              YouTube package back into Studio for you. The matching long-form review goes live on
              your branded site with one more click.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <StepCard
              n="01"
              icon={<Wand2 size={20} />}
              title="Save an unlisted draft"
              desc="Upload the video and save. Drop the Amazon ASIN in the title for an exact match, or just link the product (Amazon or any store) in the description — MVP figures out the rest. No description, no tags, no thumbnail, no hashtags. Walk away."
              accent="#ff0000"
            />
            <StepCard
              n="02"
              icon={<Sparkles size={20} />}
              title="The agent team builds everything"
              desc="A full editorial review for your site · a YouTube description with affiliate links · 10 SEO video tags · 5 hashtags · a click-magnet thumbnail. Written in your voice from your Brand Profile."
              accent="#5856d6"
            />
            <StepCard
              n="03"
              icon={<Globe size={20} />}
              title="Two clicks. Both platforms live."
              desc="Click 1 pushes the description, tags, hashtags and thumbnail back to YouTube. Click 2 publishes the review on your site and fans it out to every social you've connected — Instagram (Reels for Shorts, auto-composed image posts + Stories for long-form), Facebook, Threads, LinkedIn, Pinterest, X, Bluesky, Telegram."
              accent="#34c759"
            />
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-[#fff5f5] to-[#fff] border border-red-100 p-6 sm:p-8 text-center max-w-3xl mx-auto">
            <p className="text-sm font-semibold text-[#ff0000] mb-2 uppercase tracking-wider">The math creators care about</p>
            <p className="text-xl sm:text-2xl font-bold text-[#1d1d1f] leading-tight mb-2">
              ~2 hours of post-production per video → under 5 minutes
            </p>
            <p className="text-sm sm:text-base text-[#3a3a3c]">
              YouTube description, tag research, hashtag picking, thumbnail design, blog post writing,
              affiliate link insertion, social post copy for every platform — the unpaid tax on every
              upload. We run all of it, every time, while you record the next one.
            </p>
          </div>
        </div>
      </section>

      {/* ── Army of agents ─────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-[#0a0a0a] text-white relative overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-[#0071e3]/15 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-[#5856d6]/15 rounded-full blur-[120px] pointer-events-none" />
        <div className="relative max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="inline-block text-sm font-semibold text-[#4ea3ff] uppercase tracking-wider mb-4 px-3 py-1 rounded-full bg-[#0071e3]/15 border border-[#0071e3]/30">
              The MVP Affiliate difference
            </span>
            <h2 className="text-5xl sm:text-6xl md:text-7xl font-black mb-6 leading-[1.05] tracking-tight text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.8)]">
              An <span className="bg-gradient-to-r from-[#4ea3ff] to-[#a78bfa] bg-clip-text text-transparent">army of agents</span><br className="sm:hidden" /> on every review
            </h2>
            <p className="text-lg sm:text-xl text-gray-200 max-w-2xl mx-auto leading-relaxed">
              Other tools paste your prompt into one model and hope for the best. We orchestrate a team of
              specialized AI agents — each one focused on a single job, working together to produce a review
              that&apos;s genuinely worth publishing.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <AgentCard color="#0071e3" name="Researcher" job="Pulls product specs, pricing, reviews" />
            <AgentCard color="#5856d6" name="Outline Architect" job="Designs the review structure for SEO + flow" />
            <AgentCard color="#34c759" name="Voice Matcher" job="Reads your brand profile and writes in your tone" />
            <AgentCard color="#ff9500" name="Body Drafter" job="Writes the long-form review section by section" />
            <AgentCard color="#ff3b30" name="Verdict Builder" job="Writes the Buy/Skip + Quick Verdict block" />
            <AgentCard color="#af52de" name="Link Weaver" job="Inserts affiliate links cleanly into the body" />
            <AgentCard color="#5ac8fa" name="FAQ Author" job="Generates a relevant FAQ block from the body" />
            <AgentCard color="#ffcc00" name="Tag & Categorize" job="SEO tags, internal categories, social hashtags" />
          </div>

          <p className="mt-10 text-center text-base text-gray-400 max-w-2xl mx-auto">
            Every agent feeds the next. The result lands in your Studio, ready for you to review and publish.
            You always have the final say before anything goes live.
          </p>

          {/* Fact-grounded trust line */}
          <div className="mt-8 max-w-2xl mx-auto rounded-2xl border border-[#34c759]/30 bg-[#34c759]/5 px-6 py-5 text-center">
            <p className="text-sm font-semibold text-white mb-1.5 flex items-center justify-center gap-2">
              <ShieldCheck size={16} className="text-[#34c759]" /> Fact-grounded — never made up
            </p>
            <p className="text-sm text-gray-300 leading-relaxed">
              Every quote, number, and claim traces back to your actual video transcript and the real product page. The agents won&apos;t invent a personal story you never told or specs that don&apos;t exist — unlike a generic AI writer that hallucinates to fill space. Your reviews stay true to what you actually said.
            </p>
          </div>
        </div>
      </section>

      {/* ── Instagram fan-out (Pro flagship) ───────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-gradient-to-b from-white via-[#fef6f9] to-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14 max-w-3xl mx-auto">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-3 px-3 py-1 rounded-full bg-gradient-to-r from-[#f09433]/15 via-[#dc2743]/15 to-[#bc1888]/15 border border-[#dc2743]/30 text-[#bc1888]">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 5.838c3.405 0 6.162 2.76 6.162 6.162 0 3.405-2.76 6.162-6.162 6.162-3.405 0-6.162-2.76-6.162-6.162 0-3.405 2.76-6.162 6.162-6.162zM12 16c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/></svg>
              Pro flagship · Instagram fan-out
            </span>
            <h2 className="text-3xl sm:text-5xl font-bold mb-4 text-[#1d1d1f] leading-[1.1]">
              Every review, automatically on Instagram.
            </h2>
            <p className="text-[#3a3a3c] text-lg sm:text-xl leading-relaxed">
              Most affiliate tools stop at the blog post. We go further — one click and your review
              lands on your Instagram feed and Stories, formatted for each surface, with captions
              and hashtags written in your voice. No Canva, no manual upload, no copy-pasting links.
            </p>
          </div>

          {/* Two flows side-by-side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
            {/* Vertical Shorts → Reels */}
            <div className="rounded-2xl bg-white border border-gray-200 p-6 sm:p-7 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: 'linear-gradient(45deg, #f09433 0%, #dc2743 50%, #bc1888 100%)' }}>
                  9:16
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#bc1888]">Vertical Shorts</p>
              </div>
              <h3 className="text-xl font-bold text-[#1d1d1f] mb-2 leading-tight">Your YouTube Shorts → Instagram Reels + Stories</h3>
              <p className="text-sm text-[#3a3a3c] leading-relaxed mb-4">
                Upload your vertical MP4 once. We post it as a Reel with an AI-written caption (hook + 20 hashtags tuned for Instagram SEO) and as a Story so you can drop a Link sticker for affiliate clicks.
              </p>
              <ul className="text-[13px] text-[#3a3a3c] space-y-2">
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" /> Reel caption matches your brand voice</li>
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" /> Preview & edit before publishing</li>
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" /> Affiliate URL surfaced for Story sticker</li>
              </ul>
            </div>

            {/* Horizontal → Image post */}
            <div className="rounded-2xl bg-white border border-gray-200 p-6 sm:p-7 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: 'linear-gradient(45deg, #f09433 0%, #dc2743 50%, #bc1888 100%)' }}>
                  4:5
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#bc1888]">Long-form videos</p>
              </div>
              <h3 className="text-xl font-bold text-[#1d1d1f] mb-2 leading-tight">Your long-form video → a native AI Instagram image</h3>
              <p className="text-sm text-[#3a3a3c] leading-relaxed mb-4">
                Generate a fresh 1080×1350 feed image built for Instagram — your trained face holding the product, a punchy headline overlay, brand-tuned. Or auto-compose one from your thumbnail + brand colors. Either way: zero Canva, zero design work.
              </p>
              <ul className="text-[13px] text-[#3a3a3c] space-y-2">
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" /> AI image with your real face + the actual product</li>
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" /> 👍 / 👎 the result — the style picker learns your taste</li>
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" /> Regenerate any time, no Canva subscription</li>
              </ul>
            </div>
          </div>

          {/* CTA card */}
          <div className="rounded-2xl p-6 sm:p-8 text-center max-w-3xl mx-auto border border-[#dc2743]/20" style={{ background: 'linear-gradient(135deg, #fff5f8 0%, #fef6f0 100%)' }}>
            <p className="text-sm font-semibold mb-2 uppercase tracking-wider" style={{ color: '#bc1888' }}>Pro plan</p>
            <p className="text-xl sm:text-2xl font-bold text-[#1d1d1f] leading-tight mb-3">
              The only tool that closes the Instagram loop
            </p>
            <p className="text-sm sm:text-base text-[#3a3a3c] mb-5 max-w-xl mx-auto">
              Other affiliate tools leave Instagram as a manual chore. We compose, write, and publish — feed and Stories — from the same source. Pro plan unlocks the full fan-out.
            </p>
            <Link href="/pricing" className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: 'linear-gradient(45deg, #f09433 0%, #dc2743 50%, #bc1888 100%)' }}>
              See Pro pricing <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Collaborations / brand deals (Pro) ─────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14 max-w-3xl mx-auto">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-3 px-3 py-1 rounded-full bg-[#34c759]/10 text-[#1f8a3a]">
              Pro flagship · Brand collaborations
            </span>
            <h2 className="text-3xl sm:text-5xl font-bold mb-4 text-[#1d1d1f] leading-[1.1]">
              Don&apos;t just publish reviews. Land the brand deals.
            </h2>
            <p className="text-[#3a3a3c] text-lg sm:text-xl leading-relaxed">
              The hardest part of affiliate income isn&apos;t the content — it&apos;s getting brands to
              say yes. Pro generates personalized brand-collab pitch emails built on a method that
              actually lands partnerships: your real numbers, your platforms, a specific angle for
              each brand. Up to 100 pitches a month.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <StepCard
              n="01"
              icon={<Wand2 size={20} />}
              title="Tell us the brand"
              desc="Drop in the brand or product you want to work with. We pull your storefront, Linktree and channel stats to build your pitch from real data."
              accent="#34c759"
            />
            <StepCard
              n="02"
              icon={<Sparkles size={20} />}
              title="We write the pitch"
              desc="A personalized outreach email with a brand-specific angle, your reach across every platform, and a clean ask — written in your voice, not a generic template."
              accent="#0071e3"
            />
            <StepCard
              n="03"
              icon={<ArrowRight size={20} />}
              title="Send + track"
              desc="Copy, tweak, send. When a brand asks 'where will this go?', your answer is a list of live placements across YouTube, your site, and 8 socials — not a promise."
              accent="#5856d6"
            />
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-[#f0fff4] to-[#fff] border border-[#34c759]/20 p-6 sm:p-8 text-center max-w-3xl mx-auto">
            <p className="text-sm font-semibold text-[#1f8a3a] mb-2 uppercase tracking-wider">Why it works</p>
            <p className="text-xl sm:text-2xl font-bold text-[#1d1d1f] leading-tight mb-2">
              Brands fund creators who can prove distribution.
            </p>
            <p className="text-sm sm:text-base text-[#3a3a3c]">
              Every review you ship already fans out to YouTube, your branded site, and every connected
              social. That footprint IS your pitch — and Pro turns it into outreach that converts.
            </p>
          </div>
        </div>
      </section>

      {/* ── What's in every review (anatomy) ───────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-gradient-to-b from-[#f7f9fc] to-white border-y border-gray-100">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-[#1d1d1f]">A full editorial review. Every time.</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg max-w-2xl mx-auto">
              Not a wall of AI slop. A structured, conversion-built review with the same anatomy
              Wirecutter and Tom&apos;s Guide use — disclaimer, embedded video, scannable verdict,
              buy/skip, Q&amp;A, rating box, internal tags. Ready to outrank thin affiliate sites.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
            {/* Annotated review mockup */}
            <div className="lg:col-span-3">
              <ReviewAnatomy />
            </div>

            {/* Callouts */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <AnatomyCallout
                n={1}
                icon={<ShieldCheck size={16} />}
                title="Affiliate disclaimer"
                desc="Auto-inserted above every review. Compliant by default."
              />
              <AnatomyCallout
                n={2}
                icon={<Play size={16} />}
                title="Embedded YouTube review"
                desc="If you linked a video, it shows in a custom 'Watch Our Review' block."
              />
              <AnatomyCallout
                n={3}
                icon={<CheckCircle size={16} />}
                title="Quick verdict + Buy/Skip"
                desc="The block readers actually scroll to. Generated from your take."
              />
              <AnatomyCallout
                n={4}
                icon={<Sparkles size={16} />}
                title="Body with built-in affiliate links"
                desc="Geniuslink-friendly. CTAs styled, not pasted as raw text."
              />
              <AnatomyCallout
                n={5}
                icon={<Star size={16} />}
                title="Final rating box"
                desc="A scannable verdict block, color-matched to your theme."
              />
              <AnatomyCallout
                n={6}
                icon={<Tag size={16} />}
                title="Tags + categories"
                desc="Auto-tagged for SEO and internal site discovery."
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── The site you get ───────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-white">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0071e3] uppercase tracking-wider mb-3">
              <LayoutTemplate size={14} /> Included on every plan
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-[#1d1d1f]">A real editorial site, not a default blog</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg mb-6 leading-relaxed">
              Connect your domain and we install the MVP Affiliate WordPress theme + plugin in one
              step — no themes to shop for, no widgets to wire. You get an editorial homepage with a
              rotating Pick of the Day, a 4-post featured grid, category hubs, sidebar + in-content
              ad slots you control, and a footer wired to your bio, logo and socials. Brand colors,
              fonts and tone of voice all flow from your Brand Profile — every new review lands
              styled and on-brand without you opening WordPress once.
            </p>
            <ul className="flex flex-col gap-3 mb-6">
              <FeatureLine>Editorial hero + 4-post featured grid on the homepage</FeatureLine>
              <FeatureLine>&quot;Pick of the Day&quot; rotating featured post (12h / 24h / pinned)</FeatureLine>
              <FeatureLine>Sidebar + in-content ad blocks you control from the dashboard</FeatureLine>
              <FeatureLine>Logo banner, social icons, brand colors + fonts</FeatureLine>
              <FeatureLine>Mobile-first layout, fast page loads, clean URLs</FeatureLine>
            </ul>
            {SALES_PAUSED ? (
              <span className="inline-flex items-center gap-2 text-[#86868b] font-semibold cursor-not-allowed">
                Sign-ups paused — back soon
              </span>
            ) : (
              <Link href="/signup" className="inline-flex items-center gap-2 text-[#0071e3] font-semibold hover:gap-3 transition-all">
                Start with the themed site free <ArrowRight size={16} />
              </Link>
            )}
          </div>

          <SitePreviewFrame />
        </div>
      </section>

      {/* ── Stack consolidation pitch ───────────────────────────────────────
          Honest, concrete cost comparison: the 5 tools an active affiliate
          creator is already paying for, vs MVP doing it all in one. This is
          a price-pressure pitch (you're already spending this elsewhere),
          distinct from the "How we stack up" capability comparison below. */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-gradient-to-b from-[#f7f9fc] to-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14 max-w-3xl mx-auto">
            <span className="inline-block text-xs font-bold text-[#0071e3] uppercase tracking-wider mb-3 px-3 py-1 rounded-full bg-[#0071e3]/10">
              Stack consolidation
            </span>
            <h2 className="text-3xl sm:text-5xl font-bold mb-4 text-[#1d1d1f] leading-[1.1]">
              You&apos;re already paying <span className="text-[#0071e3]">$223/mo</span> for this.
            </h2>
            <p className="text-[#3a3a3c] text-lg sm:text-xl leading-relaxed">
              Most active affiliate creators are running 5 separate tools to do what MVP does in one click.
              None of them talk to each other. We checked the math — yours probably looks like this.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-6 lg:gap-8 items-center">

            {/* LEFT — the current stack */}
            <div className="rounded-2xl bg-white border border-gray-200 p-6 sm:p-7 shadow-sm">
              <p className="text-xs font-semibold text-[#86868b] uppercase tracking-wider mb-4">Your stack today</p>
              <div className="flex flex-col gap-3.5">
                <StackTool emoji="🔗" name="Lasso" job="Affiliate link mgmt + WordPress display blocks" price="$49/mo" />
                <StackTool emoji="✍️" name="Surfer SEO" job="AI-written long-form review articles" price="$89/mo" />
                <StackTool emoji="📅" name="Buffer (Team)" job="Schedule social posts to 8+ channels" price="$50/mo" />
                <StackTool emoji="🎯" name="TubeBuddy Pro" job="YouTube metadata, tags, hashtag research" price="$20/mo" />
                <StackTool emoji="🎨" name="Canva Pro" job="Thumbnails + Instagram image posts" price="$15/mo" />
              </div>
              <div className="mt-5 pt-5 border-t border-gray-200 flex items-baseline justify-between">
                <span className="text-sm font-semibold text-[#1d1d1f]">Total per month</span>
                <span className="text-3xl font-bold text-[#1d1d1f]">$223</span>
              </div>
              <p className="text-[11px] text-[#86868b] mt-2 leading-relaxed">
                And they don&apos;t talk to each other. You&apos;re the integration layer.
              </p>
            </div>

            {/* MIDDLE — divider with arrow */}
            <div className="flex lg:flex-col items-center justify-center gap-2 py-2">
              <span className="hidden lg:block text-xs font-bold text-[#86868b] uppercase tracking-widest">vs</span>
              <ArrowRight size={28} className="text-[#0071e3] hidden lg:block" />
              <span className="lg:hidden text-xs font-bold text-[#86868b] uppercase tracking-widest">↓ becomes ↓</span>
            </div>

            {/* RIGHT — MVP all-in-one */}
            <div
              className="rounded-2xl p-6 sm:p-7 shadow-xl text-white relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #0071e3 0%, #5856d6 100%)' }}
            >
              <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-3xl pointer-events-none" />
              <p className="relative text-xs font-semibold text-white/80 uppercase tracking-wider mb-4">One tool. Same job.</p>
              <div className="relative flex flex-col gap-3">
                <StackPerk label="Affiliate link mgmt + branded WordPress site" />
                <StackPerk label="AI-written reviews in your brand voice" />
                <StackPerk label="Auto-post to Facebook, Threads, Bluesky, LinkedIn, Pinterest" />
                <StackPerk label="YouTube metadata + tags + click-magnet thumbnail" />
                <StackPerk label="In-body AI product images on every review" />
                <StackPerk label="Affiliate disclaimer + Geniuslink routing built in" />
              </div>
              <div className="relative mt-5 pt-5 border-t border-white/20 flex items-baseline justify-between">
                <span className="text-sm font-semibold">Creator plan</span>
                <span className="text-3xl font-bold">$49<span className="text-base font-medium">/mo</span></span>
              </div>
              <p className="relative text-[11px] text-white/80 mt-2 leading-relaxed">
                Pro at $199 adds Instagram, X &amp; Telegram, the native AI Instagram image (your face + the product), face training, and one-click Publish All.
              </p>
            </div>
          </div>

          {/* Bottom savings callout */}
          <div className="mt-10 rounded-2xl bg-[#34c759]/10 border border-[#34c759]/30 px-6 py-5 max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] mb-1">Save $174/month switching to Creator.</p>
              <p className="text-xs text-[#3a3a3c]">That&apos;s $2,088/year — plus the time you stop spending integrating five dashboards.</p>
            </div>
            <Link
              href="/pricing"
              className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#34c759] hover:bg-[#2db34a] transition-colors"
            >
              See pricing <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Comparison table ───────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-[#1d1d1f]">How we stack up</h2>
            <p className="text-[#3a3a3c] text-base sm:text-lg max-w-2xl mx-auto">
              The honest comparison nobody else will show you. No generic AI writer, freelancer, or
              DIY WordPress setup covers the full creator workflow end-to-end.
            </p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="w-full text-left text-base min-w-[640px]">
              <thead>
                <tr className="bg-[#f7f9fc] text-sm uppercase tracking-wider text-[#6e6e73]">
                  <th className="p-4 font-semibold">What you need</th>
                  <th className="p-4 font-semibold text-[#0071e3]">MVP Affiliate</th>
                  <th className="p-4 font-semibold">Generic AI writer</th>
                  <th className="p-4 font-semibold">Hire a freelance writer</th>
                  <th className="p-4 font-semibold">DIY in WordPress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <CompareRow label="Full long-form review draft" us="check" gen="check" free="check" diy="manual" />
                <CompareRow label="Editorial WordPress theme included" us="check" gen="cross" free="cross" diy="cross" />
                <CompareRow label="YouTube description + tags + hashtags" us="check" gen="manual" free="manual" diy="manual" />
                <CompareRow label="One-click push back to YouTube Studio" us="check" gen="cross" free="cross" diy="cross" />
                <CompareRow label="Click-magnet thumbnail generated" us="check" gen="cross" free="cross" diy="cross" />
                <CompareRow label="Verdict + rating + Buy/Skip blocks built in" us="check" gen="manual" free="manual" diy="manual" />
                <CompareRow label="Affiliate disclaimer auto-inserted" us="check" gen="cross" free="manual" diy="manual" />
                <CompareRow label="One-click publish to WordPress" us="check" gen="cross" free="manual" diy="manual" />
                <CompareRow label="Fan-out to FB / Threads / LI / Pinterest / X / Bluesky / Telegram / Instagram" us="check" gen="manual" free="manual" diy="cross" />
                <CompareRow label="Native AI Instagram image — your face + the product" us="check" gen="cross" free="cross" diy="cross" />
                <CompareRow label="Brand-collab pitch emails to land deals" us="check" gen="cross" free="cross" diy="cross" />
                <CompareRow label="Stays in your brand voice across posts" us="check" gen="manual" free="manual" diy="manual" />
                <CompareRow label="Only writes what's actually in your video — no invented stories" us="check" gen="cross" free="manual" diy="manual" />
                <CompareRow label="Cost per 30 reviews / month" us="$49" gen="$30–80" free="$600–3000" diy="Your time" />
              </tbody>
            </table>
          </div>
          <p className="mt-5 text-center text-sm text-[#6e6e73]">
            <strong>check</strong> = handled for you · <strong>manual</strong> = possible but you do the work · <strong>cross</strong> = not supported
          </p>
        </div>
      </section>

      {/* ── Pricing teaser ─────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-gradient-to-b from-white to-[#f7f9fc]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <span className="inline-block text-xs font-semibold text-[#34c759] uppercase tracking-wider mb-2">
              Early access pricing — locked in for life
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-[#1d1d1f]">Pick a plan that fits your output</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg">Every paid plan includes a free themed review site. Cancel anytime.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {plans.map((plan) => (
              <div
                key={plan.tier}
                className={`rounded-2xl p-7 flex flex-col ${
                  plan.highlight
                    ? 'bg-[#0071e3] text-white shadow-2xl scale-[1.03]'
                    : 'bg-white border border-gray-200 shadow-sm'
                }`}
              >
                {plan.highlight && (
                  <div className="flex items-center gap-1.5 mb-3">
                    <Zap size={12} className="text-yellow-300" />
                    <span className="text-[10px] font-semibold text-yellow-300 uppercase tracking-wide">Most Popular</span>
                  </div>
                )}
                <p className={`text-xs font-semibold mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b]'}`}>{plan.tier}</p>
                <div className="flex items-end gap-1.5 mb-1">
                  <span className="text-4xl font-bold">${plan.price}</span>
                  {plan.price > 0 && (
                    <span className={`text-xs mb-1.5 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b]'}`}>/mo</span>
                  )}
                </div>
                {plan.regular > plan.price && (
                  <p className={`text-[11px] mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b]'}`}>
                    <span className="line-through">${plan.regular}/mo</span>{' '}
                    <span className={plan.highlight ? 'text-yellow-300 font-semibold' : 'text-[#34c759] font-semibold'}>
                      save ${plan.regular - plan.price}
                    </span>
                  </p>
                )}
                <p className={`text-sm font-medium ${plan.highlight ? 'text-blue-100' : 'text-[#0071e3]'}`}>{plan.limit}</p>
                {plan.bonus && (
                  <p className={`text-xs font-medium mb-3 ${plan.highlight ? 'text-yellow-300' : 'text-[#34c759]'}`}>
                    ↑ {plan.bonus}
                  </p>
                )}
                {!plan.bonus && <div className="mb-3" />}
                <ul className="flex flex-col gap-2 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px]">
                      <CheckCircle size={13} className={`mt-0.5 flex-shrink-0 ${plan.highlight ? 'text-blue-200' : 'text-[#34c759]'}`} />
                      <span className={plan.highlight ? 'text-blue-50' : 'text-[#1d1d1f]'}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.href}
                  className={`w-full py-2.5 rounded-xl font-semibold text-sm text-center transition-colors ${
                    plan.highlight
                      ? 'bg-white text-[#0071e3] hover:bg-blue-50'
                      : 'bg-[#0071e3] text-white hover:bg-[#0062c4]'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-sm text-[#86868b]">
            * Pinterest auto-publish is built and waiting on Pinterest&apos;s developer review.
            Included on Creator &amp; Pro at no extra cost once approved.
          </p>
          <div className="mt-6 max-w-2xl mx-auto rounded-2xl bg-[#0071e3]/5 border border-[#0071e3]/20 p-5">
            <p className="text-center text-sm font-semibold text-[#0071e3] mb-1.5">🔒 Price-lock guarantee</p>
            <p className="text-center text-sm text-[#3a3a3c] leading-relaxed">
              When you subscribe at these Early Access rates, your price stays locked in for as long as
              you keep your plan — even if we raise prices later. The rate only changes if you choose to
              upgrade or downgrade tiers.
            </p>
          </div>
          <p className="mt-3 text-center text-sm text-[#86868b] dark:text-[#8e8e93]">
            Want all the details? <Link href="/pricing" className="text-[#0071e3] font-semibold hover:underline">See full pricing →</Link>
          </p>
        </div>
      </section>

      {/* ── FAQ ────────────────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-[#1d1d1f]">Questions, answered honestly</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg">No fluff. No spin.</p>
          </div>
          <div className="flex flex-col gap-3">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-xl border border-gray-200 bg-white p-6 hover:border-[#0071e3]/40 transition-colors">
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <span className="text-lg font-semibold text-[#1d1d1f]">{f.q}</span>
                  <span className="text-[#86868b] group-open:rotate-180 transition-transform">
                    <ArrowRight size={18} className="rotate-90" />
                  </span>
                </summary>
                <p className="mt-3 text-base text-[#3a3a3c] leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Affiliate / referral program ────────────────────────────────────
          Two doors at the bottom of the page: buy below, or earn here.
          Rewardful-hosted signup; we never see card data, payouts are
          managed by Rewardful + Stripe. 10% recurring lifetime. */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-gradient-to-b from-white to-[#f0fff4]">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-3xl border border-[#34c759]/30 bg-white p-8 sm:p-12 shadow-sm relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-72 h-72 bg-[#34c759]/15 rounded-full blur-3xl pointer-events-none" />

            <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-center">
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-4 px-3 py-1 rounded-full bg-[#34c759]/15 text-[#1f8a3a]">
                  Affiliate program
                </span>
                <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-[#1d1d1f] leading-[1.1]">
                  Refer a creator. Earn <span className="text-[#34c759]">10% every month</span>, forever.
                </h2>
                <p className="text-[#3a3a3c] text-base sm:text-lg leading-relaxed mb-6">
                  Send creators our way — every paying customer you refer pays you 10% of their plan
                  for as long as they stay. Not a one-time bounty. Not a 90-day cookie. Recurring
                  commission for the lifetime of the membership.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <ReferralStat label="Per Pro referral" value="$19.90/mo" sub="forever" />
                  <ReferralStat label="10 Pro referrals" value="$199/mo" sub="$2,388/year" />
                  <ReferralStat label="50 Pro referrals" value="$995/mo" sub="$11,940/year" />
                </div>

                <ul className="text-sm text-[#3a3a3c] flex flex-col gap-1.5 mb-1">
                  <li className="flex items-start gap-2">
                    <CheckCircle size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" /> Tracked + paid out by Rewardful — automatic, transparent, no spreadsheets
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" /> Personal dashboard with real-time clicks, signups, and earnings
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" /> Net-30 payouts via PayPal or Wise — no minimum threshold
                  </li>
                </ul>
              </div>

              {/* CTA card */}
              <div className="lg:w-64 flex flex-col gap-4">
                <a
                  href="https://mvp-affiliate.getrewardful.com/signup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 px-6 py-4 rounded-2xl text-base font-semibold text-white bg-[#34c759] hover:bg-[#2db34a] transition-colors shadow-lg shadow-[#34c759]/30"
                >
                  Join the program <ArrowRight size={17} />
                </a>
                <p className="text-xs text-[#86868b] text-center leading-relaxed">
                  Free to join. Takes 60 seconds. You don&apos;t need to be a customer.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-gradient-to-br from-[#0071e3] to-[#5856d6] text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-5xl font-bold mb-4 leading-[1.1]">Stop writing descriptions. Start shipping reviews.</h2>
          <p className="text-blue-100 text-base sm:text-lg mb-8 max-w-xl mx-auto">
            One YouTube draft → a full review site, an optimized YouTube package, and social posts
            on every platform. 5 free posts. No card. Cancel anytime.
          </p>
          {SALES_PAUSED ? (
            <span className="inline-flex items-center justify-center gap-2 bg-white/40 text-white font-semibold px-8 py-4 rounded-2xl text-base shadow-2xl cursor-not-allowed">
              Sign-ups paused — back soon
            </span>
          ) : (
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 bg-white hover:bg-blue-50 text-[#0071e3] font-semibold px-8 py-4 rounded-2xl text-base transition-colors shadow-2xl"
            >
              Start free <ArrowRight size={17} />
            </Link>
          )}
          <p className="mt-5 text-sm text-blue-100/80 flex items-center justify-center gap-1.5">
            <Clock size={13} /> Most users publish their first review within 15 minutes of signing up.
          </p>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 py-10 px-5 sm:px-6 bg-white">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image src="/mvp-affiliate-logo.png" alt="MVP Affiliate" width={28} height={28} className="rounded-lg" />
            <span className="text-sm font-semibold text-[#1d1d1f]">MVP Affiliate</span>
            <span className="text-xs text-[#86868b] ml-2">© {new Date().getFullYear()} Gomin Planet Holdings Ltd</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-[#86868b] flex-wrap justify-center">
            <Link href="/pricing" className="hover:text-[#1d1d1f]">Pricing</Link>
            <a
              href="https://mvp-affiliate.getrewardful.com/signup"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1f8a3a] hover:text-[#136b2c] font-medium inline-flex items-center gap-1"
            >
              <span className="w-1 h-1 rounded-full bg-[#34c759]" />
              Affiliate program
            </a>
            <Link href="/privacy" className="hover:text-[#1d1d1f]">Privacy</Link>
            <Link href="/terms" className="hover:text-[#1d1d1f]">Terms</Link>
            <Link href="/login" className="hover:text-[#1d1d1f]">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ─── Building-block components ─────────────────────────────────────────────

function StepCard({ n, icon, title, desc, accent }: { n: string; icon: React.ReactNode; title: string; desc: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-7 hover:shadow-lg hover:border-gray-200 transition-all">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
          style={{ background: accent }}
        >
          {icon}
        </div>
        <span className="text-2xl font-bold text-gray-200">{n}</span>
      </div>
      <h3 className="text-xl font-semibold text-[#1d1d1f] mb-2">{title}</h3>
      <p className="text-base text-[#3a3a3c] leading-relaxed">{desc}</p>
    </div>
  )
}

function FeatureLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-base text-[#1d1d1f]">
      <CheckCircle size={17} className="text-[#34c759] mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </li>
  )
}

/** Single row in the "your current stack" card — emoji, name, job, price. */
function StackTool({ emoji, name, job, price }: { emoji: string; name: string; job: string; price: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xl flex-shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1d1d1f] leading-tight">{name}</p>
        <p className="text-[11px] text-[#6e6e73] leading-snug truncate">{job}</p>
      </div>
      <span className="text-sm font-bold text-[#1d1d1f] tabular-nums flex-shrink-0">{price}</span>
    </div>
  )
}

/** Small stat tile for the affiliate program section — label + big value + sub. */
function ReferralStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-[#34c759]/8 border border-[#34c759]/20 p-3.5">
      <p className="text-[10px] font-semibold text-[#1f8a3a] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold text-[#1d1d1f] tabular-nums leading-none">{value}</p>
      <p className="text-[11px] text-[#6e6e73] mt-1">{sub}</p>
    </div>
  )
}

/** Single check-mark line in the MVP "one tool" card. */
function StackPerk({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-white">
      <CheckCircle size={15} className="text-[#34c759] mt-0.5 flex-shrink-0" />
      <span className="leading-snug">{label}</span>
    </div>
  )
}

function AnatomyCallout({ n, icon, title, desc }: { n: number; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-white border border-gray-100 hover:border-[#0071e3]/30 transition-colors">
      <span className="w-7 h-7 rounded-full bg-[#0071e3] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
        {n}
      </span>
      <div className="flex-1">
        <p className="flex items-center gap-1.5 text-base font-semibold text-[#1d1d1f]">
          <span className="text-[#0071e3]">{icon}</span>
          {title}
        </p>
        <p className="text-sm text-[#3a3a3c] mt-1 leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}

/** Hero browser-frame mockup: shows the homepage shape of a real review site. */
function BrowserFrame() {
  return (
    <div className="relative">
      {/* Stacked depth shadow */}
      <div className="absolute inset-2 rounded-2xl bg-[#0071e3]/10 blur-2xl" />
      <div className="relative rounded-2xl shadow-2xl bg-white border border-gray-200 overflow-hidden">
        {/* Browser chrome */}
        <div className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-50 border-b border-gray-100">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          <div className="ml-3 flex-1 bg-white border border-gray-200 rounded-md px-2 py-0.5 text-[10px] text-[#86868b] font-mono">
            yourdomain.com
          </div>
        </div>
        {/* Site preview */}
        <div className="bg-white">
          {/* Utility bar */}
          <div className="bg-black text-white text-[9px] py-1.5 px-3 flex justify-between">
            <span className="opacity-80">This site contains affiliate links.</span>
            <span className="flex gap-1.5"><span>▶</span><span>○</span></span>
          </div>
          {/* Logo banner */}
          <div className="bg-black py-3 flex justify-center">
            <div className="w-10 h-10 rounded-full bg-[#7dc3c8] flex items-center justify-center text-[10px] font-bold">LG</div>
          </div>
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-serif font-bold text-[#1d1d1f]">Your Review Site</p>
              <p className="text-[8px] text-[#86868b] uppercase tracking-wider">Honest takes on the gear you buy</p>
            </div>
            <div className="flex gap-2 text-[9px] text-[#6e6e73]">
              <span>Reviews</span>
              <span>Categories</span>
            </div>
          </div>
          {/* Hero */}
          <div className="px-4 py-5 text-center">
            <p className="font-serif text-lg font-bold leading-tight">Your Review Site</p>
            <p className="text-[10px] text-[#86868b] mt-0.5">Honest takes on the gear you buy</p>
          </div>
          {/* Featured grid */}
          <div className="px-3 pb-4 grid grid-cols-2 gap-2">
            <div className="row-span-2 rounded bg-gradient-to-br from-orange-200 to-orange-100 aspect-[3/4] p-2 flex flex-col justify-end">
              <span className="text-[8px] font-bold bg-white px-1.5 py-0.5 rounded uppercase w-fit">Review</span>
              <p className="text-[10px] font-bold mt-1 leading-tight">The Anti-Fatigue Mat That Saved Our Kitchen</p>
            </div>
            <div className="rounded bg-gradient-to-br from-blue-200 to-blue-100 aspect-video p-2 flex flex-col justify-end">
              <p className="text-[8px] font-bold leading-tight">Cleansing Balm Review</p>
            </div>
            <div className="rounded bg-gradient-to-br from-green-200 to-green-100 aspect-video p-2 flex flex-col justify-end">
              <p className="text-[8px] font-bold leading-tight">10ft Cobweb Duster Tested</p>
            </div>
          </div>
        </div>
      </div>
      {/* Floating badge */}
      <div className="absolute -bottom-4 -right-2 sm:right-4 bg-white rounded-xl shadow-xl border border-gray-100 px-3 py-2 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-[#34c759] flex items-center justify-center">
          <Sparkles size={13} className="text-white" />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-[#1d1d1f] leading-tight">Just published</p>
          <p className="text-[9px] text-[#86868b] leading-tight">via MVP Affiliate</p>
        </div>
      </div>
    </div>
  )
}

/** Larger "What you get" site preview. */
function SitePreviewFrame() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-[#0071e3]/10 to-[#5856d6]/10 blur-2xl" />
      <div className="relative rounded-2xl shadow-2xl bg-white border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-50 border-b border-gray-100">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="bg-white">
          <div className="bg-black text-white text-[10px] py-1.5 px-4">This site contains affiliate links.</div>
          <div className="bg-black py-4 flex justify-center">
            <div className="w-12 h-12 rounded-full bg-[#7dc3c8]" />
          </div>
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="font-serif font-bold">Let&apos;s Give You Reviews</p>
            <p className="text-[10px] text-[#86868b]">Honest gear reviews from real homes</p>
          </div>
          <div className="px-5 py-6">
            <p className="font-serif text-2xl font-bold text-center leading-tight">Latest Reviews</p>
            <div className="grid grid-cols-3 gap-2 mt-4">
              {[
                'from-orange-200 to-orange-100',
                'from-blue-200 to-blue-100',
                'from-green-200 to-green-100',
              ].map((g, i) => (
                <div key={i} className={`rounded bg-gradient-to-br ${g} aspect-square p-2 flex flex-col justify-end`}>
                  <span className="text-[8px] font-bold bg-white px-1.5 py-0.5 rounded uppercase w-fit">Blog</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-black px-5 py-4 grid grid-cols-3 gap-3 text-white">
            <div>
              <p className="text-[8px] uppercase tracking-wider opacity-60">About</p>
              <p className="text-[10px] font-semibold mt-1">Paul Boomy</p>
              <p className="text-[8px] opacity-70 mt-0.5 leading-snug">Reviews from a real home.</p>
            </div>
            <div>
              <p className="text-[8px] uppercase tracking-wider opacity-60">Categories</p>
              <p className="text-[9px] mt-1">Kitchen</p>
              <p className="text-[9px]">Cleaning</p>
            </div>
            <div>
              <p className="text-[8px] uppercase tracking-wider opacity-60">Follow</p>
              <div className="flex gap-1 mt-1">
                <span className="w-4 h-4 rounded bg-white/20" />
                <span className="w-4 h-4 rounded bg-white/20" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Long review anatomy mockup with numbered annotation pins. */
function ReviewAnatomy() {
  return (
    <div className="relative rounded-2xl shadow-2xl bg-white border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-50 border-b border-gray-100">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
      </div>
      <div className="p-6 bg-white">
        {/* Title */}
        <p className="font-serif text-xl font-bold leading-tight mb-3">
          TranquilRelax Kitchen Mats Review: The Anti-Fatigue Upgrade Tired Feet Deserve
        </p>
        <p className="text-[10px] text-[#86868b] mb-4">By Paul Boomy · May 13, 2026</p>

        {/* (1) Disclaimer */}
        <Pin n={1} side="left">
          <div className="rounded bg-[#fffbe6] border-l-4 border-[#ffc200] p-2 mb-4">
            <p className="text-[10px] text-[#1d1d1f]">This post contains affiliate links. We may earn a commission at no extra cost to you.</p>
          </div>
        </Pin>

        {/* (2) YouTube block */}
        <Pin n={2} side="right">
          <div className="mb-4">
            <p className="text-[9px] font-bold uppercase tracking-wider text-[#555] mb-1 flex items-center gap-1">
              <span className="w-3 h-3 bg-[#ff0000] rounded-sm" /> Watch Our Review
            </p>
            <div className="aspect-video rounded bg-gradient-to-br from-gray-800 to-gray-600 relative flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                <Play size={12} className="text-[#ff0000] ml-0.5" />
              </div>
            </div>
          </div>
        </Pin>

        {/* (3) Verdict */}
        <Pin n={3} side="left">
          <div className="rounded border-2 border-black p-3 mb-4">
            <p className="text-[9px] font-black uppercase tracking-wider mb-1.5 border-b-2 border-[#ffc200] pb-1">Quick Verdict</p>
            <p className="text-[10px] font-semibold leading-snug">Solid budget anti-fatigue mats. Cushion held up over 2 weeks of daily cooking.</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div>
                <p className="text-[8px] font-bold text-[#1a7a3c] uppercase">Buy if</p>
                <p className="text-[8px] mt-0.5">✓ You cook daily on hard tile</p>
              </div>
              <div>
                <p className="text-[8px] font-bold text-[#c0392b] uppercase">Skip if</p>
                <p className="text-[8px] mt-0.5">✗ You want a statement rug</p>
              </div>
            </div>
          </div>
        </Pin>

        {/* (4) Body */}
        <Pin n={4} side="right">
          <p className="text-[10px] leading-relaxed text-[#333] mb-2">
            I cook a lot. My kitchen floor is tile. Hard, cold, unforgiving tile.
            Then I picked up the <span className="text-[#0071e3] underline">TranquilRelax Kitchen Mats</span>{' '}
            and honestly wondered why I waited this long.
          </p>
          <p className="text-[10px] leading-relaxed text-[#333] mb-3">
            The cushioning does its job on your feet, knees, and lower back...
          </p>
        </Pin>

        {/* (5) Rating */}
        <Pin n={5} side="left">
          <div className="rounded bg-black text-white p-3 mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-2xl font-black text-[#ffc200] leading-none">4.2/5</p>
              <p className="text-[8px] uppercase tracking-wider opacity-50 mt-0.5">Final Rating</p>
            </div>
            <p className="text-[9px] opacity-80 leading-snug flex-1">A solid, budget-friendly fix for anyone standing on hard tile.</p>
          </div>
        </Pin>

        {/* (6) Tags */}
        <Pin n={6} side="right">
          <div className="flex flex-wrap gap-1">
            {['#kitchenmats', '#antifatigue', '#kitchencomfort', '#amazonfinds'].map((t) => (
              <span key={t} className="text-[8px] font-semibold bg-gray-100 text-[#555] px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        </Pin>
      </div>
    </div>
  )
}

/** Inline platform-logo SVGs. Monochrome white, sized to fit a 40px chip. */
function PlatformLogo({ name }: { name: string }) {
  const props = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'white', className: 'text-white' }
  switch (name) {
    case 'wordpress':
      return (
        <svg {...props} fill="none" stroke="white" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12 L12 22" />
          <path d="M5 7 L12 2 L19 7" />
          <path d="M7 14 L17 14" />
        </svg>
      )
    case 'facebook':
      return (
        <svg {...props}>
          <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.99 22 12z" />
        </svg>
      )
    case 'threads':
      return (
        <svg {...props}>
          <path d="M12.18 21.5h-.04c-2.93-.02-5.18-.99-6.69-2.88C4.1 16.93 3.39 14.6 3.36 11.7v-.01c.03-2.9.74-5.23 2.1-6.92C6.96 2.88 9.21 1.91 12.13 1.9h.04c2.25.02 4.13.59 5.6 1.71 1.38 1.05 2.35 2.55 2.88 4.45l-1.82.51c-.92-3.27-3.23-4.94-6.66-4.96-2.27.02-3.99.73-5.11 2.14-1.05 1.31-1.6 3.2-1.62 5.62.02 2.42.57 4.31 1.62 5.62 1.12 1.41 2.84 2.13 5.11 2.14 2.05-.01 3.4-.49 4.53-1.6.51-.5.91-1.11 1.21-1.82-.31-.18-.65-.34-1-.47-.92-.36-1.93-.5-2.99-.4-.79.08-1.46.31-1.99.66-.42.28-.7.65-.83 1.07-.13.43-.06.84.2 1.2.27.36.71.62 1.32.74.91.18 1.85-.04 2.42-.4.34-.21.6-.52.78-.91l1.73.78c-.32.66-.83 1.22-1.5 1.63-.93.57-2.2.79-3.4.55-.99-.2-1.81-.71-2.36-1.47-.55-.76-.7-1.69-.44-2.6.26-.91.93-1.7 1.94-2.27.83-.47 1.84-.75 2.93-.83.41-.03.83-.04 1.24-.04 1.13 0 2.21.18 3.18.55.39.15.76.33 1.11.55.15-.93.07-1.86-.25-2.74-.43-1.2-1.27-2.13-2.43-2.72-1.18-.59-2.7-.84-4.4-.72-.94.06-1.83.24-2.65.53l-.6-1.79c.99-.34 2.05-.55 3.16-.62 1.97-.13 3.74.16 5.13.85 1.4.7 2.46 1.83 3.06 3.27.59 1.43.66 3.04.18 4.66-.39 1.31-1.05 2.49-1.93 3.41-.91.95-2.04 1.66-3.3 2.07-.74.24-1.51.36-2.31.36z" />
        </svg>
      )
    case 'linkedin':
      return (
        <svg {...props}>
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      )
    case 'pinterest':
      return (
        <svg {...props}>
          <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.402.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.746-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.624 0 11.99-5.367 11.99-11.987C24.007 5.367 18.641.001.012.001z" />
        </svg>
      )
    case 'x':
      return (
        <svg {...props}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )
    case 'bluesky':
      return (
        <svg {...props}>
          <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.911.58-7.386 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 01-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z" />
        </svg>
      )
    case 'telegram':
      return (
        <svg {...props}>
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg {...props}>
          <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 5.838c3.405 0 6.162 2.76 6.162 6.162 0 3.405-2.76 6.162-6.162 6.162-3.405 0-6.162-2.76-6.162-6.162 0-3.405 2.76-6.162 6.162-6.162zM12 16c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z" />
        </svg>
      )
    case 'email':
      return (
        <svg {...props} fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.5" y="4" width="19" height="16" rx="2" />
          <path d="m22 6-10 7L2 6" />
        </svg>
      )
    default:
      return null
  }
}

function AgentCard({ color, name, job }: { color: string; name: string; job: string }) {
  return (
    <div className="group relative rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 p-5 hover:border-white/30 transition-all hover:scale-[1.02]">
      <div className="flex items-start gap-3 mb-3">
        <span
          className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0 shadow-lg"
          style={{ background: color, boxShadow: `0 0 16px ${color}` }}
        />
        <p className="text-lg font-bold text-white leading-tight">{name}</p>
      </div>
      <p className="text-sm text-gray-400 leading-relaxed">{job}</p>
    </div>
  )
}

function CompareRow({ label, us, gen, free, diy }: { label: string; us: string; gen: string; free: string; diy: string }) {
  return (
    <tr>
      <td className="p-4 font-semibold text-[#1d1d1f]">{label}</td>
      <td className="p-4 bg-[#0071e3]/5"><CompareCell value={us} highlight /></td>
      <td className="p-4"><CompareCell value={gen} /></td>
      <td className="p-4"><CompareCell value={free} /></td>
      <td className="p-4"><CompareCell value={diy} /></td>
    </tr>
  )
}

function CompareCell({ value, highlight }: { value: string; highlight?: boolean }) {
  if (value === 'check') return <CheckCircle size={20} className={highlight ? 'text-[#0071e3]' : 'text-[#34c759]'} />
  if (value === 'cross') return <span className="inline-flex items-center justify-center w-5 h-5 text-[#86868b]">—</span>
  if (value === 'manual') return <span className="text-sm text-[#ff9500] font-medium">manual</span>
  return <span className={`text-sm font-semibold ${highlight ? 'text-[#0071e3]' : 'text-[#1d1d1f]'}`}>{value}</span>
}

function Pin({ n, side, children }: { n: number; side: 'left' | 'right'; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span
        className={`absolute top-1 ${side === 'left' ? '-left-3' : '-right-3'} w-6 h-6 rounded-full bg-[#0071e3] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white shadow-md z-10`}
      >
        {n}
      </span>
      {children}
    </div>
  )
}
