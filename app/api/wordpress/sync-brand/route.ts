/**
 * Push Brand Profile changes (author name, brand name, tagline, bio) to the
 * connected WordPress site.
 *
 * Reads stored Application Password from `integrations`, sends Basic Auth,
 * merges into the existing affiliateos/v1/customizations payload.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { tryWpProxy } from '@/lib/wp-proxy'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  // 2026-06-09 Phase 2 (VA): brand sync pushes the owner's brand_profiles
  // values to the owner's WP site. /brand UI is route-blocked for VAs but
  // the auto-sync triggered by other surfaces still routes through here.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

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
    /** Multi-site (Pro): which site to sync the brand to. Omit → default
     *  site. Brand profile is per-user; multi-site users sync the same
     *  brand to each site individually. */
    siteId?: string | null
  }
  const {
    authorName, brandName, tagline, authorBio,
    primaryColor, secondaryColor, fontTheme, logoUrl,
    headerBannerUrl, headshotUrl,
    youtubeUrl, instagramUrl, tiktokUrl, twitterUrl,
    pinterestUrl, facebookUrl, threadsUrl, contactEmail,
    niches,
  } = body

  // Multi-site: target the specific site if siteId provided; default site otherwise.
  const site = await getWordPressCredentials(supabase, ownerId, body.siteId)
  if (!site) {
    return NextResponse.json({ ok: true, wordpress: 'not_connected' })
  }

  // Stored banner + logo from OUR source of truth (brand_profiles). We
  // always seed the `about` merge with these so a partial sync (e.g. a
  // logo-only upload) or a failed customizations-GET can never drop the
  // header banner the user already saved.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brandRow } = await supabase
    .from('brand_profiles')
    .select('header_banner_url, logo_url')
    .eq('user_id', ownerId)
    .single()
  const storedBannerUrl = (brandRow?.header_banner_url as string | null)?.trim() || null
  const storedLogoUrl = (brandRow?.logo_url as string | null)?.trim() || null

  const wpBase = site.wordpress_url.replace(/\/$/, '')
  const cleanPw = site.wordpress_app_password.replace(/\s+/g, '')
  const authHeader = `Basic ${Buffer.from(`${site.wordpress_username}:${cleanPw}`).toString('base64')}`

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
        // Seed from our stored source of truth FIRST so the banner/logo
        // persist even if the live customizations GET failed (existingAbout
        // empty) or this sync's payload omits them (e.g. logo-only upload).
        ...(storedLogoUrl ? { logoUrl: storedLogoUrl } : {}),
        ...(storedBannerUrl ? { headerBannerUrl: storedBannerUrl } : {}),
        // Then let an explicit value in THIS request win (a fresh upload).
        ...(logoUrl ? { logoUrl } : {}),
        // Wide top banner — theme renders this in place of the small
        // centered logo when present (falls back to logoUrl otherwise).
        ...(headerBannerUrl ? { headerBannerUrl } : {}),
      },
    }

    // Prefer the body-auth proxy (plugin v1.0.25+) so Hostinger LiteSpeed
    // and similar hosts that strip Authorization on POST still get the
    // brand sync. Falls back to Basic Auth on plugin-too-old / no-secret.
    const proxied = await tryWpProxy({
      siteUrl: wpBase,
      proxySecret: site.wordpress_api_token,
      innerPath: '/affiliateos/v1/customizations',
      method: 'POST',
      body: merged,
    })

    let postOk = false
    let postStatus = 0
    let postText = ''
    if (proxied) {
      postOk = proxied.ok
      postStatus = proxied.status
      if (!postOk) postText = typeof proxied.data === 'string' ? proxied.data : JSON.stringify(proxied.data)
    } else {
      const postRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      })
      postOk = postRes.ok
      postStatus = postRes.status
      if (!postOk) postText = await postRes.text()
    }

    if (!postOk) {
      let msg: string
      if (postStatus === 401 || postStatus === 403) {
        msg = 'WordPress rejected the Application Password. Reconnect WordPress in Site & Integrations.'
      } else if (postStatus === 404) {
        msg = 'MVP Affiliate plugin not responding. Make sure it\'s activated in wp-admin → Plugins.'
      } else {
        msg = `WordPress returned ${postStatus}: ${postText.slice(0, 200)}`
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
