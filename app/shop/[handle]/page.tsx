// Public affiliate "Shop Grid" / link-in-bio page at /shop/<handle>. Rendered
// server-side with the service-role client (only PUBLISHED pages are shown).
// Phone-first: this is what someone taps from an Instagram/TikTok bio.

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { Youtube, Instagram, Facebook, Twitter, Music2, AtSign, Globe, Link2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { themeFor, presetFor, type LinkPage, type LinkPageItem } from '@/lib/link-in-bio'

// Brand glyph for a link button (server component).
function Glyph({ slug, size = 18 }: { slug: string | null; size?: number }) {
  const m: Record<string, React.ReactNode> = {
    youtube: <Youtube size={size} />, instagram: <Instagram size={size} />, facebook: <Facebook size={size} />,
    x: <Twitter size={size} />, tiktok: <Music2 size={size} />, threads: <AtSign size={size} />,
    pinterest: <Globe size={size} />, website: <Globe size={size} />,
  }
  return <>{m[slug || ''] || <Link2 size={size} />}</>
}

// A grid of white product cards.
function ProductGrid({ items, accent }: { items: LinkPageItem[]; accent: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
      {items.map((it) => (
        <a
          key={it.id}
          href={`/api/link-click?i=${it.id}`}
          target="_blank"
          rel="nofollow sponsored noopener"
          style={{ display: 'flex', flexDirection: 'column', background: '#ffffff', borderRadius: 18, overflow: 'hidden', textDecoration: 'none', color: '#111114', boxShadow: '0 10px 30px rgba(0,0,0,0.18)' }}
        >
          <div style={{ aspectRatio: '1 / 1', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
            {it.image_url
              ? <img src={it.image_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <span style={{ color: '#9ca3af', fontSize: 13, fontWeight: 600 }}>Shop</span>}
          </div>
          <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, color: '#1d1d1f', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '2.7em' }}>
              {it.title}
            </div>
            <span style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: accent, color: '#fff', fontSize: 13, fontWeight: 700, borderRadius: 10, padding: '9px 12px' }}>
              Shop now
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>
            </span>
          </div>
        </a>
      ))}
    </div>
  )
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPage(handle: string): Promise<{ page: LinkPage; items: LinkPageItem[] } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: page } = await admin.from('link_pages').select('*').eq('handle', handle).eq('published', true).maybeSingle()
  if (!page) return null
  const { data: items } = await admin.from('link_page_items').select('*')
    .eq('page_id', page.id).eq('hidden', false).order('position', { ascending: true })
  return { page: page as LinkPage, items: (items ?? []) as LinkPageItem[] }
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params
  const data = await loadPage(handle)
  if (!data) return { title: 'Page not found' }
  const title = data.page.title || `@${data.page.handle}`
  return {
    title: `${title} — Shop my picks`,
    description: data.page.bio || `Shop ${title}'s picks and deals.`,
    robots: { index: true, follow: true },
    openGraph: { title, description: data.page.bio || undefined, images: data.page.avatar_url ? [data.page.avatar_url] : undefined },
  }
}

export default async function BioPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const data = await loadPage(handle)
  if (!data) notFound()
  const { page, items } = data
  const t = themeFor(page.theme)
  const title = page.title || `@${page.handle}`
  const initial = title.replace(/^@/, '').charAt(0).toUpperCase()
  const links = items.filter((it) => it.kind === 'link')
  const products = items.filter((it) => it.kind !== 'link')
  const currentDeals = products.filter((it) => it.in_story)
  const moreDeals = products.filter((it) => !it.in_story)
  const headingStyle: React.CSSProperties = { textAlign: 'center', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.sub, margin: '0 0 14px' }

  return (
    <main style={{ background: t.bg, color: t.text, minHeight: '100vh', backgroundAttachment: 'fixed' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px 72px' }}>
        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 30 }}>
          {page.avatar_url
            ? <img src={page.avatar_url} alt="" style={{ width: 100, height: 100, borderRadius: '9999px', objectFit: 'cover', margin: '0 auto 14px', border: '3px solid rgba(255,255,255,0.9)', boxShadow: '0 8px 28px rgba(0,0,0,0.22)' }} />
            : <div style={{ width: 100, height: 100, borderRadius: '9999px', margin: '0 auto 14px', background: 'rgba(255,255,255,0.18)', border: '3px solid rgba(255,255,255,0.9)', boxShadow: '0 8px 28px rgba(0,0,0,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, fontWeight: 800 }}>{initial}</div>}
          {/* Explicit color — a global `h1 { color: var(--text) }` rule would
              otherwise override the theme's inherited text color and make the
              title invisible (e.g. light text on the light theme). */}
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-0.01em', color: t.text }}>{title}</h1>
          {page.bio && <p style={{ fontSize: 15, color: t.sub, margin: '10px auto 0', maxWidth: 440, lineHeight: 1.55 }}>{page.bio}</p>}
        </header>

        {/* Brand links — a compact centered row of icon pills under the header. */}
        {links.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginBottom: products.length ? 34 : 0 }}>
            {links.map((it) => (
              <a
                key={it.id}
                href={`/api/link-click?i=${it.id}`}
                target="_blank"
                rel="nofollow noopener"
                title={it.title}
                aria-label={it.title}
                // Always a solid white pill so the brand-color icon stays
                // visible on any theme — dark brand marks (X, TikTok, Threads =
                // #111114) would disappear on a translucent pill over a dark or
                // colored background.
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: '9999px', background: '#ffffff', color: presetFor(it.icon).color, border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 3px 12px rgba(0,0,0,0.14)', textDecoration: 'none' }}
              >
                <Glyph slug={it.icon} size={21} />
              </a>
            ))}
          </div>
        )}

        {items.length === 0 && (
          <p style={{ textAlign: 'center', color: t.sub, fontSize: 14, marginTop: 40 }}>No picks yet — check back soon.</p>
        )}

        {/* Current deals — live in the creator's story right now (24h). */}
        {currentDeals.length > 0 && (
          <div style={{ marginBottom: moreDeals.length ? 34 : 0 }}>
            <div style={headingStyle}>🔥 In my story right now</div>
            <ProductGrid items={currentDeals} accent={t.accent} />
          </div>
        )}

        {/* Everything else the creator has found. */}
        {moreDeals.length > 0 && (
          <div>
            <div style={headingStyle}>{currentDeals.length ? 'More sales I found' : 'Shop my picks'}</div>
            <ProductGrid items={moreDeals} accent={t.accent} />
          </div>
        )}

        {/* Footer disclosure — affiliate transparency (FTC). */}
        <p style={{ textAlign: 'center', color: t.sub, fontSize: 11.5, marginTop: 40, lineHeight: 1.5, opacity: 0.9 }}>
          As an Amazon Associate, {title.replace(/^@/, '')} earns from qualifying purchases.
        </p>
      </div>
    </main>
  )
}
