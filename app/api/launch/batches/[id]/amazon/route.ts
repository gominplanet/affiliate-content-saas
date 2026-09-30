// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launch/batches/[id]/amazon { markets } — Liftoff part 2: Start
// Amazon for a batch whose videos are on YouTube.
//
// NO SECOND PIPELINE. This does exactly what the hand-over does when a batch
// launches with countries: a row per video per country in the coverage grid,
// each with that country's own ASIN when one is known. From there the grid
// checks the product, translates, dubs, and SCOUT uploads, as it always has,
// with the batch page open or from the background tab.
//
// THE CLEAN ORIGINAL, NEVER THE CTA COPY. Part 1 recorded it on the video at
// the hand-over. If it has since been cleared from the video record, it is put
// back from the batch row or the kept original (video_masters); if neither
// file still answers, that video is NAMED in the answer rather than queued to
// fail later at the upload.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { marketByDomain } from '@/lib/markets'
import { cachedLocalAsins } from '@/lib/regional-listing'
import { coveragePriority } from '@/lib/storefront-coverage'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Does this file still answer. A failed check is "unknown", not "gone". */
async function fileAnswers(url: string): Promise<boolean | null> {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    if (r.ok) return true
    if (r.status === 404 || r.status === 400) return false
    return null
  } catch { return null }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!['pro', 'admin'].includes(normalizeTier(integ?.tier))) {
    return NextResponse.json({ error: 'Liftoff is a Pro feature.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { markets?: unknown }
  const markets = [...new Set((Array.isArray(body.markets) ? body.markets : []).map(String).filter((d) => !!marketByDomain(d)))]
  if (markets.length === 0) return NextResponse.json({ error: 'Pick at least one Amazon country.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: batch } = await sb.from('launch_batches').select('id,state,markets').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  if (batch.state !== 'launched' && batch.state !== 'launching') {
    return NextResponse.json({ error: 'Launch this batch to YouTube first. Amazon starts once YouTube is done.' }, { status: 409 })
  }

  const { data: rows, error: rowsErr } = await sb.from('launch_items')
    .select('id,title,asin,clean_url,video_id,youtube_video_id,publish_at,planned_publish_at').eq('batch_id', id).eq('user_id', user.id)
  if (rowsErr) return NextResponse.json({ error: `Could not read this batch's videos: ${rowsErr.message}` }, { status: 500 })
  const items = (rows ?? []) as Array<{ id: string; title: string | null; asin: string | null; clean_url: string | null; video_id: string | null; youtube_video_id: string | null; publish_at: string | null; planned_publish_at: string | null }>

  // The countries go on the batch first: a video that reaches YouTube after
  // this (a latecomer) is handed over with them, and the batch page and the
  // background tab read them to know what to send.
  const allMarkets = [...new Set([...(batch.markets ?? []), ...markets])]
  const { error: mErr } = await sb.from('launch_batches').update({ markets: allMarkets, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id)
  if (mErr) return NextResponse.json({ error: `The countries could not be saved: ${mErr.message}` }, { status: 500 })

  // The per-country ASIN cache is shared across creators and read with the
  // service key, as the availability check reads it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cache: any = sb
  try { cache = createAdminClient() } catch { /* the plain ASIN is used, and the grid finds local ones */ }

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
    const { data: v } = await sb.from('youtube_videos').select('id,source_video_url,youtube_video_id,published_at').eq('id', it.video_id).eq('user_id', user.id).maybeSingle()
    if (!v) { notYet.push(name); continue }

    // ── THE ORIGINAL FILE ────────────────────────────────────────────────
    let file: string | null = v.source_video_url || null
    if (!file || (await fileAnswers(file)) === false) {
      const { data: master } = await sb.from('video_masters').select('file_url').eq('user_id', user.id).eq('youtube_video_id', v.youtube_video_id).maybeSingle()
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
      markets.map((domain) => ({ user_id: user.id, video_id: v.id, domain, state: 'unknown', asin: local.get(domain) ?? it.asin ?? null, priority })),
      { onConflict: 'user_id,video_id,domain', ignoreDuplicates: true },
    ).select('domain')
    if (gridErr) return NextResponse.json({ error: `Amazon could not be started for ${name}: ${gridErr.message}`, started }, { status: 500 })
    rowsMade += (made ?? []).length
    started.push(name)
  }

  return NextResponse.json({ ok: true, markets: allMarkets, started, rowsMade, noOriginal, notYet })
}
