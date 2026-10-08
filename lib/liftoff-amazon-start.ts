// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LIFTOFF PART 2: START AMAZON. One function for both ways it starts: the
// Start Amazon button (app/api/launch/batches/[id]/amazon) and, since Seb
// asked to "bulk upload, select everything, and literally walk away"
// (2026-10-08), the uploader starting it by itself once YouTube is done
// (app/api/cron/launch-drain). The US store only (LIFTOFF_AMAZON_MARKET):
// Global Storefront shows US videos in the other countries.
//
// NO SECOND PIPELINE. This does exactly what the hand-over does when a batch
// launches with countries: a row per video per country in the coverage grid,
// each with that country's own ASIN when one is known. From there the grid
// checks the product and SCOUT uploads, with the batch page open or from the
// background tab.
//
// THE CLEAN ORIGINAL, NEVER THE CTA COPY. Part 1 recorded it on the video at
// the hand-over. If it has since been cleared from the video record, it is put
// back from the batch row or the kept original (video_masters); if neither
// file still answers, that video is NAMED in the answer rather than queued to
// fail later at the upload.

import { marketByDomain } from '@/lib/markets'
import { cachedLocalAsins } from '@/lib/regional-listing'
import { coveragePriority } from '@/lib/storefront-coverage'
import { LIFTOFF_AMAZON_MARKET, youtubePartDone } from '@/lib/launch-batch'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** Does this file still answer. A failed check is "unknown", not "gone". */
async function fileAnswers(url: string): Promise<boolean | null> {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    if (r.ok) return true
    if (r.status === 404 || r.status === 400) return false
    return null
  } catch { return null }
}

export type AmazonStart =
  | { ok: true; markets: string[]; started: string[]; rowsMade: number; noOriginal: string[]; notYet: string[] }
  | { ok: false; status: number; error: string; started?: string[] }

/**
 * Start Amazon for one launched batch. `sb` reads and writes as the creator
 * (or the service key, for the uploader); `cache` reads the shared per-country
 * ASIN cache. Every query is held to `userId`.
 */
export async function startAmazonPart(sb: Sb, cache: Sb, userId: string, batchId: string): Promise<AmazonStart> {
  const markets = [LIFTOFF_AMAZON_MARKET].filter((d) => !!marketByDomain(d))
  const { data: batch } = await sb.from('launch_batches').select('id,state,markets').eq('id', batchId).eq('user_id', userId).maybeSingle()
  if (!batch) return { ok: false, status: 404, error: 'Batch not found.' }
  if (batch.state !== 'launched' && batch.state !== 'launching') {
    return { ok: false, status: 409, error: 'Launch this batch to YouTube first. Amazon starts once YouTube is done.' }
  }

  const { data: rows, error: rowsErr } = await sb.from('launch_items')
    .select('id,title,asin,clean_url,video_id,youtube_video_id,publish_at,planned_publish_at').eq('batch_id', batchId).eq('user_id', userId)
  if (rowsErr) return { ok: false, status: 500, error: `Could not read this batch's videos: ${rowsErr.message}` }
  const items = (rows ?? []) as Array<{ id: string; title: string | null; asin: string | null; clean_url: string | null; video_id: string | null; youtube_video_id: string | null; publish_at: string | null; planned_publish_at: string | null }>

  // The countries go on the batch first: a video that reaches YouTube after
  // this (a latecomer) is handed over with them, and the batch page and the
  // background tab read them to know what to send.
  const { error: mErr } = await sb.from('launch_batches').update({ markets, updated_at: new Date().toISOString() }).eq('id', batchId).eq('user_id', userId)
  if (mErr) return { ok: false, status: 500, error: `The countries could not be saved: ${mErr.message}` }

  const started: string[] = []
  const noOriginal: string[] = []
  const notYet: string[] = []
  let rowsMade = 0
  for (const it of items) {
    const name = (it.title || '').trim() || 'A video'
    if (!it.video_id) {
      // On YouTube but not recorded yet: the uploader's repair pass records
      // it within a minute, now with these countries. Not on YouTube: nothing
      // for Amazon yet.
      if (it.youtube_video_id) notYet.push(name)
      continue
    }
    const { data: v } = await sb.from('youtube_videos').select('id,source_video_url,youtube_video_id,published_at').eq('id', it.video_id).eq('user_id', userId).maybeSingle()
    if (!v) { notYet.push(name); continue }

    // ── THE ORIGINAL FILE ────────────────────────────────────────────────
    let file: string | null = v.source_video_url || null
    if (!file || (await fileAnswers(file)) === false) {
      const { data: master } = await sb.from('video_masters').select('file_url').eq('user_id', userId).eq('youtube_video_id', v.youtube_video_id).maybeSingle()
      const candidates = [it.clean_url, master?.file_url].filter((u): u is string => !!u && u !== file)
      file = null
      for (const c of candidates) {
        if ((await fileAnswers(c)) !== false) { file = c; break }
      }
      if (file) await sb.from('youtube_videos').update({ source_video_url: file }).eq('id', v.id)
    }
    if (!file) { noOriginal.push(name); continue }

    // ── A ROW PER COUNTRY ────────────────────────────────────────────────
    const local = it.asin ? await cachedLocalAsins(cache, String(it.asin), markets) : new Map<string, string>()
    const priority = coveragePriority({ publishedAt: v.published_at || it.publish_at || it.planned_publish_at })
    const { data: made, error: gridErr } = await sb.from('storefront_coverage').upsert(
      markets.map((domain) => ({ user_id: userId, video_id: v.id, domain, state: 'unknown', asin: local.get(domain) ?? it.asin ?? null, priority })),
      { onConflict: 'user_id,video_id,domain', ignoreDuplicates: true },
    ).select('domain')
    if (gridErr) return { ok: false, status: 500, error: `Amazon could not be started for ${name}: ${gridErr.message}`, started }
    rowsMade += (made ?? []).length
    started.push(name)
  }
  return { ok: true, markets, started, rowsMade, noOriginal, notYet }
}

/**
 * Is part 1 far enough along for part 2 to start by itself: YouTube is done,
 * or every video still out is only waiting for paid promotion to be confirmed
 * (those follow on to Amazon by themselves when they are scheduled). The same
 * rule that opens the Start Amazon button. Pure.
 */
export function amazonCanStart(batchState: string, items: Array<{ state: string; youtube_video_id?: string | null; reason?: string | null }>): boolean {
  const yt = youtubePartDone(batchState, items)
  return yt.done || (yt.onYouTube > 0 && yt.held > 0 && yt.waiting === yt.held)
}
