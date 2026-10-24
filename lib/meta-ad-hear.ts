// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MVP LISTENS TO THE META ADS' VIDEOS, for what each one says first (Seb,
// 2026-10-24: the hook is what is said, not the caption). One implementation
// for the job that runs every 20 minutes (app/api/cron/meta-ad-hear) and the
// team's Listen now press (the meta_hear action in app/api/labs/trybe).
// Longest running first, never more than META_LISTEN_DAILY a day, each listen
// counted in ai_usage. A link Meta no longer serves is said as that, never as
// a video with no words.
//
// Server only.

import { transcribeToCues } from '@/lib/shorts-transcribe'
import { assertPublicHttpUrl } from '@/lib/ssrf-guard'
import { cleanScript } from '@/lib/trybe-scripts'
import { GALLERY_KEY, HOOKS_KEY, META_LISTEN_DAILY, toHear, mergeHooks, type Gallery, type AdHooks } from '@/lib/trybe-adsgallery'

export const META_LISTEN_FEATURE = 'meta_ad_listen'
const LISTEN_MODEL = 'fal-ai/whisper'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Listens in the last 24 hours. Fails closed: no answer reads as the cap. */
export async function metaListensToday(sb: Db): Promise<number> {
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { count, error } = await sb.from('ai_usage').select('id', { count: 'exact', head: true }).eq('feature', META_LISTEN_FEATURE).gte('created_at', since)
    return error ? Number.POSITIVE_INFINITY : count ?? 0
  } catch { return Number.POSITIVE_INFINITY }
}

async function countListen(sb: Db): Promise<void> {
  try {
    await sb.from('ai_usage').insert({ user_id: null, tier: 'team', feature: META_LISTEN_FEATURE, model: LISTEN_MODEL, input_tokens: 0, output_tokens: 0, web_searches: 0, images: 0 })
  } catch { /* a brake, never a reason to fail */ }
}

/** Meta still serves the file: the first byte answers. */
async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(10_000) })
    return r.status === 200 || r.status === 206
  } catch { return false }
}

export interface HearRun { heard: number; none: number; failed: number; tried: number; left: number; why?: string }

/** Listen to up to `max` video ads, within `budgetMs`. */
export async function hearMetaAds(sb: Db, max: number, budgetMs: number): Promise<HearRun> {
  const started = Date.now()
  const today = await metaListensToday(sb)
  const room = Math.min(max, META_LISTEN_DAILY - today)
  const [{ data: gRow }, { data: hRow }] = await Promise.all([
    sb.from('trybe_directory_meta').select('value').eq('key', GALLERY_KEY).maybeSingle(),
    sb.from('trybe_directory_meta').select('value').eq('key', HOOKS_KEY).maybeSingle(),
  ])
  const g = (gRow?.value || null) as Gallery | null
  const hooks = (hRow?.value || {}) as AdHooks
  const waiting = toHear(g?.ads || [], hooks, Date.now(), 10_000)
  if (room <= 0) return { heard: 0, none: 0, failed: 0, tried: 0, left: waiting.length, why: Number.isFinite(today) ? `The day's ${META_LISTEN_DAILY} listens are done.` : 'MVP could not read today’s count, so it listened to none.' }

  const add: AdHooks = {}
  let heard = 0, none = 0, failed = 0
  for (const a of waiting.slice(0, room)) {
    if (Date.now() - started > budgetMs) break
    const at = new Date().toISOString()
    const tries = (hooks[a.id]?.tries ?? 0) + 1
    try {
      assertPublicHttpUrl(String(a.videoUrl))
      if (!(await reachable(String(a.videoUrl)))) { add[a.id] = { hook: null, script: null, state: 'failed', why: 'Meta no longer serves this video’s file', at, tries: 2 }; failed++; continue }
      await countListen(sb)
      const cues = await transcribeToCues(String(a.videoUrl))
      const cleaned = cleanScript(cues.map((c) => c.text).join(' '))
      if (cleaned.ok) { add[a.id] = { hook: cleaned.hook, script: cleaned.script.slice(0, 600), state: 'ready', at, tries }; heard++ }
      else { add[a.id] = { hook: null, script: null, state: 'none', why: `MVP heard ${cleaned.why}`, at, tries }; none++ }
    } catch (e) {
      add[a.id] = { hook: null, script: null, state: 'failed', why: e instanceof Error ? e.message.slice(0, 200) : 'the listen did not finish', at, tries }; failed++
    }
  }
  if (Object.keys(add).length) {
    // Read again just before writing, so two runs close together both count.
    const { data: again } = await sb.from('trybe_directory_meta').select('value').eq('key', HOOKS_KEY).maybeSingle()
    const merged = mergeHooks((again?.value || {}) as AdHooks, add, new Set((g?.ads || []).map((x) => x.id)))
    await sb.from('trybe_directory_meta').upsert({ key: HOOKS_KEY, value: merged, updated_at: new Date().toISOString() })
  }
  const tried = heard + none + failed
  return { heard, none, failed, tried, left: Math.max(0, waiting.length - tried) }
}
