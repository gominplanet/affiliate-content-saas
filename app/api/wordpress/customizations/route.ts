import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials, getSiteCustomizations, saveSiteCustomizations } from '@/lib/wordpress-sites'
import { tryWpProxy } from '@/lib/wp-proxy'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  // 2026-06-09 Phase 2 (VA): customizations belong to the owner's WP.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // Per-site (migration 221): resolve the Customize Blog set for the user's
  // ACTIVE blog (the topbar switcher's default site). Optional ?siteId targets
  // a specific blog. Falls back to the account-level set while a blog hasn't
  // been customized yet, so nothing changes for existing single-site users.
  const url = new URL(req.url)
  const siteId = url.searchParams.get('siteId')
  const sc = await getSiteCustomizations(supabase, ownerId, siteId)
  if (!sc) return NextResponse.json({})

  // Return the blog's own set, plus a `_site` block the Customize page reads for
  // per-blog identity (which blog this is, its logo/banner override, and the
  // account defaults it inherits from when an override is empty).
  return NextResponse.json({
    ...sc.blogCustomizations,
    _site: {
      id: sc.siteId,
      label: sc.siteLabel,
      isLegacy: sc.isLegacy,
      logoUrl: sc.logoUrl ?? '',
      headerBannerUrl: sc.headerBannerUrl ?? '',
      accountLogoUrl: sc.accountLogoUrl ?? '',
      accountBannerUrl: sc.accountBannerUrl ?? '',
    },
  })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const body = await req.json() as Record<string, unknown> & {
    siteId?: string | null
    /** Per-site branding overrides (migration 221). '' clears → inherit the
     *  Brand Profile default; undefined leaves the site's value untouched. */
    logoUrl?: string
    headerBannerUrl?: string
  }
  // Strip routing/override params from the saved customizations — they're not
  // part of the Customize Blog set. The rest of the body is the actual set.
  const siteId = body.siteId ?? null
  const perSiteLogo = typeof body.logoUrl === 'string' ? body.logoUrl : undefined
  const perSiteBanner = typeof body.headerBannerUrl === 'string' ? body.headerBannerUrl : undefined
  const customizations = { ...body }
  delete (customizations as { siteId?: unknown }).siteId
  delete (customizations as { logoUrl?: unknown }).logoUrl
  delete (customizations as { headerBannerUrl?: unknown }).headerBannerUrl
  delete (customizations as { _site?: unknown })._site

  // Save per-site (migration 221): the Customize Blog set + branding land on the
  // targeted blog's wordpress_sites row (or the account-level integrations row
  // for a pure-legacy single-site user). Each blog keeps its own identity.
  const saved = await saveSiteCustomizations(supabase, ownerId, siteId, {
    blogCustomizations: customizations,
    logoUrl: perSiteLogo,
    headerBannerUrl: perSiteBanner,
  })
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 })

  // Push to WordPress — multi-site: target the specific site if siteId
  // provided; default site otherwise.
  const site = await getWordPressCredentials(supabase, ownerId, siteId)

  if (site) {
    const wpBase = site.wordpress_url.replace(/\/$/, '')
    const cleanPw = site.wordpress_app_password.replace(/\s+/g, '')
    const authHeader = `Basic ${Buffer.from(`${site.wordpress_username}:${cleanPw}`).toString('base64')}`

    try {
      // Fetch existing data so we only override footer-related fields
      let existing: Record<string, unknown> = {}
      try {
        const getRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
          headers: { Authorization: authHeader },
        })
        if (getRes.ok) existing = await getRes.json() as Record<string, unknown>
      } catch { /* start fresh */ }

      // Brand Profile (via /api/wordpress/sync-brand) is the SOLE source
      // of truth for socials, bio, contact email, brand name, tagline,
      // logo, colors, and fonts. Customize Blog must NOT write any of
      // those fields here — doing so causes stale Customize state to
      // overwrite whatever Brand Profile last set.
      //
      // What Customize Blog owns: sidebar/in-content ad blocks, pick of
      // the day, custom footer links, logo banner background color.
      const stripped = { ...(customizations ?? {}) } as Record<string, unknown>
      if (stripped.footer && typeof stripped.footer === 'object') {
        const f = { ...(stripped.footer as Record<string, unknown>) }
        delete f.socials
        delete f.bio
        stripped.footer = f
      }
      if (stripped.about && typeof stripped.about === 'object') {
        const a = { ...(stripped.about as Record<string, unknown>) }
        delete a.bio
        stripped.about = a
      }
      // Never touch `profile.*` either — that's Brand Profile territory.
      delete stripped.profile

      // Effective banner/logo for THIS blog (migration 221): the site's own
      // per-site override wins; otherwise it inherits the account default from
      // brand_profiles. Customize Blog's `about` only carries {logoUrl,
      // headerBg} — it has NO headerBannerUrl field — so a shallow merge would
      // silently drop the wide header banner. We seed + re-assert the resolved
      // per-site value here so no Customize save can ever revert it.
      const effBrand = await getSiteCustomizations(supabase, ownerId, siteId)
      const storedLogoUrl = (effBrand?.logoUrl || effBrand?.accountLogoUrl) || null
      const storedBannerUrl = (effBrand?.headerBannerUrl || effBrand?.accountBannerUrl) || null

      // DEEP-merge `about` and `footer` so a partial client payload can never
      // DROP keys that live in the WP option (most importantly
      // about.headerBannerUrl). A shallow {...existing, ...stripped} replaces
      // the whole sub-object and wipes anything the client didn't resend.
      const existingAbout = (existing.about as Record<string, unknown>) ?? {}
      const existingFooter = (existing.footer as Record<string, unknown>) ?? {}
      const strippedAbout = (stripped.about as Record<string, unknown>) ?? {}
      const strippedFooter = (stripped.footer as Record<string, unknown>) ?? {}
      delete stripped.about
      delete stripped.footer

      // Newsletter auto-embed: the MVP theme reads these fields to render the
      // [mvp-newsletter] signup form automatically on the homepage and in
      // every blog-post sidebar — no shortcode pasting required. We push the
      // creator's MVP user id + the enabled flag every customization save
      // so the theme always has fresh data. When enabled is false, the
      // theme silently skips rendering.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [{ data: nlRow }, { count: nlActiveCount }] = await Promise.all([
        supabase
          .from('newsletter_settings')
          .select('enabled,sender_name,cta_title,cta_subtitle,cta_button,cta_bullet_1,cta_bullet_2,cta_bullet_3,homepage_placement,sidebar_placement')
          .eq('user_id', ownerId)
          .maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase
          .from('newsletter_subscribers')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', ownerId)
          .eq('status', 'active'),
      ])
      const nlEnabled = !!nlRow?.enabled
      const nlSenderName = (nlRow?.sender_name as string | null)?.trim() || null
      const nlCtaTitle = (nlRow?.cta_title as string | null)?.trim() || null
      const nlCtaSubtitle = (nlRow?.cta_subtitle as string | null)?.trim() || null
      const nlCtaButton = (nlRow?.cta_button as string | null)?.trim() || null
      const nlCtaBullets = [
        (nlRow?.cta_bullet_1 as string | null)?.trim() || '',
        (nlRow?.cta_bullet_2 as string | null)?.trim() || '',
        (nlRow?.cta_bullet_3 as string | null)?.trim() || '',
      ].filter(Boolean)
      const nlHomePlacement = (nlRow?.homepage_placement as string | null)?.trim() || null
      const nlSideBarPlacement = (nlRow?.sidebar_placement as string | null)?.trim() || null
      const nlSubscriberCount = typeof nlActiveCount === 'number' ? nlActiveCount : 0

      const payload = {
        ...existing,
        ...stripped,
        about: {
          ...existingAbout,
          ...strippedAbout,
          // Logo + banner are driven by the source of truth (brand_profiles) and
          // written EXPLICITLY — '' when cleared — placed LAST so neither a stale
          // client `about` nor WordPress's previous value can restore a removed
          // one. (Was omit-on-empty + an unconditional re-assert, which made the
          // banner/logo impossible to clear from the live site.)
          logoUrl: storedLogoUrl || '',
          headerBannerUrl: storedBannerUrl || '',
        },
        footer: { ...existingFooter, ...strippedFooter },
        // The plugin/theme look up `newsletter.userId` to know whose form
        // to render, and `newsletter.enabled` as the on/off switch.
        // `newsletter.senderName` powers the form's H3 title when present.
        newsletter: {
          enabled: nlEnabled,
          // Theme reads this to know whose form to render. Owner-side so
          // the embed targets the right Resend audience (subscribers
          // table is owner-keyed).
          userId: ownerId,
          senderName: nlSenderName,
          // Per-placement CTA overrides. Null/undefined → theme falls
          // back to its own default copy.
          ctaTitle: nlCtaTitle,
          ctaSubtitle: nlCtaSubtitle,
          ctaButton: nlCtaButton,
          ctaBullets: nlCtaBullets,
          // Slot overrides. null → theme picks the default slot
          // ('after_ads' on homepage, 'bottom' in sidebar).
          homepagePlacement: nlHomePlacement,
          sidebarPlacement: nlSideBarPlacement,
          // Mid-article inline form. Configured per-blog in
          // /customize → Mid-article newsletter. Plugin renders via the
          // the_content filter at the chosen paragraph position.
          inlineMidArticle: (() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ni = (customizations as any)?.newsletterInline
            if (!ni || typeof ni !== 'object') {
              return { enabled: false, afterParagraph: 3, title: '', subtitle: '', button: '' }
            }
            return {
              enabled: !!ni.enabled,
              afterParagraph: Math.max(1, Math.min(8, Number(ni.afterParagraph) || 3)),
              title: String(ni.title || '').slice(0, 120),
              subtitle: String(ni.subtitle || '').slice(0, 300),
              button: String(ni.button || '').slice(0, 40),
            }
          })(),
          // Active-subscriber count for the homepage hero's social-proof
          // line. Theme suppresses it below 50 so small lists don't
          // self-sabotage.
          subscriberCount: nlSubscriberCount,
        },
        // "Work with brands" banner/modal the plugin renders on the blog. Like
        // newsletter.userId, `ownerId` is public here so the form can POST to
        // /api/brand-inquiry for this creator (HMAC-signed by the plugin).
        // Sanitised + capped so a stale/oversized client value can't poison it.
        brandCta: (() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bc = (customizations as any)?.brandCta
          let rawUrl = String(bc?.mediaKitUrl || '').trim()
          // Auto-prepend https:// when the creator pastes a bare host
          // (e.g. "www.example.com") — otherwise the button silently drops.
          if (rawUrl && !/^https?:\/\//i.test(rawUrl) && !/^\s*javascript:/i.test(rawUrl)) {
            rawUrl = 'https://' + rawUrl.replace(/^\/+/, '')
          }
          return {
            enabled: !!bc?.enabled,
            ownerId,
            // The small pill shown on the blog (editable; defaults to a warm
            // invitation rather than a question).
            pillLabel: (String(bc?.pillLabel || '').trim() || 'Work with us').slice(0, 40),
            headline: (String(bc?.headline || '').trim() || 'Are you a brand that wants to get featured here?').slice(0, 160),
            intro: String(bc?.intro || '').slice(0, 1000),
            mediaKitUrl: /^https?:\/\//i.test(rawUrl) ? rawUrl.slice(0, 500) : '',
            // Custom label for the media-kit / link button (falls back to a
            // sensible default). Lets creators write their own CTA — "See my
            // portfolio", "Book a collab", etc.
            mediaKitLabel: (String(bc?.mediaKitLabel || '').trim() || 'View my media kit').slice(0, 60),
            inbox: !!bc?.inbox,
            directLink: !!bc?.directLink,
            // Captcha removed from the brand modal (2026-07-09). We deliberately
            // send EMPTY keys so the plugin renders no captcha widget at all —
            // any plugin version only draws the widget when a site key is
            // present. The form stays protected by honeypot + HMAC + rate-limit.
            turnstileSiteKey: '',
            hcaptchaSiteKey: '',
          }
        })(),
      }

      // Push to WordPress. Prefer the body-auth proxy (plugin v1.0.25+) so
      // hosts that strip the Authorization header on POST still work; fall
      // back to Basic Auth on plugin-too-old / no-secret-yet.
      const proxied = await tryWpProxy({
        siteUrl: wpBase,
        proxySecret: site.wordpress_api_token,
        innerPath: '/affiliateos/v1/customizations',
        method: 'POST',
        body: payload,
      })

      let postOk = false
      let postStatus = 0
      let postText = ''
      if (proxied) {
        postOk = proxied.ok
        postStatus = proxied.status
        if (!proxied.ok) {
          postText = typeof proxied.data === 'string' ? proxied.data : JSON.stringify(proxied.data)
        }
      } else {
        const postRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify(payload),
        })
        postOk = postRes.ok
        postStatus = postRes.status
        if (!postRes.ok) postText = await postRes.text()
      }

      if (!postOk) {
        let userMsg: string
        if (postStatus === 401 || postStatus === 403) {
          userMsg = 'WordPress rejected the Application Password. Disconnect WordPress in Site & Integrations and reconnect with a fresh Application Password from wp-admin → Users → Profile → Application Passwords.'
        } else if (postStatus === 404) {
          userMsg = 'AffiliateOS plugin endpoint not found on your site. Re-run the WordPress setup from Site & Integrations to install the plugin.'
        } else {
          userMsg = `WordPress returned ${postStatus}: ${postText.slice(0, 200)}`
        }
        return NextResponse.json({ ok: true, wordpress: 'failed', wordpressError: userMsg })
      }

      return NextResponse.json({ ok: true, wordpress: 'pushed' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[customizations] WordPress push failed:', msg)
      return NextResponse.json({ ok: true, wordpress: 'failed', wordpressError: msg })
    }
  }

  return NextResponse.json({ ok: true, wordpress: 'not_connected' })
}
