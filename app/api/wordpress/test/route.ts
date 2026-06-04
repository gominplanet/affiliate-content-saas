import { NextResponse } from 'next/server'
import { createWordPressService } from '@/services/wordpress'
import { createServerClient } from '@/lib/supabase/server'
import { assertPublicHttpUrl, SsrfBlocked } from '@/lib/ssrf-guard'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

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

    const body = await request.json().catch(() => ({})) as {
      url?: string
      username?: string
      password?: string
      // When true (or when password is missing), the server reads the
      // credentials from getWordPressCredentials() instead of trusting
      // the client. This fixes the long-standing bug where the setup
      // page passed the ENCRYPTED ciphertext (loaded raw from Supabase
      // by setup/page.tsx) as the password, which WP always rejected
      // with 401 → "wrong password" — even though the saved Application
      // Password was actually fine. The client-supplied path stays for
      // the wizard flow where a fresh password is being entered before
      // it's saved to the DB.
      useStored?: boolean
      siteId?: string | null
    }

    let { url, username, password } = body
    const useStored = body.useStored === true || (!password && !!user)

    if (useStored) {
      const stored = await getWordPressCredentials(supabase, user.id, body.siteId ?? null)
      if (!stored) {
        return NextResponse.json({
          ok: false,
          step: 'no_creds',
          error: 'No WordPress credentials saved yet. Connect your site below first.',
        })
      }
      url = stored.wordpress_url
      username = stored.wordpress_username
      password = stored.wordpress_app_password
    }

    if (!url || !username || !password) {
      return NextResponse.json({ error: 'url, username, and password are required (or set useStored:true to test the saved credentials)' }, { status: 400 })
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

    const errBody = await basicRes.text()
    return NextResponse.json({
      ok: false, step: 'auth',
      error: `WordPress returned ${basicRes.status}: ${errBody.slice(0, 150)}`,
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
