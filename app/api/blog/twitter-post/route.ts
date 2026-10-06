import { NextRequest, NextResponse } from 'next/server'
import { scrubBanned } from '@/lib/scrub'
import { createServerClient } from '@/lib/supabase/server'
import { getPublishContext } from '@/lib/agency-publish'
import { decryptIntegrationRow, encryptIntegrationWrite } from '@/lib/integration-secrets'
import { channelShareUrl } from '@/lib/channel-share-url'
import { createAnthropicClient } from '@/lib/anthropic'
import { creatorVoiceBlock } from '@/lib/creator-voice'
import {
  createTweet,
  refreshAccessToken,
} from '@/services/twitter'
import { resolveXMedia, rememberXScopes } from '@/lib/x-media'
import { fetchOgImage } from '@/lib/og-image'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { checkXPostCap, xCapMessage } from '@/lib/x-cap'
import { postToXWithOneRetry, xPostKey, XPostError, xFailedAttempts, xDroppedMessage, X_ATTEMPTS_PER_POST } from '@/lib/x-retry'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { readSocialCount, incrementSocialCount, evaluateSocialCap, SOCIAL_CAP } from '@/lib/social-cap'
import { resolveBlogPostId } from '@/lib/resolve-post-id'
import { recordSocialPermalink } from '@/lib/social-permalink'
import { socialPermalink } from '@/lib/brand-recap'

export const maxDuration = 60

const TWEET_HARD_LIMIT = 280

export async function POST(request: NextRequest) {
  try {
    // A Virtual Assistant publishes through the owner's accounts (lib/agency-publish).
    const pub = await getPublishContext(await createServerClient())
    if ('error' in pub) return pub.error
    const { supabase, user } = pub

    // X / Twitter auto-publish is a Pro-only feature.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsSocial(tier, 'twitter')) {
      return NextResponse.json(
        { error: 'X (Twitter) posting is a Pro plan feature. Upgrade to Pro to publish to X.' },
        { status: 403 },
      )
    }

    const body = await request.json() as { postId?: string; dryRun?: boolean; text?: string; postUrl?: string }
    const rawPostId = body.postId
    const dryRun = body.dryRun === true
    const overrideText = body.text?.trim()
    if (!rawPostId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    // Content-page "Published Posts" rows for video-less posts (guides,
    // comparisons, link posts) send the WP post id, not the blog_posts UUID.
    const postId = (await resolveBlogPostId(supabase, user.id, rawPostId, body.postUrl)) || rawPostId

    // ── 1. Fetch blog post ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // select('*') rather than a named list. The post now also supplies the
    // IMAGE for the tweet, and one of its sources (hero_source_url) arrived in
    // migration 336: naming it would break the entire read, not just the image,
    // on any database that has not run it.
    const { data: postRow } = await supabase
      .from('blog_posts')
      .select('*, youtube_videos(thumbnail_url, blog_thumbnail_url)')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = postRow as any
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    const twSocialCount = readSocialCount(post, 'twitter')
    const twCap = evaluateSocialCap(twSocialCount)
    if (!dryRun && twCap.exceeded) {
      return NextResponse.json({
        error: `You've published this post to X ${SOCIAL_CAP} times — that's the per-post cap on re-publishing. Edit the post or use a different post.`,
        socialCapReached: true,
        platform: 'twitter',
      }, { status: 429 })
    }

    if (!post.wordpress_url) {
      return NextResponse.json({ error: 'Post has no published URL' }, { status: 400 })
    }

    // ── 2. Fetch brand voice ───────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await supabase
      .from('brand_profiles')
      .select('name,voice_summary,learn_profile,voice_fingerprint')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any

    // ── 3. Fetch X credentials ─────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = decryptIntegrationRow(intRow as any)
    if (!integration?.twitter_access_token) {
      return NextResponse.json({ error: 'X (Twitter) not connected' }, { status: 400 })
    }

    // ── 3b. Monthly X post cap (X is the only paid-per-post channel) ────────
    const xcap = await checkXPostCap(supabase, user.id)
    if (xcap.exceeded) {
      return NextResponse.json({ error: xCapMessage(xcap.resetLabel), limitReached: true }, { status: 429 })
    }

    // ── 3a. Refresh the access token if it's expired or expiring soon ─────
    let accessToken = integration.twitter_access_token as string
    // A refresh RE-ISSUES the same grant, so this never gains media.write. It is
    // read here only so a token refreshed since connect keeps the freshest copy
    // of what it was always allowed to do.
    let grantedScopes = (integration.twitter_scopes as string | null) ?? null
    const expiresAtMs = integration.twitter_expires_at
      ? new Date(integration.twitter_expires_at).getTime()
      : 0
    const expiringSoon = expiresAtMs && expiresAtMs - Date.now() < 60_000
    if (expiringSoon && integration.twitter_refresh_token) {
      try {
        const refreshed = await refreshAccessToken(integration.twitter_refresh_token)
        accessToken = refreshed.access_token
        const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
        // Encrypt refreshed tokens at rest (2026-06-02). Decrypt happens
        // on the next read via decryptIntegrationRow.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('integrations').update(encryptIntegrationWrite({
          twitter_access_token: refreshed.access_token,
          twitter_refresh_token: refreshed.refresh_token ?? integration.twitter_refresh_token,
          twitter_expires_at: newExpiry,
        })).eq('user_id', user.id)
        if (refreshed.scope) {
          grantedScopes = refreshed.scope
          await rememberXScopes(supabase, user.id, refreshed.scope)
        }
      } catch (e) {
        return NextResponse.json(
          { error: 'X token refresh failed. Please reconnect X in Settings.', detail: e instanceof Error ? e.message : String(e) },
          { status: 401 },
        )
      }
    }

    // ── 4. Resolve tweet copy — user override or fresh AI gen ──────────────
    // Reserve characters for the URL — X autoshortens any URL to 23 chars,
    // and we add one space before it. Generation budget is 280 - 23 - 1 = 256.
    const generationBudget = TWEET_HARD_LIMIT - 23 - 1

    let tweetText: string
    if (overrideText) {
      tweetText = overrideText
    } else {
      const anthropic = createAnthropicClient()
      const plainContent = (post.content as string ?? '')
        .replace(/<[^>]+>/g, '')
        .slice(0, 1200)

      const voiceNote = brand?.voice_summary
        ? `\n\nVoice guidance: ${brand.voice_summary}`
        : ''
      const learnBlock = creatorVoiceBlock(brand)

      // A PROVIDER ERROR IS NOT A SENTENCE. Uncaught, an overload or refusal
      // fell to the catch at the bottom and reached the modal as the raw
      // provider JSON. Nothing has been posted yet, so say so plainly.
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Write a single tweet for this product review article.

Style: a content creator's authentic short take. Strong hook, one clear value bullet, one short line of curiosity. Match the voice provided.${voiceNote}${learnBlock ? `\n\n${learnBlock}` : ''}

Hard rules:
- The tweet text alone (BEFORE the URL is appended) must be ${generationBudget} characters or fewer.
- Do NOT include any URL — we will append one ourselves.
- Do NOT use hashtags unless one feels genuinely necessary; at most one.
- Plain text only, no markdown.
- Stay TRUE to the article. Do NOT claim you personally tested or used a product unless the article actually says you did. If this is a comparison or round-up that may include other creators' videos, write "I compared…", "I put X against Y", or "here's my pick" — NEVER "I tested both/all of them". Never invent first-hand experience you don't have.

Blog title: ${post.title}
Blog excerpt: ${post.excerpt || plainContent.slice(0, 300)}
Content preview: ${plainContent}

Return ONLY the tweet text.`,
        }],
      }).catch((e: unknown) => {
        console.error('[twitter-post] caption writer failed', e instanceof Error ? e.message : e)
        return null
      })
      if (!msg) {
        return NextResponse.json({ error: 'The tweet could not be written just now, so nothing was posted to X. Please try again in a moment.' }, { status: 502 })
      }

      tweetText = ((msg.content[0] as { type: string; text: string }).text || '').trim()
      recordAnthropicUsage(msg, {
        userId: user.id, tier,
        feature: 'social_twitter_caption', model: 'claude-haiku-4-5-20251001',
      })
    }

    // Defensive trim — protects against AI drift AND user-edited overshoot
    if (tweetText.length > generationBudget) {
      tweetText = tweetText.slice(0, generationBudget - 1).replace(/\s+\S*$/, '') + '…'
    }

    // Scrub BEFORE composing, so the dry-run preview returns exactly what
    // gets published. It used to scrub only inline at composition, so the
    // text handed back to the modal — and saved as scheduled_posts.body_text
    // — still contained banned words.
    tweetText = scrubBanned(tweetText)
    // Per-channel Geniuslink: the X link lands in MVP-TWITTER. Best-effort.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const twShareUrl = (await channelShareUrl({ supabase, post: post as any, channel: 'twitter', userId: user.id, apiKey: integration?.geniuslink_api_key, apiSecret: integration?.geniuslink_api_secret })) || ((post as any).geniuslink_blog_url || post.wordpress_url)
    const finalText = `${tweetText} ${twShareUrl}`

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, text: tweetText, finalText })
    }

    // ── 5. Post the tweet ──────────────────────────────────────────────────
    // One re-attempt per post, then MVP drops it (lib/x-retry): X bills every
    // request, failed ones too. Checked here, before the image upload (also a
    // request to X); the cap slot is reserved per request inside the helper.
    const xKey = xPostKey('blog', postId!)
    if (await xFailedAttempts(user.id, xKey) >= X_ATTEMPTS_PER_POST) {
      return NextResponse.json({ error: xDroppedMessage(), xDropped: true }, { status: 409 })
    }

    // ── 5a. The picture ────────────────────────────────────────────────────
    //
    // THE DESIGNED THUMBNAIL FIRST. The first version of this put og:image at
    // the top, reasoning that the blog's featured image is what a reader lands
    // on, so the tweet should match it. That was wrong in practice: the first
    // live test attached a bare product photo on a white background, while the
    // post's own row in MVP showed the branded thumbnail the creator paid a
    // render for. A timeline is a feed, and the designed image is the one built
    // to stop a scroll.
    //
    // So the order is the creator's own work first and the blog's featured
    // image as the fallback, which is exactly the old behaviour for any post
    // that has no designed thumbnail.
    //
    //   blog_thumbnail_url  the hero the creator uploaded or designed FOR the
    //                       blog post. The most specific answer there is.
    //   thumbnail_url       the video's thumbnail, which is the branded design
    //                       MVP made. This is the picture on the post's row.
    //   og:image            whatever fronts the published post.
    //   hero_source_url     the product photo a link-written post was built
    //                       from, for posts that have no video at all.
    //
    // resolveXMedia never throws. A post that cannot carry its image still goes
    // out, and comes back with a note saying so.
    const video = post.youtube_videos as { thumbnail_url?: string | null; blog_thumbnail_url?: string | null } | null
    const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    // og:image is fetched LAST and only if nothing better exists: it costs a
    // round trip to the creator's blog, and on a post that has a designed
    // thumbnail the answer was never going to be used.
    const heroUrl =
      pick(video?.blog_thumbnail_url)
      ?? pick(video?.thumbnail_url)
      ?? pick(await fetchOgImage(post.wordpress_url as string))
      ?? pick(post.hero_source_url)

    let media = await resolveXMedia({ accessToken, imageUrl: heroUrl, grantedScopes })

    let tweet
    try {
      tweet = await postToXWithOneRetry({
        supabase, userId: user.id, key: xKey,
        // On the re-attempt after a 401, refresh the token first: sending the
        // same dead token again would be a charge for a known answer.
        tweet: async (previous) => {
          if (previous && /\b401\b|unauthorized/i.test(previous) && integration.twitter_refresh_token) {
            const r = await refreshAccessToken(integration.twitter_refresh_token)
            accessToken = r.access_token
            await supabase.from('integrations').update(encryptIntegrationWrite({
              twitter_access_token: r.access_token,
              twitter_refresh_token: r.refresh_token ?? integration.twitter_refresh_token,
              twitter_expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString(),
            })).eq('user_id', user.id)
            media = await resolveXMedia({ accessToken, imageUrl: heroUrl, grantedScopes })
          }
          return createTweet(accessToken, finalText, media.mediaIds)
        },
      })
    } catch (e) {
      if (e instanceof XPostError && /X posts for this billing period/.test(e.message)) {
        return NextResponse.json({ error: e.message, limitReached: true }, { status: 429 })
      }
      if (e instanceof XPostError) return NextResponse.json({ error: e.message, xDropped: e.dropped }, { status: 502 })
      throw e
    }
    // The reservation already counted this post (no recordXPost).

    // ── 6. Save tweet id on the post ───────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      .from('blog_posts')
      .update({ twitter_post_id: tweet.id })
      .eq('id', postId).eq('user_id', user.id)
    // Record the real permalink so the brand-recap links straight to the tweet.
    await recordSocialPermalink(supabase, postId!, 'x', socialPermalink.x(tweet.id))
    await incrementSocialCount(supabase, postId!, 'twitter')

    return NextResponse.json({
      ok: true,
      tweetId: tweet.id,
      publishCount: twSocialCount + 1,
      isLastAllowed: twCap.willBeLast,
      // A tweet WITH its picture and a tweet without one both return ok:true and
      // a tweet id, so the difference has to be said out loud or it is invisible
      // on screen — which is how this went unnoticed long enough for a creator
      // to be the one who spotted it. Named to match the Facebook route so the
      // shared preview modal already shows it: it toasts `mediaNote` on any
      // publish, and a second spelling would just be a note nothing renders.
      mediaUsed: media.attached ? 'image' : 'link-only',
      mediaNote: media.note,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // X rate-limit (free-tier daily cap) → a proper 429 with a clean message and
    // a flag, so the caller can say "try later" instead of surfacing a raw 500.
    if (/^RATE_LIMIT:/.test(msg)) {
      return NextResponse.json({ error: msg.replace(/^RATE_LIMIT:\s*/, ''), rateLimited: true }, { status: 429 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
