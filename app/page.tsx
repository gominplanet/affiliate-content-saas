import Link from 'next/link'
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
    desc: 'A compelling social caption with your affiliate link, auto-posted to your Facebook page the moment your blog goes live.',
  },
  {
    icon: Globe,
    title: 'Pinterest Pin',
    desc: 'A keyword-rich pin description and your YouTube thumbnail, pinned automatically to drive long-tail traffic back to your review.',
  },
  {
    icon: Zap,
    title: 'Threads Thread',
    desc: 'Short-form content for Threads posted automatically — reaching a new audience without lifting a finger.',
  },
  {
    icon: BarChart3,
    title: 'Affiliate Links Built In',
    desc: 'Your affiliate links are woven into every piece of content. Every platform. Every post. Every time.',
  },
  {
    icon: CheckCircle,
    title: 'Set It & Forget It',
    desc: 'Connect once. We watch your YouTube channel and trigger everything automatically when you post a new video.',
  },
]

const steps = [
  { n: '01', title: 'Connect your YouTube channel', desc: 'Link your channel in one click. We import all your videos instantly.' },
  { n: '02', title: 'Connect your platforms', desc: 'WordPress, Facebook, Pinterest, Threads — connect each platform once.' },
  { n: '03', title: 'Upload a video, we do the rest', desc: 'Every new video triggers a full content rollout across all four platforms automatically.' },
]

const plans = [
  {
    tier: 'Starter',
    price: 25,
    limit: '4 videos / week',
    features: ['4 blog posts per week', 'AI-generated content', 'WordPress auto-publish', 'Facebook, Pinterest & Threads'],
    highlight: false,
  },
  {
    tier: 'Growth',
    price: 40,
    limit: '1 video / day',
    features: ['1 blog post per day', 'Everything in Starter', 'Priority support'],
    highlight: true,
  },
  {
    tier: 'Pro',
    price: 95,
    limit: '5 videos / day',
    features: ['5 blog posts per day', 'Everything in Growth', 'Bulk content generation'],
    highlight: false,
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-[#1d1d1f]">

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#0071e3] flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-bold text-base tracking-tight text-[#1d1d1f]">MVP Affiliate</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm text-[#6e6e73] hover:text-[#1d1d1f] transition-colors px-4 py-2">
            Sign in
          </Link>
          <Link href="/signup" className="text-sm font-semibold bg-[#0071e3] hover:bg-[#0062c4] text-white px-4 py-2 rounded-xl transition-colors">
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-40 pb-24 px-6 text-center relative overflow-hidden bg-gradient-to-b from-[#f0f7ff] to-white">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#0071e3]/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="relative max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-[#0071e3]/8 border border-[#0071e3]/20 rounded-full px-4 py-1.5 text-sm text-[#0071e3] font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34c759] animate-pulse" />
            Free trial — 5 posts included, no credit card required
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6 text-[#1d1d1f]">
            One video.<br />
            <span className="text-[#0071e3]">Four platforms.</span><br />
            Zero writing.
          </h1>
          <p className="text-xl text-[#6e6e73] max-w-2xl mx-auto mb-10 leading-relaxed">
            MVP Affiliate turns every YouTube review into an SEO blog post, Facebook post, Pinterest pin, and Threads thread — with your affiliate links built in. Automatically.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup" className="flex items-center gap-2 bg-[#0071e3] hover:bg-[#0062c4] text-white font-semibold px-8 py-4 rounded-2xl text-base transition-colors shadow-lg shadow-[#0071e3]/25">
              Start for free <ArrowRight size={18} />
            </Link>
            <Link href="/login" className="flex items-center gap-2 bg-white hover:bg-gray-50 border border-gray-200 text-[#1d1d1f] font-semibold px-8 py-4 rounded-2xl text-base transition-colors">
              Sign in
            </Link>
          </div>
          <p className="mt-5 text-sm text-[#86868b]">No credit card required · Cancel anytime</p>
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
      <section className="py-28 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-[#1d1d1f]">How it works</h2>
            <p className="text-[#6e6e73] text-lg">Three steps. Then it runs itself.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step) => (
              <div key={step.n} className="bg-[#f5f5f7] rounded-2xl p-8 hover:bg-[#ebebf0] transition-colors">
                <div className="text-5xl font-black text-[#0071e3]/20 mb-4">{step.n}</div>
                <h3 className="text-lg font-semibold mb-3 text-[#1d1d1f]">{step.title}</h3>
                <p className="text-[#6e6e73] leading-relaxed text-sm">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-28 px-6 bg-[#f5f5f7]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-[#1d1d1f]">Everything done for you</h2>
            <p className="text-[#6e6e73] text-lg">One upload triggers a full content machine.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow border border-gray-100">
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

      {/* Pricing */}
      <section className="py-28 px-6 bg-white" id="pricing">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-[#1d1d1f]">Simple pricing</h2>
            <p className="text-[#6e6e73] text-lg">Start free. Scale when you&apos;re ready.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 items-start">
            {plans.map((plan) => (
              <div
                key={plan.tier}
                className={`rounded-2xl p-8 flex flex-col ${
                  plan.highlight
                    ? 'bg-[#0071e3] text-white shadow-2xl shadow-[#0071e3]/30 scale-105'
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
      <section className="py-28 px-6 bg-[#f5f5f7]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="bg-gradient-to-br from-[#0071e3] to-[#0055b3] rounded-3xl p-16 shadow-2xl shadow-[#0071e3]/20">
            <h2 className="text-4xl md:text-5xl font-black mb-6 leading-tight text-white">
              Your next video is<br />
              worth more than views.
            </h2>
            <p className="text-blue-100 text-lg mb-10">
              Start turning your YouTube content into affiliate revenue across every platform — today.
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 bg-white text-[#0071e3] font-bold px-10 py-5 rounded-2xl text-base transition-colors hover:bg-blue-50 shadow-lg"
            >
              Start for free <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-10 px-6 bg-white">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-[#0071e3] flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="font-bold text-sm text-[#1d1d1f]">MVP Affiliate</span>
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
