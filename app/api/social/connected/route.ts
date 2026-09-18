/**
 * GET /api/social/connected — which socials this creator can actually post to.
 *
 * Read by every "Quick post to socials" modal (Deal Radar, Walmart, Wayward) so
 * it can tick only the networks that will work. Before this, all of them opened
 * with every platform selected, so a creator connected to one network unselected
 * six by hand on every post, and forgetting meant six red "failed" rows for six
 * accounts that were never connected. Gina reported it after weeks of it.
 *
 * NOT A SECOND OPINION ABOUT CONNECTEDNESS. Facebook and Threads are resolved
 * with the same resolveSocialAccount call the publisher makes, with the same
 * legacy fallback, and the rest go through lib/connected-platforms, whose
 * predicates are the negation of the publisher's own throws. A list assembled
 * any other way would disagree with the publisher eventually, and a button that
 * promises a post it cannot make is worse than the red error it replaced.
 *
 * VA-aware: reports the OWNER's connections, because those are what publish.
 *
 * Tokens never leave the server. The response is a list of platform keys.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { resolveSocialAccount } from '@/lib/social-accounts'
import {
  connectedQuickPostPlatforms, pinterestConnected, instagramConnected,
  type ConnectionRow,
} from '@/lib/connected-platforms'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { data: raw } = await supabase
    .from('integrations')
    .select([
      'twitter_access_token',
      'linkedin_access_token', 'linkedin_person_id',
      'telegram_bot_token', 'telegram_channel_id',
      'bluesky_handle', 'bluesky_app_password',
      'pinterest_access_token',
      'instagram_user_id', 'instagram_access_token',
      'facebook_page_id', 'facebook_page_access_token', 'facebook_page_name',
      'threads_user_id', 'threads_access_token',
    ].join(','))
    .eq('user_id', ownerId)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = (decryptIntegrationRow(raw as any) || {}) as Record<string, string | null>

  // Same two resolutions the publisher performs, in the same order, so a
  // creator connected through the modern social_accounts flow does not read as
  // "not connected" here while posting fine there.
  const [fb, th] = await Promise.all([
    resolveSocialAccount(supabase, ownerId, 'facebook', {
      socialAccountId: null, allowSelection: false,
      legacy: {
        externalId: ig.facebook_page_id || undefined,
        accessToken: ig.facebook_page_access_token || undefined,
        displayName: ig.facebook_page_name ?? null,
      },
    }).catch(() => null),
    resolveSocialAccount(supabase, ownerId, 'threads', {
      socialAccountId: null, allowSelection: false,
      legacy: {
        externalId: ig.threads_user_id || undefined,
        accessToken: ig.threads_access_token || undefined,
        displayName: null,
      },
    }).catch(() => null),
  ])

  const instagramAcct = await resolveSocialAccount(supabase, ownerId, 'instagram', {
    socialAccountId: null, allowSelection: false,
    legacy: {
      externalId: ig.instagram_user_id || undefined,
      accessToken: ig.instagram_access_token || undefined,
      displayName: null,
    },
  }).catch(() => null)

  const row = ig as unknown as ConnectionRow
  const connected = connectedQuickPostPlatforms(row, {
    facebook: !!fb,
    threads: !!th,
    // Telegram publishes through the creator's own bot OR the platform bot, and
    // the publisher accepts either. Only the server knows whether the platform
    // bot exists, so it is answered here rather than guessed in the browser.
    platformTelegramBot: !!process.env.TELEGRAM_BOT_TOKEN,
  })

  if (pinterestConnected(row)) connected.push('pinterest' as never)
  if (instagramConnected(row, !!instagramAcct)) connected.push('instagram' as never)

  // `known` is what tells the modal the difference between "we looked and found
  // nothing" and "we could not look". A failed request never reaches here, so
  // anything this route returns is a completed lookup.
  return NextResponse.json({ ok: true, known: true, connected })
}
