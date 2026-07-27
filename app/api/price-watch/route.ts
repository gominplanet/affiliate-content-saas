/**
 * Price Watch API.
 *
 *   GET    /api/price-watch      → { alerts, watchCount, watching: string[] }
 *   POST   /api/price-watch      → add/refresh a watch  { asin, blogPostId?, title?, imageUrl?, priceCents? }
 *   DELETE /api/price-watch?asin= → stop watching a product
 *
 * Reads are RLS-scoped to the signed-in user; writes go through the user's own
 * client (RLS WITH CHECK user_id = auth.uid()). The cron (service role) is the
 * only writer of price_alerts.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [{ data: alerts }, { data: watches }, { data: intg }] = await Promise.all([
    sb.from('price_alerts').select('*').order('created_at', { ascending: false }).limit(50),
    sb.from('product_watches').select('asin'),
    sb.from('integrations').select('amazon_associates_tag').eq('user_id', user.id).maybeSingle(),
  ])

  return NextResponse.json({
    ok: true,
    alerts: alerts ?? [],
    watchCount: (watches ?? []).length,
    watching: (watches ?? []).map((w: { asin: string }) => w.asin),
    amazonTag: (intg?.amazon_associates_tag as string | null) || null,
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    asin?: string; blogPostId?: string; title?: string; imageUrl?: string; priceCents?: number; deal?: boolean
  }
  const asin = (body.asin || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'A valid ASIN is required.' }, { status: 400 })

  // 'deal_post' watches get the stale-price guard (drift vs the post's price);
  // a plain 'manual' watch only gets new-low drop alerts.
  const isDealPost = !!body.blogPostId || body.deal === true
  const price = Number.isFinite(body.priceCents) ? Math.round(body.priceCents as number) : null
  const row = {
    user_id: user.id,
    asin,
    source: isDealPost ? 'deal_post' : 'manual',
    blog_post_id: body.blogPostId || null,
    title: (body.title || '').slice(0, 500) || null,
    image_url: body.imageUrl || null,
    baseline_price_cents: price,
    last_price_cents: price,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('product_watches')
    .upsert(row, { onConflict: 'user_id,asin' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, watching: true })
}

export async function DELETE(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const asin = (new URL(request.url).searchParams.get('asin') || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'A valid ASIN is required.' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('product_watches').delete().eq('user_id', user.id).eq('asin', asin)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, watching: false })
}
