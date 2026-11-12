// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE BATCH OF A CREATOR'S YOUTUBE VIDEOS READ FOR THEIR PRODUCTS (YouTube vs
// Amazon). Shared by the page's Find the products (app/api/labs/yt-amazon,
// sixty at a time, three readers) and the background reader
// (app/api/cron/yt-amazon-links, ten a minute, one reader), so a run the page
// hands over is finished the same way. Each video: the product MVP already
// knows, else the link at the top of its description (lib/yt-amazon-links),
// read from MVP's own tables and the creator's Geniuslink account where it can
// be, followed where it cannot. Server only.

import { productsOfVideo, type LinkLookup } from '@/lib/yt-amazon-links'
import { asinFromAmazonUrl } from '@/lib/asin'
import { passportCodeFromUrl } from '@/lib/passport-links'
import { geniuslinkAsins, geniusCode } from '@/lib/yt-amazon-geniuslink'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// The reader that wrote a reason, saved in front of it ("r3:no-link"). A video
// an earlier reader could not place is read again once by the newer one,
// whenever that happens to be, with no clock to guess (2026-11-11: the third
// reader reads "Product ASIN: B0..." lines and says where a link failed; the
// fourth looks Passport codes up in MVP's own table instead of following them;
// the fifth reads geni.us links from the creator's Geniuslink account; the
// sixth starts from what MVP already knows: the video's own product
// (youtube_videos.asin, product_url) and the geni.us links MVP made).
export const READER = 'r6'

/** Every row, a thousand at a time. */
export async function every<T>(make: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>, max = 20000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

export interface BatchResult {
  read: number
  found: number
  followed: number
  slowed: number
  known: number
  left: number
  geniuslink: { state: string; why: string | null; read: number }
  /** A read or a save that failed, in the database's words. */
  saveError: string | null
}

const EMPTY: BatchResult = { read: 0, found: 0, followed: 0, slowed: 0, known: 0, left: 0, geniuslink: { state: 'read', why: null, read: 0 }, saveError: null }

/** The next `limit` videos not read yet, newest first, read by `workers`
 *  readers inside `budgetMs`, each saved as it is read so a stop loses nothing. */
export async function readLinkBatch(db: Db, ownerId: string, opts: { limit: number; workers: number; budgetMs: number }): Promise<BatchResult> {
  // The next videos not read yet, newest first, read six at a time inside a
  // time budget, each saved as it is read so a stop loses nothing.
  const { data: todo, error } = await db.from('youtube_videos').select('youtube_video_id, title, description, asin, product_url').eq('user_id', ownerId).is('products_read_at', null).order('published_at', { ascending: false }).limit(opts.limit)
  if (error) return { ...EMPTY, saveError: error.message }
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
      if (Date.now() - started > opts.budgetMs || saveError) return
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
  await Promise.all(Array.from({ length: opts.workers }, worker))
  const { count } = await db.from('youtube_videos').select('youtube_video_id', { count: 'exact', head: true }).eq('user_id', ownerId).is('products_read_at', null)
  return { read, found, followed, slowed, known: alreadyKnown, left: count ?? 0, geniuslink: { state: genius.state, why: genius.why, read: viaGenius }, saveError }
}
