import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// Diagnostic endpoint — shows exactly what Hostinger returns at each login step.
// Remove before shipping to production users; only used for debugging.

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteUrl: rawUrl, username, password } = await req.json()
  const siteUrl = (rawUrl || '').replace(/\/$/, '')
  const loginUrl = `${siteUrl}/wp-login.php`

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

  function collectCookies(headers: Headers): string[] {
    const cookies: string[] = []
    if (typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
      cookies.push(...(headers as unknown as { getSetCookie: () => string[] }).getSetCookie())
    } else {
      headers.forEach((val, key) => {
        if (key.toLowerCase() === 'set-cookie') cookies.push(val)
      })
    }
    return cookies
  }

  const result: Record<string, unknown> = {}

  // ── Step 0: Basic Auth test ───────────────────────────────────────────────
  try {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64')
    const basicRes = await fetch(`${siteUrl}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: `Basic ${encoded}` },
      signal: AbortSignal.timeout(8000),
    })
    result.basicAuth = {
      status: basicRes.status,
      ok: basicRes.ok,
      body: (await basicRes.text()).slice(0, 300),
    }
  } catch (e) {
    result.basicAuth = { error: String(e) }
  }

  // ── Step 1: GET login page ────────────────────────────────────────────────
  try {
    const getRes = await fetch(loginUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
    const html = await getRes.text()
    const getCookies = collectCookies(getRes.headers)

    result.get = {
      status: getRes.status,
      url: getRes.url,
      cookies: getCookies,
      htmlSnippet: html.slice(0, 500),
      hasLoginForm: html.includes('wp-submit') || html.includes('user_login'),
      hiddenFields: [] as { name: string; value: string }[],
    }

    // Extract hidden fields
    const re = /<input[^>]+type=["']hidden["'][^>]*>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
      const nm = /name=["']([^"']+)["']/.exec(m[0])
      const vm = /value=["']([^"']*)["']/.exec(m[0])
      if (nm) {
        ;(result.get as Record<string, unknown[]>).hiddenFields.push({
          name: nm[1],
          value: vm ? vm[1] : '',
        })
      }
    }

    // ── Step 2: POST login ──────────────────────────────────────────────────
    const hiddenFields: Record<string, string> = {}
    for (const f of (result.get as { hiddenFields: { name: string; value: string }[] }).hiddenFields) {
      hiddenFields[f.name] = f.value
    }
    delete hiddenFields['log']; delete hiddenFields['pwd']; delete hiddenFields['testcookie']

    const body = new URLSearchParams({
      log: username, pwd: password, 'wp-submit': 'Log In',
      redirect_to: `${siteUrl}/wp-admin/`, testcookie: '1',
      ...hiddenFields,
    })

    const cookieHeader = [...getCookies.map(c => c.split(';')[0]), 'wordpress_test_cookie=WP Cookie check'].join('; ')

    const postRes = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader,
        Referer: loginUrl,
        Origin: siteUrl,
        'User-Agent': UA,
        Accept: 'text/html,*/*',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-User': '?1',
        'Sec-Fetch-Dest': 'document',
      },
      body: body.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    })

    const postCookies = collectCookies(postRes.headers)
    const postBody = await postRes.text().catch(() => '')

    result.post = {
      status: postRes.status,
      location: postRes.headers.get('location'),
      cookies: postCookies,
      hasLoggedInCookie: postCookies.some(c => c.includes('wordpress_logged_in_')),
      bodySnippet: postBody.slice(0, 500),
    }

  } catch (e) {
    result.getError = String(e)
  }

  return NextResponse.json(result)
}
