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
//   POST { action: 'unplaced' } read again the videos with no product whose
//                               link did not answer, and once, the ones an
//                               earlier reader could not place (their reason
//                               does not start with READER)
//
// Labs: the MVP team only, like the Amazon video library it reads.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { normalizeTier } from '@/lib/tier'
import { buildCoverage, familyKeys, type YtVideo, type AmzVideo } from '@/lib/yt-amazon-match'
import { familiesFor } from '@/lib/asin-family'
import { productsOfVideo, type LinkLookup } from '@/lib/yt-amazon-links'
import { asinFromAmazonUrl } from '@/lib/asin'
import { passportCodeFromUrl } from '@/lib/passport-links'
import { geniuslinkAsins, geniusCode } from '@/lib/yt-amazon-geniuslink'

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

// The reader that wrote a reason, saved in front of it ("r3:no-link"). A video
// an earlier reader could not place is read again once by the newer one,
// whenever that happens to be, with no clock to guess (2026-11-11: the third
// reader reads "Product ASIN: B0..." lines and says where a link failed; the
// fourth looks Passport codes up in MVP's own table instead of following them;
// the fifth reads geni.us links from the creator's Geniuslink account; the
// sixth starts from what MVP already knows: the video's own product
// (youtube_videos.asin, product_url) and the geni.us links MVP made).
const READER = 'r6'

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
    // The same product in another colour or size counts as the same product:
    // the families MVP already holds (no new lookups here).
    let sameAs = new Map<string, string>()
    try {
      const { families } = await familiesFor(db, [...ytp.map((r) => String(r.asin)), ...amzp.map((r) => String(r.asin))], { maxLookups: 0 })
      sameAs = familyKeys(families.values())
    } catch { /* exact matching, as before */ }
    const coverage = buildCoverage(
      ytVideos,
      ytp.map((r) => ({ videoId: String(r.youtube_video_id), asin: String(r.asin), via: (r.via as string) || null })),
      amzVideos,
      amzp.map((r) => ({ aci: String(r.aci), asin: String(r.asin), title: (r.title as string) || null })),
      sameAs,
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
  if (body.action === 'unplaced') {
    const older = await db.from('youtube_videos').update({ products_read_at: null }).eq('user_id', ownerId).not('products_why', 'is', null).not('products_why', 'like', `${READER}:%`)
    const failed = await db.from('youtube_videos').update({ products_read_at: null }).eq('user_id', ownerId).like('products_why', `${READER}:link-failed%`)
    const slowed = await db.from('youtube_videos').update({ products_read_at: null }).eq('user_id', ownerId).like('products_why', `${READER}:rate-limited%`)
    const err = older.error || failed.error || slowed.error
    if (err) return NextResponse.json({ error: missingSchema(err.message) ? MIGRATION : err.message }, { status: missingSchema(err.message) ? 409 : 500 })
    return NextResponse.json({ ok: true })
  }
  if (body.action !== 'read') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })

  // The next videos not read yet, newest first, read six at a time inside a
  // time budget, each saved as it is read so a stop loses nothing.
  const { data: todo, error } = await db.from('youtube_videos').select('youtube_video_id, title, description, asin, product_url').eq('user_id', ownerId).is('products_read_at', null).order('published_at', { ascending: false }).limit(60)
  if (error) return NextResponse.json({ error: missingSchema(error.message) ? MIGRATION : error.message }, { status: missingSchema(error.message) ? 409 : 500 })
  const started = Date.now()
  let read = 0
  let found = 0
  let followed = 0
  let slowed = 0
  let saveError: string | null = null
  // Every link already resolved for this creator, so a link in many
  // descriptions is followed once, ever.
  const known = new Map<string, string | null>()
  try {
    const prior = await every<{ via: string | null; asin: string }>((a, b) => db.from('youtube_video_products').select('via, asin').eq('user_id', ownerId).like('via', 'http%').range(a, b), 60000)
    for (const r of prior) if (r.via) known.set(r.via, r.asin)
  } catch { /* followed again, as before */ }
  const queue = [...((todo || []) as Array<{ youtube_video_id: string; title: string | null; description: string | null; asin?: string | null; product_url?: string | null }>)]
  // The geni.us links MVP made for this creator, each with its ASIN
  // (geniuslink_codes, written when MVP built the link from the product).
  const madeByMvp = new Map<string, string>()
  try {
    const rows = await every<{ code: string; asin: string }>((a, b) => db.from('geniuslink_codes').select('code, asin').eq('user_id', ownerId).range(a, b), 60000)
    for (const r of rows) if (r.code && /^[A-Z0-9]{10}$/i.test(String(r.asin || ''))) madeByMvp.set(String(r.code), String(r.asin).toUpperCase())
  } catch { /* followed or read from the account instead */ }
  let alreadyKnown = 0
  // A saved product on so many of the creator's videos that it is no one
  // video's product (a gear list item an early reader saved) is not trusted:
  // those videos have their links read instead.
  const savedCount = new Map<string, number>()
  let often = Infinity
  try {
    const saved = await every<{ asin: string | null }>((a, b) => db.from('youtube_videos').select('asin').eq('user_id', ownerId).not('asin', 'is', null).range(a, b))
    for (const r of saved) { const k = String(r.asin || '').toUpperCase(); if (k) savedCount.set(k, (savedCount.get(k) || 0) + 1) }
    const { count: videos } = await db.from('youtube_videos').select('youtube_video_id', { count: 'exact', head: true }).eq('user_id', ownerId)
    often = Math.max(6, Math.ceil((videos || saved.length) * 0.08))
  } catch { often = 6 }
  // MVP's own Passport links (mvpl.ink/CODE, /go/CODE) are looked up, never
  // followed: the table holds each code's ASIN, and a followed one would log a
  // click and could lead to a Levanta link or another country's store.
  const passport = new Map<string, { asin: string | null; url: string | null }>()
  const codes = new Set<string>()
  for (const v of queue) {
    for (const raw of String(v.description || '').match(/https?:\/\/[^\s)>\]"']+/gi) || []) {
      const code = passportCodeFromUrl(raw.replace(/[.,;:!)\]]+$/, ''))
      if (code) codes.add(code)
    }
  }
  if (codes.size) {
    const { data: rows } = await db.from('passport_links').select('*').in('code', Array.from(codes))
    for (const r of (rows || []) as Array<Record<string, unknown>>) passport.set(String(r.code), { asin: r.asin ? String(r.asin) : null, url: (r.destination_url as string) || null })
  }
  // The creator's geni.us links, from their own Geniuslink account in one ask
  // per batch (lib/yt-amazon-geniuslink): geni.us itself answers ten follows a
  // minute, which is what left most of Seb's videos "slow down".
  const allUrls: string[] = []
  for (const v of queue) for (const raw of String(v.description || '').match(/https?:\/\/[^\s)>\]"']+/gi) || []) allUrls.push(raw.replace(/[.,;:!)\]]+$/, ''))
  const genius = await geniuslinkAsins(db, ownerId, allUrls)
  let viaGenius = 0
  const resolve: LinkLookup = (u) => {
    const code = passportCodeFromUrl(u)
    if (code) return passport.get(code) ?? null
    const g = geniusCode(u)
    if (g && madeByMvp.has(g)) { viaGenius++; return { asin: madeByMvp.get(g)! } }
    const e = g ? genius.map.get(g) : undefined
    if (!e) return null
    viaGenius++
    return e.asin ? { asin: e.asin } : { asin: null, url: e.destination }
  }
  const worker = async () => {
    for (;;) {
      if (Date.now() - started > 70_000 || saveError) return
      const v = queue.shift()
      if (!v) return
      // THE VIDEO'S OWN PRODUCT, WHEN MVP ALREADY KNOWS IT: youtube_videos.asin
      // ("resolved product ASIN for this video", written at blog generation
      // and by the Creator Connections badge) or an Amazon product_url. Nothing
      // to follow for those.
      const saved = /^[A-Z0-9]{10}$/i.test(String(v.asin || '')) ? String(v.asin).toUpperCase() : asinFromAmazonUrl(String(v.product_url || ''))
      const own = saved && (savedCount.get(saved) || 0) <= often ? saved : null
      const r = own
        ? { asins: [{ asin: own, via: 'mvp-known' }], why: null as string | null, followed: 0 }
        : await productsOfVideo(v.title || '', v.description || '', known, resolve)
      if (own) alreadyKnown++
      followed += r.followed
      if (r.why === 'rate-limited') slowed++
      const now = new Date().toISOString()
      if (r.asins.length) {
        const { error: pe } = await db.from('youtube_video_products').upsert(r.asins.map((a) => ({ user_id: ownerId, youtube_video_id: v.youtube_video_id, asin: a.asin, via: a.via })), { onConflict: 'user_id,youtube_video_id,asin' })
        if (pe) { saveError = pe.message; return }
        found++
      }
      const { error: ve } = await db.from('youtube_videos').update({ products_read_at: now, products_why: r.why ? `${READER}:${r.why}` : null }).eq('user_id', ownerId).eq('youtube_video_id', v.youtube_video_id)
      if (ve) { saveError = ve.message; return }
      // The video's main product, where nothing set one before (the column the
      // Creator Connections badge and blog posts read).
      if (r.asins[0]) await db.from('youtube_videos').update({ asin: r.asins[0].asin }).eq('user_id', ownerId).eq('youtube_video_id', v.youtube_video_id).is('asin', null)
      read++
    }
  }
  // Three at a time: the link services answer a steady pace, not a burst.
  await Promise.all(Array.from({ length: 3 }, worker))
  if (saveError) return NextResponse.json({ error: missingSchema(saveError) ? MIGRATION : `MVP could not save what it read: ${saveError}`, read }, { status: missingSchema(saveError) ? 409 : 500 })
  const { count } = await db.from('youtube_videos').select('youtube_video_id', { count: 'exact', head: true }).eq('user_id', ownerId).is('products_read_at', null)
  return NextResponse.json({ ok: true, read, found, followed, slowed, left: count ?? 0, known: alreadyKnown, geniuslink: { state: genius.state, why: genius.why, read: viaGenius } })
}
