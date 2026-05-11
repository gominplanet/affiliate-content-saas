import Link from 'next/link'
import Image from 'next/image'
import { CheckCircle, Youtube, Facebook, ArrowRight, Zap, Globe, BarChart3 } from 'lucide-react'

const features = [
  {
    icon: Youtube,
    title: 'YouTube → Blog Post',
    desc: 'We pull your video transcript and generate a full SEO-optimized affiliate blog post — published directly to your WordPress site.',
  },
  {
    icon: Facebook,
    title: 'Facebook Post',
    desc: 'A compelling social caption with your affiliate link, ready to post to your Facebook page with one click.',
  },
  {
    icon: Globe,
    title: 'Pinterest Pin',
    desc: 'A keyword-rich pin description and your YouTube thumbnail, ready to drive long-tail traffic back to your review.',
  },
  {
    icon: Zap,
    title: 'Threads Thread',
    desc: 'Short-form content for Threads generated alongside your blog post — one click to reach a whole new audience.',
  },
  {
    icon: BarChart3,
    title: 'Affiliate Links Built In',
    desc: 'Your affiliate links are woven into every piece of content. Every platform. Every post. Every time.',
  },
  {
    icon: CheckCircle,
    title: 'One Click. Every Platform.',
    desc: 'Pick a video, hit generate. We write the blog post, publish it to WordPress, and have your social content ready to go — all in one shot.',
  },
]

const steps = [
  { n: '01', title: 'Connect your YouTube channel', desc: 'Link your channel in one click. We import all your videos instantly.' },
  { n: '02', title: 'Connect your platforms', desc: 'WordPress, Facebook, Pinterest, Threads — connect each platform once.' },
  { n: '03', title: 'Pick a video. Hit generate.', desc: 'We write a full SEO blog post, publish it to WordPress, and prepare social content for every platform — in minutes.' },
]

const plans = [
  {
    tier: 'Starter',
    price: 19,
    limit: '25 posts / month',
    features: ['25 blog posts per month', 'AI-generated content', 'WordPress auto-publish', 'Facebook, Pinterest & Threads'],
    highlight: false,
  },
  {
    tier: 'Growth',
    price: 39,
    limit: '75 posts / month',
    features: ['75 blog posts per month', 'Everything in Starter', 'Priority support'],
    highlight: true,
  },
  {
    tier: 'Pro',
    price: 79,
    limit: '250 posts / month',
    features: ['250 blog posts per month', 'Everything in Growth', 'Bulk content generation'],
    highlight: false,
  },
]

const comparisonRows = [
  { feature: 'Auto-pulls from YouTube',   us: true,  jasper: false, surfer: false, writesonic: false },
  { feature: 'Publishes to WordPress',    us: true,  jasper: false, surfer: false, writesonic: false },
  { feature: 'Affiliate links built in',  us: true,  jasper: false, surfer: false, writesonic: false },
  { feature: 'Matches your voice',        us: true,  jasper: false, surfer: false, writesonic: false },
  { feature: 'Social posts included',     us: true,  jasper: 'add-on', surfer: false, writesonic: 'add-on' },
  { feature: 'Starting price',            us: '$19/mo', jasper: '$49/mo', surfer: '$89/mo', writesonic: '$16/mo' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-[#1d1d1f]">

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-6 py-3 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="flex items-center">
          <Image src="/mvp-affiliate-logo.png" alt="MVP Affiliate" width={44} height={44} className="rounded-xl" />
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden sm:block text-sm text-[#6e6e73] hover:text-[#1d1d1f] transition-colors px-3 py-2">
            Sign in
          </Link>
          <Link href="/signup" className="text-sm font-semibold bg-[#0071e3] hover:bg-[#0062c4] text-white px-4 py-2 rounded-xl transition-colors">
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 sm:pt-40 pb-16 sm:pb-24 px-5 sm:px-6 text-center relative overflow-hidden bg-gradient-to-b from-[#f0f7ff] to-white">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#0071e3]/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="relative max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-[#0071e3]/8 border border-[#0071e3]/20 rounded-full px-3 sm:px-4 py-1.5 text-xs sm:text-sm text-[#0071e3] font-medium mb-6 sm:mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34c759] animate-pulse flex-shrink-0" />
            Free trial — 5 posts included, no credit card required
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-5 sm:mb-6 text-[#1d1d1f]">
            One video.<br />
            <span className="text-[#0071e3]">Every platform.</span><br />
            Zero writing.
          </h1>
          <p className="text-base sm:text-xl text-[#6e6e73] max-w-2xl mx-auto mb-8 sm:mb-10 leading-relaxed">
            MVP Affiliate turns every YouTube review into SEO blog posts and social content across all your platforms — with your affiliate links built in. Automatically.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <Link href="/signup" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#0071e3] hover:bg-[#0062c4] text-white font-semibold px-8 py-4 rounded-2xl text-base transition-colors shadow-lg shadow-[#0071e3]/25">
              Start for free <ArrowRight size={18} />
            </Link>
            <Link href="/login" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white hover:bg-gray-50 border border-gray-200 text-[#1d1d1f] font-semibold px-8 py-4 rounded-2xl text-base transition-colors">
              Sign in
            </Link>
          </div>
          <p className="mt-4 sm:mt-5 text-sm text-[#86868b]">No credit card required · Cancel anytime</p>
        </div>
      </section>

      {/* Platform strip */}
      <section className="py-12 border-y border-gray-100 bg-[#fafafa]">
        <div className="max-w-3xl mx-auto px-6">
          <p className="text-center text-xs text-[#86868b] mb-8 uppercase tracking-widest font-semibold">Publishes to</p>
          <div className="flex items-center justify-center gap-12 flex-wrap">
            {[
              { label: 'WordPress', color: '#21759b' },
              { label: 'Facebook', color: '#1877f2' },
              { label: 'Pinterest', color: '#e60023' },
              { label: 'Threads', color: '#1d1d1f' },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                <span className="text-[#1d1d1f] font-semibold text-sm">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 sm:py-28 px-5 sm:px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4 text-[#1d1d1f]">How it works</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg">Three steps. Then it runs itself.</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-4 sm:gap-8">
            {steps.map((step) => (
              <div key={step.n} className="bg-[#f5f5f7] rounded-2xl p-6 sm:p-8 hover:bg-[#ebebf0] transition-colors">
                <div className="text-4xl sm:text-5xl font-black text-[#0071e3]/20 mb-3 sm:mb-4">{step.n}</div>
                <h3 className="text-base sm:text-lg font-semibold mb-2 sm:mb-3 text-[#1d1d1f]">{step.title}</h3>
                <p className="text-[#6e6e73] leading-relaxed text-sm">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 sm:py-28 px-5 sm:px-6 bg-[#f5f5f7]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4 text-[#1d1d1f]">Everything done for you</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg">One upload triggers a full content machine.</p>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100">
                <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 flex items-center justify-center mb-4">
                  <Icon size={18} className="text-[#0071e3]" />
                </div>
                <h3 className="font-semibold mb-2 text-[#1d1d1f]">{title}</h3>
                <p className="text-[#6e6e73] text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="py-16 sm:py-28 px-5 sm:px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10 sm:mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4 text-[#1d1d1f]">How we compare</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg">Other tools make you do the work. We do it for you.</p>
          </div>

          {/* Mobile: 2-column (us vs others) */}
          <div className="sm:hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left pb-3 text-xs font-semibold text-[#86868b] w-[55%]" />
                  <th className="pb-0 w-[22.5%]">
                    <div className="bg-[#0071e3] text-white text-[11px] font-bold px-2 py-2 rounded-t-xl text-center leading-tight">
                      MVP<br />Affiliate
                    </div>
                  </th>
                  <th className="pb-3 text-center text-xs font-semibold text-[#86868b] w-[22.5%]">Others</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, i) => {
                  const isLast = i === comparisonRows.length - 1
                  const isPrice = typeof row.us === 'string'
                  const othersAllBad = row.jasper === false && row.surfer === false && row.writesonic === false
                  const othersAddOn = !othersAllBad && row.jasper !== true && row.surfer !== true && row.writesonic !== true
                  return (
                    <tr key={row.feature} className="border-t border-gray-100">
                      <td className={`py-3 pr-3 text-xs font-medium text-[#1d1d1f] ${isPrice ? 'font-semibold' : ''}`}>
                        {row.feature}
                      </td>
                      <td className={`py-3 text-center bg-[#0071e3]/5 border-x border-[#0071e3]/15 ${isLast ? 'rounded-b-xl border-b border-[#0071e3]/15' : ''}`}>
                        {isPrice
                          ? <span className="text-xs font-bold text-[#0071e3]">{row.us as string}</span>
                          : <span className="text-base">✅</span>
                        }
                      </td>
                      <td className="py-3 text-center">
                        {isPrice
                          ? <span className="text-xs text-[#6e6e73]">from $16/mo</span>
                          : othersAllBad
                          ? <span className="text-base">❌</span>
                          : othersAddOn
                          ? <span className="text-[10px] text-[#ff9500] font-medium">Add-on</span>
                          : <span className="text-base">✅</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Desktop: full 5-column table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <th className="text-left pb-4 text-sm font-semibold text-[#86868b] w-[38%]" />
                  <th className="pb-0 w-[15.5%]">
                    <div className="bg-[#0071e3] text-white text-xs font-bold px-3 py-2.5 rounded-t-xl mx-1 text-center leading-tight">
                      MVP<br />Affiliate
                    </div>
                  </th>
                  <th className="pb-4 text-center text-xs font-semibold text-[#86868b] w-[15.5%]">Jasper</th>
                  <th className="pb-4 text-center text-xs font-semibold text-[#86868b] w-[15.5%]">Surfer</th>
                  <th className="pb-4 text-center text-xs font-semibold text-[#86868b] w-[15.5%]">WriteSonic</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, i) => {
                  const isLast = i === comparisonRows.length - 1
                  const isPrice = typeof row.us === 'string'
                  return (
                    <tr key={row.feature} className="border-t border-gray-100">
                      <td className={`py-3.5 pr-4 text-sm font-medium text-[#1d1d1f] ${isPrice ? 'font-semibold' : ''}`}>
                        {row.feature}
                      </td>
                      <td className={`py-3.5 text-center bg-[#0071e3]/5 border-x border-[#0071e3]/15 ${isLast ? 'rounded-b-xl border-b border-[#0071e3]/15' : ''}`}>
                        {isPrice
                          ? <span className="text-sm font-bold text-[#0071e3]">{row.us as string}</span>
                          : <span className="text-lg">✅</span>
                        }
                      </td>
                      <td className="py-3.5 text-center">
                        {isPrice ? <span className="text-sm text-[#6e6e73]">{row.jasper as string}</span>
                          : row.jasper === true ? <span className="text-lg">✅</span>
                          : row.jasper === 'add-on' ? <span className="text-xs text-[#ff9500] font-medium">Add-on</span>
                          : <span className="text-lg">❌</span>}
                      </td>
                      <td className="py-3.5 text-center">
                        {isPrice ? <span className="text-sm text-[#6e6e73]">{row.surfer as string}</span>
                          : row.surfer === true ? <span className="text-lg">✅</span>
                          : row.surfer === 'add-on' ? <span className="text-xs text-[#ff9500] font-medium">Add-on</span>
                          : <span className="text-lg">❌</span>}
                      </td>
                      <td className="py-3.5 text-center">
                        {isPrice ? <span className="text-sm text-[#6e6e73]">{row.writesonic as string}</span>
                          : row.writesonic === true ? <span className="text-lg">✅</span>
                          : row.writesonic === 'add-on' ? <span className="text-xs text-[#ff9500] font-medium">Add-on</span>
                          : <span className="text-lg">❌</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-center mt-6 sm:mt-8 text-xs text-[#86868b]">
            Competitor pricing as of 2025. They&apos;re general AI writers — great tools, wrong job for affiliate creators.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-16 sm:py-28 px-5 sm:px-6 bg-white" id="pricing">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3 sm:mb-4 text-[#1d1d1f]">Simple pricing</h2>
            <p className="text-[#6e6e73] text-base sm:text-lg">Start free. Scale when you&apos;re ready.</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-4 sm:gap-6 items-start">
            {plans.map((plan) => (
              <div
                key={plan.tier}
                className={`rounded-2xl p-6 sm:p-8 flex flex-col ${
                  plan.highlight
                    ? 'bg-[#0071e3] text-white shadow-2xl shadow-[#0071e3]/30 md:scale-105'
                    : 'bg-[#f5f5f7] border border-gray-100'
                }`}
              >
                {plan.highlight && (
                  <div className="flex items-center gap-1.5 mb-4">
                    <Zap size={13} className="text-yellow-300" />
                    <span className="text-xs font-bold text-yellow-300 uppercase tracking-wider">Most Popular</span>
                  </div>
                )}
                <p className={`text-sm font-semibold mb-1 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b]'}`}>{plan.tier}</p>
                <div className="flex items-end gap-1 mb-1">
                  <span className={`text-5xl font-black ${plan.highlight ? 'text-white' : 'text-[#1d1d1f]'}`}>${plan.price}</span>
                  <span className={`text-sm mb-2 ${plan.highlight ? 'text-blue-100' : 'text-[#86868b]'}`}>/mo</span>
                </div>
                <p className={`text-sm font-medium mb-6 ${plan.highlight ? 'text-blue-100' : 'text-[#0071e3]'}`}>{plan.limit}</p>
                <ul className="flex flex-col gap-3 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle size={14} className={`mt-0.5 flex-shrink-0 ${plan.highlight ? 'text-blue-200' : 'text-[#34c759]'}`} />
                      <span className={plan.highlight ? 'text-blue-50' : 'text-[#1d1d1f]'}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`w-full py-3 rounded-xl font-semibold text-sm text-center transition-colors ${
                    plan.highlight
                      ? 'bg-white text-[#0071e3] hover:bg-blue-50'
                      : 'bg-[#0071e3] text-white hover:bg-[#0062c4]'
                  }`}
                >
                  Get started
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center mt-8 text-sm text-[#86868b]">Free plan included — 5 posts to try it out. No credit card needed.</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16 sm:py-28 px-5 sm:px-6 bg-[#f5f5f7]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="bg-gradient-to-br from-[#0071e3] to-[#0055b3] rounded-2xl sm:rounded-3xl p-8 sm:p-16 shadow-2xl shadow-[#0071e3]/20">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mb-4 sm:mb-6 leading-tight text-white">
              Your next video is<br />
              worth more than views.
            </h2>
            <p className="text-blue-100 text-base sm:text-lg mb-8 sm:mb-10">
              Start turning your YouTube content into affiliate revenue across every platform — today.
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 bg-white text-[#0071e3] font-bold px-8 sm:px-10 py-4 sm:py-5 rounded-2xl text-base transition-colors hover:bg-blue-50 shadow-lg"
            >
              Start for free <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-10 px-6 bg-white">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center">
            <Image src="/mvp-affiliate-logo.png" alt="MVP Affiliate" width={36} height={36} className="rounded-lg" />
          </div>
          <div className="flex items-center gap-6 text-sm text-[#86868b]">
            <Link href="/privacy" className="hover:text-[#1d1d1f] transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-[#1d1d1f] transition-colors">Terms</Link>
            <Link href="/login" className="hover:text-[#1d1d1f] transition-colors">Sign in</Link>
          </div>
          <p className="text-sm text-[#86868b]">© 2025 MVP Affiliate. All rights reserved.</p>
        </div>
      </footer>

    </div>
  )
}
