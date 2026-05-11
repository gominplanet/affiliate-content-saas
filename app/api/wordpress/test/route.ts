import { NextResponse } from 'next/server'
import { createWordPressService } from '@/services/wordpress'

export const maxDuration = 20

export async function POST(request: Request) {
  try {
    const { url, username, password } = await request.json()

    if (!url || !username || !password) {
      return NextResponse.json({ error: 'url, username, and password are required' }, { status: 400 })
    }

    const siteUrl = url.replace(/\/$/, '')
    const baseUrl = `${siteUrl}/wp-json/wp/v2`
    const cleanPassword = password.replace(/\s+/g, '')

    // ── Step 1: Check site is reachable ───────────────────────────────────────
    try {
      const siteRes = await fetch(`${siteUrl}/wp-json/`, { signal: AbortSignal.timeout(8000) })
      if (!siteRes.ok) {
        return NextResponse.json({ ok: false, step: 'reach', error: `Could not reach ${siteUrl} (HTTP ${siteRes.status}). Check the URL.` })
      }
    } catch {
      return NextResponse.json({ ok: false, step: 'reach', error: `Could not reach your WordPress site. Check the URL.` })
    }

    // ── Step 2: Try Basic auth first ──────────────────────────────────────────
    const encoded = Buffer.from(`${username}:${cleanPassword}`).toString('base64')
    const basicHeaders = { Authorization: `Basic ${encoded}` }

    const basicRes = await fetch(`${baseUrl}/users/me`, { headers: basicHeaders })

    if (basicRes.ok) {
      const me = await basicRes.json()
      injectCss(url, username, password) // fire-and-forget
      return NextResponse.json({ ok: true, username: me.name, message: `✓ Connected as "${me.name}"` })
    }

    // ── Step 3: Basic auth failed — try cookie/nonce login (works on Hostinger) ──
    try {
      const loginBody = new URLSearchParams({
        log: username,
        pwd: cleanPassword,
        'wp-submit': 'Log In',
        redirect_to: '/wp-admin/',
        testcookie: '1',
      })

      const loginRes = await fetch(`${siteUrl}/wp-login.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: 'wordpress_test_cookie=WP+Cookie+check',
        },
        body: loginBody.toString(),
        redirect: 'manual',
      })

      // Extract cookies
      let rawCookies: string[] = []
      if (typeof (loginRes.headers as Record<string, unknown>).getSetCookie === 'function') {
        rawCookies = (loginRes.headers as Record<string, unknown> & { getSetCookie: () => string[] }).getSetCookie()
      } else {
        loginRes.headers.forEach((val, key) => {
          if (key.toLowerCase() === 'set-cookie') rawCookies.push(...val.split(/,(?=\s*\w[^=,]*=)/))
        })
      }

      const authCookies = rawCookies
        .map(c => c.split(';')[0].trim())
        .filter(c => c.startsWith('wordpress_') || c.startsWith('wp-settings'))
        .join('; ')

      if (!authCookies) {
        return NextResponse.json({
          ok: false, step: 'auth',
          error: 'Login failed — wrong username or password. Make sure you\'re using your wp-admin login credentials.',
        })
      }

      // Get a nonce from wp-admin
      const adminRes = await fetch(`${siteUrl}/wp-admin/`, {
        headers: { Cookie: authCookies },
        redirect: 'follow',
      })
      const html = await adminRes.text()
      const nonceMatch = html.match(/"nonce"\s*:\s*"([a-zA-Z0-9]{8,12})"/)
        || html.match(/wpApiSettings\s*=\s*\{[^}]*?"nonce"\s*:\s*"([^"]{8,12})"/)
      const nonce = nonceMatch?.[1]

      const cookieHeaders: Record<string, string> = { Cookie: authCookies }
      if (nonce) cookieHeaders['X-WP-Nonce'] = nonce

      const meRes = await fetch(`${baseUrl}/users/me${nonce ? `?_wpnonce=${nonce}` : ''}`, {
        headers: cookieHeaders,
      })

      if (!meRes.ok) {
        const body = await meRes.text()
        return NextResponse.json({
          ok: false, step: 'auth',
          error: `Authentication failed (${meRes.status}). ${body.slice(0, 150)}`,
        })
      }

      const me = await meRes.json()
      injectCss(url, username, password) // fire-and-forget
      return NextResponse.json({ ok: true, username: me.name, message: `✓ Connected as "${me.name}"` })

    } catch (cookieErr) {
      const msg = cookieErr instanceof Error ? cookieErr.message : String(cookieErr)
      return NextResponse.json({ ok: false, step: 'auth', error: `Authentication failed: ${msg}` })
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, step: 'unknown', error: msg }, { status: 500 })
  }
}

function injectCss(url: string, username: string, password: string) {
  const THUMBNAIL_CSS = `.post-thumbnail img,.wp-post-image,.wp-block-post-featured-image img,.entry-thumbnail img,.featured-image img{width:100%!important;height:auto!important;aspect-ratio:16/9;object-fit:cover}`
  try {
    const wpService = createWordPressService(url, username, password)
    wpService.injectGlobalCss(THUMBNAIL_CSS, 'gomin-thumbnail-ratio').catch(() => {})
  } catch { /* non-fatal */ }
}
