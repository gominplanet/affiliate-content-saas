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

  return (
    <main style={{ background: t.bg, color: t.text, minHeight: '100vh' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 18px 64px' }}>
        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 26 }}>
          {page.avatar_url
            ? <img src={page.avatar_url} alt="" style={{ width: 84, height: 84, borderRadius: '9999px', objectFit: 'cover', margin: '0 auto 12px', border: `2px solid ${t.border}` }} />
            : <div style={{ width: 84, height: 84, borderRadius: '9999px', margin: '0 auto 12px', background: t.card, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700 }}>{title.replace(/^@/, '').charAt(0).toUpperCase()}</div>}
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>{title}</h1>
          {page.bio && <p style={{ fontSize: 14, color: t.sub, margin: '8px auto 0', maxWidth: 420, lineHeight: 1.5 }}>{page.bio}</p>}
        </header>

        {/* Grid */}
        {items.length === 0 ? (
          <p style={{ textAlign: 'center', color: t.sub, fontSize: 14, marginTop: 40 }}>No picks yet — check back soon.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {items.map((it) => (
              <a
                key={it.id}
                href={`/api/link-click?i=${it.id}`}
                target="_blank"
                rel="nofollow sponsored noopener"
                style={{ display: 'flex', flexDirection: 'column', background: t.card, border: `1px solid ${t.border}`, borderRadius: 16, overflow: 'hidden', textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ aspectRatio: '1 / 1', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
                  {it.image_url
                    ? <img src={it.image_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <span style={{ color: '#9ca3af', fontSize: 12 }}>Shop</span>}
                </div>
                <div style={{ padding: '10px 12px 12px', fontSize: 13, fontWeight: 600, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {it.title}
                </div>
              </a>
            ))}
          </div>
        )}

        {/* Footer disclosure — affiliate transparency (FTC). */}
        <p style={{ textAlign: 'center', color: t.sub, fontSize: 11, marginTop: 34, lineHeight: 1.5 }}>
          As an Amazon Associate, {title.replace(/^@/, '')} earns from qualifying purchases.
        </p>
      </div>
    </main>
  )
}
