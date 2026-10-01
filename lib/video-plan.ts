// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PLAN THIS VIDEO (Labs, admin while it is tested). The pure parts.
//
// From a joined Creator Connections campaign to a video plan: the angle, three
// titles, the opening line, an outline with talking points, the shots, which
// moment to cut as a Short, the thumbnail, and the dates worked back from the
// campaign end. The plan uses only what is known about the product (its page,
// the campaign) and the creator's own voice and past titles. It never states a
// price or a discount, which go stale and Amazon's policy forbids in copy.

const DAY = 86_400_000

export type VideoPlan = {
  angle: string
  titles: string[]
  hook: string
  outline: Array<{ section: string; points: string[] }>
  shots: string[]
  short: { moment: string; why: string }
  thumbnail: { text: string; idea: string }
  questions: string[]
  dates: PlanDates
}

export type PlanDates = {
  /** Post by this day so the video has time to earn inside the window. */
  postBy: string | null
  /** Film by this day so editing and Liftoff fit before postBy. */
  shootBy: string | null
  /** Days left in the campaign, or null when Amazon gave no end date. */
  daysLeft: number | null
  /** Said plainly when the window is too short for the usual schedule. */
  note: string | null
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/**
 * The schedule, worked back from the campaign end: post at least a week before
 * it closes (sales need time), film four days before posting. When the window
 * is shorter than that, the dates move to today and the note says so. Pure.
 */
export function planDates(endsAt: string | null, now: Date = new Date()): PlanDates {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const end = endsAt ? Date.parse(`${String(endsAt).slice(0, 10)}T00:00:00Z`) : NaN
  if (!Number.isFinite(end)) return { postBy: null, shootBy: null, daysLeft: null, note: 'Amazon gave no end date for this campaign, so there is no deadline to work back from.' }
  const daysLeft = Math.round((end - today) / DAY)
  if (daysLeft < 0) return { postBy: null, shootBy: null, daysLeft, note: 'This campaign has ended. A video now earns normal commission only.' }
  const postBy = Math.max(today, end - 7 * DAY)
  const shootBy = Math.max(today, postBy - 4 * DAY)
  const note = daysLeft < 11
    ? (daysLeft <= 3 ? `Only ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left. A Short posted today is the realistic option.` : `${daysLeft} days left: film and post as soon as you can.`)
    : null
  return { postBy: iso(postBy), shootBy: iso(shootBy), daysLeft, note }
}

export type PlanInput = {
  asin: string
  product: string
  brand: string | null
  commissionPct: number | null
  bullets: string[]
  description: string
  rating: string | null
  voice: string
  pastTitles: string[]
  daysLeft: number | null
}

export function buildPlanPrompt(i: PlanInput): { system: string; user: string } {
  return {
    system: [
      'You plan one YouTube product review video for an Amazon creator. Return STRICT JSON only, no markdown:',
      '{"angle","titles":[3],"hook","outline":[{"section","points":[]}],"shots":[],"short":{"moment","why"},"thumbnail":{"text","idea"},"questions":[]}',
      'angle: one sentence, the specific promise of this video for a buyer deciding. titles: three, under 70 characters, no year, no clickbait the video cannot back up.',
      'hook: the first line the creator says on camera, under 25 words. outline: 4 to 6 sections in filming order, each with 2 to 4 talking points the creator can check by using the product.',
      'shots: 5 to 8 specific b-roll shots. short: the one moment to cut as a vertical Short, and why it stops the scroll. thumbnail: up to 4 words of text and the image idea.',
      'questions: the 3 to 5 questions a buyer would ask that the video should answer.',
      'Rules: never state a price, a discount, a sale or a percentage off. Never invent specs that are not in the product details; where a spec matters and is unknown, tell the creator to check it.',
      'Write talking points as things to show and test, not claims, because the creator has not filmed yet. Match the creator\'s voice where one is given.',
    ].join(' '),
    user: [
      `PRODUCT: ${i.product} (ASIN ${i.asin})${i.brand ? `\nBRAND: ${i.brand}` : ''}`,
      i.rating ? `RATING ON AMAZON: ${i.rating}` : '',
      i.bullets.length ? `PRODUCT DETAILS:\n${i.bullets.slice(0, 10).map((b) => `- ${b}`).join('\n')}` : 'PRODUCT DETAILS: not available, plan from the product name and tell the creator what to check.',
      i.description ? `DESCRIPTION: ${i.description.slice(0, 1200)}` : '',
      i.voice ? `CREATOR VOICE: ${i.voice.slice(0, 800)}` : '',
      i.pastTitles.length ? `CREATOR'S RECENT VIDEO TITLES (match the style, do not copy):\n${i.pastTitles.slice(0, 12).map((t) => `- ${t}`).join('\n')}` : '',
      i.daysLeft != null ? `CAMPAIGN DAYS LEFT: ${i.daysLeft}${i.daysLeft <= 3 ? ' (too short for a long video: make the Short the priority)' : ''}` : '',
      'Write the plan JSON now.',
    ].filter(Boolean).join('\n\n'),
  }
}

const PRICE = /\$\s?\d|\d+\s?%|\bpercent off\b|\bon sale\b|\bdiscount/i
const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const noPrice = (s: string) => (PRICE.test(s) ? '' : s)

/** The model's answer as a plan, or null when it is unusable. Any line that
 *  states a price or a discount is dropped, whatever the prompt said. Pure. */
export function parsePlan(raw: string, dates: PlanDates): VideoPlan | null {
  let j: Record<string, unknown>
  try { j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) } catch { return null }
  const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v : []).map((x) => noPrice(clean(x, max))).filter(Boolean).slice(0, n)
  const outline = (Array.isArray(j.outline) ? j.outline : []).slice(0, 7).map((s: Record<string, unknown>) => ({
    section: noPrice(clean(s?.section, 80)), points: list(s?.points, 5, 200),
  })).filter((s) => s.section && s.points.length)
  const short = (j.short ?? {}) as Record<string, unknown>
  const thumb = (j.thumbnail ?? {}) as Record<string, unknown>
  const plan: VideoPlan = {
    angle: noPrice(clean(j.angle, 240)),
    titles: list(j.titles, 3, 100).map((t) => t.replace(/\b20\d\d\b/g, '').replace(/\s{2,}/g, ' ').trim()).filter(Boolean),
    hook: noPrice(clean(j.hook, 240)),
    outline,
    shots: list(j.shots, 8, 160),
    short: { moment: noPrice(clean(short.moment, 200)), why: noPrice(clean(short.why, 200)) },
    thumbnail: { text: noPrice(clean(thumb.text, 40)), idea: noPrice(clean(thumb.idea, 200)) },
    questions: list(j.questions, 5, 160),
    dates,
  }
  return plan.titles.length && plan.outline.length ? plan : null
}

/** The plan as plain text, to paste into notes or a script doc. Pure. */
export function planText(product: string, p: VideoPlan): string {
  const out: string[] = [`VIDEO PLAN: ${product}`, '']
  if (p.dates.shootBy || p.dates.postBy) out.push(`Film by ${p.dates.shootBy ?? 'today'}. Post by ${p.dates.postBy ?? 'today'}.`, '')
  if (p.dates.note) out.push(p.dates.note, '')
  out.push(`Angle: ${p.angle}`, '', 'Titles:', ...p.titles.map((t) => `  ${t}`), '', `Opening line: ${p.hook}`, '')
  for (const s of p.outline) out.push(s.section, ...s.points.map((x) => `  • ${x}`), '')
  out.push('Shots:', ...p.shots.map((s) => `  • ${s}`), '')
  out.push(`Short: ${p.short.moment} (${p.short.why})`, `Thumbnail: "${p.thumbnail.text}". ${p.thumbnail.idea}`, '')
  if (p.questions.length) out.push('Questions to answer:', ...p.questions.map((q) => `  • ${q}`))
  return out.join('\n').trim()
}
