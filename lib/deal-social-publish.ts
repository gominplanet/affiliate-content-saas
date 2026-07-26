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
  /** The tagged affiliate URL (…/dp/ASIN?tag=…). */
  link: string
  /** Price-safe base caption — no link, no disclosure (composed per platform). */
  baseCaption: string
  disclaimer: string
  platforms: QuickPostPlatform[]
}

/** Compose the final text for a platform: base caption trimmed to the platform
 *  limit, then the affiliate link + disclosure appended. */
function composeText(base: string, platform: QuickPostPlatform, link: string, disclaimer: string): string {
  if (platform === 'twitter') return capSocialText(base, SOCIAL_LIMITS.twitter, ` ${link} #ad`)
  if (platform === 'bluesky') return capSocialText(base, SOCIAL_LIMITS.bluesky, `\n\n${link}\n#ad`)
  const limit = (SOCIAL_LIMITS as Record<string, number>)[platform] ?? 1000
  return capSocialText(base, limit, `\n\n👉 ${link}\n\n${disclaimer}`)
}

export async function publishDealToSocials(opts: PublishOpts): Promise<PlatformResult[]> {
  const { supabase, userId, deal, link, baseCaption, disclaimer } = opts
  const platforms = opts.platforms.filter((p) => QUICK_POST_PLATFORMS.includes(p))
  const results: PlatformResult[] = []
  if (!platforms.length) return results

  const { data: intRaw } = await supabase
    .from('integrations')
    .select('twitter_access_token,twitter_refresh_token,twitter_expires_at,facebook_page_id,facebook_page_access_token,threads_access_token,threads_user_id,linkedin_access_token,linkedin_person_id,telegram_bot_token,telegram_channel_id,bluesky_handle,bluesky_app_password')
    .eq('user_id', userId).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = decryptIntegrationRow(intRaw as any) || {}
  const img = deal.imageUrl || null

  for (const platform of platforms) {
    try {
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
        const pageId = ig.facebook_page_id as string | undefined
        const pageToken = ig.facebook_page_access_token as string | undefined
        if (!pageId || !pageToken) throw new Error('Facebook Page is not connected.')
        const caption = composeText(baseCaption, 'facebook', link, disclaimer)
        const fb = createFacebookService(pageToken, pageId)
        let id: string
        if (img) { const r = await fb.postPhoto({ imageUrl: img, caption }); id = r.post_id || r.id }
        else { const r = await fb.postLink({ message: caption, link }); id = r.id }
        results.push({ platform, ok: true, url: `https://www.facebook.com/${id}` })

      } else if (platform === 'threads') {
        const token = ig.threads_access_token as string | undefined
        const tuid = ig.threads_user_id as string | undefined
        if (!token || !tuid) throw new Error('Threads is not connected.')
        const r = await new ThreadsService(token, tuid).createPost(composeText(baseCaption, 'threads', link, disclaimer), img || undefined)
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
        // (dp URLs contain no ')' so the destination is safe unescaped).
        const body = escapeMarkdownV2(capSocialText(baseCaption, 700))
        const caption = `${body}\n\n[Grab it on Amazon](${link})\n\n${escapeMarkdownV2(disclaimer)}`
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
