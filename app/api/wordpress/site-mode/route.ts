/**
 * GET /api/wordpress/site-mode
 *
 * Lightweight read of the user's DEFAULT WordPress site mode — used by UI that
 * needs to branch on content-only ("bring your own theme") without pulling the
 * full sites list. Goes through getDefaultSite so it correctly covers BOTH the
 * multi-site (wordpress_sites) and legacy single-site (integrations) paths.
 *
 * Returns: { connected, contentOnly, ctaStyle }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getDefaultSite } from '@/lib/wordpress-sites'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const site = await getDefaultSite(supabase, ownerId)
  if (!site) {
    return NextResponse.json({ connected: false, contentOnly: false, ctaStyle: 'button' })
  }
  return NextResponse.json({
    connected: true,
    contentOnly: site.contentOnly,
    ctaStyle: site.ctaStyle,
  })
}
