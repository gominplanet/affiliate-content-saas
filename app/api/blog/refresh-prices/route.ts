/**
 * GET /api/blog/refresh-prices
 *
 * Streams SSE progress while re-fetching current Amazon prices for every
 * published post that has an ASIN, then patches ONLY the JSON-LD price
 * fields in WordPress (no content regeneration — cheap, no AI cost).
 *
 * Respects the user's `blog_customizations.postMeta.schemaIncludePrice`
 * toggle. If price is disabled, returns `{"skipped":true}` immediately.
 *
 * SSE event shape: `data: {"done":N,"total":N,"current":"title"}\n\n`
 * Terminal event:  `data: {"done":N,"total":N,"finished":true}\n\n`
 */
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { extractAsin, fetchAmazonProduct } from '@/services/amazon'
import { parsePrice } from '@/lib/seo-schema'

export const maxDuration = 300

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  // Check user's price toggle
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('blog_customizations')
    .eq('user_id', user.id)
    .maybeSingle()

  const bc = (brand as { blog_customizations?: Record<string, unknown> } | null)?.blog_customizations ?? {}
  const postMeta = (bc as Record<string, Record<string, unknown>>)?.postMeta ?? {}
  const includePrice = postMeta?.schemaIncludePrice !== false

  if (!includePrice) {
    return new Response(JSON.stringify({ skipped: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Resolve WP credentials (uses primary/default site)
  const site = await getWordPressCredentials(supabase, user.id, null)
  if (!site) {
    return new Response(JSON.stringify({ error: 'WordPress not connected.' }), { status: 400 })
  }
  const wpService = createWordPressService(
    site.wordpress_url ?? '',
    site.wordpress_username ?? '',
    site.wordpress_app_password ?? '',
  )

  // Query published blog posts that have both a WP post id and a linked video
  // with a product_url (which carries the ASIN). Cast through any for tables
  // not yet in generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from('blog_posts')
    .select('id, title, wordpress_post_id, video_id')
    .eq('user_id', user.id)
    .eq('status', 'published')
    .not('wordpress_post_id', 'is', null)
    .not('video_id', 'is', null)

  type BlogRow = { id: string; title: string; wordpress_post_id: number; video_id: string }
  const blogRows: BlogRow[] = (rows as BlogRow[] | null) ?? []

  // Collect which rows have an ASIN (via product_url on youtube_videos)
  type WorkItem = { wpPostId: number; asin: string; title: string }
  const workItems: WorkItem[] = []

  if (blogRows.length > 0) {
    const videoIds = blogRows.map(r => r.video_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vids } = await (supabase as any)
      .from('youtube_videos')
      .select('id, product_url')
      .eq('user_id', user.id)
      .in('id', videoIds)

    type VidRow = { id: string; product_url: string | null }
    const vidMap = new Map<string, string | null>(
      ((vids as VidRow[]) ?? []).map(v => [v.id, v.product_url])
    )

    for (const row of blogRows) {
      const productUrl = vidMap.get(row.video_id) ?? null
      if (!productUrl) continue
      const asin = extractAsin(productUrl.toUpperCase())
      if (!asin) continue
      workItems.push({ wpPostId: row.wordpress_post_id, asin, title: row.title })
    }
  }

  const total = workItems.length

  // Stream SSE
  const encoder = new TextEncoder()
  let done = 0

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sse(data)))
      }

      if (total === 0) {
        emit({ done: 0, total: 0, finished: true })
        controller.close()
        return
      }

      const priceValidUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0]

      for (const item of workItems) {
        emit({ done, total, current: item.title })

        try {
          // 1. Fetch current Amazon price (no AI cost — plain HTTP scrape)
          const product = await fetchAmazonProduct(item.asin)
          const rawPrice = product?.price ?? product?.priceSale ?? null
          const numericPrice = parsePrice(rawPrice)
          if (numericPrice == null) {
            done++
            continue // product has no price (out of stock / varies) — skip
          }

          // 2. Read existing mvp_jsonld from WP so we can patch in-place
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const wpPost = await (wpService as any).getCustomEndpoint(
            `/wp/v2/posts/${item.wpPostId}?context=edit&_fields=meta`
          ) as { meta?: { mvp_jsonld?: string } } | null

          const existingJsonStr = wpPost?.meta?.mvp_jsonld
          if (!existingJsonStr) {
            done++
            continue // no schema on this post yet — skip
          }

          let graph: { '@context': string; '@graph': Array<Record<string, unknown>> }
          try {
            graph = JSON.parse(existingJsonStr)
          } catch {
            done++
            continue
          }

          // 3. Patch the price on the Product node's offers
          let patched = false
          for (const node of graph['@graph'] ?? []) {
            if (node['@type'] === 'Product' && node.offers) {
              const offer = node.offers as Record<string, unknown>
              offer.price = numericPrice
              offer.priceCurrency = 'USD'
              offer.priceValidUntil = priceValidUntil
              if (!offer['@type']) offer['@type'] = 'Offer'
              patched = true
            }
          }

          if (!patched) {
            done++
            continue
          }

          // 4. Write patched JSON-LD back to WP meta
          await wpService.updatePost(item.wpPostId, {
            meta: { mvp_jsonld: JSON.stringify(graph) },
          })
        } catch (e) {
          console.warn('[refresh-prices] skipped post', item.wpPostId, e instanceof Error ? e.message : String(e))
        }

        done++
        // Rate-limit Amazon requests
        if (done < total) await delay(800)
      }

      emit({ done, total, finished: true })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
