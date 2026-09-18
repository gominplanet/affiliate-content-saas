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

  // select('*'), exactly like lib/deal-social-publish. NOT a shortcut.
  //
  // The first version named its fifteen columns, one of which was
  // telegram_bot_token — a column no migration ever created and nothing has
  // ever written, left over from an abandoned bring-your-own-bot design. The
  // publisher survives reading it because select('*') makes an absent column
  // simply undefined. Naming it made PostgREST reject the WHOLE query, so the
  // row came back null and every platform decided from a column reported as
  // disconnected, while the three resolved through social_accounts reported
  // fine. Seb saw five of his working channels greyed out.
  //
  // So this reads the row the same way the publisher reads it. A column list
  // maintained here is a second list to keep in step with the schema, and the
  // failure when it drifts is silent and total rather than loud and local.
  const { data: raw, error: readErr } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', ownerId)
    .maybeSingle()

  // A LOOKUP THAT FAILED IS NOT A CREATOR WITH NOTHING CONNECTED.
  //
  // This is the clause whose absence turned a broken query into "your accounts
  // are disconnected". known:false tells the modal to tick everything, which is
  // the pre-change behaviour and the only honest answer when we did not manage
  // to find out. Saying known:true here unticks live channels and puts nothing
  // on screen to explain it, which is the same defect the feature was fixing.
  if (readErr) {
    console.error('[social/connected] integrations read failed:', readErr.message)
    return NextResponse.json({ ok: true, known: false, connected: [] })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = (decryptIntegrationRow(raw as any) || {}) as Record<string, string | null>

  // Same two resolutions the publisher performs, in the same order, so a
  // creator connected through the modern social_accounts flow does not read as
  // "not connected" here while posting fine there.
  //
  // No per-call .catch(() => null) here, and that is the point. Swallowing a
  // resolver error turns "we could not check" into "not connected", which is
  // the same lie the failed column read told. One try/catch around the lot, and
  // a throw anywhere in it means known:false.
  let fb = null, th = null, instagramAcct = null
  try {
    ;[fb, th, instagramAcct] = await Promise.all([
      resolveSocialAccount(supabase, ownerId, 'facebook', {
        socialAccountId: null, allowSelection: false,
        legacy: {
          externalId: ig.facebook_page_id || undefined,
          accessToken: ig.facebook_page_access_token || undefined,
          displayName: ig.facebook_page_name ?? null,
        },
      }),
      resolveSocialAccount(supabase, ownerId, 'threads', {
        socialAccountId: null, allowSelection: false,
        legacy: {
          externalId: ig.threads_user_id || undefined,
          accessToken: ig.threads_access_token || undefined,
          displayName: null,
        },
      }),
      resolveSocialAccount(supabase, ownerId, 'instagram', {
        socialAccountId: null, allowSelection: false,
        legacy: {
          externalId: ig.instagram_user_id || undefined,
          accessToken: ig.instagram_access_token || undefined,
          displayName: null,
        },
      }),
    ])
  } catch (e) {
    console.error('[social/connected] account resolve failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: true, known: false, connected: [] })
  }

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
