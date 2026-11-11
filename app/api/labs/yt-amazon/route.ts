// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUTUBE AGAINST AMAZON (Labs; Seb, 2026-11-11: "is there a way to look at
// all of the youtube videos ive uploaded and see what is missing when you look
// at my amazon storefront?").
//
//   GET                         the four lists (lib/yt-amazon-match) from MVP's
//                               copies: youtube_videos and the products each
//                               links to, amazon_videos and theirs
//   POST { action: 'read' }     read the links of the next YouTube videos not
//                               read yet (lib/yt-amazon-links), a batch at a
//                               time, and say how many are left
//   POST { action: 'again' }    read every video's links again (after the
//                               creator changed descriptions)
//
// Labs: the MVP team only, like the Amazon video library it reads.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { normalizeTier } from '@/lib/tier'
import { buildCoverage, type YtVideo, type AmzVideo } from '@/lib/yt-amazon-match'
import { productsOfVideo } from '@/lib/yt-amazon-links'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function gate(): Promise<{ error: NextResponse } | { ownerId: string; db: Db }> {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  const db = createAdminClient() as Db
  const { data: intg } = await db.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(intg?.tier) !== 'admin') return { error: NextResponse.json({ error: 'This is in Labs, for the MVP team.' }, { status: 403 }) }
  return { ownerId, db }
}

const MIGRATION = 'MVP needs migration 466 (youtube_video_products) in Supabase before it can match your videos. It is in the message from the MVP team.'
const missingSchema = (m: string) => /youtube_video_products|products_read_at|products_why|does not exist|schema cache/i.test(m)

/** Every row, a thousand at a time. */
async function every<T>(make: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>, max = 20000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const { ownerId, db } = g
  try {
    const [yt, ytp, amz, amzp] = await Promise.all([
      every<Record<string, unknown>>((a, b) => db.from('youtube_videos').select('youtube_video_id, title, published_at, view_count, thumbnail_url, duration_seconds, is_vertical, products_read_at, products_why').eq('user_id', ownerId).order('published_at', { ascending: false }).range(a, b)),
      every<Record<string, unknown>>((a, b) => db.from('youtube_video_products').select('youtube_video_id, asin, via').eq('user_id', ownerId).range(a, b), 60000),
      every<Record<string, unknown>>((a, b) => db.from('amazon_videos').select('aci, description, state, published_at, views, products_synced_at, synced_at').eq('user_id', ownerId).range(a, b)),
      every<Record<string, unknown>>((a, b) => db.from('amazon_video_products').select('aci, asin, title').eq('user_id', ownerId).range(a, b), 60000),
    ])
    const ytVideos: YtVideo[] = yt.map((r) => ({
      id: String(r.youtube_video_id), title: String(r.title || ''), publishedAt: (r.published_at as string) || null,
      views: r.view_count == null ? null : Number(r.view_count), thumb: (r.thumbnail_url as string) || null,
      short: r.is_vertical === true || (Number(r.duration_seconds) > 0 && Number(r.duration_seconds) <= 60),
      readAt: (r.products_read_at as string) || null, why: (r.products_why as string) || null,
    }))
    const amzVideos: AmzVideo[] = amz.map((r) => ({
      aci: String(r.aci), description: (r.description as string) || null, state: (r.state as string) || null,
      publishedAt: (r.published_at as string) || null, views: r.views == null ? null : Number(r.views), productsRead: !!r.products_synced_at,
    }))
    const coverage = buildCoverage(
      ytVideos,
      ytp.map((r) => ({ videoId: String(r.youtube_video_id), asin: String(r.asin), via: (r.via as string) || null })),
      amzVideos,
      amzp.map((r) => ({ aci: String(r.aci), asin: String(r.asin), title: (r.title as string) || null })),
    )
    const amazonReadAt = amz.reduce<string | null>((m, r) => (r.synced_at && (!m || String(r.synced_at) > m) ? String(r.synced_at) : m), null)
    return NextResponse.json({ ok: true, coverage, youtubeNewest: ytVideos[0]?.publishedAt ?? null, amazonReadAt })
  } catch (e) {
    const m = e instanceof Error ? e.message : 'error'
    if (missingSchema(m)) return NextResponse.json({ error: MIGRATION, migration: '466' }, { status: 409 })
    return NextResponse.json({ error: `MVP could not read your videos: ${m}` }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const { ownerId, db } = g
  const body = await req.json().catch(() => ({})) as { action?: string }
  if (body.action === 'again') {
    const { error } = await db.from('youtube_videos').update({ products_read_at: null, products_why: null }).eq('user_id', ownerId)
    if (error) return NextResponse.json({ error: missingSchema(error.message) ? MIGRATION : error.message }, { status: missingSchema(error.message) ? 409 : 500 })
    return NextResponse.json({ ok: true })
  }
  if (body.action !== 'read') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })

  // The next videos not read yet, newest first, read six at a time inside a
  // time budget, each saved as it is read so a stop loses nothing.
  const { data: todo, error } = await db.from('youtube_videos').select('youtube_video_id, title, description').eq('user_id', ownerId).is('products_read_at', null).order('published_at', { ascending: false }).limit(60)
  if (error) return NextResponse.json({ error: missingSchema(error.message) ? MIGRATION : error.message }, { status: missingSchema(error.message) ? 409 : 500 })
  const started = Date.now()
  let read = 0
  let found = 0
  let saveError: string | null = null
  const queue = [...((todo || []) as Array<{ youtube_video_id: string; title: string | null; description: string | null }>)]
  const worker = async () => {
    for (;;) {
      if (Date.now() - started > 70_000 || saveError) return
      const v = queue.shift()
      if (!v) return
      const r = await productsOfVideo(v.title || '', v.description || '')
      const now = new Date().toISOString()
      if (r.asins.length) {
        const { error: pe } = await db.from('youtube_video_products').upsert(r.asins.map((a) => ({ user_id: ownerId, youtube_video_id: v.youtube_video_id, asin: a.asin, via: a.via })), { onConflict: 'user_id,youtube_video_id,asin' })
        if (pe) { saveError = pe.message; return }
        found++
      }
      const { error: ve } = await db.from('youtube_videos').update({ products_read_at: now, products_why: r.why }).eq('user_id', ownerId).eq('youtube_video_id', v.youtube_video_id)
      if (ve) { saveError = ve.message; return }
      // The video's main product, where nothing set one before (the column the
      // Creator Connections badge and blog posts read).
      if (r.asins[0]) await db.from('youtube_videos').update({ asin: r.asins[0].asin }).eq('user_id', ownerId).eq('youtube_video_id', v.youtube_video_id).is('asin', null)
      read++
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  if (saveError) return NextResponse.json({ error: missingSchema(saveError) ? MIGRATION : `MVP could not save what it read: ${saveError}`, read }, { status: missingSchema(saveError) ? 409 : 500 })
  const { count } = await db.from('youtube_videos').select('youtube_video_id', { count: 'exact', head: true }).eq('user_id', ownerId).is('products_read_at', null)
  return NextResponse.json({ ok: true, read, found, left: count ?? 0 })
}
