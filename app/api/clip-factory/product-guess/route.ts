// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/clip-factory/product-guess?file=<name>&video=<youtube id>&asin=<ASIN>
//   -> { product, productName, from, recent: [{ product, productName }] }
//
// Fills Clip Factory's product link and name from what MVP already knows
// (lib/clip-product-guess). `from` says where the guess came from, so the page
// can say so: a filled field that looks typed by the creator but was guessed is
// the kind of silent swap this codebase keeps getting bitten by. Reads only.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { asinInFileName, asinInText, nameFromFileName } from '@/lib/clip-product-guess'
import { isAsin } from '@/lib/product-image-label'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** The product name MVP already wrote down for this ASIN, or null. */
async function nameForAsin(db: Db, userId: string, asin: string): Promise<string | null> {
  const tries: Array<[string, string]> = [
    ['launch_items', 'amazon_title'], ['video_scripts', 'product_title'], ['campaigns', 'product_title'], ['youtube_videos', 'title'],
  ]
  for (const [table, col] of tries) {
    try {
      const { data } = await db.from(table).select('*').eq('user_id', userId).eq('asin', asin).order('created_at', { ascending: false }).limit(1).maybeSingle()
      const v = data?.[col]
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120)
    } catch { /* next source */ }
  }
  return null
}

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = new URL(request.url)
  const file = u.searchParams.get('file')
  const video = u.searchParams.get('video')
  const typed = (u.searchParams.get('asin') || '').trim().toUpperCase()

  let product: string | null = null
  let productName: string | null = null
  let from: 'file' | 'video' | 'typed' | null = null

  if (isAsin(typed)) { product = typed; from = 'typed' }
  if (!product && file) {
    const a = asinInFileName(file)
    if (a) { product = a; from = 'file' }
  }
  if (!product && video) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // Clip Factory passes the video row's own id; a YouTube id works too.
      const col = /^[0-9a-f-]{36}$/i.test(video) ? 'id' : 'youtube_video_id'
      const { data: v } = await (supabase as any).from('youtube_videos').select('*').eq('user_id', user.id).eq(col, video).maybeSingle()
      const a = (isAsin(v?.asin) ? String(v.asin).toUpperCase() : null) || asinInText(v?.product_url) || asinInText(v?.description)
      if (a) { product = a; from = 'video' }
      else if (typeof v?.product_url === 'string' && /^https?:\/\//.test(v.product_url)) { product = v.product_url; from = 'video' }
      if (typeof v?.title === 'string' && v.title.trim()) productName = v.title.trim().slice(0, 120)
    } catch { /* no video row */ }
  }
  if (product && isAsin(product)) productName = (await nameForAsin(supabase, user.id, product)) || productName
  if (!productName && file) productName = nameFromFileName(file)

  // The creator's recent products, newest first, for one-tap picks.
  const recent: Array<{ product: string; productName: string | null }> = []
  try {
    const seen = new Set<string>()
    const add = (asin: unknown, name: unknown) => {
      const a = typeof asin === 'string' ? asin.trim().toUpperCase() : ''
      if (!isAsin(a) || seen.has(a) || recent.length >= 6) return
      seen.add(a)
      recent.push({ product: a, productName: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const [li, yv] = await Promise.all([
      sb.from('launch_items').select('*').eq('user_id', user.id).not('asin', 'is', null).order('created_at', { ascending: false }).limit(12),
      sb.from('youtube_videos').select('asin,title,created_at').eq('user_id', user.id).not('asin', 'is', null).order('created_at', { ascending: false }).limit(12),
    ])
    const rows = [
      ...((li?.data ?? []) as Array<Record<string, unknown>>).map((r) => ({ asin: r.asin, name: r.amazon_title || r.title, at: String(r.created_at || '') })),
      ...((yv?.data ?? []) as Array<Record<string, unknown>>).map((r) => ({ asin: r.asin, name: r.title, at: String(r.created_at || '') })),
    ].sort((a, b) => b.at.localeCompare(a.at))
    for (const r of rows) add(r.asin, r.name)
  } catch { /* no recents */ }

  return NextResponse.json({ product, productName, from, recent }, { headers: { 'Cache-Control': 'no-store' } })
}
