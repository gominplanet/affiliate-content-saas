import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { generateHomePage } from '@/lib/wordpress-home-template'
import { generateAboutPage } from '@/lib/wordpress-about-template'
import { generatePrivacyPolicy } from '@/lib/wordpress-privacy-template'
import { wpLogin, getNonce } from '@/lib/wordpress-login'

export const maxDuration = 60

// ── Auth context — supports both cookie+nonce and Basic Auth (Application Passwords) ──

type AuthCtx =
  | { mode: 'basic'; header: string }
  | { mode: 'cookie'; cookies: string; nonce: string }

function authHeaders(auth: AuthCtx, extra: Record<string, string> = {}): Record<string, string> {
  if (auth.mode === 'basic') return { Authorization: auth.header, ...extra }
  return { Cookie: auth.cookies, 'X-WP-Nonce': auth.nonce, ...extra }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function wpFetch(siteUrl: string, auth: AuthCtx) {
  return async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
    const isWrite = options.method === 'POST' || options.method === 'PATCH' || options.method === 'DELETE'
    const res = await fetch(`${siteUrl}/wp-json/wp/v2${path}`, {
      ...options,
      headers: authHeaders(auth, {
        ...(isWrite ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers as Record<string, string> || {}),
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`WordPress ${res.status} on ${path}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }
}

// Legacy Code Snippets helpers + inline PHP blobs removed — the MVP Affiliate
// Plugin + Theme handle everything that these snippets used to do (REST
// endpoints, front-page template, LiteSpeed REST cache fix).

async function wpMediaUpload(
  siteUrl: string,
  auth: AuthCtx,
  base64: string,
  mime: string,
  filename: string,
): Promise<{ id: number; source_url: string }> {
  const buffer = Buffer.from(base64, 'base64')
  const res = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: authHeaders(auth, {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${filename}"`,
    }),
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
      siteUrl: rawUrl, username, password, appPassword: rawAppPassword,
      fromToken,
      accentColor = '#f5a623',
      logoBase64, logoMime, logoFilename,
      headshotBase64, headshotMime, headshotFilename,
      aboutText, contactEmail,
      youtubeUrl, instagramUrl, tiktokUrl, twitterUrl, pinterestUrl, facebookUrl,
    } = body

    // Token-based flow: credentials were already verified + stored by /connect-token.
    // Pull them out of the integrations table.
    let resolvedUrl: string | undefined = rawUrl
    let resolvedUsername: string | undefined = username
    let resolvedAppPw: string | undefined = (rawAppPassword || password || '').trim()

    if (fromToken) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: intRow } = await (supabase as any)
        .from('integrations')
        .select('wordpress_url, wordpress_username, wordpress_app_password')
        .eq('user_id', user.id)
        .single()
      if (!intRow?.wordpress_url || !intRow?.wordpress_username || !intRow?.wordpress_app_password) {
        return NextResponse.json({ error: 'No stored WordPress connection. Connect via token first.' }, { status: 400 })
      }
      resolvedUrl = intRow.wordpress_url
      resolvedUsername = intRow.wordpress_username
      resolvedAppPw = intRow.wordpress_app_password
    }

    const appPwInput = (resolvedAppPw || '').trim()
    if (!resolvedUrl || !resolvedUsername || !appPwInput) {
      return NextResponse.json({ error: 'siteUrl, username, and Application Password are required' }, { status: 400 })
    }

    let siteUrl = resolvedUrl.trim()
    if (!siteUrl.startsWith('http')) siteUrl = `https://${siteUrl}`
    siteUrl = siteUrl.replace(/\/wp-admin\/?.*$/, '').replace(/\/$/, '')

    // ── 1. Authenticate via Basic Auth + Application Password ─────────────────
    const appPwClean = appPwInput.replace(/\s+/g, '')
    const encoded = Buffer.from(`${resolvedUsername}:${appPwClean}`).toString('base64')
    const basicHeader = `Basic ${encoded}`
    const testRes = await fetch(`${siteUrl}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: basicHeader },
      signal: AbortSignal.timeout(10000),
    })
    if (!testRes.ok) {
      const errBody = await testRes.text()
      // rest_not_logged_in specifically means the Authorization header was stripped
      // by the host before WordPress could read it — common on Hostinger / some Apache setups.
      if (errBody.includes('rest_not_logged_in')) {
        return NextResponse.json({
          error: 'Your hosting strips the Authorization header before WordPress sees it (common on Hostinger).',
          hint: 'auth_header_stripped',
        }, { status: 400 })
      }
      return NextResponse.json({
        error: `Authentication failed (${testRes.status}). Generate an Application Password in wp-admin → Users → Profile → Application Passwords and paste it exactly as WordPress shows it. ${errBody.slice(0, 120)}`,
      }, { status: 400 })
    }
    const auth: AuthCtx = { mode: 'basic', header: basicHeader }

    // ── 2. Build the REST client ──────────────────────────────────────────────
    const req = wpFetch(siteUrl, auth)

    // ── 3. Get current user ───────────────────────────────────────────────────
    const me = await req<{ name: string; roles?: string[] }>('/users/me')

    // Legacy Code Snippets installation removed — users now install the
    // MVP Affiliate Plugin + Theme directly in wp-admin. See the setup
    // wizard for the new flow.

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

    // ── 4. The Application Password we just authenticated with is what we store ─
    const appPassword = appPwClean

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
        const media = await wpMediaUpload(siteUrl, auth,logoBase64, logoMime, logoFilename)
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
        const media = await wpMediaUpload(siteUrl, auth,headshotBase64, headshotMime, headshotFilename)
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

    // ── 16. Save profile/brand data to WordPress via custom endpoint ──────────
    // We use our own affiliateos/v1/customizations endpoint rather than /settings
    // because WordPress only exposes whitelisted options via the REST settings API.
    try {
      const authHeader = { Authorization: `Basic ${Buffer.from(`${resolvedUsername}:${appPwClean}`).toString('base64')}` }
      await fetch(`${siteUrl}/wp-json/affiliateos/v1/customizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          profile: {
            authorName,
            authorBio: aboutText || '',
            headshotUrl: headshotUrl || '',
            accentColor,
            youtubeUrl: youtubeUrl || '',
            instagramUrl: instagramUrl || '',
            facebookUrl: facebookUrl || '',
            pinterestUrl: pinterestUrl || '',
            tiktokUrl: tiktokUrl || '',
            twitterUrl: twitterUrl || '',
            contactEmail: contactEmail || '',
            affiliateDisclaimer,
          },
        }),
      })
    } catch { /* non-fatal */ }

    // ── 17. Save credentials + brand extras ──────────────────────────────────
    await supabase.from('integrations').upsert(
      {
        user_id: user.id,
        wordpress_url: siteUrl,
        wordpress_username: resolvedUsername,
        wordpress_app_password: appPassword,
        // wordpress_api_token historically held the wp-admin password for cookie-auth fallbacks.
        // We no longer use cookie auth — Application Password covers everything — so store the
        // same value here for backward compatibility with any code that still reads it.
        wordpress_api_token: appPassword,
        setup_status: 'site_ready',
      },
      { onConflict: 'user_id' },
    )

    // Save social/contact info + profile assets to brand_profiles for future use
    await supabase.from('brand_profiles').update({
      ...(contactEmail ? { contact_email: contactEmail } : {}),
      ...(youtubeUrl ? { youtube_channel_url: youtubeUrl } : {}),
      ...(instagramUrl ? { instagram_url: instagramUrl } : {}),
      ...(tiktokUrl ? { tiktok_url: tiktokUrl } : {}),
      ...(twitterUrl ? { twitter_url: twitterUrl } : {}),
      ...(pinterestUrl ? { pinterest_url: pinterestUrl } : {}),
      ...(facebookUrl ? { facebook_url: facebookUrl } : {}),
      ...(aboutText ? { author_bio: aboutText } : {}),
      ...(headshotUrl ? { headshot_url: headshotUrl } : {}),
    }).eq('user_id', user.id)

    // Sync social links into blog_customizations so the Customize page pre-populates correctly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingCustom } = await (supabase as any)
      .from('integrations')
      .select('blog_customizations')
      .eq('user_id', user.id)
      .single()
    const existing = existingCustom?.blog_customizations ?? {}
    const mergedCustomizations = {
      ...existing,
      profile: {
        ...(existing.profile ?? {}),
        authorName,
        authorBio: aboutText || existing.profile?.authorBio || '',
        headshotUrl: headshotUrl || existing.profile?.headshotUrl || '',
        accentColor,
        youtubeUrl:    youtubeUrl    || existing.profile?.youtubeUrl    || '',
        instagramUrl:  instagramUrl  || existing.profile?.instagramUrl  || '',
        facebookUrl:   facebookUrl   || existing.profile?.facebookUrl   || '',
        pinterestUrl:  pinterestUrl  || existing.profile?.pinterestUrl  || '',
        tiktokUrl:     tiktokUrl     || existing.profile?.tiktokUrl     || '',
        twitterUrl:    twitterUrl    || existing.profile?.twitterUrl    || '',
        contactEmail:  contactEmail  || existing.profile?.contactEmail  || '',
      },
      footer: {
        ...(existing.footer ?? {}),
        bio: aboutText || existing.footer?.bio || '',
        socials: {
          ...(existing.footer?.socials ?? {}),
          ...(youtubeUrl   ? { youtube:   youtubeUrl   } : {}),
          ...(instagramUrl ? { instagram: instagramUrl } : {}),
          ...(facebookUrl  ? { facebook:  facebookUrl  } : {}),
          ...(pinterestUrl ? { pinterest: pinterestUrl } : {}),
          ...(tiktokUrl    ? { tiktok:    tiktokUrl    } : {}),
          ...(twitterUrl   ? { twitter:   twitterUrl   } : {}),
          ...(contactEmail ? { contact:   contactEmail } : {}),
        },
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('integrations')
      .update({ blog_customizations: mergedCustomizations })
      .eq('user_id', user.id)

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
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
