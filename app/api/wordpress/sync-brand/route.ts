/**
 * Push Brand Profile changes (author name, brand name, tagline, bio) to the
 * connected WordPress site.
 *
 * Reads stored Application Password from `integrations`, sends Basic Auth,
 * merges into the existing affiliateos/v1/customizations payload.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { authorName, brandName, tagline, authorBio } = await request.json() as {
    authorName?: string
    brandName?: string
    tagline?: string
    authorBio?: string
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.wordpress_url || !intRow?.wordpress_username || !intRow?.wordpress_app_password) {
    return NextResponse.json({ ok: true, wordpress: 'not_connected' })
  }

  const wpBase = intRow.wordpress_url.replace(/\/$/, '')
  const cleanPw = intRow.wordpress_app_password.replace(/\s+/g, '')
  const authHeader = `Basic ${Buffer.from(`${intRow.wordpress_username}:${cleanPw}`).toString('base64')}`

  const debug: Record<string, unknown> = {}

  try {
    // Update WP user display name
    if (authorName) {
      const userRes = await fetch(`${wpBase}/wp-json/wp/v2/users/me`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: authorName, nickname: authorName }),
      }).catch((e) => ({ ok: false, status: 0, text: () => Promise.resolve(String(e)) } as Response))
      debug.userUpdate = { ok: userRes.ok, status: userRes.status }
      if (!userRes.ok) {
        debug.userUpdateBody = (await userRes.text()).slice(0, 200)
      }
    }

    // Update site title + tagline via WP Settings API so they flow through
    // the theme natively (header, footer, browser tab, RSS, etc.)
    if (brandName || tagline) {
      const settingsBody: Record<string, string> = {}
      if (brandName) settingsBody.title       = brandName
      if (tagline)   settingsBody.description = tagline
      const settingsRes = await fetch(`${wpBase}/wp-json/wp/v2/settings`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsBody),
      }).catch((e) => ({ ok: false, status: 0, text: () => Promise.resolve(String(e)) } as Response))
      debug.settingsUpdate = { ok: settingsRes.ok, status: settingsRes.status }
      if (!settingsRes.ok) {
        const body = await settingsRes.text()
        debug.settingsUpdateBody = body.slice(0, 300)
        return NextResponse.json({
          ok: true, wordpress: 'failed',
          wordpressError: `WordPress rejected the site title/tagline update (${settingsRes.status}). Make sure your user has admin rights. ${body.slice(0, 150)}`,
          debug,
        })
      }
    }

    // Merge into existing customizations
    let existing: Record<string, unknown> = {}
    try {
      const getRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
        headers: { Authorization: authHeader },
      })
      if (getRes.ok) existing = await getRes.json() as Record<string, unknown>
    } catch { /* start fresh */ }

    const existingProfile = (existing.profile as Record<string, unknown>) ?? {}
    const merged = {
      ...existing,
      profile: {
        ...existingProfile,
        ...(brandName  ? { brandName }  : {}),
        ...(tagline    ? { tagline }    : {}),
        ...(authorName ? { authorName } : {}),
        ...(authorBio  ? { authorBio }  : {}),
      },
    }

    const postRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(merged),
    })

    if (!postRes.ok) {
      const text = await postRes.text()
      let msg: string
      if (postRes.status === 401 || postRes.status === 403) {
        msg = 'WordPress rejected the Application Password. Reconnect WordPress in Site & Integrations.'
      } else if (postRes.status === 404) {
        msg = 'MVP Affiliate plugin not responding. Make sure it\'s activated in wp-admin → Plugins.'
      } else {
        msg = `WordPress returned ${postRes.status}: ${text.slice(0, 200)}`
      }
      return NextResponse.json({ ok: true, wordpress: 'failed', wordpressError: msg })
    }

    return NextResponse.json({ ok: true, wordpress: 'pushed', debug })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: true, wordpress: 'failed', wordpressError: msg, debug })
  }
}
