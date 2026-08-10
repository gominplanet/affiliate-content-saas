// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Influencer → Social Influencer. Turn an Art Director thumbnail into a
// native post for the three visual networks Amazon creators live on: Pinterest,
// Instagram, Facebook. The AI writes the caption, attaches the affiliate link,
// and (for Instagram) routes through the Link-in-Bio shop grid. First-pass
// scaffold — the per-platform composers are being built next.
import type { Metadata } from 'next'
import { Share2, Sparkles } from 'lucide-react'
import SocialComposer from '@/components/amazon/SocialComposer'
import SocialConnections from '@/components/amazon/SocialConnections'

export const metadata: Metadata = {
  title: 'Social Influencer — Amazon Influencer',
  description: 'Turn a thumbnail into Pinterest, Instagram and Facebook posts.',
}

const PLATFORMS = [
  {
    name: 'Pinterest',
    color: '#E60023',
    tag: 'Pins',
    desc: 'The Art Director thumbnail becomes a tall, high-CTR Pin. AI writes the title and description, and the Pin links straight to your affiliate product.',
  },
  {
    name: 'Instagram',
    color: '#E1306C',
    tag: 'Reels cover + link-in-bio',
    desc: 'Use the thumbnail as a Reel cover or feed post. IG blocks links in captions, so the affiliate link routes through your Link-in-Bio shop grid automatically.',
  },
  {
    name: 'Facebook',
    color: '#1877F2',
    tag: 'Posts',
    desc: 'Post the thumbnail with an AI caption and your affiliate link inline, straight to your connected Page.',
  },
]


export default function AmazonSocialPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Share2 size={14} className="text-[#d97706]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>
            Amazon Influencer · Social Influencer
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2" style={{ color: 'var(--text)' }}>
          One thumbnail, three networks
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: 'var(--text-soft)' }}>
          Now that MVP Art Director makes scroll-stopping thumbnails, they become the raw material for great Pins and posts. Caption, affiliate link and publishing, handled.
        </p>
      </header>

      {/* Connect strip — all three accounts in one place, above the columns */}
      <SocialConnections />

      {/* Saved research finds + the Pinterest composer */}
      <SocialComposer />

      {/* Instagram + Facebook — next up */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        {PLATFORMS.filter(p => p.name !== 'Pinterest').map((p) => (
          <div key={p.name} className="flex flex-col gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${p.color}1a` }}>
                <Share2 size={16} style={{ color: p.color }} />
              </span>
              <div>
                <h2 className="text-base font-bold leading-tight" style={{ color: 'var(--text)' }}>{p.name}</h2>
                <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>{p.tag}</span>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed flex-1" style={{ color: 'var(--text-soft)' }}>{p.desc}</p>
            <span className="inline-flex w-fit items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/10" style={{ color: 'var(--text-soft)' }}>
              <Sparkles size={11} /> Composer in build
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
