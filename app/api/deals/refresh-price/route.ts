/**
 * POST /api/deals/refresh-price  { asin }
 *
 * Cheap "the price changed, fix my post" action for a stale deal post. Re-pulls
 * the current price and runs ONE Haiku pass that corrects only the dollar
 * figures + discount % in the post — leaving the writing, images, links and
 * shortcodes untouched. Updates WordPress + the stored row. Not a regeneration:
 * ~a cent, seconds, not the Opus/Sonnet writer.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { fetchKeepaProductStats, buildPriceSnapshotHtml } from '@/services/keepa'
import { scrubBanned } from '@/lib/scrub'

export const runtime = 'nodejs'
export const maxDuration = 60

const usd = (c: number | null) => (c == null ? null : `$${(c / 100).toFixed(2)}`)

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as { asin?: string }
    const asin = (body.asin || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'A valid ASIN is required.' }, { status: 400 })

    // Find this user's deal post for the ASIN (most recent).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: post } = await sb
      .from('blog_posts')
      .select('id,title,content,wordpress_post_id,wordpress_site_id,deal_meta')
      .eq('user_id', user.id).eq('post_type', 'deal').eq('deal_meta->>asin', asin)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!post?.content || !post.wordpress_post_id) {
      return NextResponse.json({ error: 'No published deal post found for that product.' }, { status: 404 })
    }

    // Current price from the same price-history source.
    const a = await fetchKeepaProductStats(asin)
    if (a.currentCents == null) {
      return NextResponse.json({ error: "Couldn't read a current price for this product right now — try again shortly." }, { status: 502 })
    }
    const now = usd(a.currentCents)
    const pct = a.pctBelowAvg90

    const oldContent = post.content as string

    // One cheap Haiku pass: correct ONLY the money figures, keep everything else
    // byte-identical (tags, shortcodes, links, images, structure).
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Below is the HTML of a published deal blog post whose pricing is now out of date. Update ONLY the deal/price CLAIMS to match reality now. Change nothing else.

CURRENT REALITY:
${pct != null && pct >= 5 ? `- It's currently about ${pct}% below its usual price.` : '- It is NOT meaningfully discounted right now (the earlier deal has faded — soften any "big discount / X% off" claims to something honest like "close to its usual price").'}

RULES:
- Keep everything RELATIVE. Do NOT introduce exact dollar prices. If the post already contains exact dollar amounts, remove or generalise them ("a great price right now"). Percentages are fine and should be corrected to the number above.
- If the post claims a discount that no longer holds, rewrite those claims truthfully — do not pretend it's still a deal.
- Keep ALL HTML tags, attributes, links, images, and shortcodes (anything in [square brackets] like [mvp_deal_banner ...], [mvp_deal_cta ...]) EXACTLY as-is.
- Do not add or remove sections. No markdown fences. NEVER name a data provider or price tracker.
- Return the FULL updated HTML only.

HTML:
${oldContent}`,
      }],
    })
    recordAnthropicUsage(msg, { userId: user.id, feature: 'deal_price_refresh', model: 'claude-haiku-4-5-20251001' })

    let updated = scrubBanned((msg.content?.[0] as { type: string; text: string })?.text || '').trim()
    // Safety: the pass must return recognisable, complete HTML and preserve the
    // deal shortcodes. If it looks mangled, refresh just the deterministic price
    // snapshot block instead of risking a broken post.
    const looksOk = updated.length > oldContent.length * 0.6 && /<\/p>/i.test(updated)
      && oldContent.includes('[mvp_deal_cta') === updated.includes('[mvp_deal_cta')
    if (!looksOk) {
      const snapshot = buildPriceSnapshotHtml(a)
      updated = snapshot
        ? oldContent.replace(/<div class="mvp-price-snapshot"[\s\S]*?<\/div>\s*<\/div>\s*(?:<div[^>]*><\/div>\s*)?<\/div>/i, snapshot)
        : oldContent
      if (updated === oldContent) {
        return NextResponse.json({ error: "Couldn't safely rewrite the post automatically — edit the price in WordPress, or regenerate the post from Deal Radar." }, { status: 422 })
      }
    }

    // Push to WordPress + persist.
    const site = await getWordPressCredentials(supabase, user.id, (post.wordpress_site_id as string | null) || undefined)
    if (!site) return NextResponse.json({ error: 'WordPress is not connected.' }, { status: 400 })
    const wpService = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
    await wpService.updatePost(post.wordpress_post_id as number, { content: updated })

    const dealMeta = { ...((post.deal_meta as Record<string, unknown>) || {}), priceSale: now, discountPct: pct }
    await sb.from('blog_posts').update({ content: updated, deal_meta: dealMeta }).eq('id', post.id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[deals/refresh-price]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
