import type { Metadata } from 'next'
import { BookOpen } from 'lucide-react'

export const metadata: Metadata = { title: 'Tutorials' }

const TUTORIALS = [
  {
    id: 'aBo0ruDuVuE',
    title: 'Full Onboarding Walkthrough',
    description: 'A complete setup guide — from connecting WordPress and YouTube to generating your first blog post and pushing it everywhere.',
    category: 'Getting Started',
    accent: '#7C3AED',
  },
  {
    id: 'QTH5x8KYHnk',
    title: 'Brand Identity Set Up',
    description: 'Configure your brand profile, voice training, and author identity so every post sounds exactly like you.',
    category: 'Getting Started',
    accent: '#DB2777',
  },
]

export default function TutorialsPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 sm:px-8 py-10">
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #DB2777 100%)' }}
          >
            <BookOpen size={17} className="text-white" />
          </span>
          <h1 className="text-[28px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
            Tutorials
          </h1>
        </div>
        <p className="text-[14px] mt-1 ml-12" style={{ color: 'var(--text-soft)' }}>
          Step-by-step video guides to get the most out of MVP Affiliate.
        </p>
      </div>

      {/* Video grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {TUTORIALS.map((t) => (
          <article
            key={t.id}
            className="rounded-2xl overflow-hidden border flex flex-col"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            {/* Embed */}
            <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, flexShrink: 0 }}>
              <iframe
                src={`https://www.youtube.com/embed/${t.id}?rel=0&modestbranding=1`}
                title={t.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
              />
            </div>

            {/* Meta */}
            <div className="px-5 py-4 flex flex-col gap-1">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: t.accent }}
              >
                {t.category}
              </span>
              <h2 className="text-[16px] font-semibold leading-snug" style={{ color: 'var(--text)' }}>
                {t.title}
              </h2>
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                {t.description}
              </p>
            </div>
          </article>
        ))}
      </div>

      {/* More coming soon */}
      <div
        className="mt-8 rounded-2xl border border-dashed flex items-center justify-center py-10"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
          More tutorials coming soon
        </p>
      </div>
    </div>
  )
}
