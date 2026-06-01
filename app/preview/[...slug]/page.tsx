/**
 * Catch-all for /preview/* pages we haven't mocked yet. Theme-aware via
 * CSS variables set by app/preview/layout.tsx.
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
        <div
          className="w-10 h-10 rounded-xl border flex items-center justify-center"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-soft)' }}
        >
          {meta.icon}
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>{meta.label}</h1>
      </div>
      <p className="text-[13px] mb-8" style={{ color: 'var(--text-subtle)' }}>
        This page lives in the real app — the preview just hasn&apos;t been mocked yet.
      </p>

      <div
        className="rounded-2xl border p-6"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-[#7C3AED]" />
          <p className="text-[11px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-faint)' }}>Design direction</p>
        </div>
        <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{meta.note}</p>
      </div>

      <div className="mt-6 flex gap-3">
        <a
          href="/preview/dashboard"
          className="px-3.5 py-2 rounded-lg border text-[12px] inline-flex items-center gap-1.5 transition-colors"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}
        >
          ← Back to dashboard
        </a>
      </div>
    </main>
  )
}
