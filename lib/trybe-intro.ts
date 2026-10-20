// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE INTRO VIDEO FOR BRAND REQUESTS (Seb, 2026-10-20: "what if we tell users
// to upload an introductionary video? Something like, hey, my name is so-and-
// so. I've been doing UGC for this many years. My niches are, just so that
// the brand can actually see the person ... Let's make it a personal intro
// submission based on what MVP wants to recommend").
//
// TRYBE's Request to Join takes an optional preview video. MVP recommends a
// personal one, the same for every brand: who the creator is, how long they
// have made videos, their niches, where their videos run, and an invitation.
// MVP writes the words from what it knows of the creator (their pitch, niche
// and profile) and the creator films it once. Never a rate or a price (TRYBE
// messages never talk rates), never a brand's name (it goes to every brand),
// never a claim MVP was not told. Pure; tested in scripts/test-trybe-intro.

/** How long the intro runs, and the words that fit in it. */
export const INTRO_SECONDS = 30
export const INTRO_MAX_WORDS = 90
/** The largest intro file MVP keeps (a 30 second phone video is far under). */
export const INTRO_MAX_BYTES = 200 * 1024 * 1024

export const YEARS_CHOICES = ['less than a year', '1 year', '2 years', '3 years', '4 years', '5 years or more'] as const

export interface IntroLine { say: string; show: string | null }
export interface IntroScript { lines: IntroLine[]; words: number }

/** How to film it, the same for everyone. */
export const INTRO_TIPS: string[] = [
  'Film it vertical, at eye level, with the light in front of you (a window works).',
  'Look into the lens, not at the screen, and smile before you start talking.',
  'Say your name in the first two seconds, so a brand knows who it is meeting.',
  'Hold up one product you have filmed while you say your niches.',
  'Keep it to about 30 seconds, no music, and no rates or prices.',
]

export const INTRO_SYSTEM = `You write a creator's personal intro video for brands on TRYBE, a UGC marketplace. The creator films it once and it is sent with every request to join a brand's program, so it must suit any brand.

Write what the creator says, first person, warm and natural, like meeting someone. About ${INTRO_SECONDS} seconds spoken: ${INTRO_MAX_WORDS} words at most in all.

In this order:
1. Hello and their first name.
2. What they make and how long they have made videos (the years given).
3. Their niches: two or three, from the facts.
4. Where their videos run (YouTube, an Amazon storefront, TikTok), only if the facts say so.
5. One line on what they bring a brand: real-life videos that show the product and answer buyers' questions.
6. A friendly close: they would love to make videos for the brand.

Rules:
- Never mention rates, prices, pay, fees or money.
- Never name a brand or a product: this goes to every brand.
- Use only the facts given. No follower counts, results, awards or years you were not told.
- Never use the word "honest" or "honestly", and no dashes as sentence breaks.
- For each line, say what to show on camera in a few words, or null.

Return ONLY JSON: {"lines":[{"say":"...","show":"..."}]}`

/** The facts the writer gets: the creator's name and years, then what MVP knows. Pure. */
export function introPrompt(input: { name: string; years: string; facts: string[]; coreMessage?: string | null; niches?: string[] }): string {
  return [
    `FIRST NAME: ${input.name.trim() || '(not given: write "I" without a name)'}`,
    `MAKING VIDEOS FOR: ${input.years.trim() || '(not given: leave years out)'}`,
    input.niches?.length ? `NICHES: ${input.niches.slice(0, 6).join(', ')}` : '',
    input.coreMessage?.trim() ? `THEIR PITCH TO BRANDS (for what they make and where it runs; do not copy it):\n${input.coreMessage.trim().slice(0, 1200)}` : '',
    input.facts.length ? `WHAT MVP KNOWS:\n${input.facts.join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

const BANNED = /\b(honest(ly)?|rate|rates|price|prices|pricing|fee|fees|paid|pay|payment|\$\d)\b/i
const DASH = /\s[-–—]\s|[–—]/

/** The writer's answer, made safe: lines with words, the house rules kept,
 *  under the word limit. A line that talks money is dropped. Pure. */
export function parseIntro(raw: string): IntroScript | null {
  const m = String(raw || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: { lines?: unknown }
  try { j = JSON.parse(m[0]) } catch { return null }
  const lines: IntroLine[] = []
  let words = 0
  for (const l of Array.isArray(j.lines) ? j.lines : []) {
    const o = l && typeof l === 'object' ? l as Record<string, unknown> : {}
    const say = String(o.say || '').replace(DASH, ', ').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (!say || BANNED.test(say)) continue
    const n = say.split(' ').length
    if (words + n > INTRO_MAX_WORDS + 10) break
    words += n
    const show = typeof o.show === 'string' && o.show.trim() ? o.show.replace(DASH, ', ').trim().slice(0, 120) : null
    lines.push({ say, show })
  }
  return lines.length >= 3 ? { lines, words } : null
}

/** The intro the creator uploaded, as MVP keeps it. */
export interface IntroVideo { url: string; path: string; name: string; bytes: number | null; uploadedAt: string }

/** A stored intro read back, or null. Pure. */
export function readIntroVideo(v: unknown): IntroVideo | null {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : null
  if (!o || typeof o.url !== 'string' || !/^https:\/\//.test(o.url) || typeof o.path !== 'string') return null
  return { url: o.url, path: o.path, name: typeof o.name === 'string' ? o.name.slice(0, 200) : 'intro.mp4', bytes: typeof o.bytes === 'number' ? o.bytes : null, uploadedAt: typeof o.uploadedAt === 'string' ? o.uploadedAt : '' }
}
