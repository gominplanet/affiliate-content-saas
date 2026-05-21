import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('integrations')
    .select('blog_customizations')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data?.blog_customizations ?? {})
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const customizations = await req.json()

  // Save to Supabase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any)
    .from('integrations')
    .update({ blog_customizations: customizations })
    .eq('user_id', user.id)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  // Push to WordPress if connected
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password, wordpress_api_token')
    .eq('user_id', user.id)
    .single()

  if (intRow?.wordpress_url && intRow?.wordpress_username && intRow?.wordpress_app_password) {
    const wpBase = intRow.wordpress_url.replace(/\/$/, '')
    const cleanPw = intRow.wordpress_app_password.replace(/\s+/g, '')
    const authHeader = `Basic ${Buffer.from(`${intRow.wordpress_username}:${cleanPw}`).toString('base64')}`

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

      // Source-of-truth banner/logo from brand_profiles (same as
      // sync-brand). Customize Blog's `about` only carries {logoUrl,
      // headerBg} — it has NO headerBannerUrl field — so a shallow merge
      // would silently drop the wide header banner the user set in Brand
      // Profile. We seed + re-assert it here so no Customize save can ever
      // revert the banner to the small logo again.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: brandRow } = await (supabase as any)
        .from('brand_profiles')
        .select('header_banner_url, logo_url')
        .eq('user_id', user.id)
        .single()
      const storedBannerUrl = (brandRow?.header_banner_url as string | null)?.trim() || null
      const storedLogoUrl = (brandRow?.logo_url as string | null)?.trim() || null

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

      const payload = {
        ...existing,
        ...stripped,
        about: {
          ...existingAbout,
          ...(storedLogoUrl ? { logoUrl: storedLogoUrl } : {}),
          ...(storedBannerUrl ? { headerBannerUrl: storedBannerUrl } : {}),
          ...strippedAbout,
          // Re-assert the banner LAST so a client `about` (which lacks the
          // field entirely) can never overwrite/clear it.
          ...(storedBannerUrl ? { headerBannerUrl: storedBannerUrl } : {}),
        },
        footer: { ...existingFooter, ...strippedFooter },
      }

      // Push to WordPress — direct Basic Auth, no wp-login.php fallback (Hostinger blocks it)
      const postRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
      })

      if (!postRes.ok) {
        const text = await postRes.text()
        let userMsg: string
        if (postRes.status === 401 || postRes.status === 403) {
          userMsg = 'WordPress rejected the Application Password. Disconnect WordPress in Site & Integrations and reconnect with a fresh Application Password from wp-admin → Users → Profile → Application Passwords.'
        } else if (postRes.status === 404) {
          userMsg = 'AffiliateOS plugin endpoint not found on your site. Re-run the WordPress setup from Site & Integrations to install the plugin.'
        } else {
          userMsg = `WordPress returned ${postRes.status}: ${text.slice(0, 200)}`
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
