import { NextResponse } from 'next/server'
import { createWordPressService } from '@/services/wordpress'
import { createServerClient } from '@/lib/supabase/server'
import { assertPublicHttpUrl, SsrfBlocked } from '@/lib/ssrf-guard'

export const maxDuration = 20

export async function POST(request: Request) {
  try {
    // Auth gate — discovered during 2026-06-02 audit that this route
    // was completely unauthenticated, making it a classic SSRF probe
    // (attacker posts any URL, server fetches it, response status +
    // body prefix leak back). Now requires a signed-in user.
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { url, username, password } = await request.json()

    if (!url || !username || !password) {
      return NextResponse.json({ error: 'url, username, and password are required' }, { status: 400 })
    }

    // SSRF guard — reject private/loopback/metadata addresses BEFORE
    // any fetch fires. Without this, a logged-in attacker could probe
    // internal AWS/GCP metadata, localhost, or VPC services and leak
    // response status + first 150 bytes via the returned error string.
    try {
      assertPublicHttpUrl(url)
    } catch (e) {
      if (e instanceof SsrfBlocked) {
        return NextResponse.json({ ok: false, step: 'reach', error: e.message }, { status: 400 })
      }
      throw e
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

    // ── Step 2: Basic Auth with Application Password (the only supported path) ──
    const encoded = Buffer.from(`${username}:${cleanPassword}`).toString('base64')
    const basicRes = await fetch(`${baseUrl}/users/me`, {
      headers: { Authorization: `Basic ${encoded}` },
    })

    if (basicRes.ok) {
      const me = await basicRes.json()
      injectCss(url, username, password) // fire-and-forget
      return NextResponse.json({ ok: true, username: me.name, message: `✓ Connected as "${me.name}"` })
    }

    if (basicRes.status === 401 || basicRes.status === 403) {
      return NextResponse.json({
        ok: false, step: 'auth',
        error: 'Wrong username or Application Password. Make sure you generated an Application Password in wp-admin → Users → Profile → Application Passwords — your regular login password will not work here.',
      })
    }

    const body = await basicRes.text()
    return NextResponse.json({
      ok: false, step: 'auth',
      error: `WordPress returned ${basicRes.status}: ${body.slice(0, 150)}`,
    })

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
