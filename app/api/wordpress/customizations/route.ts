import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'

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
    try {
      const wpService = createWordPressService(
        intRow.wordpress_url,
        intRow.wordpress_username,
        intRow.wordpress_app_password,
        intRow.wordpress_api_token || undefined,
      )

      // Fetch existing data so we only override footer-related fields
      let existing: Record<string, unknown> = {}
      try {
        existing = await wpService.getCustomEndpoint('/wp-json/affiliateos/v1/customizations') as Record<string, unknown>
      } catch { /* start fresh */ }

      // Map footer.socials → profile keys the WP plugin expects
      const socials = customizations?.footer?.socials ?? {}
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
        ...(customizations?.footer?.bio ? { authorBio: customizations.footer.bio } : {}),
      }

      await wpService.postCustomEndpoint(
        '/wp-json/affiliateos/v1/customizations',
        { ...existing, ...customizations, profile: mergedProfile },
      )
    } catch (e) {
      console.error('WP push error:', e)
    }
  }

  return NextResponse.json({ ok: true })
}
