// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOOKS WINNING ON TRYBE (Huntr's "Winning Hooks"; Seb 2026-10-14: "do
// 1,2,3,4,5"). The opening lines of the videos in TRYBE's Top 100 this week,
// read from the Top 100 itself when it carries words, else from each video's
// script through SCOUT (the same read as a brand's best videos). Kept once
// for every member, from the MVP team's own read, and handed to Make videos
// as the style of opening that sells on TRYBE right now: never copied, never
// another brand's name. Pure, so it is tested (scripts/test-trybe-huntr).

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

export interface TopHook { submissionId: string | null; brandId: string | null; brandName: string | null; rank: number | null; hook: string }
export interface TopEntryWords { submissionId: string | null; brandId: string | null; brandName: string | null; rank: number | null; text: string | null }

/** The opening line of a video's words: the first sentence, at most 160
 *  letters, cut at a word. Null when there is nothing worth calling a hook. Pure. */
export function firstHook(text: string | null | undefined): string | null {
  const t = str(text).replace(/^\[[^\]]*\]\s*/, '').replace(/^(hook|scene \d+|intro)\s*[:\-]\s*/i, '')
  if (t.length < 12) return null
  const m = t.match(/^(.{12,160}?[.!?])(\s|$)/)
  let h = m ? m[1] : t.slice(0, 160)
  if (!m && t.length > 160) h = h.replace(/\s+\S*$/, '')
  h = h.trim()
  return h.length >= 12 ? h : null
}

/** TRYBE's Top 100 entries with their words, when the list carries them
 *  (hook, caption, title, script, transcript). Pure. */
export function readTopWords(json: unknown): TopEntryWords[] {
  const root = isObj(json) && isObj(json.data) ? json.data : json
  const list = Array.isArray(root) ? root
    : isObj(root) ? ([root.items, root.creatives, root.topCreatives, root.videos, root.submissions, root.data].find(Array.isArray) as unknown[] | undefined) || []
      : []
  const out: TopEntryWords[] = []
  for (const raw of list) {
    if (!isObj(raw)) continue
    const brand = isObj(raw.brand) ? raw.brand : isObj(raw.brandProfile) ? raw.brandProfile : null
    const sub = isObj(raw.submission) ? raw.submission : null
    const meta = isObj(raw.metadata) ? raw.metadata : isObj(sub?.metadata) ? sub!.metadata as Obj : null
    const rank = Number(raw.rank ?? raw.position)
    const text = [raw.hook, raw.script, raw.transcript, sub?.script, meta?.hook, raw.caption, meta?.caption, raw.title, meta?.title].map(str).find((t) => t.length >= 12) || null
    out.push({
      submissionId: str(raw.submissionId ?? raw.submission_id ?? sub?.id ?? raw.id) || null,
      brandId: str(raw.brandId ?? raw.brand_id ?? brand?.id) || null,
      brandName: str(raw.brandName ?? raw.brand_name ?? brand?.name) || null,
      rank: Number.isFinite(rank) && rank > 0 ? rank : null,
      text,
    })
  }
  return out
}

/** Hooks from the page (each video's script read through SCOUT), read
 *  safely: at most 40, each cut to its first line. Pure. */
export function readHooksBody(v: unknown): TopHook[] {
  if (!Array.isArray(v)) return []
  const out: TopHook[] = []
  for (const x of v.slice(0, 40)) {
    if (!isObj(x)) continue
    const hook = firstHook(str(x.text ?? x.hook).slice(0, 2000))
    if (!hook) continue
    const rank = Number(x.rank)
    out.push({ submissionId: str(x.submissionId).slice(0, 80) || null, brandId: str(x.brandId).slice(0, 80) || null, brandName: str(x.brandName).slice(0, 120) || null, rank: Number.isFinite(rank) && rank > 0 ? rank : null, hook })
  }
  return out
}

/** The hooks to keep: best rank first, one per video, no near repeats. Pure. */
export function keepHooks(list: TopHook[], max = 30): TopHook[] {
  const seen = new Set<string>()
  const out: TopHook[] = []
  for (const h of [...list].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))) {
    const key = h.hook.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 6).join(' ')
    if (seen.has(key) || (h.submissionId && seen.has(h.submissionId))) continue
    seen.add(key); if (h.submissionId) seen.add(h.submissionId)
    out.push(h)
    if (out.length >= max) break
  }
  return out
}

/** The block for Make videos: the style of opening that sells on TRYBE now.
 *  Another brand's name never goes in; nor do its exact words. Pure. */
export function hooksBlock(hooks: TopHook[], forBrand: string, max = 10): string {
  const own = forBrand.trim().toLowerCase()
  const lines = hooks.slice(0, max).map((h) => {
    let t = h.hook
    if (h.brandName && h.brandName.trim().toLowerCase() !== own) t = t.replace(new RegExp(h.brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'the brand')
    return `- ${t}`
  })
  if (!lines.length) return ''
  return [
    'HOOKS WINNING ON TRYBE THIS WEEK (the opening lines of videos in TRYBE’s Top 100, for other brands). Learn the style of opening that stops people right now: the question, the claim, the problem shown first. Never copy their words and never name another brand.',
    ...lines,
  ].join('\n')
}
