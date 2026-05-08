import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { generateHomePage } from '@/lib/wordpress-home-template'
import { generateAboutPage } from '@/lib/wordpress-about-template'
import { generatePrivacyPolicy } from '@/lib/wordpress-privacy-template'

export const maxDuration = 60

// ── helpers ───────────────────────────────────────────────────────────────────

function buildCookieHeader(rawSetCookie: string[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const raw of rawSetCookie) {
    const kv = raw.split(';')[0].trim()
    const key = kv.split('=')[0]
    if (!seen.has(key)) {
      seen.add(key)
      parts.push(kv)
    }
  }
  return parts.join('; ')
}

async function wpLogin(
  siteUrl: string,
  username: string,
  password: string,
): Promise<{ cookies: string; ok: boolean }> {
  const body = new URLSearchParams({
    log: username,
    pwd: password,
    'wp-submit': 'Log In',
    redirect_to: '/wp-admin/',
    testcookie: '1',
  })
  const res = await fetch(`${siteUrl}/wp-login.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: 'wordpress_test_cookie=WP+Cookie+check',
    },
    body: body.toString(),
    redirect: 'manual',
  })

  const rawCookies: string[] = []
  res.headers.forEach((value, name) => {
    if (name.toLowerCase() === 'set-cookie') rawCookies.push(value)
  })

  const cookies = buildCookieHeader(rawCookies)
  const ok = rawCookies.some(c => c.includes('wordpress_logged_in_'))
  return { cookies, ok }
}

async function getNonce(siteUrl: string, cookies: string): Promise<string> {
  const res = await fetch(`${siteUrl}/wp-admin/index.php`, {
    headers: { Cookie: cookies },
  })
  const html = await res.text()
  let m = html.match(/createNonceMiddleware\("([^"]+)"\)/)
  if (m) return m[1]
  m = html.match(/"nonce"\s*:\s*"([^"]+)"/)
  if (m) return m[1]
  throw new Error('Could not extract WP nonce. Make sure your credentials have admin access.')
}

function wpFetch(siteUrl: string, cookies: string, nonce: string) {
  return async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${siteUrl}/wp-json/wp/v2${path}`, {
      ...options,
      headers: {
        Cookie: cookies,
        'X-WP-Nonce': nonce,
        ...(options.method === 'POST' || options.method === 'PATCH'
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(options.headers as Record<string, string> || {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`WordPress ${res.status} on ${path}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }
}

async function wpMediaUpload(
  siteUrl: string,
  cookies: string,
  nonce: string,
  base64: string,
  mime: string,
  filename: string,
): Promise<{ id: number; source_url: string }> {
  const buffer = Buffer.from(base64, 'base64')
  const res = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Cookie: cookies,
      'X-WP-Nonce': nonce,
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: buffer as BodyInit,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Media upload failed ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<{ id: number; source_url: string }>
}

// ── route ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const {
      siteUrl: rawUrl, username, password, accentColor = '#f5a623',
      logoBase64, logoMime, logoFilename,
      headshotBase64, headshotMime, headshotFilename,
      aboutText, contactEmail,
      youtubeUrl, instagramUrl, tiktokUrl, twitterUrl, pinterestUrl, facebookUrl,
    } = body

    if (!rawUrl || !username || !password) {
      return NextResponse.json({ error: 'siteUrl, username, and password are required' }, { status: 400 })
    }

    let siteUrl = rawUrl.trim()
    if (!siteUrl.startsWith('http')) siteUrl = `https://${siteUrl}`
    siteUrl = siteUrl.replace(/\/wp-admin\/?.*$/, '').replace(/\/$/, '')

    // ── 1. Login ──────────────────────────────────────────────────────────────
    const { cookies, ok: loginOk } = await wpLogin(siteUrl, username, password)
    if (!loginOk) {
      return NextResponse.json({ error: 'Login failed. Check your WordPress username and password.' }, { status: 400 })
    }

    // ── 2. Get nonce ──────────────────────────────────────────────────────────
    const nonce = await getNonce(siteUrl, cookies)
    const req = wpFetch(siteUrl, cookies, nonce)

    // ── 3. Get current user ───────────────────────────────────────────────────
    const me = await req<{ name: string; roles?: string[] }>('/users/me')

    // ── 3b. Delete default WordPress content ─────────────────────────────────
    try {
      const [defaultPosts, defaultPages] = await Promise.all([
        req<{ id: number; slug: string }[]>('/posts?per_page=20&status=any'),
        req<{ id: number; slug: string }[]>('/pages?per_page=20&status=any'),
      ])
      const junkSlugs = new Set(['hello-world', 'sample-page', 'privacy-policy'])
      await Promise.all([
        ...defaultPosts.filter(p => junkSlugs.has(p.slug)).map(p =>
          req(`/posts/${p.id}?force=true`, { method: 'DELETE' }),
        ),
        ...defaultPages.filter(p => junkSlugs.has(p.slug)).map(p =>
          req(`/pages/${p.id}?force=true`, { method: 'DELETE' }),
        ),
      ])
    } catch { /* non-fatal */ }

    // ── 4. Generate Application Password ─────────────────────────────────────
    let appPassword = ''
    try {
      const appPwRes = await req<{ password: string }>('/users/me/application-passwords', {
        method: 'POST',
        body: JSON.stringify({ name: 'AffiliateOS' }),
      })
      appPassword = appPwRes.password.replace(/\s+/g, '')
    } catch {
      appPassword = password
    }

    // ── 5. Load brand profile ─────────────────────────────────────────────────
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('name,niches,tagline,author_name,affiliate_disclaimer')
      .eq('user_id', user.id)
      .single()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = brand as any
    const brandName: string = b?.name || 'My Review Blog'
    const niches: string[] = Array.isArray(b?.niches) ? b.niches : []
    const tagline: string = b?.tagline || ''
    const authorName: string = b?.author_name || ''
    const affiliateDisclaimer: string = b?.affiliate_disclaimer || ''

    // ── 6. Set site title ─────────────────────────────────────────────────────
    try {
      await req('/settings', {
        method: 'POST',
        body: JSON.stringify({
          title: brandName,
          description: tagline || `${brandName} — honest product reviews`,
        }),
      })
    } catch { /* non-fatal */ }

    // ── 7. Upload logo → set as favicon ──────────────────────────────────────
    let logoMediaId: number | undefined
    if (logoBase64 && logoMime && logoFilename) {
      try {
        const media = await wpMediaUpload(siteUrl, cookies, nonce, logoBase64, logoMime, logoFilename)
        logoMediaId = media.id
        await req('/settings', {
          method: 'POST',
          body: JSON.stringify({ site_icon: media.id }),
        })
      } catch { /* non-fatal */ }
    }

    // ── 8. Upload headshot ────────────────────────────────────────────────────
    let headshotUrl: string | undefined
    if (headshotBase64 && headshotMime && headshotFilename) {
      try {
        const media = await wpMediaUpload(siteUrl, cookies, nonce, headshotBase64, headshotMime, headshotFilename)
        headshotUrl = media.source_url
      } catch { /* non-fatal */ }
    }

    // ── 9. Create categories ──────────────────────────────────────────────────
    const categories: { name: string; slug: string; id: number }[] = []
    for (const niche of niches) {
      try {
        const slug = niche.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        const existing = await req<{ id: number; slug: string }[]>(
          `/categories?search=${encodeURIComponent(niche)}&per_page=5`,
        )
        const match = existing.find(c => c.slug === slug)
        if (match) {
          categories.push({ name: niche, slug, id: match.id })
        } else {
          const created = await req<{ id: number }>('/categories', {
            method: 'POST',
            body: JSON.stringify({ name: niche, slug }),
          })
          categories.push({ name: niche, slug, id: created.id })
        }
      } catch { /* skip */ }
    }

    // ── 10. Create or update home page ───────────────────────────────────────
    const { title, content } = generateHomePage({
      brandName, accentColor, categories, siteUrl, tagline,
      youtubeUrl, instagramUrl, tiktokUrl, twitterUrl, pinterestUrl, facebookUrl,
      contactEmail, affiliateDisclaimer,
    })

    // If a front page is already set, update it instead of creating a new one
    let page: { id: number; link: string }
    try {
      const settings = await req<{ page_on_front?: number; show_on_front?: string }>('/settings')
      if (settings.show_on_front === 'page' && settings.page_on_front) {
        page = await req<{ id: number; link: string }>(`/pages/${settings.page_on_front}`, {
          method: 'PATCH',
          body: JSON.stringify({ title, content }),
        })
      } else {
        throw new Error('no front page set')
      }
    } catch {
      page = await req<{ id: number; link: string }>('/pages', {
        method: 'POST',
        body: JSON.stringify({ title, content, status: 'publish' }),
      })
    }

    // ── 11. Set as front page ─────────────────────────────────────────────────
    try {
      await req('/settings', {
        method: 'POST',
        body: JSON.stringify({ show_on_front: 'page', page_on_front: page.id }),
      })
    } catch { /* non-fatal */ }

    // ── 12. Create About page ─────────────────────────────────────────────────
    let aboutPageUrl: string | undefined
    if (aboutText) {
      try {
        const { title: aTitle, content: aContent } = generateAboutPage({
          brandName, authorName, aboutText, accentColor, headshotUrl,
          contactEmail, youtubeUrl, instagramUrl, tiktokUrl, twitterUrl, pinterestUrl, facebookUrl,
        })
        const aboutPage = await req<{ id: number; link: string }>('/pages', {
          method: 'POST',
          body: JSON.stringify({ title: aTitle, content: aContent, status: 'publish' }),
        })
        aboutPageUrl = aboutPage.link
      } catch { /* non-fatal */ }
    }

    // ── 13. Create Privacy Policy page ────────────────────────────────────────
    try {
      const { title: ppTitle, content: ppContent } = generatePrivacyPolicy(brandName, siteUrl, contactEmail)
      await req('/pages', {
        method: 'POST',
        body: JSON.stringify({ title: ppTitle, content: ppContent, status: 'publish' }),
      })
    } catch { /* non-fatal */ }

    // ── 14. Disable comments site-wide ───────────────────────────────────────
    try {
      await req('/settings', {
        method: 'POST',
        body: JSON.stringify({ default_comment_status: 'closed', default_ping_status: 'closed' }),
      })
      // Close comments on all existing posts and pages
      const [existingPosts, existingPages] = await Promise.all([
        req<{ id: number }[]>('/posts?per_page=100&status=publish'),
        req<{ id: number }[]>('/pages?per_page=100&status=publish'),
      ])
      await Promise.all([
        ...existingPosts.map(p => req(`/posts/${p.id}`, { method: 'PATCH', body: JSON.stringify({ comment_status: 'closed', ping_status: 'closed' }) })),
        ...existingPages.map(p => req(`/pages/${p.id}`, { method: 'PATCH', body: JSON.stringify({ comment_status: 'closed', ping_status: 'closed' }) })),
      ])
    } catch { /* non-fatal */ }

    // ── 14b. Inject CSS to hide empty Kadence footer widget areas ────────────
    try {
      const kadenceCss = `.footer-widget-area:empty,.site-footer .widget-area:empty{display:none!important}.site-footer .footer-widget-area .widget:only-child:empty{display:none!important}`
      await req('/settings', {
        method: 'POST',
        body: JSON.stringify({ custom_css: kadenceCss }),
      })
    } catch { /* non-fatal */ }

    // ── 15. Create nav menu ───────────────────────────────────────────────────
    try {
      // Discover which location slugs this theme actually registers
      let locationSlugs: string[] = ['primary']
      try {
        const locs = await req<Record<string, unknown>[]>('/menu-locations')
        if (Array.isArray(locs) && locs.length) {
          locationSlugs = locs.map((l: Record<string, unknown>) => l.slug as string).filter(Boolean)
        }
      } catch { /* use default */ }

      const menu = await req<{ id: number }>('/menus', {
        method: 'POST',
        body: JSON.stringify({ name: brandName, locations: locationSlugs }),
      })
      // Also PATCH to ensure locations are assigned (some WP versions need this)
      try {
        await req(`/menus/${menu.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ locations: locationSlugs }),
        })
      } catch { /* non-fatal */ }

      const menuItems = [
        { title: 'All Reviews', url: `${siteUrl}/` },
        ...categories.map(c => ({ title: c.name, url: `${siteUrl}/category/${c.slug}/` })),
        ...(aboutPageUrl ? [{ title: 'About', url: aboutPageUrl }] : []),
      ]
      await Promise.all(menuItems.map((item, i) =>
        req('/menu-items', {
          method: 'POST',
          body: JSON.stringify({
            title: item.title,
            url: item.url,
            menus: menu.id,
            menu_order: i + 1,
            type: 'custom',
            status: 'publish',
          }),
        }),
      ))
    } catch { /* non-fatal */ }

    // ── 16. Save brand options to WordPress (used by front-page.php) ─────────
    try {
      await req('/settings', {
        method: 'POST',
        body: JSON.stringify({
          affiliateos_accent_color: accentColor,
          affiliateos_about_text: aboutText || '',
          affiliateos_author_name: authorName,
          affiliateos_author_img: headshotUrl || '',
          affiliateos_youtube_url: youtubeUrl || '',
          affiliateos_instagram_url: instagramUrl || '',
          affiliateos_tiktok_url: tiktokUrl || '',
          affiliateos_twitter_url: twitterUrl || '',
          affiliateos_pinterest_url: pinterestUrl || '',
          affiliateos_facebook_url: facebookUrl || '',
          affiliateos_contact_email: contactEmail || '',
          affiliateos_disclaimer: affiliateDisclaimer,
        }),
      })
    } catch { /* non-fatal */ }

    // ── 17. Save credentials + brand extras ──────────────────────────────────
    await supabase.from('integrations').upsert(
      {
        user_id: user.id,
        wordpress_url: siteUrl,
        wordpress_username: username,
        wordpress_app_password: appPassword,
        wordpress_api_token: password,
        setup_status: 'site_ready',
      },
      { onConflict: 'user_id' },
    )

    // Save social/contact info to brand_profiles for future use
    await supabase.from('brand_profiles').update({
      ...(contactEmail ? { contact_email: contactEmail } : {}),
      ...(youtubeUrl ? { youtube_channel_url: youtubeUrl } : {}),
      ...(instagramUrl ? { instagram_url: instagramUrl } : {}),
      ...(tiktokUrl ? { tiktok_url: tiktokUrl } : {}),
      ...(twitterUrl ? { twitter_url: twitterUrl } : {}),
      ...(pinterestUrl ? { pinterest_url: pinterestUrl } : {}),
      ...(facebookUrl ? { facebook_url: facebookUrl } : {}),
    }).eq('user_id', user.id)

    return NextResponse.json({
      ok: true,
      siteUrl,
      pageUrl: page.link,
      connectedAs: me.name,
      logoSet: !!logoMediaId,
      aboutPageCreated: !!aboutPageUrl,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/wordpress/connect-and-setup]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
