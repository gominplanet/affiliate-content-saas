/**
 * POST /api/deal-radar/social-post — Deal Radar "Quick post".
 *
 * Publish ONE deal straight to the link-friendly socials (X, Facebook, Threads,
 * LinkedIn, Telegram, Bluesky) with a thumbnail, a price-safe caption, and the
 * creator's own affiliate link. Skips the blog for time-sensitive deals. NOT
 * Instagram/TikTok (no clickable caption link) or Pinterest (pins go to blog).
 *
 * Body: { asin, platforms: string[], caption?, story?, title?, imageUrl?,
 *         useSavedImage?, useShowcase?, showcaseUrl?, scheduledFor? }
 *   - useShowcase: send clicks to the creator's TikTok Shop showcase instead of
 *     Amazon. showcaseUrl is an optional per-post override; without it the
 *     saved default on integrations is used (lib/post-destination).
 *   - useSavedImage: post the image the creator already approved for this ASIN
 *     (lib/product-image-memory) instead of designing a deal card from the
 *     Amazon photo. A FLAG, not a URL — the server resolves it from
 *     (user, asin), so this endpoint can't be used to push an arbitrary image.
 *   - scheduledFor (ISO time, future): queue the post instead of firing now. The
 *     process-deal-schedules cron publishes it at that time and SKIPS it if the
 *     deal has ended by then (you never promote a dead deal).
 * Returns: { ok, results } for an immediate post, or { ok, scheduled, scheduledFor }.
 *
 * Gate: Pro (+ admin), Labs while testing (NEXT_PUBLIC_DEAL_RADAR_ENABLED).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { QUICK_POST_PLATFORMS, type QuickPostPlatform } from '@/lib/deal-social-publish'
import { executeDealQuickPost } from '@/lib/deal-quick-post'
import { toUserMessage } from '@/lib/friendly-error'
import { spendGate } from '@/lib/ai-spend'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { recallProductImage } from '@/lib/product-image-memory'
import { resolvePostDestination } from '@/lib/post-destination'

export const runtime = 'nodejs'
export const maxDuration = 120

// A soft guardrail on scheduling: at most this many deal posts queued to fire on
// any one calendar day (UTC), per user. This protects the user more than us —
// firing dozens of near-identical posts a day is how a social account gets
// flagged as spam by the platforms. The cost to MVP is negligible either way.
const DAILY_SCHEDULE_CAP = 50

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawIntRow } = await (supabase as any)
      .from('integrations')
      .select('*')
      .eq('user_id', user.id).maybeSingle()
    // Secret columns (pinterest_access_token, geniuslink_api_key/secret) are
    // stored encrypted at rest. This path fed them to the Pinterest / Geniuslink
    // APIs raw, so Pinterest rejected the ciphertext with 401 "Authentication
    // failed" even right after a reconnect. Decrypt before use, like the blog +
    // Amazon pin routes already do.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const intRow = decryptIntegrationRow(rawIntRow as any)
    const tier = normalizeTier(intRow?.tier) as Tier
    if (!canUseDealRadar(tier)) {
      return NextResponse.json({ error: 'Amazon Deal Radar is available on paid plans.', currentTier: tier }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as { asin?: string; platforms?: unknown; caption?: string; title?: string; imageUrl?: string; story?: boolean; scheduledFor?: string; useSavedImage?: boolean; useShowcase?: boolean; showcaseUrl?: string }
    const asin = (body.asin || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'A valid ASIN is required.' }, { status: 400 })
    const rawPlatforms = (Array.isArray(body.platforms) ? body.platforms : []).map((p) => String(p))
    const platforms = rawPlatforms.filter((p): p is QuickPostPlatform => QUICK_POST_PLATFORMS.includes(p as QuickPostPlatform))
    // Pinterest is a separate pipeline (designed pin → affiliate link), not a
    // caption-link platform.
    const wantPinterest = rawPlatforms.includes('pinterest')
    // Instagram runs its own pipeline (designed image + caption, no clickable
    // link in the caption), so like Pinterest it travels as a flag rather than
    // as one of the caption-link platforms.
    const wantInstagram = rawPlatforms.includes('instagram')
    // Instagram Story is a separate path (image + baked "link in bio" CTA — a
    // Story published via the API can't carry a caption or a tappable link).
    const wantStory = body.story === true
    if (!platforms.length && !wantStory && !wantPinterest) return NextResponse.json({ error: 'Pick at least one platform.' }, { status: 400 })

    // Resolve the creator's approved image for this product ONCE, here. A
    // scheduled post stores the URL resolved now rather than re-resolving at
    // fire time, so what the modal said ("Reusing your thumbnail from Sep 14")
    // is what actually goes out days later.
    const savedImage = body.useSavedImage === true
      ? await recallProductImage(supabase, user.id, asin)
      : null
    const imageOverride = savedImage?.imageUrl ?? null

    // WHERE THE CLICKS GO, resolved ONCE here. A per-post paste wins over the
    // saved default. Resolved now rather than at fire time for the same reason
    // the image is: the composer told the creator where this post would send
    // people, and changing the saved default afterwards must not silently
    // redirect a post they already approved.
    // Explicit wins; absent inherits the account default (migration 333).
    const useShowcase = typeof body.useShowcase === 'boolean'
      ? body.useShowcase
      : (intRow as { link_destination_default?: string | null } | null)?.link_destination_default === 'showcase'
    const showcaseUrl = (body.showcaseUrl || '').trim()
      || ((intRow as { tiktok_showcase_url?: string | null } | null)?.tiktok_showcase_url || '')
    const destination = resolvePostDestination({
      asin,
      amazonTag: (intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag,
      useShowcase, showcaseUrl,
    })

    // ── Schedule for later ──────────────────────────────────────────────────
    // A future scheduledFor means: don't post now, queue it. The
    // process-deal-schedules cron fires it at that time and, crucially, skips it
    // if the deal has ended by then (lib/deal-quick-post requireLiveDeal).
    if (body.scheduledFor) {
      const when = new Date(body.scheduledFor)
      if (isNaN(when.getTime())) return NextResponse.json({ error: 'That schedule time isn’t valid.' }, { status: 400 })
      // Reject clearly-past times (allow a minute of clock skew).
      if (when.getTime() < Date.now() - 60_000) return NextResponse.json({ error: 'Pick a time in the future.' }, { status: 400 })
      // A tag is required to schedule too — fail fast rather than surprise them
      // when the post fires with nothing to earn. Pinterest pins earn off the tag
      // too, so require it whenever any link/pin platform is chosen.
      if ((platforms.length || wantPinterest) && !((intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag || '').trim()) {
        return NextResponse.json({ error: 'Add your Amazon Associates tag in Settings first, so your links earn.' }, { status: 400 })
      }
      // Daily cap: count what's already queued for that calendar day (UTC) and
      // refuse once it hits DAILY_SCHEDULE_CAP. Best-effort — a count error never
      // blocks a legitimate schedule.
      const dayStart = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate(), 0, 0, 0))
      const dayEnd = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate(), 23, 59, 59, 999))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: dayCount } = await (supabase as any).from('deal_scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('status', ['pending', 'processing'])
        .gte('scheduled_at', dayStart.toISOString())
        .lte('scheduled_at', dayEnd.toISOString())
      if (typeof dayCount === 'number' && dayCount >= DAILY_SCHEDULE_CAP) {
        return NextResponse.json({
          error: `You already have ${dayCount} posts scheduled for that day (limit ${DAILY_SCHEDULE_CAP}). Spread them across other days, or post some now. This cap keeps your accounts from being flagged as spam.`,
        }, { status: 429 })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insErr } = await (supabase as any).from('deal_scheduled_posts').insert({
        user_id: user.id,
        asin,
        title: (body.title || '').trim() || null,
        image_url: body.imageUrl || null,
        image_override: imageOverride,
        destination_url: destination.kind === 'showcase' ? destination.url : null,
        destination_kind: destination.kind,
        // Store 'pinterest' alongside the caption-link platforms; the cron splits
        // it back out and routes it through the pin pipeline at fire time.
        platforms: [...platforms, ...(wantPinterest ? ['pinterest'] : []), ...(wantInstagram ? ['instagram'] : [])],
        story: wantStory,
        caption: (body.caption || '').trim() || null,
        scheduled_at: when.toISOString(),
        status: 'pending',
      })
      if (insErr) {
        console.error('[deal-radar/social-post schedule]', insErr.message)
        return NextResponse.json({ error: toUserMessage(insErr, 'Could not schedule that post. Please try again.') }, { status: 500 })
      }
      // Say which image was queued, not which was requested — useSavedImage
      // with nothing saved (or an unapplied migration 331) silently falls back
      // to the product photo, and the caller should be able to tell.
      return NextResponse.json({
        ok: true, scheduled: true, scheduledFor: when.toISOString(),
        usedSavedImage: !!imageOverride,
        // Say where it will actually go, and why if that is not what was asked.
        destinationKind: destination.kind,
        destinationNote: destination.note,
      })
    }

    // ── Post now ────────────────────────────────────────────────────────────
    const gate = await spendGate(user.id, tier)
    if (gate) return gate

    const out = await executeDealQuickPost({
      db: supabase, userId: user.id, tier, intRow: intRow ?? null,
      asin, platforms, pinterest: wantPinterest, instagram: wantInstagram, story: wantStory,
      caption: body.caption, title: body.title, imageUrl: body.imageUrl,
      imageOverride,
      useShowcase, showcaseUrl,
    })
    if (out.missingTag) return NextResponse.json({ error: 'Add your Amazon Associates tag in Settings first, so your links earn.' }, { status: 400 })
    if (out.dealEnded && out.results.length === 0) return NextResponse.json({ error: 'That deal is no longer on the radar.' }, { status: 404 })
    const anyOk = out.results.some((r) => r.ok)
    return NextResponse.json({
      ok: anyOk, results: out.results, caption: out.caption, geniuslinkNote: out.geniuslinkNote,
      usedSavedImage: !!imageOverride,
      destinationKind: out.destinationKind ?? 'amazon',
      destinationNote: out.destinationNote ?? null,
    }, { status: anyOk ? 200 : 502 })
  } catch (err) {
    console.error('[deal-radar/social-post]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't post just now. Please try again in a moment.") }, { status: 500 })
  }
}
