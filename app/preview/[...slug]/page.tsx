/**
 * Catch-all for /preview/* pages we haven't mocked yet. Renders a stub
 * with the page name from the URL + a "Coming next" placeholder so the
 * sidebar nav never dead-ends during the preview review.
 *
 * The dynamic param is at the END of the route table — built-in pages
 * (/preview/dashboard, /preview/library, etc.) take precedence over
 * this catch-all per Next.js routing rules.
 */
'use client'

import { useParams } from 'next/navigation'
import { Sparkles, Wrench, Mail, Palette, Brush, Calendar, Bot, CreditCard, Settings, PenLine, Scale } from 'lucide-react'

const PAGE_META: Record<string, { label: string; icon: React.ReactNode; note: string }> = {
  script: {
    label: 'Script writer',
    icon: <PenLine size={18} />,
    note: 'Long-form video script generation. In the new design: split-screen layout with brand voice prompt on the left, draft + revision history on the right. AI suggestions inline (rewrite this paragraph, tighten this hook, etc.).',
  },
  compare: {
    label: 'Compare & Guides',
    icon: <Scale size={18} />,
    note: 'Multi-product comparison generator (the page you already shipped the SitePicker into). In the new design: ranked product cards, verdict at top, comparison table mid-page, pros/cons per product. Glass treatment + tabular-nums on every spec.',
  },
  newsletter: {
    label: 'Newsletter',
    icon: <Mail size={18} />,
    note: 'Compose + send + subscribers. In the new design: drag-to-reorder section blocks, live preview on the right, AI "rewrite this section" buttons inline. Send confirmation modal shows subscriber count + estimated delivery time.',
  },
  scheduled: {
    label: 'Scheduled',
    icon: <Calendar size={18} />,
    note: 'Calendar view of upcoming posts + scheduled social. In the new design: week/month toggle, per-platform color coding, hover any item to see preview, click-and-drag to reschedule.',
  },
  brand: {
    label: 'Brand Profile',
    icon: <Palette size={18} />,
    note: 'Identity + voice + niches. In the new design: stays mostly form-based but with a "live preview" panel that shows how the brand reads across a sample blog post + thumbnail + newsletter.',
  },
  customize: {
    label: 'Customize Blog',
    icon: <Brush size={18} />,
    note: 'Per-site visual customizations (ads, footer, pick-of-day). In the new design: live WP preview iframe on the right, controls on the left. Multi-site picker at top so you customize per site.',
  },
  setup: {
    label: 'Site & Integrations',
    icon: <Settings size={18} />,
    note: 'WordPress + GSC + socials + analytics. In the new design: large connection cards arranged by status (connected/needs attention/not yet). Connection Doctor lives here. Multi-site Manager too.',
  },
  assistant: {
    label: 'Assistant',
    icon: <Bot size={18} />,
    note: 'Full conversation history with the MVP assistant. In the new design: ChatGPT-style layout, but with action buttons embedded in responses ("Generate a post about X" → click → generates inline).',
  },
  billing: {
    label: 'Billing',
    icon: <CreditCard size={18} />,
    note: 'Plan + invoices + payment method. In the new design: current usage at the top (visualized as a progress meter against plan limits), invoice history below, big "Upgrade" or "Manage" CTA.',
  },
}

export default function PreviewStub() {
  const params = useParams()
  const slugParts = (params?.slug as string[]) || []
  const slug = slugParts[0] || 'unknown'
  const meta = PAGE_META[slug] || {
    label: slug.charAt(0).toUpperCase() + slug.slice(1),
    icon: <Wrench size={18} />,
    note: 'This page is referenced from the sidebar but a mockup hasn\'t been built yet.',
  }

  return (
    <main className="px-8 py-10 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/70">
          {meta.icon}
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight text-white">{meta.label}</h1>
      </div>
      <p className="text-[13px] text-white/55 mb-8">
        This page lives in the real app — the preview just hasn&apos;t been mocked yet.
      </p>

      <div
        className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-6"
        style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-[#7C3AED]" />
          <p className="text-[11px] uppercase tracking-[0.15em] text-white/45">Design direction</p>
        </div>
        <p className="text-[14px] text-white/85 leading-relaxed">{meta.note}</p>
      </div>

      <div className="mt-6 flex gap-3">
        <a
          href="/preview/dashboard"
          className="px-3.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] text-[12px] text-white inline-flex items-center gap-1.5 transition-colors"
        >
          ← Back to dashboard
        </a>
      </div>
    </main>
  )
}
