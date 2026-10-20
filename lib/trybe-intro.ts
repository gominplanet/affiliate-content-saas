// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE INTRO VIDEO FOR BRAND REQUESTS (Seb, 2026-10-20: "what if we tell users
// to upload an introductionary video? Something like, hey, my name is so-and-
// so. I've been doing UGC for this many years. My niches are, just so that
// the brand can actually see the person ... Let's make it a personal intro
// submission based on what MVP wants to recommend").
//
// TRYBE's Request to Join takes an optional preview video. MVP recommends a
// personal one, the same for every brand. The creator says who they are
// (Seb, 2026-10-20: "name, experience, social used with success (links),
// signature, name + email (if user wants)"), how they want it to sound and
// how long; MVP writes the words, line by line with what to show, and the
// creator films it once. Never a rate or a price (TRYBE messages never talk
// rates), never a brand's name (it goes to every brand), never a claim the
// creator did not give. Pure; tested in scripts/test-trybe-intro.

import { scrubBanned } from '@/lib/scrub'

/** The largest intro file MVP keeps (a 30 second phone video is far under). */
export const INTRO_MAX_BYTES = 200 * 1024 * 1024
export const INTRO_SECONDS = 30

export const YEARS_CHOICES = ['less than a year', '1 year', '2 years', '3 years', '4 years', '5 years or more'] as const
export const LENGTHS = [15, 30, 45] as const
/** Words spoken in each length, at an easy pace. */
export const WORDS_FOR: Record<(typeof LENGTHS)[number], number> = { 15: 40, 30: 80, 45: 115 }
export const TONES = { warm: 'Warm and friendly', upbeat: 'Upbeat and energetic', calm: 'Calm and professional' } as const
export type IntroTone = keyof typeof TONES

/** Where the creator's videos do well, in the order shown. */
export const SOCIALS = [
  { id: 'youtube', label: 'YouTube' }, { id: 'tiktok', label: 'TikTok' }, { id: 'instagram', label: 'Instagram' },
  { id: 'amazon', label: 'Amazon storefront' }, { id: 'facebook', label: 'Facebook' }, { id: 'pinterest', label: 'Pinterest' }, { id: 'website', label: 'Website' },
] as const
export type SocialId = (typeof SOCIALS)[number]['id']

export interface IntroInputs {
  name: string
  years: string
  /** What they are proud of, in their words ("500 Amazon videos"). */
  highlight: string
  niches: string[]
  socials: Array<{ id: SocialId; url: string }>
  /** Close with their email on screen and said simply. */
  withEmail: boolean
  email: string
  tone: IntroTone
  seconds: (typeof LENGTHS)[number]
}

export const INTRO_TIPS: string[] = [
  'Film it vertical, at eye level, with the light in front of you (a window works).',
  'Look into the lens, not at the screen, and smile before you start talking.',
  'Say your name in the first two seconds, so a brand knows who it is meeting.',
  'Hold up one product you have filmed while you say your niches.',
  'Add your links and email as text on screen, so nobody has to remember them.',
  'No music, and no rates or prices.',
]

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i

/** What the page sent, made safe. Pure. */
export function cleanInputs(raw: unknown): IntroInputs {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')
  const ids = new Set(SOCIALS.map((s) => s.id as string))
  const socials: IntroInputs['socials'] = []
  for (const s of Array.isArray(o.socials) ? o.socials : []) {
    const x = s && typeof s === 'object' ? s as Record<string, unknown> : {}
    const id = String(x.id || '')
    const url = str(x.url, 300)
    if (ids.has(id) && !socials.some((y) => y.id === id)) socials.push({ id: id as SocialId, url: /^(https?:\/\/|www\.|@)/i.test(url) || !url ? url : '' })
  }
  const email = str(o.email, 254)
  const seconds = LENGTHS.includes(Number(o.seconds) as (typeof LENGTHS)[number]) ? Number(o.seconds) as (typeof LENGTHS)[number] : 30
  return {
    name: str(o.name, 60),
    years: (YEARS_CHOICES as readonly string[]).includes(String(o.years)) ? String(o.years) : '',
    highlight: str(o.highlight, 240),
    niches: (Array.isArray(o.niches) ? o.niches : typeof o.niches === 'string' ? o.niches.split(',') : []).map((n) => str(n, 40)).filter(Boolean).slice(0, 6),
    socials: socials.slice(0, SOCIALS.length),
    withEmail: o.withEmail === true && EMAIL.test(email),
    email: EMAIL.test(email) ? email : '',
    tone: (Object.keys(TONES) as IntroTone[]).includes(o.tone as IntroTone) ? o.tone as IntroTone : 'warm',
    seconds,
  }
}

/** The writer's rules, for this length. Pure. */
export function introSystem(seconds: (typeof LENGTHS)[number]): string {
  return `You write a creator's personal intro video for brands on TRYBE, a UGC marketplace. The creator films it once and it is sent with every request to join a brand's program, so it must suit any brand.

Write what the creator says, first person, natural, like meeting someone. About ${seconds} seconds spoken: ${WORDS_FOR[seconds]} words at most in all. If more than one name is given, they speak as "we".

In this order, leaving out anything not given:
1. Hello and their name.
2. What they make and how long they have made videos.
3. What they are proud of, only as given.
4. Their niches: two or three.
5. Where their videos do well: name the platforms in words (never read a link out loud).
6. One line on what they bring a brand: real-life videos that show the product and answer buyers' questions.
7. A friendly close: they would love to make videos for the brand. With an email given, end by saying where to reach them in a few words.

For each line, say what to show on camera in a few words, or null. When a line names a platform or the email, "show" is the on-screen text: the link or the email exactly as given.

Rules:
- Never mention rates, prices, pay, fees or money.
- Never name a brand or a product: this goes to every brand.
- Use only the facts given. No follower counts, results, awards or years you were not told.
- Never use the word "honest" or "honestly", and no dashes as sentence breaks.

Return ONLY JSON: {"lines":[{"say":"...","show":"..."}]}`
}

/** The facts the writer gets. Pure. */
export function introPrompt(i: IntroInputs, more: { facts?: string[]; coreMessage?: string | null } = {}): string {
  const label = (id: SocialId) => SOCIALS.find((s) => s.id === id)?.label || id
  return [
    `NAME: ${i.name || '(not given: no name)'}`,
    `MAKING VIDEOS FOR: ${i.years || '(not given: leave years out)'}`,
    i.highlight ? `PROUD OF: ${i.highlight}` : '',
    i.niches.length ? `NICHES: ${i.niches.join(', ')}` : '',
    i.socials.length ? `WHERE THEIR VIDEOS DO WELL:\n${i.socials.map((s) => `- ${label(s.id)}${s.url ? ` (on screen: ${s.url})` : ''}`).join('\n')}` : '',
    i.withEmail ? `EMAIL (end with it; on screen exactly): ${i.email}` : '',
    `TONE: ${TONES[i.tone]}`,
    more.coreMessage?.trim() ? `THEIR PITCH TO BRANDS (for what they make; do not copy it):\n${more.coreMessage.trim().slice(0, 1200)}` : '',
    more.facts?.length ? `MORE THAT MVP KNOWS (use only what fits):\n${more.facts.join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

export interface IntroLine { say: string; show: string | null }
export interface IntroScript { lines: IntroLine[]; words: number }

const MONEY = /\b(rates?|prices?|pricing|fees?|paid|pay|payment|cost|\$\d)\b/i
const DASH = /\s[-–—]\s|[–—]/g

/** The writer's answer, made safe LINE BY LINE (the house scrub on each
 *  line, never on the answer as a whole: a health claim in one line once
 *  took the whole answer with it, 2026-10-20). A line that talks money or is
 *  emptied by the scrub is dropped; the words stay near the length. Pure. */
export function parseIntro(raw: string, seconds: (typeof LENGTHS)[number] = 30): IntroScript | null {
  const m = String(raw || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: { lines?: unknown }
  try { j = JSON.parse(m[0]) } catch { return null }
  const lines: IntroLine[] = []
  let words = 0
  for (const l of Array.isArray(j.lines) ? j.lines : []) {
    const o = l && typeof l === 'object' ? l as Record<string, unknown> : {}
    const say = scrubBanned(String(o.say || '').replace(DASH, ', ')).replace(/\s+/g, ' ').trim().slice(0, 300)
    if (!say || MONEY.test(say)) continue
    const n = say.split(' ').length
    if (words + n > WORDS_FOR[seconds] + 12) break
    words += n
    const showRaw = typeof o.show === 'string' ? o.show.trim() : ''
    // On-screen text (a link or the email) is kept as written; a cue is scrubbed.
    const show = !showRaw ? null : /^(https?:\/\/|www\.|@)|@[^\s]+\.[a-z]{2,}$/i.test(showRaw) ? showRaw.slice(0, 200) : scrubBanned(showRaw.replace(DASH, ', ')).slice(0, 120) || null
    lines.push({ say, show })
  }
  return lines.length >= 2 ? { lines, words } : null
}

/** The intro the creator uploaded, as MVP keeps it. */
export interface IntroVideo { url: string; path: string; name: string; bytes: number | null; uploadedAt: string }

/** A stored intro read back, or null. Pure. */
export function readIntroVideo(v: unknown): IntroVideo | null {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : null
  if (!o || typeof o.url !== 'string' || !/^https:\/\//.test(o.url) || typeof o.path !== 'string') return null
  return { url: o.url, path: o.path, name: typeof o.name === 'string' ? o.name.slice(0, 200) : 'intro.mp4', bytes: typeof o.bytes === 'number' ? o.bytes : null, uploadedAt: typeof o.uploadedAt === 'string' ? o.uploadedAt : '' }
}

/** What MVP already knows, to fill the form in: the creator's profile. Pure. */
export function introSuggest(bp: Record<string, unknown>, categories: string[]): Partial<IntroInputs> {
  const s = (k: string) => (typeof bp[k] === 'string' && (bp[k] as string).trim() ? (bp[k] as string).trim() : '')
  const op = bp.outreach_profile && typeof bp.outreach_profile === 'object' ? bp.outreach_profile as Record<string, unknown> : {}
  const links: Array<[SocialId, string]> = [
    ['youtube', s('youtube_channel_url') || (typeof op.youtube === 'string' ? op.youtube : '')], ['tiktok', s('tiktok_url')], ['instagram', s('instagram_url')],
    ['amazon', s('amazon_storefront_url') || (typeof op.storefrontUrl === 'string' ? op.storefrontUrl : '')], ['facebook', s('facebook_url')], ['pinterest', s('pinterest_url')], ['website', s('website_url')],
  ]
  const niches = Array.isArray(bp.niches) ? (bp.niches as unknown[]).map(String) : []
  return {
    name: s('author_name'),
    highlight: s('collab_track_record').slice(0, 240),
    niches: Array.from(new Set([...niches, ...categories])).slice(0, 6),
    socials: links.filter(([, url]) => url).map(([id, url]) => ({ id, url })),
    email: s('contact_email'),
  }
}
