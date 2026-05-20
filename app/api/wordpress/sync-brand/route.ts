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

  const body = await request.json() as {
    authorName?: string
    brandName?: string
    tagline?: string
    authorBio?: string
    primaryColor?: string
    secondaryColor?: string
    fontTheme?: string
    logoUrl?: string
    headerBannerUrl?: string
    headshotUrl?: string
    youtubeUrl?: string
    instagramUrl?: string
    tiktokUrl?: string
    twitterUrl?: string
    pinterestUrl?: string
    facebookUrl?: string
    threadsUrl?: string
    contactEmail?: string
    niches?: string[]
  }
  const {
    authorName, brandName, tagline, authorBio,
    primaryColor, secondaryColor, fontTheme, logoUrl,
    headerBannerUrl, headshotUrl,
    youtubeUrl, instagramUrl, tiktokUrl, twitterUrl,
    pinterestUrl, facebookUrl, threadsUrl, contactEmail,
    niches,
  } = body

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
    const existingAbout   = (existing.about   as Record<string, unknown>) ?? {}
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
        ...(fontTheme      ? { fontTheme:      fontTheme      } : {}),
        // Social URLs — moved from blog_customizations.footer.socials to brand profile
        ...(youtubeUrl     ? { youtubeUrl }   : {}),
        ...(instagramUrl   ? { instagramUrl } : {}),
        ...(tiktokUrl      ? { tiktokUrl }    : {}),
        ...(twitterUrl     ? { twitterUrl }   : {}),
        ...(pinterestUrl   ? { pinterestUrl } : {}),
        ...(facebookUrl    ? { facebookUrl }  : {}),
        ...(threadsUrl     ? { threadsUrl }   : {}),
        ...(contactEmail   ? { contactEmail } : {}),
        // Round About-Us photo (theme reads profile.headshotUrl).
        ...(headshotUrl    ? { headshotUrl } : {}),
      },
      about: {
        ...existingAbout,
        // logo_url stays the favicon/footer/legacy banner fallback.
        ...(logoUrl ? { logoUrl } : {}),
        // Wide top banner — theme renders this in place of the small
        // centered logo when present (falls back to logoUrl otherwise).
        ...(headerBannerUrl ? { headerBannerUrl } : {}),
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

    // ─── Sync selected Affiliate Niches → WordPress categories ────────────
    // Every niche the user has ticked on Brand Profile becomes a category on
    // their WordPress site. Idempotent: existing categories with the same
    // slug are skipped (no duplicate). We never DELETE categories — users
    // unticking a niche just stops new category creation; any existing
    // category they want to remove they can delete in wp-admin.
    if (Array.isArray(niches) && niches.length > 0) {
      const createdCategories: string[] = []
      const skippedCategories: string[] = []
      try {
        for (const nicheLabel of niches) {
          const slug = nicheLabel
            .toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
          if (!slug) continue

          // Check if a category with this slug already exists.
          const checkRes = await fetch(
            `${wpBase}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}`,
            { headers: { Authorization: authHeader } },
          )
          if (checkRes.ok) {
            const found = await checkRes.json() as Array<{ id: number; slug: string }>
            if (Array.isArray(found) && found.length > 0) {
              skippedCategories.push(slug)
              continue
            }
          }

          // Create it.
          const createRes = await fetch(`${wpBase}/wp-json/wp/v2/categories`, {
            method: 'POST',
            headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: nicheLabel, slug }),
          })
          if (createRes.ok) {
            createdCategories.push(slug)
          }
        }
        debug.nicheCategoriesCreated = createdCategories
        debug.nicheCategoriesSkipped = skippedCategories
      } catch (e) {
        debug.nicheCategoriesError = e instanceof Error ? e.message : String(e)
      }
    }

    return NextResponse.json({ ok: true, wordpress: 'pushed', debug })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: true, wordpress: 'failed', wordpressError: msg, debug })
  }
}
