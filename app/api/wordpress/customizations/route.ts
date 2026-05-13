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

      // Map footer.socials → profile keys the WP plugin expects
      const socials = customizations?.footer?.socials ?? {}
      // Bio lives in `about.bio` on the frontend form (AboutData interface).
      // The PHP plugin reads `footer.bio` OR `profile.authorBio`, so we write both.
      const bio = customizations?.about?.bio || customizations?.footer?.bio || ''
      const mergedProfile = {
        ...(existing?.profile ?? {}),
        ...(socials.youtube   ? { youtubeUrl:   socials.youtube   } : {}),
        ...(socials.facebook  ? { facebookUrl:  socials.facebook  } : {}),
        ...(socials.instagram ? { instagramUrl: socials.instagram } : {}),
        ...(socials.tiktok    ? { tiktokUrl:    socials.tiktok    } : {}),
        ...(socials.twitter   ? { twitterUrl:   socials.twitter   } : {}),
        ...(socials.pinterest ? { pinterestUrl: socials.pinterest } : {}),
        ...(socials.threads   ? { threadsUrl:   socials.threads   } : {}),
        ...(socials.contact   ? { contactEmail: socials.contact   } : {}),
        ...(bio ? { authorBio: bio } : {}),
      }

      // Also write bio into footer.bio so the PHP plugin's first-choice key is set
      const mergedFooter = {
        ...(customizations?.footer ?? {}),
        ...(bio ? { bio } : {}),
      }

      const payload = { ...existing, ...customizations, footer: mergedFooter, profile: mergedProfile }

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
