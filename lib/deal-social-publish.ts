// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Deal Radar "Quick post" — publish ONE deal (image + caption + direct
 * affiliate link) straight to the link-friendly social platforms, skipping the
 * blog. Reuses the same per-platform services the scheduled cron uses; this is
 * just a blog-independent orchestrator for a deal.
 *
 * PLATFORMS: X, Facebook, Threads, LinkedIn, Telegram, Bluesky. Deliberately
 * NOT Instagram/TikTok (their captions can't carry a clickable link — those use
 * the comment→DM / link-in-bio mechanic instead), and NOT Pinterest (our pins
 * link to the blog per Amazon+Pinterest ToS, see lib/pin-publish).
 *
 * Each platform runs in its own try/catch and returns an independent result, so
 * one failure never blocks the others.
 */
import {
  decryptIntegrationRow, encryptIntegrationWrite,
} from '@/lib/integration-secrets'
import { resolveSocialAccount } from '@/lib/social-accounts'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'
import { createTweet, refreshAccessToken as refreshTwitter } from '@/services/twitter'
import { createFacebookService } from '@/services/facebook'
import { ThreadsService } from '@/services/threads'
import { createLinkedInService } from '@/services/linkedin'
import { sendPhoto, sendMessage, escapeMarkdownV2 } from '@/services/telegram'
import { createSession as blueskySession, createPost as blueskyPost } from '@/services/bluesky'

export type QuickPostPlatform = 'twitter' | 'facebook' | 'threads' | 'linkedin' | 'telegram' | 'bluesky'
export const QUICK_POST_PLATFORMS: QuickPostPlatform[] = ['twitter', 'facebook', 'threads', 'linkedin', 'telegram', 'bluesky']
export const QUICK_POST_LABELS: Record<QuickPostPlatform, string> = {
  twitter: 'X', facebook: 'Facebook', threads: 'Threads', linkedin: 'LinkedIn', telegram: 'Telegram', bluesky: 'Bluesky',
}

export interface DealForPost { asin: string; title: string; imageUrl: string | null }
export interface PlatformResult { platform: QuickPostPlatform; ok: boolean; url?: string; error?: string }

interface PublishOpts {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  userId: string
  deal: DealForPost
  /** Fallback tagged affiliate URL (…/dp/ASIN?tag=…), used when a platform has
   *  no per-platform link. */
  link: string
  /** Per-platform affiliate links — a Geniuslink short URL wrapped into that
   *  platform's own tracking group (FACEBOOK, TWITTER, …). Missing entries fall
   *  back to `link`. */
  links?: Partial<Record<QuickPostPlatform, string>>
  /** Price-safe base caption — no link, no disclosure (composed per platform). */
  baseCaption: string
  disclaimer: string
  platforms: QuickPostPlatform[]
}

/** Compose the final text for a platform: the affiliate link leads (a shopper
 *  can buy without reading), then the caption, then the disclosure — all capped
 *  to the platform's limit. */
function composeText(base: string, platform: QuickPostPlatform, link: string, disclaimer: string): string {
  if (platform === 'twitter') return capSocialText(base, SOCIAL_LIMITS.twitter, ` #ad`, `🛒 ${link}\n\n`)
  if (platform === 'bluesky') return capSocialText(base, SOCIAL_LIMITS.bluesky, `\n#ad`, `🛒 ${link}\n\n`)
  const limit = (SOCIAL_LIMITS as Record<string, number>)[platform] ?? 1000
  return capSocialText(base, limit, `\n\n${disclaimer}`, `🛒 Grab it on Amazon 👉 ${link}\n\n`)
}

export async function publishDealToSocials(opts: PublishOpts): Promise<PlatformResult[]> {
  const { supabase, userId, deal, baseCaption, disclaimer } = opts
  const platforms = opts.platforms.filter((p) => QUICK_POST_PLATFORMS.includes(p))
  const results: PlatformResult[] = []
  if (!platforms.length) return results
  // The affiliate link for a platform: its own Geniuslink (per-platform group)
  // when we built one, else the shared tagged fallback.
  const linkFor = (p: QuickPostPlatform) => opts.links?.[p] || opts.link

  // Read the FULL row, not an explicit column list: if any named column is
  // absent from the live schema, Postgres rejects the whole SELECT, intRaw comes
  // back null, and every platform that reads from it throws "not connected" even
  // though the tokens are there. '*' can't hit that. Surface a real read error
  // instead of silently degrading to "not connected".
  const { data: intRaw, error: intErr } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', userId).maybeSingle()
  if (intErr) console.error('[deal-social-publish] integrations read failed:', intErr.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = decryptIntegrationRow(intRaw as any) || {}
  const img = deal.imageUrl || null

  for (const platform of platforms) {
    try {
      const link = linkFor(platform)
      if (platform === 'twitter') {
        let token = ig.twitter_access_token as string | undefined
        if (!token) throw new Error('X is not connected.')
        const expiry = ig.twitter_expires_at ? new Date(ig.twitter_expires_at).getTime() : 0
        if (expiry && Date.now() > expiry - 60_000 && ig.twitter_refresh_token) {
          const r = await refreshTwitter(ig.twitter_refresh_token as string)
          token = r.access_token
          await supabase.from('integrations').update(encryptIntegrationWrite({
            twitter_access_token: r.access_token,
            twitter_refresh_token: r.refresh_token ?? ig.twitter_refresh_token,
            twitter_expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString(),
          })).eq('user_id', userId)
        }
        const t = await createTweet(token!, composeText(baseCaption, 'twitter', link, disclaimer))
        results.push({ platform, ok: true, url: `https://x.com/i/web/status/${t.id}` })

      } else if (platform === 'facebook') {
        // Facebook Pages live in social_accounts (modern connect flow), with the
        // legacy integrations columns as a zero-migration fallback — resolve the
        // same way every other MVP post route does, or a user connected via the
        // new flow reads as "not connected".
        const acct = await resolveSocialAccount(supabase, userId, 'facebook', {
          socialAccountId: null,
          allowSelection: false,
          legacy: {
            externalId: ig.facebook_page_id as string | undefined,
            accessToken: ig.facebook_page_access_token as string | undefined,
            displayName: (ig.facebook_page_name as string | undefined) ?? null,
          },
        })
        if (!acct) throw new Error('Facebook Page is not connected.')
        const caption = composeText(baseCaption, 'facebook', link, disclaimer)
        const fb = createFacebookService(acct.accessToken, acct.externalId)
        let id: string
        if (img) { const r = await fb.postPhoto({ imageUrl: img, caption }); id = r.post_id || r.id }
        else { const r = await fb.postLink({ message: caption, link }); id = r.id }
        results.push({ platform, ok: true, url: `https://www.facebook.com/${id}` })

      } else if (platform === 'threads') {
        // Same story as Facebook — Threads profiles live in social_accounts with
        // the legacy threads_* columns as fallback.
        const acct = await resolveSocialAccount(supabase, userId, 'threads', {
          socialAccountId: null,
          allowSelection: false,
          legacy: {
            externalId: ig.threads_user_id as string | undefined,
            accessToken: ig.threads_access_token as string | undefined,
            displayName: null,
          },
        })
        if (!acct) throw new Error('Threads is not connected.')
        const r = await new ThreadsService(acct.accessToken, acct.externalId).createPost(composeText(baseCaption, 'threads', link, disclaimer), img || undefined)
        results.push({ platform, ok: true, url: r.permalink })

      } else if (platform === 'linkedin') {
        const token = ig.linkedin_access_token as string | undefined
        const person = ig.linkedin_person_id as string | undefined
        if (!token || !person) throw new Error('LinkedIn is not connected.')
        const li = createLinkedInService(token, person)
        const text = composeText(baseCaption, 'linkedin', link, disclaimer)
        if (img) await li.createImagePost({ text, imageUrl: img, title: deal.title })
        else await li.createPost({ text, articleUrl: link, articleTitle: deal.title, articleDescription: deal.title })
        results.push({ platform, ok: true })

      } else if (platform === 'telegram') {
        const token = (ig.telegram_bot_token as string | undefined) || process.env.TELEGRAM_BOT_TOKEN || ''
        const channel = ig.telegram_channel_id as string | undefined
        if (!token || !channel) throw new Error('Telegram is not connected.')
        // MarkdownV2: escape the body + disclosure; the link rides in a link span
        // (dp + geni.us URLs contain no ')' so the destination is safe unescaped).
        // Link leads so a shopper can buy without reading.
        const body = escapeMarkdownV2(capSocialText(baseCaption, 700))
        const caption = `🛒 [Grab it on Amazon](${link})\n\n${body}\n\n${escapeMarkdownV2(disclaimer)}`
        if (img) await sendPhoto(token, channel, img, caption)
        else await sendMessage(token, channel, caption)
        results.push({ platform, ok: true })

      } else if (platform === 'bluesky') {
        const handle = ig.bluesky_handle as string | undefined
        const appPw = ig.bluesky_app_password as string | undefined
        if (!handle || !appPw) throw new Error('Bluesky is not connected.')
        const session = await blueskySession(handle, appPw)
        const text = composeText(baseCaption, 'bluesky', link, disclaimer)
        await blueskyPost(session, {
          text, linkUrl: link, linkText: link,
          embed: { url: link, title: deal.title, description: '', imageUrl: img || undefined },
        })
        results.push({ platform, ok: true, url: `https://bsky.app/profile/${handle}` })
      }
    } catch (err) {
      results.push({ platform, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return results
}
