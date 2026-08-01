// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/campaigns/cc-badges   { videoIds: string[] }
//
// Batch "which of these posts' products have a LIVE Creator Connections
// campaign?" for the Blog Post Generator list ("CC campaign" badge). Resolves
// each video's ASIN the reliable way:
//   1. the stored youtube_videos.asin (written at generation, migration 204),
//   2. else a direct amazon /dp/ or bare B0… id in product_url / description,
//   3. else RESOLVE the geni.us / amzn.to short link once (most creators use
//      Geniuslink, which hides the ASIN) and CACHE it back into .asin so we
//      never re-resolve.
// Then one GIN-indexed overlap query against the shared catalog. Returns the
// subset of input videoIds whose product has a live campaign.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { resolveTrueDestination } from '@/lib/affiliate-resolve'
import { asinFromAmazonUrl } from '@/lib/product-link'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Max geni.us/amzn.to redirects to resolve per request — bounds latency; the
// .asin cache fills across loads so repeat visits are instant.
const MAX_RESOLVE = 20

function asinFromText(...parts: (string | null | undefined)[]): string | null {
  const hay = parts.filter(Boolean).join('\n').toUpperCase()
  return hay.match(/\/(?:DP|GP\/PRODUCT)\/([A-Z0-9]{10})/)?.[1] || hay.match(/\b(B0[A-Z0-9]{8})\b/)?.[1] || null
}
function firstShortLink(...parts: (string | null | undefined)[]): string | null {
  const hay = parts.filter(Boolean).join('\n')
  return hay.match(/https?:\/\/(?:www\.)?geni\.us\/[^\s)>\]"']+/i)?.[0]
    || hay.match(/https?:\/\/(?:www\.)?amzn\.to\/[^\s)>\]"']+/i)?.[0]
    || null
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth) return auth.error
  const { ownerId } = auth

  const body = await request.json().catch(() => ({})) as { videoIds?: string[] }
  const videoIds = [...new Set((body.videoIds ?? []).filter(v => typeof v === 'string'))].slice(0, 150)
  if (!videoIds.length) return NextResponse.json({ ok: true, matched: [] })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from('youtube_videos')
    .select('id, asin, product_url, description, title')
    .eq('user_id', ownerId)
    .in('id', videoIds)
  const vids = (rows ?? []) as Array<{ id: string; asin: string | null; product_url: string | null; description: string | null; title: string | null }>

  const idToAsin = new Map<string, string>()
  const needResolve: Array<{ id: string; link: string }> = []
  for (const v of vids) {
    const stored = (v.asin || '').toUpperCase()
    if (/^[A-Z0-9]{10}$/.test(stored)) { idToAsin.set(v.id, stored); continue }
    const direct = asinFromText(v.product_url, v.description, v.title)
    if (direct) { idToAsin.set(v.id, direct); continue }
    const link = firstShortLink(v.product_url, v.description)
    if (link) needResolve.push({ id: v.id, link })
  }

  // Resolve geni.us / amzn.to short links (bounded), cache the ASIN back.
  const admin = createAdminClient()
  for (const { id, link } of needResolve.slice(0, MAX_RESOLVE)) {
    try {
      const dest = await resolveTrueDestination(link)
      const asin = (asinFromAmazonUrl(dest) || '').toUpperCase()
      if (/^[A-Z0-9]{10}$/.test(asin)) {
        idToAsin.set(id, asin)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        void (admin as any).from('youtube_videos').update({ asin }).eq('id', id).then(() => {}, () => {})
      }
    } catch { /* skip this one */ }
  }

  const asins = [...new Set(idToAsin.values())]
  if (!asins.length) return NextResponse.json({ ok: true, matched: [] })

  // Which ASINs have a live campaign? One overlap query on the shared catalog.
  const today = new Date().toISOString().slice(0, 10)
  const liveAsins = new Set<string>()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('cc_campaign_catalog')
      .select('asins')
      .overlaps('asins', asins)
      .gte('ends_at', today)
      .limit(4000)
    const wanted = new Set(asins)
    for (const row of (data ?? []) as Array<{ asins: string[] | null }>) {
      for (const a of row.asins ?? []) {
        const up = String(a || '').toUpperCase()
        if (wanted.has(up)) liveAsins.add(up)
      }
    }
  } catch { /* best-effort */ }

  const matched = [...idToAsin.entries()].filter(([, a]) => liveAsins.has(a)).map(([id]) => id)
  return NextResponse.json({ ok: true, matched })
}
