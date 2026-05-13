/**
 * Push Brand Profile changes (author name, brand name, tagline, bio) to the
 * connected WordPress site.
 *
 * Reads stored Application Password from `integrations`, sends Basic Auth,
 * merges into the existing affiliateos/v1/customizations payload.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { AFFILIATEOS_FULL_PHP, AFFILIATEOS_SNIPPET_NAME } from '@/lib/wordpress-plugin'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { authorName, brandName, tagline, authorBio, primaryColor, secondaryColor } = await request.json() as {
    authorName?: string
    brandName?: string
    tagline?: string
    authorBio?: string
    primaryColor?: string
    secondaryColor?: string
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
    let frontPageId: number | undefined
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
      if (settingsRes.ok) {
        try {
          const settingsJson = await settingsRes.json() as { page_on_front?: number }
          frontPageId = settingsJson.page_on_front
        } catch { /* ignore */ }
      }
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
        ...(brandName      ? { brandName }                : {}),
        ...(tagline        ? { tagline }                  : {}),
        ...(authorName     ? { authorName }               : {}),
        ...(authorBio      ? { authorBio }                : {}),
        ...(primaryColor   ? { accentColor:    primaryColor   } : {}),
        ...(primaryColor   ? { primaryColor:   primaryColor   } : {}),
        ...(secondaryColor ? { secondaryColor: secondaryColor } : {}),
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

    // Update the home page (page_on_front) so the hero title/content reflects
    // the new brand name. Users never touch wp-admin to edit the home page.
    if (brandName && frontPageId) {
      try {
        // Fetch the current page content
        const pageRes = await fetch(`${wpBase}/wp-json/wp/v2/pages/${frontPageId}?context=edit`, {
          headers: { Authorization: authHeader },
        })
        if (pageRes.ok) {
          const page = await pageRes.json() as { title?: { raw?: string }; content?: { raw?: string } }
          const oldTitle = page.title?.raw ?? ''
          const oldContent = page.content?.raw ?? ''
          // Replace previous brand name occurrences in title + content with new one.
          // We always update the page title; for content, we do a best-effort
          // replacement of the previous brand name we sent (existingProfile.brandName).
          const previousBrand = (existingProfile.brandName as string) || oldTitle
          let newContent = oldContent
          if (previousBrand && previousBrand !== brandName) {
            // Replace all occurrences of previousBrand in content with brandName
            const escaped = previousBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            newContent = oldContent.replace(new RegExp(escaped, 'g'), brandName)
          }
          const updateRes = await fetch(`${wpBase}/wp-json/wp/v2/pages/${frontPageId}`, {
            method: 'POST',
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: brandName,
              ...(newContent !== oldContent ? { content: newContent } : {}),
            }),
          })
          debug.homePageUpdate = { id: frontPageId, ok: updateRes.ok, status: updateRes.status }
        }
      } catch (e) {
        debug.homePageError = e instanceof Error ? e.message : String(e)
      }
    }

    // Refresh the AffiliateOS Code Snippet to the latest version so logo banner,
    // color injection, and other rendering fixes propagate without re-running setup.
    // Non-fatal — if Code Snippets isn't installed or this fails, we still saved the data.
    try {
      const snippetsRes = await fetch(`${wpBase}/wp-json/code-snippets/v1/snippets?per_page=100`, {
        headers: { Authorization: authHeader },
      })
      if (snippetsRes.ok) {
        const list = await snippetsRes.json() as { snippets?: { id: number; name: string }[] } | { id: number; name: string }[]
        const snippets = Array.isArray(list) ? list : (list.snippets ?? [])
        // Match either the new canonical name OR the legacy 'AffiliateOS Core' name
        const existing = snippets.find(s =>
          s.name === AFFILIATEOS_SNIPPET_NAME ||
          s.name === 'AffiliateOS' ||
          s.name === 'AffiliateOS Core'
        )
        if (existing) {
          await fetch(`${wpBase}/wp-json/code-snippets/v1/snippets/${existing.id}`, {
            method: 'POST',
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: AFFILIATEOS_SNIPPET_NAME,
              code: AFFILIATEOS_FULL_PHP,
              active: true,
              scope: 'global',
            }),
          })
          debug.snippetRefreshed = true
        }
      }
    } catch (e) {
      debug.snippetRefreshError = e instanceof Error ? e.message : String(e)
    }

    return NextResponse.json({ ok: true, wordpress: 'pushed', debug })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: true, wordpress: 'failed', wordpressError: msg, debug })
  }
}
