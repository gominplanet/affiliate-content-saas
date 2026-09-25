// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Live prep: the plan for one live stream.
//
// WHAT A PLAN IS. The products in the order they will be shown, a run of show
// with a start time for every segment, and for each product what to say (from
// the creator's own review when there is one), what to show on camera, and
// the questions viewers are likely to type. Plus an opening, a close, and
// moments to ask the chat something, because a quiet chat is what makes a
// live stream feel long.
//
// THE TIMES ARE MVP'S, NOT THE MODEL'S. The model writes the words; the clock
// is laid out here from the length the creator chose, so the run of show
// always adds up to the minutes they asked for.

import { tidyCopy } from '@/lib/copy-rules'

export interface LiveProductInput {
  asin: string
  title: string
  image: string | null
  bullets: string[]
  /** What the creator said about it in their own video, when MVP has it. */
  transcript: string
  videoTitle: string | null
  /** "32% off" and the like, when it is on sale today. */
  saleLabel: string | null
}

export interface LiveSegment {
  asin: string
  title: string
  image: string | null
  startMin: number
  minutes: number
  hook: string
  talkingPoints: string[]
  show: string[]
  questions: Array<{ q: string; a: string }>
  saleLabel: string | null
  fromVideo: string | null
}

export interface LivePlan {
  title: string
  minutes: number
  opening: { minutes: number; script: string }
  segments: LiveSegment[]
  chatPrompts: Array<{ atMin: number; text: string }>
  closing: { startMin: number; minutes: number; script: string }
}

/** Length choices offered on the page. */
export const LIVE_LENGTHS = [30, 45, 60, 90, 120] as const

/** Most products a show takes: Amazon Live's product carousel holds 39. */
export const LIVE_MAX_PRODUCTS = 39

/**
 * The clock: an opening, the products, a close. The opening and close scale
 * with the length but never exceed a few minutes; the rest is split across
 * the products, the ones on sale getting a little more.
 */
export function layoutClock(minutes: number, products: Array<{ saleLabel: string | null }>): {
  opening: number; closing: number; segments: Array<{ startMin: number; minutes: number }>
} {
  const total = Math.max(10, Math.min(180, Math.round(minutes)))
  const opening = Math.min(4, Math.max(2, Math.round(total * 0.06)))
  const closing = Math.min(4, Math.max(2, Math.round(total * 0.05)))
  const body = total - opening - closing
  const weights = products.map((p) => (p.saleLabel ? 1.25 : 1))
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  // Whole minutes, at least one each, and the remainder handed out in order so
  // the segments add up to the body exactly.
  const raw = weights.map((w) => (w / sum) * body)
  const mins = raw.map((r) => Math.max(1, Math.floor(r)))
  let rest = body - mins.reduce((a, b) => a + b, 0)
  const byFraction = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f)
  for (let k = 0; rest > 0 && byFraction.length; k = (k + 1) % byFraction.length) { mins[byFraction[k].i]++; rest-- }
  for (let i = mins.length - 1; rest < 0 && i >= 0; i--) { if (mins[i] > 1) { mins[i]--; rest++ } }
  let at = opening
  const segments = mins.map((m) => { const s = { startMin: at, minutes: m }; at += m; return s })
  return { opening, closing, segments }
}

/** "0:00", "12:00", "1:05:00" for a minute mark. */
export function clockLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:00` : `${m}:00`
}

/** No dashes as sentence breaks, no year, no banned words (lib/copy-rules). */
export function tidyLine(s: unknown): string {
  return tidyCopy(s)
}

export function buildLivePrompt(opts: {
  title: string
  minutes: number
  products: LiveProductInput[]
  voice: string
  notes: string
}): string {
  const list = opts.products.map((p, i) => {
    const bits = [
      `PRODUCT ${i + 1}: ${p.asin} | "${p.title}"`,
      p.saleLabel ? `ON SALE TODAY: yes` : 'ON SALE TODAY: no',
      p.bullets.length ? `LISTING: ${p.bullets.slice(0, 5).map((b) => b.slice(0, 160)).join(' / ')}` : '',
      p.videoTitle ? `THEIR VIDEO: "${p.videoTitle}"` : '',
      p.transcript ? `WHAT THEY SAID IN IT: """${p.transcript.slice(0, 1400)}"""` : '',
    ].filter(Boolean)
    return bits.join('\n')
  }).join('\n\n')

  return `You are preparing a creator for an Amazon Live stream: "${opts.title}", about ${opts.minutes} minutes. Viewers watch on Amazon, with each product shown in a carousel beside the stream. The creator talks to camera and demonstrates each product.

${list}

${opts.notes ? `THE CREATOR'S NOTES FOR THIS STREAM: ${opts.notes.slice(0, 600)}\n` : ''}${opts.voice ? `THE CREATOR'S VOICE:\n${opts.voice}\n` : ''}
Write, for each product in the order given:
- "hook": one spoken line that introduces it, under 18 words.
- "talkingPoints": 3 to 5 short points to say, drawn first from what the creator actually said in their video, then from the listing. Specific, real-use details.
- "show": 2 to 4 things to demonstrate on camera (hold it up, show the fit, turn it on).
- "questions": 2 or 3 questions viewers are likely to type in chat, with short answers only from the facts given. If the facts do not answer it, the answer says to check the listing.

Also write:
- "opening": a 20 to 40 second spoken welcome that says what is coming up.
- "closing": a 20 to 40 second spoken close.
- "chatPrompts": 3 to 6 short questions to ask the chat during the stream, to keep it talking.

HARD RULES:
- NEVER state a price, a dollar amount, or a percentage. Prices change during a stream, and the carousel shows them. For a product on sale, say it is on sale right now.
- NEVER invent features, results, or claims not in the facts given.
- NEVER mention a giveaway, contest, sweepstake, raffle, prize, or anything free for viewers, even if the creator's notes ask for one. Amazon Live does not allow them.
- First person, conversational, the creator speaking. No dashes as sentence breaks. No year. Never any form of the word "honest". No "game-changer", "must-have", "insane", "amazing".

Return ONLY JSON:
{"opening":"...","closing":"...","chatPrompts":["..."],"products":[{"asin":"...","hook":"...","talkingPoints":["..."],"show":["..."],"questions":[{"q":"...","a":"..."}]}]}`
}

/**
 * The model's answer laid onto MVP's clock. Products the model skipped keep
 * their slot with the listing's own points, so a plan never silently drops a
 * product the creator picked.
 */
export function assemblePlan(opts: {
  title: string
  minutes: number
  products: LiveProductInput[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any
}): LivePlan {
  const clock = layoutClock(opts.minutes, opts.products)
  const byAsin = new Map<string, Record<string, unknown>>()
  for (const p of (Array.isArray(opts.model?.products) ? opts.model.products : []) as Array<Record<string, unknown>>) {
    const a = String(p?.asin || '').toUpperCase()
    if (a) byAsin.set(a, p)
  }
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map(tidyLine).filter(Boolean).slice(0, max)
  const segments: LiveSegment[] = opts.products.map((p, i) => {
    // By ASIN; by position only when the writer's entry carries no ASIN at all,
    // or a skipped product would be handed its neighbour's talking points.
    const atIndex = Array.isArray(opts.model?.products) ? opts.model.products[i] : null
    const m = byAsin.get(p.asin) ?? (atIndex && !atIndex.asin ? atIndex : null) ?? {}
    const points = list(m.talkingPoints, 5)
    return {
      asin: p.asin,
      title: p.title,
      image: p.image,
      startMin: clock.segments[i].startMin,
      minutes: clock.segments[i].minutes,
      hook: tidyLine(m.hook) || `Next up, the ${p.title.split(/[,(|]/)[0].trim().slice(0, 60)}.`,
      talkingPoints: points.length ? points : p.bullets.slice(0, 3).map((b) => tidyLine(b.slice(0, 160))),
      show: list(m.show, 4),
      questions: (Array.isArray(m.questions) ? m.questions : []).slice(0, 3)
        .map((q: { q?: unknown; a?: unknown }) => ({ q: tidyLine(q?.q), a: tidyLine(q?.a) }))
        .filter((q: { q: string; a: string }) => q.q && q.a),
      saleLabel: p.saleLabel,
      fromVideo: p.videoTitle,
    }
  })
  const last = segments[segments.length - 1]
  const closingStart = last ? last.startMin + last.minutes : clock.opening
  const body = Math.max(1, closingStart - clock.opening)
  const prompts = list(opts.model?.chatPrompts, 6)
  return {
    title: tidyLine(opts.title) || 'Amazon Live',
    minutes: closingStart + clock.closing,
    // NEVER BLANK. A missing opening or close reads as a finished plan with a
    // hole in it; a plain line in the creator's words is better than silence.
    opening: {
      minutes: clock.opening,
      script: tidyLine(opts.model?.opening) || `Welcome in, everyone. Today I am going through ${segments.length} ${segments.length === 1 ? 'product' : 'products'} I picked out, and I will show you each one up close. Say hi in the chat and tell me where you are watching from.`,
    },
    segments,
    // Spread through the products, never in the opening or the close.
    chatPrompts: prompts.map((text, i) => ({ atMin: clock.opening + Math.round(((i + 1) * body) / (prompts.length + 1)), text })),
    closing: {
      startMin: closingStart, minutes: clock.closing,
      script: tidyLine(opts.model?.closing) || 'That is everything for today. Everything I showed you is in the carousel next to the stream. Thanks so much for hanging out with me.',
    },
  }
}
