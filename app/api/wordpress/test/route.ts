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
