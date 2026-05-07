import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { generateHomePage } from '@/lib/wordpress-home-template'

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
  // Successful login sets a wordpress_logged_in_* cookie
  const ok = rawCookies.some(c => c.includes('wordpress_logged_in_'))
  return { cookies, ok }
}

async function getNonce(siteUrl: string, cookies: string): Promise<string> {
  const res = await fetch(`${siteUrl}/wp-admin/index.php`, {
    headers: { Cookie: cookies },
  })
  const html = await res.text()

  // Try wp.apiFetch nonce middleware first
  let m = html.match(/createNonceMiddleware\("([^"]+)"\)/)
  if (m) return m[1]

  // Fallback: wpApiSettings.nonce
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

// ── route ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { siteUrl: rawUrl, username, password, accentColor = '#f5a623' } = await request.json()

    if (!rawUrl || !username || !password) {
      return NextResponse.json({ error: 'siteUrl, username, and password are required' }, { status: 400 })
    }

    let siteUrl = rawUrl.trim()
    if (!siteUrl.startsWith('http')) siteUrl = `https://${siteUrl}`
    siteUrl = siteUrl.replace(/\/wp-admin\/?.*$/, '').replace(/\/$/, '')

    // ── 1. Login ──────────────────────────────────────────────────────────────
    const { cookies, ok: loginOk } = await wpLogin(siteUrl, username, password)
    if (!loginOk) {
      return NextResponse.json({
        error: 'Login failed. Check your WordPress username and password.',
      }, { status: 400 })
    }

    // ── 2. Get nonce ──────────────────────────────────────────────────────────
    const nonce = await getNonce(siteUrl, cookies)
    const req = wpFetch(siteUrl, cookies, nonce)

    // ── 3. Verify admin ───────────────────────────────────────────────────────
    const me = await req<{ name: string; roles: string[] }>('/users/me')
    if (!me.roles?.some(r => ['administrator', 'editor'].includes(r))) {
      return NextResponse.json({
        error: `Your WordPress user "${me.name}" needs Administrator or Editor role to set up the site.`,
      }, { status: 400 })
    }

    // ── 4. Generate Application Password (for REST API Basic Auth reads) ────────
    // Also store the real WP password for login+nonce fallback on hosts that
    // strip Authorization headers on writes (e.g. Hostinger/LiteSpeed).
    let appPassword = ''
    try {
      const appPwRes = await req<{ password: string }>('/users/me/application-passwords', {
        method: 'POST',
        body: JSON.stringify({ name: 'AffiliateOS' }),
      })
      appPassword = appPwRes.password.replace(/\s+/g, '')
    } catch {
      // If App Password creation fails, use real password for Basic Auth too
      appPassword = password
    }

    // ── 5. Set site title ─────────────────────────────────────────────────────
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('name,niches')
      .eq('user_id', user.id)
      .single()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = brand as any
    const brandName: string = b?.name || 'My Review Blog'
    const niches: string[] = Array.isArray(b?.niches) ? b.niches : []

    try {
      await req('/settings', {
        method: 'POST',
        body: JSON.stringify({ title: brandName, description: `${brandName} — honest product reviews` }),
      })
    } catch { /* non-fatal */ }

    // ── 6. Create categories ──────────────────────────────────────────────────
    const categories: { name: string; slug: string; id: number }[] = []
    for (const niche of niches) {
      try {
        const slug = niche.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
        // Check for existing
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

    // ── 7. Create home page ───────────────────────────────────────────────────
    const { title, content } = generateHomePage({ brandName, accentColor, categories, siteUrl })
    const page = await req<{ id: number; link: string }>('/pages', {
      method: 'POST',
      body: JSON.stringify({ title, content, status: 'publish' }),
    })

    // ── 8. Set as front page ──────────────────────────────────────────────────
    try {
      await req('/settings', {
        method: 'POST',
        body: JSON.stringify({ show_on_front: 'page', page_on_front: page.id }),
      })
    } catch { /* non-fatal */ }

    // ── 9. Create nav menu ────────────────────────────────────────────────────
    try {
      const menu = await req<{ id: number }>('/menus', {
        method: 'POST',
        body: JSON.stringify({ name: brandName, locations: ['primary', 'primary-menu', 'main-menu'] }),
      })
      const menuItems = [
        { title: 'All Reviews', url: `${siteUrl}/` },
        ...categories.map(c => ({ title: c.name, url: `${siteUrl}/category/${c.slug}/` })),
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

    // ── 10. Save credentials ──────────────────────────────────────────────────
    await supabase.from('integrations').upsert(
      {
        user_id: user.id,
        wordpress_url: siteUrl,
        wordpress_username: username,
        wordpress_app_password: appPassword,   // Application Password — Basic Auth reads
        wordpress_api_token: password,          // Real WP password — login+nonce fallback
        setup_status: 'site_ready',
      },
      { onConflict: 'user_id' },
    )

    return NextResponse.json({
      ok: true,
      siteUrl,
      pageUrl: page.link,
      connectedAs: me.name,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/wordpress/connect-and-setup]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
