// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE ADS EDITED FROM A BATCH (Seb, 2026-11-16: "after scripts, users shoot
// and then come back and could potentially edit all of their vertical trybe
// videos inside of mvp before being able to submit them"; then "go with your
// recommendation": the batch as a tracker, takes dropped in bulk, one video
// at a time beside its script). The editor (lib/review-edit) already cuts a
// TRYBE ad; this is what the batch adds to it:
//   matchScript  which of the batch's scripts a take is, from what was said,
//                so files never need naming. Unsure is said, never guessed.
//   scriptText   the script handed to the planner, so the plan matches the
//                take to lines MVP wrote instead of working the video out.
//   checkCut     the finished video checked against the brief, from the
//                words that are in it and when they are heard: the product
//                said before the delay, banned words, prices, percents and
//                the length. A check of the real cut, not of the plan.
// Pure, so it is tested (scripts/test-trybe-edit.ts).

import { casedWords, type Campaign, type Script } from './trybe-batch'
import type { Word } from './review-edit'

const STOP = new Set('the a an and or but so to of in on at for with my our your their his her its it is was were be been am are this that these those i me we you he she they them just then than there here what when where who how all any every some one two out up down over into from about like really very get got go going went do did does have has had not no yes can could would will now off back too also only even still'.split(' '))

/** The words that say what a line is about: lower case, letters and digits, no small words. Pure. */
export function contentWords(text: string): string[] {
  return String(text || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w))
}

/** How much of a script must be heard in a take to call it that script. */
export const MATCH_MIN = 0.4
/** How far ahead of the next script the best one must be. */
export const MATCH_MARGIN = 0.08

export interface ScriptMatch { idx: number; hit: number; of: number; score: number }

/** Which script a take is: the share of each script's own words heard in
 *  the take, the best one when it is clear of the next. Null when no script
 *  is heard enough, or two are too close to tell. Pure. */
export function matchScript(heard: Array<Pick<Word, 'text'>>, scripts: Array<Pick<Script, 'idx' | 'story' | 'body'>>): ScriptMatch | null {
  const said = new Set(contentWords(heard.map((w) => w.text).join(' ')))
  if (!said.size) return null
  const scored = scripts.map((s) => {
    const want = Array.from(new Set(contentWords([...s.story, ...s.body].map((b) => b.say).join(' '))))
    const hit = want.filter((w) => said.has(w)).length
    return { idx: s.idx, hit, of: want.length, score: want.length ? hit / want.length : 0 }
  }).sort((a, b) => b.score - a.score || b.hit - a.hit)
  const [best, next] = scored
  if (!best || best.score < MATCH_MIN) return null
  if (next && best.score - next.score < MATCH_MARGIN) return null
  return best
}

/** The script, as the planner reads it: what each beat says and shows, and
 *  where the product may first be said. Pure. */
export function scriptText(s: Pick<Script, 'title' | 'story' | 'body'>, delaySec: number): string {
  const beat = (b: { say: string; show: string }) => `- SAY: ${b.say}\n  SHOW: ${b.show}`
  return [
    `TITLE: ${s.title}`,
    `STORY (before the product${delaySec > 0 ? `, the first ${delaySec} seconds` : ''}):`,
    ...s.story.map(beat),
    'PRODUCT:',
    ...s.body.map(beat),
  ].join('\n')
}

export type CheckState = 'green' | 'amber' | 'red'
export interface CutCheck { state: CheckState; items: Array<{ tone: 'ok' | 'warn' | 'bad'; text: string }>; seconds: number; at: string }

const norm = (s: string) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9%$]+/g, ' ').trim()
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

/** When a phrase is first heard in the finished video, or null. Pure. */
export function heardAt(words: Word[], phrase: string): number | null {
  const want = norm(phrase).split(' ').filter(Boolean)
  if (!want.length) return null
  const said = words.map((w) => norm(w.text))
  for (let k = 0; k + want.length <= said.length; k++) {
    let ok = true
    for (let j = 0; j < want.length; j++) {
      // A word may be heard with its plural or possessive ending.
      const got = said[k + j].replace(/\s+/g, '')
      if (got !== want[j] && got !== `${want[j]}s` && got !== `${want[j]}es`) { ok = false; break }
    }
    if (ok) return words[k].start
  }
  return null
}

/** The finished video against the brief: red when a rule is broken, amber
 *  when something is worth a look, green when every rule holds. `words` are
 *  the words in the finished video on its own clock (lib/review-edit
 *  outputWords). Pure. */
export function checkCut(o: { words: Word[]; seconds: number; campaign: Pick<Campaign, 'product' | 'rules'>; now?: string }): CutCheck {
  const { product: P, rules: R } = o.campaign
  const items: CutCheck['items'] = []
  const text = o.words.map((w) => w.text).join(' ')
  // 1. The product delay: no name, brand word or category word before it.
  if (R.productDelaySec > 0) {
    const names = Array.from(new Set([P.name, ...casedWords(P), ...P.categoryWords].map((x) => x.trim()).filter(Boolean)))
    let first: { word: string; at: number } | null = null
    for (const n of names) {
      const at = heardAt(o.words, n)
      if (at != null && (!first || at < first.at)) first = { word: n, at }
    }
    if (!first) items.push({ tone: 'warn', text: `The product is never said by name. The brief wants it after ${clock(R.productDelaySec)}.` })
    else if (first.at < R.productDelaySec) items.push({ tone: 'bad', text: `"${first.word}" is said at ${clock(first.at)}, before the ${R.productDelaySec} second mark.` })
    else items.push({ tone: 'ok', text: `No product before ${clock(R.productDelaySec)}: first said at ${clock(first.at)}.` })
  }
  // 2. Names and words never said.
  const never = Array.from(new Set([...R.bannedTerms, ...P.neverSay].map((x) => x.trim()).filter(Boolean)))
  const saidNever = never.map((w) => ({ w, at: heardAt(o.words, w) })).filter((x) => x.at != null)
  for (const x of saidNever) items.push({ tone: 'bad', text: `"${x.w}" is said at ${clock(x.at!)}. The brief never allows it.` })
  // 3. Prices and percents.
  const price = R.noPrices ? text.match(/\$\s?\d[\d,.]*|\b\d[\d,.]*\s?(dollars?|bucks)\b/i) : null
  const pct = R.noPercentOff ? text.match(/\b\d+(\.\d+)?\s?(%|percent)/i) : null
  if (price) items.push({ tone: 'bad', text: `A price is said ("${price[0]}"). The brief allows no prices.` })
  if (pct) items.push({ tone: 'bad', text: `A percent is said ("${pct[0]}"). The brief allows no percents off.` })
  if (!saidNever.length && !price && !pct) items.push({ tone: 'ok', text: 'No price, percent or banned word said.' })
  // 4. The length.
  const [lo, hi] = R.targetLengthSec
  const secs = Math.round(o.seconds)
  if (secs < lo || secs > hi) items.push({ tone: 'warn', text: `${secs} seconds: the brief asks for ${lo} to ${hi}.` })
  else items.push({ tone: 'ok', text: `${secs} seconds, inside the brief's ${lo} to ${hi}.` })
  const state: CheckState = items.some((i) => i.tone === 'bad') ? 'red' : items.some((i) => i.tone === 'warn') ? 'amber' : 'green'
  return { state, items, seconds: secs, at: o.now ?? new Date().toISOString() }
}
