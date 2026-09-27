// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /shop/<handle>/<asin> — one product's own page on a creator's Link in Bio.
//
// Where a Pinterest pin lands when the creator chose Link in Bio (migration
// 382). The shop grid made someone who tapped a pin for one product hunt for
// it among forty; this page is that product: its picture, the button to buy
// it (the creator's affiliate link, through the same click counter as the
// grid), their review and video when they have them, and the way back to
// everything else they picked.
//
// Its title, description and picture are the product's, so the pin and the
// page it opens match. A product no longer on the page sends the visitor to
// the whole shop rather than to an error.

import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { themeFor, shopCtaLabel, type LinkPage, type LinkPageItem } from '@/lib/link-in-bio'
import { blogPostUrlForAsin } from '@/lib/pinterest-pin-dest-server'

export const runtime = 'nodejs'
export const revalidate = 60

interface Loaded { page: LinkPage; item: LinkPageItem | null; blogUrl: string | null; videoId: string | null }

async function load(handle: string, rawAsin: string): Promise<Loaded | null> {
  const asin = String(rawAsin || '').toUpperCase()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: page } = await admin.from('link_pages').select('*').eq('handle', handle).eq('published', true).maybeSingle()
  if (!page) return null
  if (!/^[A-Z0-9]{10}$/.test(asin)) return { page, item: null, blogUrl: null, videoId: null }
  const { data: item } = await admin.from('link_page_items').select('*')
    .eq('page_id', page.id).eq('asin', asin).eq('hidden', false).maybeSingle()
  if (!item) return { page, item: null, blogUrl: null, videoId: null }
  const [blogUrl, video] = await Promise.all([
    blogPostUrlForAsin(admin, page.user_id as string, asin).catch(() => null),
    admin.from('youtube_videos').select('youtube_video_id').eq('user_id', page.user_id).eq('asin', asin)
      .order('published_at', { ascending: false }).limit(1).maybeSingle().then((r: { data: { youtube_video_id?: string } | null }) => r.data?.youtube_video_id || null, () => null),
  ])
  return { page: page as LinkPage, item: item as LinkPageItem, blogUrl, videoId: video }
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string; asin: string }> }): Promise<Metadata> {
  const { handle, asin } = await params
  const data = await load(handle, asin)
  if (!data?.item) return { title: 'Shop my picks' }
  const who = data.page.title || `@${data.page.handle}`
  const description = (data.item.subtitle || '').trim() || `${who} picked this. See it, and everything else they recommend.`
  return {
    title: `${data.item.title} | ${who}`,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: `/shop/${encodeURIComponent(data.page.handle)}/${encodeURIComponent(asin.toUpperCase())}` },
    openGraph: { title: data.item.title, description, images: data.item.image_url ? [data.item.image_url] : undefined },
  }
}

export default async function ProductOnBioPage({ params }: { params: Promise<{ handle: string; asin: string }> }) {
  const { handle, asin } = await params
  const data = await load(handle, asin)
  if (!data) notFound()
  if (!data.item) redirect(`/shop/${encodeURIComponent(handle)}`)
  const { page, item, blogUrl, videoId } = data as Loaded & { item: LinkPageItem }
  const t = themeFor(page.theme)
  const accent = (page.accent || '').trim() || t.accent
  const who = page.title || `@${page.handle}`
  const secondary: React.CSSProperties = {
    display: 'block', textAlign: 'center', background: 'rgba(255,255,255,0.14)', color: t.text, border: '1px solid rgba(255,255,255,0.28)',
    fontSize: 15, fontWeight: 700, padding: '14px 18px', borderRadius: 14, textDecoration: 'none',
  }

  return (
    <main style={{ background: t.bg, color: t.text, minHeight: '100vh', backgroundAttachment: 'fixed' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 20px 64px' }}>
        <a href={`/shop/${encodeURIComponent(page.handle)}`} style={{ display: 'flex', alignItems: 'center', gap: 10, color: t.text, textDecoration: 'none', marginBottom: 20 }}>
          {page.avatar_url
            ? <img src={page.avatar_url} alt="" style={{ width: 40, height: 40, borderRadius: 9999, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.9)' }} />
            : null}
          <span style={{ fontSize: 15, fontWeight: 700 }}>{who}</span>
        </a>

        <div style={{ background: '#ffffff', borderRadius: 22, overflow: 'hidden', boxShadow: '0 14px 40px rgba(0,0,0,0.22)' }}>
          <div style={{ aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#fff' }}>
            {item.image_url
              ? <img src={item.image_url} alt={item.title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <span style={{ color: '#9ca3af', fontSize: 14, fontWeight: 600 }}>{item.title}</span>}
          </div>
          <div style={{ padding: '18px 20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Explicit colour: a global h1 rule would otherwise recolour it. */}
            <h1 style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3, margin: 0, color: '#1d1d1f' }}>{item.title}</h1>
            {item.subtitle && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: '#4b5563' }}>{item.subtitle}</p>}
            <a href={`/api/link-click?i=${item.id}`} target="_blank" rel="nofollow sponsored noopener"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: accent, color: '#fff', fontSize: 17, fontWeight: 800, borderRadius: 14, padding: '16px 18px', textDecoration: 'none' }}>
              {shopCtaLabel(item)}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>
            </a>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
          {blogUrl && <a href={blogUrl} target="_blank" rel="noopener" style={secondary}>Read my full review</a>}
          {videoId && <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener" style={secondary}>Watch my video</a>}
          <a href={`/shop/${encodeURIComponent(page.handle)}`} style={secondary}>See everything I recommend</a>
        </div>

        <p style={{ fontSize: 11, color: t.sub, opacity: 0.75, margin: '18px auto 0', maxWidth: 440, lineHeight: 1.5, textAlign: 'center' }}>
          When you purchase through the links on this page, I may earn a commission at no cost to you.
        </p>
      </div>
    </main>
  )
}
