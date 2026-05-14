import Link from 'next/link'
import Image from 'next/image'
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
const platforms = [
  { label: 'WordPress', status: 'live'    as const, color: '#21759b' },
  { label: 'Facebook',  status: 'live'    as const, color: '#1877f2' },
  { label: 'Threads',   status: 'live'    as const, color: '#000000' },
  { label: 'LinkedIn',  status: 'pro'     as const, color: '#0a66c2' },
  { label: 'Pinterest', status: 'soon'    as const, color: '#e60023' },
  { label: 'Twitter / X', status: 'soon' as const, color: '#000000' },
  { label: 'Bluesky',   status: 'soon' as const, color: '#1185fe' },
  { label: 'Email digest', status: 'roadmap' as const, color: '#34c759' },
]

const statusBadge: Record<typeof platforms[number]['status'], { text: string; bg: string; fg: string }> = {
  live:    { text: 'Live now',     bg: 'bg-[#34c759]/10',  fg: 'text-[#1f8a3a]' },
  pro:     { text: 'Pro plan',     bg: 'bg-[#0071e3]/10',  fg: 'text-[#0071e3]' },
  soon:    { text: 'Coming soon',  bg: 'bg-[#ff9500]/10',  fg: 'text-[#9a5d00]' },
  roadmap: { text: 'On roadmap',   bg: 'bg-gray-100',      fg: 'text-[#6e6e73]' },
}

const plans = [
  {
    tier: 'Free',
    price: 0,
    regular: 0,
    limit: '5 posts lifetime',
    features: ['Free themed review site', 'AI-generated content', 'Facebook + Threads posting'],
    cta: 'Start free',
    href: '/signup',
    highlight: false,
  },
  {
    tier: 'Starter',
    price: 49,
    regular: 99,
    limit: '30 posts / month',
    features: ['Free themed review site', '1 connected WordPress site', 'Facebook + Threads posting'],
    cta: 'Get Starter',
    href: '/pricing',
    highlight: false,
  },
  {
    tier: 'Growth',
    price: 99,
    regular: 199,
    limit: '60 posts / month',
    features: ['Everything in Starter', 'Priority generation queue'],
    cta: 'Get Growth',
    href: '/pricing',
    highlight: true,
  },
  {
    tier: 'Pro',
    price: 199,
    regular: 299,
    limit: '150 posts / month',
    features: ['Everything in Growth', 'LinkedIn auto-post', 'Priority support'],
    cta: 'Get Pro',
    href: '/pricing',
    highlight: false,
  },
]

const faqs = [
  {
    q: 'Do I need my own WordPress site?',
    a: 'You need a domain and a WordPress install (any host — we test on Hostinger). When you connect it, we install our editorial theme and plugin automatically so your reviews look polished from day one.',
  },
  {
    q: 'Is the content AI-generated?',
    a: 'Yes — but not by a single chatbot. We orchestrate an army of specialized AI agents: one researches the product, one drafts the body, one matches your voice from your brand profile, one inserts affiliate links cleanly, one writes the FAQ, one tags and categorizes, one fact-checks. The output is reviewed in Studio before publish so you always have the final say.',
  },
  {
    q: 'Do I own the content?',
    a: 'You own everything generated for your account. We don\'t reuse, resell, or train models on your content.',
  },
  {
    q: 'What happens after my 5 free posts?',
    a: 'You can upgrade to a paid plan or pause. Your existing posts and connected site stay exactly as they are — nothing gets taken down.',
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
        <div className="flex items-center gap-2">
          <Link href="/pricing" className="hidden sm:block text-sm text-[#6e6e73] hover:text-[#1d1d1f] transition-colors px-3 py-2">
            Pricing
          </Link>
          <Link href="/login" className="hidden sm:block text-sm text-[#6e6e73] hover:text-[#1d1d1f] transition-colors px-3 py-2">
            Sign in
          </Link>
          <Link href="/signup" className="text-sm font-semibold bg-[#0071e3] hover:bg-[#0062c4] text-white px-4 py-2 rounded-xl transition-colors">
            Start free
          </Link>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="pt-28 sm:pt-36 pb-12 sm:pb-20 px-5 sm:px-6 relative overflow-hidden bg-gradient-to-b from-[#f0f7ff] via-white to-white">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1100px] h-[600px] bg-[#0071e3]/8 rounded-full blur-[120px] pointer-events-none" />
        <div className="relative max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">

          {/* Left — copy */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 bg-white border border-[#0071e3]/20 rounded-full px-3 py-1.5 text-xs sm:text-sm text-[#0071e3] font-medium mb-6 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#34c759] animate-pulse" />
              5 free posts. No card. No catch.
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-5 text-[#1d1d1f]">
              Turn one review into
              <br />
              <span className="text-[#0071e3]">a full affiliate site.</span>
            </h1>
            <p className="text-lg sm:text-xl text-[#3a3a3c] max-w-xl mx-auto lg:mx-0 mb-8 leading-relaxed">
              A team of AI agents writes the review. We publish it to your WordPress site with our editorial theme.
              You get social posts ready for every platform — affiliate links woven in.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Link href="/signup" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#0071e3] hover:bg-[#0062c4] text-white font-semibold px-7 py-3.5 rounded-2xl text-base transition-colors shadow-lg shadow-[#0071e3]/25">
                Start free — 5 posts <ArrowRight size={17} />
              </Link>
              <Link href="/pricing" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white hover:bg-gray-50 border border-gray-200 text-[#1d1d1f] font-semibold px-7 py-3.5 rounded-2xl text-base transition-colors">
                See pricing
              </Link>
            </div>
            <p className="mt-4 text-sm text-[#86868b]">
              Includes a free themed review site · Cancel anytime
            </p>
          </div>

          {/* Right — live preview "browser frame" */}
          <BrowserFrame />
        </div>
      </section>

      {/* ── Platform strip ─────────────────────────────────────────────────── */}
      <section className="py-12 sm:py-16 border-y border-gray-100 bg-[#fafafa]">
        <div className="max-w-6xl mx-auto px-5 sm:px-6">
          <p className="text-center text-sm text-[#3a3a3c] mb-6 uppercase tracking-widest font-semibold">
            Publishes to your site + every platform you care about
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {platforms.map(({ label, status, color }) => {
              const badge = statusBadge[status]
              return (
                <div key={label} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white border border-gray-100">
                  <span className="w-4 h-4 rounded-full" style={{ background: color }} />
                  <span className="text-sm font-semibold text-[#1d1d1f] text-center leading-tight">{label}</span>
                  <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${badge.bg} ${badge.fg}`}>
                    {badge.text}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-6 text-center text-sm text-[#3a3a3c] max-w-2xl mx-auto leading-relaxed">
            We only ship what works. Pinterest, Twitter / X, and Bluesky auto-publish are all
            actively in build — Pinterest is in Pinterest&apos;s developer review queue right now.
            Email digests are on the roadmap. No false promises.
          </p>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-[#1d1d1f]">How it works</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg">Connect once. Publish forever.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StepCard
              n="01"
              icon={<Wand2 size={20} />}
              title="Drop in a product, video, or topic"
              desc="Paste a product URL, pick a YouTube video, or just type the idea. Studio handles the rest."
              accent="#0071e3"
            />
            <StepCard
              n="02"
              icon={<Sparkles size={20} />}
              title="AI writes the full review"
              desc="Verdict box, pros/cons, body copy with affiliate links, rating, tags, FAQ — in your voice."
              accent="#5856d6"
            />
            <StepCard
              n="03"
              icon={<Globe size={20} />}
              title="One click publishes everywhere"
              desc="Live on your themed WordPress site, plus social drafts ready for Facebook, Threads, LinkedIn."
              accent="#34c759"
            />
          </div>
        </div>
      </section>

      {/* ── Army of agents ─────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-[#0a0a0a] text-white relative overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-[#0071e3]/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-[#5856d6]/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="relative max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="inline-block text-sm font-semibold text-[#0071e3] uppercase tracking-wider mb-3">
              The MVP Affiliate difference
            </span>
            <h2 className="text-4xl sm:text-5xl font-bold mb-4 leading-tight">
              An <span className="text-[#0071e3]">army of agents</span> on every review
            </h2>
            <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
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
        </div>
      </section>

      {/* ── What's in every review (anatomy) ───────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-gradient-to-b from-[#f7f9fc] to-white border-y border-gray-100">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-[#1d1d1f]">What&apos;s in every review</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg max-w-2xl mx-auto">
              Not a wall of text. A full editorial review built to convert — the same shape Wirecutter and
              Tom&apos;s Guide use.
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
              When you connect your WordPress site, we install our theme and plugin automatically.
              Featured grid, Pick of the Day, sidebar banners, footer with your bio and socials — all
              styled from your Brand Profile.
            </p>
            <ul className="flex flex-col gap-3 mb-6">
              <FeatureLine>Editorial hero + 4-post featured grid on the homepage</FeatureLine>
              <FeatureLine>&quot;Pick of the Day&quot; rotating featured post (12h / 24h / pinned)</FeatureLine>
              <FeatureLine>Sidebar + in-content ad blocks you control from the dashboard</FeatureLine>
              <FeatureLine>Logo banner, social icons, brand colors + fonts</FeatureLine>
              <FeatureLine>Mobile-first layout, fast page loads, clean URLs</FeatureLine>
            </ul>
            <Link href="/signup" className="inline-flex items-center gap-2 text-[#0071e3] font-semibold hover:gap-3 transition-all">
              Start with the themed site free <ArrowRight size={16} />
            </Link>
          </div>

          <SitePreviewFrame />
        </div>
      </section>

      {/* ── Comparison table ───────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-[#1d1d1f]">How we stack up</h2>
            <p className="text-[#3a3a3c] text-base sm:text-lg max-w-2xl mx-auto">
              A side-by-side look at the most common ways affiliate marketers produce review content.
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
                <CompareRow label="Full review draft" us="check" gen="check" free="check" diy="manual" />
                <CompareRow label="Editorial review site theme included" us="check" gen="cross" free="cross" diy="cross" />
                <CompareRow label="Verdict + rating + tags blocks built in" us="check" gen="manual" free="manual" diy="manual" />
                <CompareRow label="Affiliate disclaimer auto-inserted" us="check" gen="cross" free="manual" diy="manual" />
                <CompareRow label="One-click publish to WordPress" us="check" gen="cross" free="manual" diy="manual" />
                <CompareRow label="Social posts ready for every platform" us="check" gen="manual" free="manual" diy="cross" />
                <CompareRow label="Stays in your brand voice across posts" us="check" gen="manual" free="manual" diy="manual" />
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
              Launch pricing — up to 50% off
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-[#1d1d1f]">Pick a plan that fits your output</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg">Every paid plan includes a free themed review site. Cancel anytime.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
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
                <p className={`text-sm font-medium mb-4 ${plan.highlight ? 'text-blue-100' : 'text-[#0071e3]'}`}>{plan.limit}</p>
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

      {/* ── Final CTA ──────────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-gradient-to-br from-[#0071e3] to-[#5856d6] text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-5xl font-bold mb-4 leading-[1.1]">Ready to turn your reviews into a site?</h2>
          <p className="text-blue-100 text-base sm:text-lg mb-8 max-w-xl mx-auto">
            5 free posts. No credit card. No contracts. Cancel anytime.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 bg-white hover:bg-blue-50 text-[#0071e3] font-semibold px-8 py-4 rounded-2xl text-base transition-colors shadow-2xl"
          >
            Start free <ArrowRight size={17} />
          </Link>
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
          <div className="flex items-center gap-5 text-xs text-[#86868b]">
            <Link href="/pricing" className="hover:text-[#1d1d1f]">Pricing</Link>
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
