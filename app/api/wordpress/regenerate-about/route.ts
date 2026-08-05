/**
 * POST /api/wordpress/regenerate-about  { siteId?, showBio }
 *
 * Rebuilds the site's generated "About" page from the current Brand Profile and
 * the showBio toggle, and updates it in place on WordPress. `showBio: false`
 * drops the headshot + bio from the About page so the footer "About" band is the
 * only place they appear (no duplication). Best-effort: no-ops cleanly when
 * there's no site or no existing About page.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { generateAboutPage } from '@/lib/wordpress-about-template'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    const body = await request.json().catch(() => ({})) as { siteId?: string | null; showBio?: boolean }
    const showBio = body.showBio !== false

    const site = await getWordPressCredentials(supabase, ownerId, body.siteId)
    if (!site) return NextResponse.json({ ok: true, wordpress: 'not_connected' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand } = await (supabase as any)
      .from('brand_profiles')
      .select('name, author_name, author_bio, contact_email, headshot_url, primary_color, youtube_channel_url, instagram_url, tiktok_url, twitter_url, pinterest_url, facebook_url')
      .eq('user_id', ownerId)
      .maybeSingle()
    if (!brand) return NextResponse.json({ ok: true, note: 'no_brand_profile' })

    const aboutText = (brand.author_bio as string | null)?.trim() || ''
    // No bio to show AND we're not stripping it → nothing meaningful to rebuild.
    if (!aboutText && showBio) return NextResponse.json({ ok: true, note: 'no_about_text' })

    const { content } = generateAboutPage({
      brandName: (brand.name as string) || 'About',
      authorName: (brand.author_name as string | null) || undefined,
      aboutText,
      accentColor: (brand.primary_color as string | null) || '#7C3AED',
      headshotUrl: (brand.headshot_url as string | null) || undefined,
      contactEmail: (brand.contact_email as string | null) || undefined,
      youtubeUrl: (brand.youtube_channel_url as string | null) || undefined,
      instagramUrl: (brand.instagram_url as string | null) || undefined,
      tiktokUrl: (brand.tiktok_url as string | null) || undefined,
      twitterUrl: (brand.twitter_url as string | null) || undefined,
      pinterestUrl: (brand.pinterest_url as string | null) || undefined,
      facebookUrl: (brand.facebook_url as string | null) || undefined,
      showBio,
    })

    const wpBase = site.wordpress_url.replace(/\/$/, '')
    const cleanPw = site.wordpress_app_password.replace(/\s+/g, '')
    const authHeader = `Basic ${Buffer.from(`${site.wordpress_username}:${cleanPw}`).toString('base64')}`

    // Find the existing About page. The page was created with the title
    // "About <brand>", so WP may have slugged it "about" OR "about-<brand>";
    // search by title and match the slug 'about' first, else any "About …" page.
    const findRes = await fetch(`${wpBase}/wp-json/wp/v2/pages?search=${encodeURIComponent('About')}&status=publish&per_page=20&_fields=id,title,slug`, {
      headers: { Authorization: authHeader },
    }).catch(() => null)
    if (!findRes || !findRes.ok) return NextResponse.json({ ok: true, note: 'about_lookup_failed' })
    const pages = await findRes.json().catch(() => []) as Array<{ id: number; slug?: string; title?: { rendered?: string } }>
    const list = Array.isArray(pages) ? pages : []
    const aboutId =
      list.find((p) => p.slug === 'about')?.id ??
      list.find((p) => /^about\b/i.test((p.title?.rendered || '').trim()))?.id ??
      null
    if (!aboutId) return NextResponse.json({ ok: true, note: 'no_about_page' })

    const upRes = await fetch(`${wpBase}/wp-json/wp/v2/pages/${aboutId}`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }).catch(() => null)
    if (!upRes || !upRes.ok) {
      return NextResponse.json({ ok: false, error: `Couldn't update the About page (${upRes?.status ?? 'network'}).` }, { status: 502 })
    }
    return NextResponse.json({ ok: true, updated: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
