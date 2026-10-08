// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/liftoff-cleanup — hourly. Removes Liftoff video files nothing
// needs any more, by the rules in lib/liftoff-cleanup (Seb, 2026-10-08), and
// clears every pointer to each file it removes, so nothing later tries to
// fetch a file that is gone. Says what it removed and what it skipped.
//
// A file is removed only from this project's storage, and only from the
// folder of the creator whose row points at it: the URL columns are written
// by the creator's own page, and this runs with the service key.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { storagePathFromPublicUrl } from '@/lib/storage-url'
import { cleanupFor, COVERAGE_FINISHED, DAY_MS, IDLE_DAYS } from '@/lib/liftoff-cleanup'

export const runtime = 'nodejs'
export const maxDuration = 120

const BUCKET = 'instagram-videos'
const PAGE = 500
const MAX_ROWS = 3000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any
type Item = {
  id: string; user_id: string; batch_id: string; state: string; youtube_video_id: string | null; video_id: string | null
  source_url: string | null; rendered_url: string | null; clean_url: string | null; updated_at: string | null
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient() as Sb
  const started = Date.now()
  const now = Date.now()
  const cutoff = new Date(now - IDLE_DAYS * DAY_MS).toISOString()

  // Only rows quiet for two days and still pointing at a file: every rule
  // needs at least that, so nothing newer is read.
  const items: Item[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await sb.from('launch_items')
      .select('id,user_id,batch_id,state,youtube_video_id,video_id,source_url,rendered_url,clean_url,updated_at')
      .or('source_url.not.is.null,rendered_url.not.is.null,clean_url.not.is.null')
      .lt('updated_at', cutoff)
      .order('updated_at', { ascending: true }).order('id')
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    items.push(...((data ?? []) as Item[]))
    if (!data || data.length < PAGE) break
  }
  if (!items.length) return NextResponse.json({ ok: true, checked: 0 })

  // The batches, for launched or not, their stores and their last change.
  const batchIds = [...new Set(items.map((i) => i.batch_id))]
  const batches = new Map<string, { state: string; markets: string[]; updated_at: string | null }>()
  for (let i = 0; i < batchIds.length; i += 200) {
    const { data, error } = await sb.from('launch_batches').select('id,state,markets,updated_at').in('id', batchIds.slice(i, i + 200))
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    for (const b of (data ?? []) as Array<{ id: string; state: string; markets: string[] | null; updated_at: string | null }>) {
      batches.set(b.id, { state: b.state, markets: b.markets ?? [], updated_at: b.updated_at })
    }
  }
  // Each video's Amazon countries, as the coverage grid has them.
  const videoIds = [...new Set(items.map((i) => i.video_id).filter((v): v is string => !!v))]
  const cover = new Map<string, Array<{ domain: string; state: string; updated_at: string | null }>>()
  for (let i = 0; i < videoIds.length; i += 200) {
    const { data, error } = await sb.from('storefront_coverage').select('video_id,domain,state,updated_at').in('video_id', videoIds.slice(i, i + 200))
    // Unread is not "done": without the grid, no original is removed this run.
    if (error) return NextResponse.json({ ok: false, error: `coverage: ${error.message}` }, { status: 500 })
    for (const c of (data ?? []) as Array<{ video_id: string; domain: string; state: string; updated_at: string | null }>) {
      cover.set(c.video_id, [...(cover.get(c.video_id) ?? []), c])
    }
  }

  const ms = (iso: string | null | undefined) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? t : 0 }
  let ctaRemoved = 0, originalsRemoved = 0, notOurs = 0, failed = 0, checked = 0
  const errors: string[] = []
  for (const it of items) {
    if (Date.now() - started > (maxDuration - 20) * 1000) break
    checked++
    const b = batches.get(it.batch_id)
    if (!b) continue
    const launched = b.state === 'launched' || b.state === 'launching'
    const rows = it.video_id ? cover.get(it.video_id) ?? [] : []
    const markets = b.markets
    const amazonDone = markets.length === 0
      || (rows.length > 0 && markets.every((d) => rows.some((r) => r.domain === d && COVERAGE_FINISHED.has(r.state))))
    const lastAt = Math.max(ms(it.updated_at), ...rows.map((r) => ms(r.updated_at)), launched ? 0 : ms(b.updated_at))
    const original = it.clean_url || it.source_url
    const act = cleanupFor({
      state: it.state, youtube_video_id: it.youtube_video_id, lastAt, batchLaunched: launched, amazonDone,
      hasCta: !!it.rendered_url && it.rendered_url !== original, hasOriginal: !!original,
    }, now)
    if (!act.cta && !act.original) continue

    // ONLY OUR FILES, IN THIS CREATOR'S FOLDER. A pointer we cannot remove
    // the file behind is left as it is, and counted.
    const removeFile = async (url: string): Promise<'removed' | 'not-ours' | 'failed'> => {
      const path = storagePathFromPublicUrl(url, BUCKET)
      if (!path || path.split('/')[0] !== it.user_id) return 'not-ours'
      const { error } = await sb.storage.from(BUCKET).remove([path])
      if (error) { errors.push(`${it.id}: ${error.message}`); return 'failed' }
      return 'removed'
    }
    const patch: Record<string, unknown> = {}
    if (act.cta && it.rendered_url) {
      const r = await removeFile(it.rendered_url)
      if (r === 'removed') { patch.rendered_url = null; ctaRemoved++ } else if (r === 'not-ours') notOurs++; else failed++
    }
    if (act.original && original) {
      const urls = [...new Set([it.source_url, it.clean_url].filter((u): u is string => !!u))]
      let all = true
      for (const u of urls) {
        const r = await removeFile(u)
        if (r === 'not-ours') notOurs++
        if (r === 'failed') failed++
        if (r !== 'removed') all = false
      }
      if (all) {
        patch.source_url = null
        patch.clean_url = null
        originalsRemoved++
        // EVERY POINTER TO IT, so Clip Factory, Global Sync and Start Amazon
        // say "no original" rather than fetch a file that is gone.
        for (const u of urls) {
          await sb.from('video_masters').delete().eq('user_id', it.user_id).eq('file_url', u)
          await sb.from('youtube_videos').update({ source_video_url: null }).eq('user_id', it.user_id).eq('source_video_url', u)
        }
      }
    }
    if (!Object.keys(patch).length) continue
    // Before YouTube, the row says why it can no longer go.
    if (act.reason) { patch.state = 'blocked'; patch.reason = act.reason }
    const { error: upErr } = await sb.from('launch_items').update(patch).eq('id', it.id)
    if (upErr) errors.push(`${it.id}: ${upErr.message}`)
  }
  return NextResponse.json({ ok: true, checked, ctaRemoved, originalsRemoved, notOurs, failed, errors: errors.slice(0, 20) })
}
