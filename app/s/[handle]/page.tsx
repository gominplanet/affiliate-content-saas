// Public affiliate "Shop Grid" / link-in-bio page at /s/<handle>. Rendered
// server-side with the service-role client (only PUBLISHED pages are shown).
// Phone-first: this is what someone taps from an Instagram/TikTok bio.

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { themeFor, type LinkPage, type LinkPageItem } from '@/lib/link-in-bio'

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

  return (
    <main style={{ background: t.bg, color: t.text, minHeight: '100vh', backgroundAttachment: 'fixed' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px 72px' }}>
        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 30 }}>
          {page.avatar_url
            ? <img src={page.avatar_url} alt="" style={{ width: 100, height: 100, borderRadius: '9999px', objectFit: 'cover', margin: '0 auto 14px', border: '3px solid rgba(255,255,255,0.9)', boxShadow: '0 8px 28px rgba(0,0,0,0.22)' }} />
            : <div style={{ width: 100, height: 100, borderRadius: '9999px', margin: '0 auto 14px', background: 'rgba(255,255,255,0.18)', border: '3px solid rgba(255,255,255,0.9)', boxShadow: '0 8px 28px rgba(0,0,0,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, fontWeight: 800 }}>{initial}</div>}
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-0.01em' }}>{title}</h1>
          {page.bio && <p style={{ fontSize: 15, color: t.sub, margin: '10px auto 0', maxWidth: 440, lineHeight: 1.55 }}>{page.bio}</p>}
        </header>

        {/* Grid — solid white product cards for clarity on any theme. */}
        {items.length === 0 ? (
          <p style={{ textAlign: 'center', color: t.sub, fontSize: 14, marginTop: 40 }}>No picks yet — check back soon.</p>
        ) : (
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
                  <span style={{ marginTop: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: t.accent, color: '#fff', fontSize: 13, fontWeight: 700, borderRadius: 10, padding: '9px 12px' }}>
                    Shop now
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>
                  </span>
                </div>
              </a>
            ))}
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
