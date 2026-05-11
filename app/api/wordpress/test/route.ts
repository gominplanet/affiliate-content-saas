import { NextResponse } from 'next/server'
import { createWordPressService } from '@/services/wordpress'

export const maxDuration = 15

export async function POST(request: Request) {
  try {
    const { url, username, password, apiToken } = await request.json()

    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    const baseUrl = `${url.replace(/\/$/, '')}/wp-json/wp/v2`

    // ── Build auth headers ─────────────────────────────────────────────────────
    // Prefer API token (bypasses Hostinger/LiteSpeed header stripping)
    let authHeaders: Record<string, string>
    if (apiToken) {
      authHeaders = { 'X-Content-Tool-Token': apiToken }
    } else if (username && password) {
      const cleanPassword = password.replace(/\s+/g, '')
      const encoded = Buffer.from(`${username}:${cleanPassword}`).toString('base64')
      authHeaders = { Authorization: `Basic ${encoded}` }
    } else {
      return NextResponse.json({ error: 'Provide an API token or username + password' }, { status: 400 })
    }

    // Step 1: Check if WP REST API is reachable
    let siteRes
    try {
      siteRes = await fetch(`${url.replace(/\/$/, '')}/wp-json/`, {
        headers: authHeaders,
      })
    } catch {
      return NextResponse.json({
        ok: false,
        step: 'reach',
        error: 'Could not reach your WordPress site. Check the URL.',
      })
    }

    if (!siteRes.ok) {
      return NextResponse.json({
        ok: false,
        step: 'reach',
        error: `WordPress returned HTTP ${siteRes.status}. Check your site URL.`,
      })
    }

    // Step 2: Check authentication — /users/me
    const meRes = await fetch(`${baseUrl}/users/me`, {
      headers: authHeaders,
    })

    if (!meRes.ok) {
      const body = await meRes.text()
      const hint = apiToken
        ? 'API token rejected — check that the mu-plugin is installed and CONTENT_TOOL_TOKEN matches.'
        : 'Wrong username or Application Password.'
      return NextResponse.json({
        ok: false,
        step: 'auth',
        error: `Authentication failed (${meRes.status}). ${hint} ${body.slice(0, 200)}`,
      })
    }

    const me = await meRes.json()

    // Inject global CSS for 16:9 thumbnail display (idempotent)
    const THUMBNAIL_CSS = `.post-thumbnail img,.wp-post-image,.wp-block-post-featured-image img,.entry-thumbnail img,.featured-image img{width:100%!important;height:auto!important;aspect-ratio:16/9;object-fit:cover}`
    try {
      const wpService = createWordPressService(url, username || '', password || '')
      await wpService.injectGlobalCss(THUMBNAIL_CSS, 'gomin-thumbnail-ratio')
    } catch { /* non-fatal — CSS injection is best-effort */ }

    return NextResponse.json({
      ok: true,
      username: me.name,
      message: `✓ Connected as "${me.name}"`,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, step: 'unknown', error: msg }, { status: 500 })
  }
}
