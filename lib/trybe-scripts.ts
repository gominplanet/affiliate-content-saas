// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW THEY WIN (migration 442): every Top 100 video MVP has seen for a brand,
// with what was actually said in it, and the rewrite that turns one of them
// into a script in the creator's own voice.
//
// Everything here is pure, so the rules are tested without SCOUT, without the
// database and without an AI call (scripts/test-trybe-scripts.ts).
//
// TWO SOURCES, AND WE SAY WHICH. TRYBE's own script endpoint is free and
// thin: one admin read of the top 25 kept 4 usable openings. Whisper on the
// video works on anything with a file and costs money. A card says which one
// answered, because "TRYBE shared these words" and "MVP listened to the
// video" are different claims and only one of them is TRYBE's.
//
// A VIDEO WITH NO WORDS IS SHOWN SAYING SO. The failure this codebase keeps
// shipping is a screen whose silence looks like a pass. A video we could not
// read is a card that says we could not read it, never a card left out.

import { likeness } from '@/lib/trybe-voice'

export type ScriptSource = 'trybe' | 'transcribed' | 'none'
export type ScriptState = 'ready' | 'waiting' | 'none'

export interface TopScript {
  submission_id: string
  brand_id: string | null
  brand_name: string | null
  creator: string | null
  best_rank: number | null
  category: string | null
  video_url: string | null
  thumbnail: string | null
  seconds: number | null
  script: string | null
  hook: string | null
  source: ScriptSource
  state: ScriptState
  detail: string | null
}

/** The longest script worth keeping. A 45 second video is maybe 130 words;
 *  anything far past that is a transcript of something else. */
export const SCRIPT_MAX = 4000
/** Under this there is nothing to learn from and nothing to rewrite. */
export const SCRIPT_MIN = 40

/** The opening line of a script: the hook, which is the whole reason the
 *  video was watched. First sentence, else the first dozen words. Pure. */
export function openingOf(script: string | null | undefined): string | null {
  const t = String(script || '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const stop = t.search(/[.!?](\s|$)/)
  const first = stop > 0 ? t.slice(0, stop + 1) : t
  if (first.length >= 12 && first.length <= 180) return first
  const words = t.split(' ').slice(0, 14).join(' ')
  return words.length >= 12 ? `${words}${t.split(' ').length > 14 ? '...' : ''}` : null
}

/** A script we are willing to store, or null with the reason. */
export function cleanScript(raw: unknown): { ok: true; script: string; hook: string | null } | { ok: false; why: string } {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return { ok: false, why: 'no words in it' }
  if (t.length < SCRIPT_MIN) return { ok: false, why: `only ${t.length} characters of words` }
  const script = t.slice(0, SCRIPT_MAX)
  return { ok: true, script, hook: openingOf(script) }
}

// ── What to collect next ─────────────────────────────────────────────────────

/**
 * The videos worth spending a transcription on, in order.
 *
 * A TRANSCRIPTION IS MONEY, so the order matters and the cap is real. Highest
 * placed first, because a video that reached number 3 teaches more than one
 * that scraped in at 98. Anything already read is skipped for ever: a video
 * is transcribed once in the life of the product, not once per member and not
 * once per day.
 *
 * `have` is every submission id already in the store, whatever its state. A
 * video we tried and failed to read is not tried again by this: retrying it
 * is a deliberate act, not a side effect of opening a page.
 */
export function toTranscribe<T extends { submissionId: string | null; rank: number | null; video: string | null }>(
  entries: T[], have: Set<string>, max: number,
): T[] {
  return entries
    .filter((e) => !!e.submissionId && !have.has(e.submissionId) && !!e.video && /^https:\/\//i.test(e.video))
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, Math.max(0, max))
}

/** Why the filed videos without words have none, counted from their rows
 *  (Seb, 2026-10-19: a board at 85 of 134 said nothing about the other 49).
 *  'none' rows were heard with almost nothing said, or had no file; 'waiting'
 *  rows are still to be listened to, or a listen fell over. Pure. */
export interface NoWords { noSpeech: number; noFile: number; toListen: number; couldNot: number }
export function whyNoWords(rows: Array<{ state: string; detail?: string | null; video_url?: string | null }>): NoWords {
  const n: NoWords = { noSpeech: 0, noFile: 0, toListen: 0, couldNot: 0 }
  for (const r of rows) {
    if (r.state === 'ready') continue
    const detail = String(r.detail || '')
    const file = /^https:\/\//i.test(String(r.video_url || ''))
    if (r.state === 'none') { if (/no video file/i.test(detail) || !file) n.noFile++; else n.noSpeech++ }
    else if (!file) n.noFile++
    else if (/^MVP could not listen to it/i.test(detail)) n.couldNot++
    else n.toListen++
  }
  return n
}

/** The same count in words, '' when every video has its words. Pure. */
export function noWordsSentence(n: NoWords): string {
  const total = n.noSpeech + n.noFile + n.toListen + n.couldNot
  if (!total) return ''
  const parts = [
    n.noSpeech ? `${n.noSpeech} ${n.noSpeech === 1 ? 'was' : 'were'} listened to and hardly anything is said in ${n.noSpeech === 1 ? 'it' : 'them'} (music, or words on screen only)` : '',
    n.noFile ? `${n.noFile} came without a video file from TRYBE, so nothing can listen to ${n.noFile === 1 ? 'it' : 'them'}` : '',
    n.toListen ? `${n.toListen} ${n.toListen === 1 ? 'is' : 'are'} still to be listened to, up to 25 a day` : '',
    n.couldNot ? `${n.couldNot} could not be listened to, and Collect tries again while ${n.couldNot === 1 ? 'it is' : 'they are'} still in the Top 100` : '',
  ].filter(Boolean)
  return `${total} ${total === 1 ? 'has' : 'have'} no words: ${parts.join('; ')}.`
}

/**
 * The best place a video has reached while we have been watching.
 *
 * A LOWER NUMBER IS BETTER AND A WORSE DAY NEVER OVERWRITES A BETTER ONE. A
 * video that hit number 3 on Monday and 71 today is a number 3 video; filing
 * today's read over Monday's would quietly demote it and reorder the board a
 * creator is learning from. Nothing known on either side stays null rather
 * than becoming 0, which would sort to the top. Pure.
 */
export function bestRank(...ranks: Array<number | null | undefined>): number | null {
  const real = ranks.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
  return real.length ? Math.min(...real) : null
}

/** What the screen says about its own coverage, so a thin board never reads
 *  as a complete one. Pure. */
export function coverageWords(rows: Array<{ state: ScriptState; source: ScriptSource }>): string {
  const total = rows.length
  if (!total) return 'No Top 100 videos saved for this brand yet.'
  const ready = rows.filter((r) => r.state === 'ready').length
  const fromTrybe = rows.filter((r) => r.state === 'ready' && r.source === 'trybe').length
  const heard = rows.filter((r) => r.state === 'ready' && r.source === 'transcribed').length
  if (!ready) return `${total} ${total === 1 ? 'video' : 'videos'}, none with words yet.`
  const parts: string[] = []
  if (fromTrybe) parts.push(`${fromTrybe} shared by TRYBE`)
  if (heard) parts.push(`${heard} MVP listened to`)
  return `Words for ${ready} of ${total} ${total === 1 ? 'video' : 'videos'}${parts.length ? ` (${parts.join(', ')})` : ''}.`
}

// ── The rewrite ──────────────────────────────────────────────────────────────

/** How close to the reference the new script should be. The creator's dial. */
export type Closeness = 'loose' | 'similar' | 'close'

export const CLOSENESS: Record<Closeness, { label: string; says: string }> = {
  loose: { label: 'Just the idea', says: 'Keep only what the video is doing. Your own order, your own beats.' },
  similar: { label: 'Same shape', says: 'Same order and the same kind of hook, said your way.' },
  close: { label: 'Close to it', says: 'Follow it beat for beat, in your words and about your product.' },
}

export function readCloseness(raw: unknown): Closeness {
  return raw === 'loose' || raw === 'close' ? raw : 'similar'
}

export interface RewriteInput {
  /** The winning video's words. */
  reference: string
  /** Who the creator is, in their words: who they are talking to and why
   *  anyone should believe them. */
  avatar: string
  /** Anything the creator wants worked in: an angle, a moment with it, what
   *  the brand asked for. Optional. A TRYBE video is an ad the brand runs, not
   *  a review (Seb, 2026-10-18), so a script does not wait on a story. */
  experience: string
  closeness: Closeness
  /** The product this video is for. */
  product: string
  brand: string
  /** The brand's brief, when there is one. */
  brief?: string
  /** How the creator writes, from their own TRYBE messages (lib/trybe-voice). */
  voice?: string[]
}

/** What is still missing before a rewrite is worth asking for, in the
 *  creator's own words. Empty means go. */
export function rewriteMissing(i: Partial<RewriteInput>): string[] {
  const out: string[] = []
  if (!String(i.reference || '').trim()) out.push('the video to work from')
  if (!String(i.product || '').trim()) out.push('which product it is for')
  return out
}

/**
 * The prompt. Written here rather than in the route so it can be read, argued
 * with and tested.
 *
 * COPY THE ANGLE, NEVER THE SENTENCES. A creator who posts another creator's
 * words to the same brand, on the same platform, in the same month, is not
 * being clever. Brands see both. The reference is there to show what shape of
 * video that brand approves, and the prompt is told so in as many words.
 */
export function rewritePrompt(i: RewriteInput): string {
  const close = CLOSENESS[i.closeness]
  return [
    `You write short video ad scripts for a creator making a video for ${i.brand}, about ${i.product}.`,
    'THIS IS AN AD, NOT A REVIEW. The brand runs it as a paid ad, so write it to stop the scroll and sell the product, spoken by the creator on camera.',
    '',
    'A VIDEO THAT ALREADY WINS FOR THIS BRAND, as a reference for its shape only:',
    `"""${i.reference.slice(0, SCRIPT_MAX)}"""`,
    '',
    `HOW CLOSE TO IT: ${close.label}. ${close.says}`,
    '',
    'NEVER reuse its sentences, its phrases or its exact numbers. The brand sees both videos. Copy what it does, not what it says.',
    '',
    `WHO THE CREATOR IS: ${i.avatar.slice(0, 600) || 'not said, so keep it plain and first person'}`,
    ...(i.experience.trim()
      ? [`WHAT THE CREATOR WANTS WORKED IN: ${i.experience.slice(0, 900)}`, 'Build the script around it.']
      : ['The creator added nothing of their own, so write it from the product and the angle of the reference.']),
    // An ad still may not make up facts. What the product does comes from the
    // brief, the reference or the creator; numbers and promises nobody gave
    // are what gets an ad rejected and a creator dropped.
    'Never make up a number, a price, a discount, a health claim or a result that the brief, the reference or the creator did not give.',
    ...(i.brief ? ['', `THE BRAND'S BRIEF (follow it, it is how the video gets approved): ${i.brief.slice(0, 1200)}`] : []),
    ...(i.voice?.length ? ['', 'HOW THIS CREATOR TALKS, from their own messages. Match the rhythm, not the subject:', ...i.voice.slice(0, 3).map((v, n) => `${n + 1}. ${v.slice(0, 400)}`)] : []),
    '',
    'Give exactly this, as JSON and nothing else:',
    '{"hooks":["three different opening lines, each under 15 words"],"script":"the full script, spoken words only, no shot directions, no headings, 23 to 45 seconds when read aloud"}',
  ].join('\n')
}

/** The answer, read safely. A model that returns prose instead of JSON, or
 *  two hooks instead of three, is a result to show rather than a crash. */
export function readRewrite(raw: unknown): { hooks: string[]; script: string } | null {
  const text = typeof raw === 'string' ? raw : ''
  let obj: unknown = raw
  if (text) {
    const start = text.indexOf('{'), end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const script = String(o.script ?? '').replace(/\s+/g, ' ').trim()
  if (script.length < SCRIPT_MIN) return null
  const hooks = (Array.isArray(o.hooks) ? o.hooks : [])
    .map((h) => String(h ?? '').replace(/\s+/g, ' ').trim())
    .filter((h) => h.length >= 8 && h.length <= 200)
    .slice(0, 3)
  return { hooks, script: script.slice(0, SCRIPT_MAX) }
}

/**
 * Did the model just hand back the reference.
 *
 * THE ONE CHECK THAT PROTECTS THE CREATOR. "Close to it" invites copying, and
 * a model under that instruction will sometimes return the reference with two
 * words changed. That is the version that gets a creator thrown off a brand.
 * Measured with the same word overlap the voice work already uses.
 */
export const TOO_ALIKE = 0.6

export function tooAlike(reference: string, written: string): boolean {
  return likeness(reference, written) >= TOO_ALIKE
}

// ── The team's words, where the creator plans ───────────────────────────────

/**
 * A brand's best videos in Make videos, with the words the team's Top 100
 * collection already holds (Seb, 2026-10-18: How they win is "not as useful
 * as we think where it is"; the help belongs "inside of the brands that have
 * already accepted to work with users, under Make a video").
 *
 * Make videos reads a brand's best videos live and asks TRYBE for the words
 * of the first three. Any of them TRYBE gave no words for, the collection may
 * have: shared by TRYBE on an earlier day, or listened to by MVP. Then the
 * brand's other Top 100 videos with words are added after them, best placed
 * first, up to `max`. Every video says where its words came from, so a script
 * MVP listened to is never passed off as one TRYBE shared. Pure.
 */
export type WordsFrom = 'trybe' | 'top100_trybe' | 'top100_listened' | null
export interface WinnerVideo { id: string; thumbnail: string | null; video: string | null; caption: string | null; words: string | null; from: WordsFrom }

export function withTeamWords(
  live: Array<{ id: string; thumbnail: string | null; video: string | null; caption: string | null; words: string | null }>,
  team: Array<Pick<TopScript, 'submission_id' | 'script' | 'state' | 'source' | 'best_rank' | 'thumbnail' | 'video_url'>>,
  max: number,
): { videos: WinnerVideo[]; fromTeam: number } {
  const ready = new Map(team
    .filter((t) => t.state === 'ready' && typeof t.script === 'string' && t.script.trim().length >= SCRIPT_MIN)
    .map((t) => [t.submission_id, t]))
  const fromOf = (t: { source: ScriptSource }): WordsFrom => (t.source === 'transcribed' ? 'top100_listened' : 'top100_trybe')
  let fromTeam = 0
  const out: WinnerVideo[] = live.map((v) => {
    if (v.words) return { ...v, from: 'trybe' as const }
    const t = ready.get(v.id)
    if (!t) return { ...v, from: null }
    fromTeam++
    return { ...v, words: t.script, from: fromOf(t) }
  })
  const have = new Set(out.map((v) => v.id))
  const more = [...ready.values()]
    .filter((t) => !have.has(t.submission_id))
    .sort((a, b) => (a.best_rank ?? 999) - (b.best_rank ?? 999))
  for (const t of more) {
    if (out.length >= max) break
    out.push({ id: t.submission_id, thumbnail: t.thumbnail, video: t.video_url, caption: null, words: t.script, from: fromOf(t) })
    fromTeam++
  }
  return { videos: out, fromTeam }
}
