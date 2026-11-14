// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BATCH SCRIPTS FOR A BRAND CHALLENGE (Seb, 2026-11-14: "we need to add a
// functionality into trybe scriptwriting so people can do batches of
// scripts", with the Story-Time Script Generator brief). A creator sets up a
// campaign once (product, the brief's rules, where they can film, who is on
// camera), and MVP writes 50 to 300 shoot-ready story-time scripts in rounds
// of ten, checks every one against the rules in plain code, rewrites the ones
// that fail up to twice, and flags what still fails with the reasons.
//
// Pure: types, the even spread across places, hosts and angles, the rule
// checker, the near-duplicate check, the prompts and the parsing. The model
// call is passed in (runRound's `ask`), so the whole round runs in a test.

import { BANNED_RULE, scrubBanned } from '@/lib/scrub'
import { PROVEN_OPENERS } from '@/lib/trybe-playbook'

// ── The campaign ─────────────────────────────────────────────────────────────

export interface Claim { id: string; text: string }

/** What the brand's brief allows, read from it and checked by the creator. */
export interface BriefRules {
  /** The only features and claims a script may state. */
  approvedClaims: Claim[]
  /** Never said or shown, anywhere (case does not matter). */
  bannedTerms: string[]
  /** No prices or money amounts. */
  noPrices: boolean
  /** No percentages off. */
  noPercentOff: boolean
  /** When generic sale words are allowed, in the brief's words. */
  saleLanguageRule: string
  /** Generic sale words, allowed only in the last beat (when allowed at all). */
  saleWords: string[]
  targetLengthSec: [number, number]
  /** Aspect ratio and safe-zone notes, for the creator. */
  safeZoneNotes: string
  /** Seconds before the product, its brand or its category may be seen or said. */
  productDelaySec: number
}

export interface Product {
  /** Exact spelling and casing, e.g. "NOBL Air Tracker". */
  name: string
  /** Words whose casing is checked everywhere, e.g. ["NOBL"]. Derived from the name when empty. */
  mustSpell: string[]
  /** Names never to use, e.g. ["AirTag"]. */
  neverSay: string[]
  /** The product's category words, kept out of the story, e.g. ["tracker"]. */
  categoryWords: string[]
  /** Objects tied to the product, kept out of the story's shots, e.g. ["suitcase", "luggage"]. */
  showDeny: string[]
}

export interface Place { name: string; accessNotes: string; deny: string[] }
export interface CastMember { name: string; phone: string }

export interface Reality {
  locations: Place[]
  /** False: no script may claim the creator flies, checks in or lands today. */
  isTraveling: boolean
  cast: CastMember[]
  onePersonPerVideo: boolean
  /** App demo shots may be a screen recording from a past trip. */
  appFootageReuse: boolean
}

export interface Campaign {
  id: string
  name: string
  /** A TRYBE brand id, or null for a campaign of its own. */
  brandId: string | null
  product: Product
  rules: BriefRules
  reality: Reality
  /** Short true facts about the creator the stories may draw on. */
  creatorFacts: string[]
  angles: string[]
  hooks: string[]
  /** The brand's own starter scripts, as style references. */
  references: string
  /** Brand feedback, e.g. "less like an ad, more like story time". */
  feedback: string
  /** Scripts the creator needs, and by when. */
  target: number
  deadline: string | null
}

// ── A script ─────────────────────────────────────────────────────────────────

export interface Beat { say: string; show: string }
export interface BodyBeat extends Beat { claimIds: string[] }
export type ScriptStatus = 'draft' | 'approved' | 'shot' | 'submitted' | 'accepted' | 'rejected'
export const SCRIPT_STATUSES: ScriptStatus[] = ['draft', 'approved', 'shot', 'submitted', 'accepted', 'rejected']

export interface CheckResult {
  /** green: every rule holds; amber: warnings only; red: a rule is broken. */
  state: 'green' | 'amber' | 'red'
  reasons: string[]
  warnings: string[]
}

export interface Script {
  idx: number
  title: string
  angle: string
  host: string
  location: string
  realStory: boolean
  realityReason: string
  story: Beat[]
  body: BodyBeat[]
  estSeconds: number
  status: ScriptStatus
  link: string | null
  notes: string | null
  checks: CheckResult
  tries: number
}

export const BATCH_ROUND = 10
export const MAX_PER_CAMPAIGN = 300
export const DEFAULT_TARGET = 50
export const DEFAULT_ANGLES = ['Stress', 'Thing nobody thinks of', 'Relief', 'Aha moment']
export const DEFAULT_HOOKS: string[] = PROVEN_OPENERS.map((h) => `${h}...`)
export const DEFAULT_SALE_WORDS = ['on sale', 'sale', 'discount', 'discounted', 'limited time', 'promo', 'promo code', 'coupon', 'percent off', 'sitewide', 'doorbuster', 'clearance', 'lowest price', 'best price']
/** Near-duplicates: two scripts this alike (trigram overlap) count as one. */
export const TOO_ALIKE = 0.85
/** Rewrites of a script that broke a rule, before it is flagged. */
export const MAX_REWRITES = 2

export function emptyRules(): BriefRules {
  return { approvedClaims: [], bannedTerms: [], noPrices: true, noPercentOff: true, saleLanguageRule: '', saleWords: [...DEFAULT_SALE_WORDS], targetLengthSec: [25, 45], safeZoneNotes: '', productDelaySec: 0 }
}

// ── Small helpers ────────────────────────────────────────────────────────────

const clean = (s: unknown, max = 600): string => scrubBanned(String(s ?? '')).replace(/\s+/g, ' ').trim().slice(0, max)
const list = (v: unknown, max = 40, each = 120): string[] => (Array.isArray(v) ? v : []).map((x) => clean(x, each)).filter(Boolean).slice(0, max)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A word or phrase as a whole-word pattern (letters, digits and spaces). */
export function wordRe(term: string, flags = 'i'): RegExp {
  const t = esc(term.trim()).replace(/\s+/g, '\\s+')
  return new RegExp(`(^|[^A-Za-z0-9])(${t})(?=$|[^A-Za-z0-9])`, flags)
}
const wordsIn = (s: string) => (s.match(/[A-Za-z0-9$%']+/g) || []).length

/** Seconds a script runs: 2.5 words a second in the story, 2.6 in the body. */
export function estimateSeconds(story: Beat[], body: Beat[]): number {
  const s = story.reduce((n, b) => n + wordsIn(b.say), 0) / 2.5
  const b = body.reduce((n, x) => n + wordsIn(x.say), 0) / 2.6
  return Math.round(s + b)
}
export function storySeconds(story: Beat[]): number {
  return Math.round(story.reduce((n, b) => n + wordsIn(b.say), 0) / 2.5)
}

/** Words whose casing is checked: the ones given, else the name's own
 *  all-capitals or inner-capital words (NOBL, iPhone, GoPro). Pure. */
export function casedWords(p: Product): string[] {
  if (p.mustSpell.length) return p.mustSpell
  return p.name.split(/\s+/).filter((w) => w.length >= 2 && (/^[A-Z0-9]+$/.test(w) && /[A-Z]/.test(w) || /[a-z][A-Z]/.test(w)))
}

/** Character trigrams of normalised text. */
function trigrams(s: string): Set<string> {
  const t = ` ${s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `
  const out = new Set<string>()
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3))
  return out
}
/** How alike two texts are, 0 to 1 (trigram overlap, Jaccard). Pure. */
export function likeness(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b)
  if (!A.size || !B.size) return 0
  let same = 0
  for (const g of A) if (B.has(g)) same++
  return same / (A.size + B.size - same)
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const bodyText = (s: Pick<Script, 'body'>) => s.body.map((b) => b.say).join(' ')
const openText = (s: Pick<Script, 'title' | 'story'>) => `${s.title} ${s.story.map((b) => b.say).join(' ')}`

// ── The even spread (plain code, not the model) ──────────────────────────────

export interface Slot { idx: number; location: string; host: string; angle: string }

/** The next `count` scripts' place, host and angle, each the least used so
 *  far (ties in the campaign's own order), so a batch spreads evenly. Pure. */
export function planSlots(c: Campaign, existing: Array<Pick<Script, 'idx' | 'location' | 'host' | 'angle'>>, count: number): Slot[] {
  const places = c.reality.locations.map((l) => l.name).filter(Boolean)
  const hosts = c.reality.cast.map((p) => p.name).filter(Boolean)
  const angles = c.angles.filter(Boolean)
  const tally = (names: string[], key: 'location' | 'host' | 'angle') => {
    const m = new Map(names.map((n) => [n, 0]))
    for (const s of existing) if (m.has(s[key])) m.set(s[key], (m.get(s[key]) || 0) + 1)
    return m
  }
  const tp = tally(places, 'location'), th = tally(hosts, 'host'), ta = tally(angles, 'angle')
  const least = (m: Map<string, number>, fallback: string) => {
    let best = fallback, n = Infinity
    for (const [k, v] of m) if (v < n) { best = k; n = v }
    if (best !== fallback) m.set(best, (m.get(best) || 0) + 1)
    return best
  }
  let next = existing.reduce((n, s) => Math.max(n, s.idx), 0) + 1
  const out: Slot[] = []
  for (let i = 0; i < count; i++) out.push({ idx: next++, location: least(tp, 'Anywhere'), host: least(th, 'You'), angle: least(ta, 'Story') })
  return out
}

// ── The rule checker ─────────────────────────────────────────────────────────

const TRAVEL_NOW: RegExp[] = [
  /\bI['’]?m\s+(checking in|boarding|flying|landing|about to (board|fly|check in)|heading (to|for) (my|the) gate|going through security|catching (a|my) flight|taking off)\b/i,
  /\bI\s+am\s+(checking in|boarding|flying|landing|about to (board|fly))\b/i,
  /\bwe['’]?re\s+(checking in|boarding|flying|landing|about to (board|fly))\b/i,
  /\bmy\s+(flight|plane)\s+(is|just)\s+(boarding|landed|leaving|taking off|delayed|called)\b/i,
  /\bmy\s+bag\s+(just\s+)?(landed|arrived|came out|is on the carousel)\b/i,
  /\bI\s+just\s+(landed|checked in|got off (the|my) (plane|flight))\b/i,
  /\bboarding\s+now\b/i,
  /\b(my|our)\s+flight\s+(today|tonight|this morning|in an hour)\b/i,
  /\b(flying|fly)\s+out\s+(today|tonight|this morning|right now)\b/i,
]

/** Everything a script says and shows, beat by beat. */
const allText = (s: Pick<Script, 'title' | 'story' | 'body'>) => [s.title, ...s.story.flatMap((b) => [b.say, b.show]), ...s.body.flatMap((b) => [b.say, b.show])]

/** Check one script against every rule. `others`: the campaign's other
 *  scripts, for repeats. Pure. */
export function checkScript(s: Pick<Script, 'idx' | 'title' | 'angle' | 'host' | 'location' | 'realStory' | 'story' | 'body' | 'estSeconds'>, c: Campaign, others: Array<Pick<Script, 'idx' | 'title' | 'story' | 'body'> & { checks?: CheckResult }>, opts: { skipLater?: boolean } = {}): CheckResult {
  const reasons: string[] = []
  const warnings: string[] = []
  const R = c.rules
  const P = c.product
  const say = (t: string) => reasons.push(t)

  // Shape.
  if (!s.title) say('It has no title.')
  if (s.story.length < 1) say('It has no story beats.')
  if (s.body.length < 1) say('It has no product beats.')
  if (s.story.length && (s.story.length < 3 || s.story.length > 5)) warnings.push(`The story has ${s.story.length} beats (3 to 5 asked).`)
  const place = c.reality.locations.find((l) => l.name === s.location)
  if (c.reality.locations.length && !place) say(`"${s.location}" is not one of the campaign's places.`)
  if (c.reality.cast.length && !c.reality.cast.some((p) => p.name === s.host)) say(`"${s.host}" is not in the cast.`)

  // Product delay: the story never names, says or shows the product.
  if (R.productDelaySec > 0) {
    const named = [P.name, ...casedWords(P), ...P.categoryWords, ...P.neverSay].filter(Boolean)
    const inSay = [s.title, ...s.story.map((b) => b.say)].join(' \n ')
    for (const w of named) if (wordRe(w).test(inSay)) { say(`The product enters too early: "${w}" is in the title or the story, before ${R.productDelaySec} seconds.`); break }
    const inShow = s.story.map((b) => b.show).join(' \n ')
    for (const w of [...P.showDeny, ...named]) if (wordRe(w).test(inShow)) { say(`The story's shots show "${w}", a product or product-related object, before ${R.productDelaySec} seconds.`); break }
    const st = storySeconds(s.story)
    if (st < R.productDelaySec - 1) say(`The story runs about ${st} seconds, so the product would enter before ${R.productDelaySec} seconds.`)
  }

  // Banned words and names, and the product's spelling, anywhere.
  const text = allText(s)
  const joined = text.join(' \n ')
  for (const w of [...R.bannedTerms, ...P.neverSay].filter(Boolean)) {
    if (wordRe(w).test(joined)) say(`It uses "${w}", which the brief does not allow.`)
  }
  if (R.noPrices && /\$\s?\d|\b\d+(\.\d+)?\s?(dollars|bucks|usd)\b/i.test(joined)) say('It states a price, which the brief does not allow.')
  if (R.noPercentOff && /\b\d+\s?(%|percent)\b/i.test(joined)) say('It states a percentage, which the brief does not allow.')
  for (const w of casedWords(P)) {
    const re = new RegExp(`(^|[^A-Za-z0-9])(${esc(w)})(?=$|[^A-Za-z0-9])`, 'gi')
    for (const t of text) for (const m of t.matchAll(re)) if (m[2] !== w) { say(`"${m[2]}" is spelled with the wrong capitals: it is always "${w}".`); break }
  }

  // Sale words only in the last beat.
  const sale = R.saleWords.filter(Boolean)
  if (sale.length) {
    const early = [s.title, ...s.story.flatMap((b) => [b.say, b.show]), ...s.body.slice(0, -1).flatMap((b) => [b.say, b.show])].join(' \n ')
    const hit = sale.find((w) => wordRe(w).test(early))
    if (hit) say(`Sale words ("${hit}") come before the last beat.`)
  }

  // The place: nothing its deny list rules out.
  if (place) {
    const hit = place.deny.filter(Boolean).find((w) => wordRe(w).test(joined))
    if (hit) say(`At ${place.name} there is no "${hit}" (${place.accessNotes || 'see the place notes'}).`)
  }

  // Not travelling: no flying, checking in or landing today.
  if (!c.reality.isTraveling) {
    for (const t of text) { const re = TRAVEL_NOW.find((r) => r.test(t)); if (re) { say(`It says the creator is travelling right now ("${(t.match(re) || [''])[0]}"), and they are not.`); break } }
  }

  // One person on camera.
  if (c.reality.onePersonPerVideo && c.reality.cast.length > 1) {
    for (const b of [...s.story, ...s.body]) {
      const seen = c.reality.cast.filter((p) => wordRe(p.name).test(b.show)).map((p) => p.name)
      const others2 = seen.filter((n) => n !== s.host)
      if (seen.length >= 2 || others2.length) { say(`A shot puts ${others2.length ? others2.join(' and ') : seen.join(' and ')} on camera; only ${s.host} is filmed in this one.`); break }
      if (/\b(both of us|the two of us|together on camera|side by side)\b/i.test(b.show)) { say('A shot puts two people on camera; one person is filmed per video.'); break }
    }
  }

  // Claims: only approved ones.
  const ids = new Set(R.approvedClaims.map((x) => x.id))
  for (const b of s.body) for (const id of b.claimIds) if (!ids.has(id)) { say(`It uses a claim that is not in the approved list (${id}).`); break }

  // Repeats across the campaign. A script that already broke a rule does not
  // count against the others, and within a round (skipLater) the later
  // number of two copies is the one flagged: only the copy, never both.
  for (const o of others) {
    if (o.idx === s.idx || o.checks?.state === 'red' || (opts.skipLater && o.idx > s.idx)) continue
    if (norm(o.title) && norm(o.title) === norm(s.title)) { say(`Same title as #${o.idx}.`); break }
    if (o.story[0] && s.story[0] && norm(o.story[0].say) === norm(s.story[0].say)) { say(`Same opening line as #${o.idx}.`); break }
    if (norm(bodyText(o)) && norm(bodyText(o)) === norm(bodyText(s))) { say(`Same product part as #${o.idx}.`); break }
    const near = Math.max(likeness(openText(o), openText(s)), likeness(bodyText(o), bodyText(s)))
    if (near > TOO_ALIKE) { say(`Too close to #${o.idx} (${Math.round(near * 100)}% alike).`); break }
  }

  // Length: a warning only.
  const [lo, hi] = R.targetLengthSec
  if (s.estSeconds && (s.estSeconds < lo || s.estSeconds > hi)) warnings.push(`About ${s.estSeconds} seconds, outside ${lo} to ${hi}.`)

  return { state: reasons.length ? 'red' : warnings.length ? 'amber' : 'green', reasons: Array.from(new Set(reasons)), warnings }
}

// ── The prompts ──────────────────────────────────────────────────────────────

export function writerSystem(): string {
  return `You write shoot-ready story-time UGC scripts for a creator's brand challenge: many unique short videos for one product, each one approved by the brand. Write like a friend telling a story, never like an ad.

THE RULES, ALL OF THEM, IN EVERY SCRIPT:
1. STORY FIRST. When PRODUCT DELAY is above 0, the story beats run at least that many seconds (about 2.5 spoken words a second) and never name the product, its brand or its category, and never show the product or anything tied to it (the listed objects). Open with a real moment, a travel moment or a problem told the way you would tell a friend.
2. EVERY LINE MAKES PHYSICAL SENSE. Each place's access notes and banned words are the truth about what the creator can stand next to and film. When the creator is NOT TRAVELLING, nobody flies, checks in, boards or lands today: they are there dropping someone off, watching, remembering a past trip, or getting ready for one. A product demo then shows a past trip or a drop-off (for example the product paired to the creator's phone, in a family member's bag).
3. ONE PERSON ON CAMERA when asked: only the host is ever in a shot. Others may be talked about, never filmed.
4. ONLY APPROVED CLAIMS. State no feature or benefit that is not in APPROVED CLAIMS, and tag every product beat with the ids of the claims it uses (an empty list for a beat with none).
5. SHOW WHAT YOU SAY. The "show" of every product claim demonstrates it (a live map line pairs with a live map screen recording). When app footage may be reused, say "screen recording from a past trip".
6. REAL STORIES. Set "realStory": true whenever a script tells a specific past event or names a real person. Those are shot only if true.
7. THE PRODUCT BEAT SOUNDS NATURAL ("Anyway, that's why I keep a ___ in my bag now") and the CTA is soft ("It's linked below"). Sale words, only when the brief allows them, go only in the last beat.
8. SPELL THE PRODUCT EXACTLY as given, every time. Never use a NEVER SAY word. Never use a BANNED word.
9. EVERY SCRIPT IS NEW: a different title, a different first line, a different story from every script listed under ALREADY WRITTEN and from each other. Signature hooks are used sparingly: at most one script in four opens with one.
10. NO FLUFF. Every line hooks, sets the moment, moves the story, shows the product working, or asks. Keep the length asked.

Each script follows its SLOT exactly: its index, place, host and angle.

${BANNED_RULE}

Answer with JSON only, in this shape:
{"scripts":[{"index":12,"title":"also the on-screen text for the first 2 seconds, under 9 words","angle":"from the slot","host":"from the slot","location":"from the slot","realStory":false,"realityReason":"why the host is at this place today, true to the travel rule","story":[{"say":"spoken words","show":"what the camera sees"}],"body":[{"say":"spoken words","show":"what the camera sees","claimIds":["c1"]}]}]}
Story: 3 to 5 beats. Body: the product beat first, then demos, then the soft CTA.`
}

function campaignBlock(c: Campaign): string {
  const R = c.rules, P = c.product, X = c.reality
  return [
    `PRODUCT: ${P.name} (spell exactly so${casedWords(P).length ? `; always ${casedWords(P).join(', ')} in these capitals` : ''})`,
    P.neverSay.length ? `NEVER SAY: ${P.neverSay.join(', ')}` : '',
    P.categoryWords.length ? `CATEGORY WORDS (kept out of the story): ${P.categoryWords.join(', ')}` : '',
    P.showDeny.length ? `PRODUCT-RELATED OBJECTS (never in the story's shots): ${P.showDeny.join(', ')}` : '',
    `PRODUCT DELAY: ${R.productDelaySec} seconds`,
    `APPROVED CLAIMS:\n${R.approvedClaims.map((x) => `- ${x.id}: ${x.text}`).join('\n') || '- none given: describe what it is, claim nothing'}`,
    R.bannedTerms.length ? `BANNED: ${R.bannedTerms.join(', ')}` : '',
    R.noPrices ? 'No prices or money amounts.' : '',
    R.noPercentOff ? 'No percentages.' : '',
    `SALE LANGUAGE: ${R.saleLanguageRule || 'only generic words, only in the last beat'}`,
    `LENGTH: ${R.targetLengthSec[0]} to ${R.targetLengthSec[1]} seconds`,
    R.safeZoneNotes ? `FRAMING: ${R.safeZoneNotes}` : '',
    `PLACES:\n${X.locations.map((l) => `- ${l.name}: ${l.accessNotes || 'no notes'}${l.deny.length ? `. Not here: ${l.deny.join(', ')}` : ''}`).join('\n')}`,
    `TRAVELLING TODAY: ${X.isTraveling ? 'yes' : 'NO: nobody flies, checks in, boards or lands today'}`,
    `CAST: ${X.cast.map((p) => `${p.name}${p.phone ? ` (${p.phone})` : ''}`).join(', ')}${X.onePersonPerVideo ? '. ONE PERSON ON CAMERA per video.' : ''}`,
    X.appFootageReuse ? 'App demo shots may be a screen recording from a past trip; label them so.' : '',
    c.creatorFacts.length ? `ABOUT THE CREATOR (true, use freely):\n${c.creatorFacts.map((f) => `- ${f}`).join('\n')}` : '',
    `ANGLES: ${c.angles.join(', ')}`,
    c.hooks.length ? `SIGNATURE HOOKS (sparingly): ${c.hooks.join(' | ')}` : '',
    c.references ? `THE BRAND'S OWN STARTER SCRIPTS (style only, never copied):\n${c.references.slice(0, 6000)}` : '',
    c.feedback ? `BRAND FEEDBACK: ${c.feedback.slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n\n')
}

/** One script's line in ALREADY WRITTEN. */
export function summaryOf(s: Pick<Script, 'idx' | 'title' | 'angle' | 'location' | 'story'>): string {
  return `#${s.idx} | ${s.title} | ${s.angle} | ${s.location} | ${(s.story[0]?.say || '').slice(0, 110)}`
}

export function writerPrompt(c: Campaign, slots: Slot[], written: Array<Pick<Script, 'idx' | 'title' | 'angle' | 'location' | 'story'>>, fixes?: Array<{ idx: number; reasons: string[]; instruction?: string; previous?: Pick<Script, 'title' | 'story' | 'body'> }>): string {
  const fixFor = new Map((fixes || []).map((f) => [f.idx, f]))
  return [
    campaignBlock(c),
    written.length ? `ALREADY WRITTEN (do not repeat a title, an opening or a story):\n${written.slice(-300).map(summaryOf).join('\n')}` : '',
    `SLOTS (write one script for each):\n${slots.map((s) => {
      const f = fixFor.get(s.idx)
      const fix = f ? `\n  REWRITE: the last version broke these rules: ${f.reasons.join(' ')}${f.instruction ? `\n  CREATOR'S NOTE: ${f.instruction}` : ''}${f.previous ? `\n  LAST VERSION'S TITLE: ${f.previous.title}` : ''}` : ''
      return `- index ${s.idx}: place "${s.location}", host "${s.host}", angle "${s.angle}"${fix}`
    }).join('\n')}`,
  ].filter(Boolean).join('\n\n')
}

/** The scripts the model wrote, matched to their slots and cleaned. Pure. */
export function parseScripts(text: string, slots: Slot[]): Array<Omit<Script, 'status' | 'link' | 'notes' | 'checks' | 'tries'>> {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return []
  let j: { scripts?: unknown }
  try { j = JSON.parse(m[0]) } catch { return [] }
  const arr = Array.isArray(j.scripts) ? j.scripts as Array<Record<string, unknown>> : []
  const bySlot = new Map(slots.map((s) => [s.idx, s]))
  const out: Array<Omit<Script, 'status' | 'link' | 'notes' | 'checks' | 'tries'>> = []
  for (const r of arr) {
    const slot = bySlot.get(Number(r.index))
    if (!slot || out.some((o) => o.idx === slot.idx)) continue
    const beats = (v: unknown) => (Array.isArray(v) ? v : []).slice(0, 8).map((b) => ({ say: clean((b as Beat)?.say, 400), show: clean((b as Beat)?.show, 300) })).filter((b) => b.say || b.show)
    const story = beats(r.story)
    const body = (Array.isArray(r.body) ? r.body : []).slice(0, 8).map((b) => ({ say: clean((b as BodyBeat)?.say, 400), show: clean((b as BodyBeat)?.show, 300), claimIds: list((b as BodyBeat)?.claimIds, 6, 20) })).filter((b) => b.say || b.show)
    out.push({
      idx: slot.idx, title: clean(r.title, 90), angle: slot.angle, host: slot.host, location: slot.location,
      realStory: r.realStory === true, realityReason: clean(r.realityReason, 240), story, body, estSeconds: estimateSeconds(story, body),
    })
  }
  return out
}

// ── A round ──────────────────────────────────────────────────────────────────

export type Ask = (system: string, user: string) => Promise<string>

export interface RoundResult {
  scripts: Script[]
  /** Scripts the model never returned for their slot (said, not hidden). */
  missing: number
  calls: number
}

/** Write the next `count` scripts: one call, the rule check, up to two
 *  rewrites of what broke a rule, and whatever still fails flagged red with
 *  its reasons. `existing`: the campaign's scripts so far. */
export async function runRound(c: Campaign, existing: Script[], count: number, ask: Ask, opts: { budgetMs?: number; now?: () => number } = {}): Promise<RoundResult> {
  const now = opts.now || Date.now
  const started = now()
  const budget = opts.budgetMs ?? 200_000
  const slots = planSlots(c, existing, Math.max(0, Math.min(count, BATCH_ROUND)))
  if (!slots.length) return { scripts: [], missing: 0, calls: 0 }
  let calls = 0
  const done = new Map<number, Script>()
  // Every script of the round checked again, in number order, against the
  // campaign and the rest of the round: a script checked while its original
  // was still broken is caught once the original is fixed.
  const recheck = () => {
    for (const s of slots) {
      const d = done.get(s.idx)
      if (!d) continue
      const others = [...existing, ...Array.from(done.values()).filter((x) => x.idx !== d.idx && !(x.idx > d.idx))]
      done.set(d.idx, { ...d, checks: checkScript(d, c, others, { skipLater: true }) })
    }
  }
  const settle = (drafts: ReturnType<typeof parseScripts>, tries: number) => {
    for (const d of drafts) done.set(d.idx, { ...d, status: 'draft', link: null, notes: null, tries, checks: { state: 'green', reasons: [], warnings: [] } })
    recheck()
  }
  calls++
  settle(parseScripts(await ask(writerSystem(), writerPrompt(c, slots, existing)), slots), 0)
  for (let round = 1; round <= MAX_REWRITES; round++) {
    const bad = slots.filter((s) => !done.has(s.idx) || done.get(s.idx)!.checks.state === 'red')
    if (!bad.length || now() - started > budget) break
    const fixes = bad.filter((s) => done.has(s.idx)).map((s) => ({ idx: s.idx, reasons: done.get(s.idx)!.checks.reasons, previous: done.get(s.idx)! }))
    const written = [...existing, ...Array.from(done.values()).filter((x) => x.checks.state !== 'red')]
    calls++
    const again = parseScripts(await ask(writerSystem(), writerPrompt(c, bad, written, fixes)), bad)
    // A rewrite only replaces a script it improves on.
    const before = new Map(Array.from(done.entries()))
    settle(again, round)
    for (const d of again) {
      const was = before.get(d.idx)
      const now2 = done.get(d.idx)!
      if (was && now2.checks.state === 'red' && was.checks.reasons.length < now2.checks.reasons.length) done.set(d.idx, { ...was, tries: round })
    }
    recheck()
  }
  const scripts = slots.map((s) => done.get(s.idx)).filter((x): x is Script => !!x)
  return { scripts, missing: slots.length - scripts.length, calls }
}

// ── Reading a campaign the page sent ─────────────────────────────────────────

/** A campaign from anything the page sent, every field cleaned. Pure. */
export function readCampaign(raw: unknown, id = ''): Campaign {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const p = (o.product && typeof o.product === 'object' ? o.product : {}) as Record<string, unknown>
  const r = (o.rules && typeof o.rules === 'object' ? o.rules : {}) as Record<string, unknown>
  const x = (o.reality && typeof o.reality === 'object' ? o.reality : {}) as Record<string, unknown>
  const base = emptyRules()
  const len = Array.isArray(r.targetLengthSec) ? r.targetLengthSec.map(Number) : []
  const lo = Number.isFinite(len[0]) && len[0] > 0 ? Math.round(len[0]) : base.targetLengthSec[0]
  const hi = Number.isFinite(len[1]) && len[1] >= lo ? Math.round(len[1]) : Math.max(lo, base.targetLengthSec[1])
  const claims = (Array.isArray(r.approvedClaims) ? r.approvedClaims : []).slice(0, 40).map((c, i) => {
    const cc = (c && typeof c === 'object' ? c : { text: c }) as Record<string, unknown>
    const cid = String(cc.id || `c${i + 1}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || `c${i + 1}`
    return { id: cid, text: clean(cc.text, 200) }
  }).filter((c) => c.text)
  const seen = new Set<string>()
  for (const c of claims) { if (seen.has(c.id)) c.id = `${c.id}x${seen.size}`; seen.add(c.id) }
  return {
    id,
    name: clean(o.name, 80) || 'Batch scripts',
    brandId: typeof o.brandId === 'string' && /^[A-Za-z0-9_-]{4,80}$/.test(o.brandId) ? o.brandId : null,
    product: { name: clean(p.name, 80), mustSpell: list(p.mustSpell, 6, 40), neverSay: list(p.neverSay, 20, 60), categoryWords: list(p.categoryWords, 12, 40), showDeny: list(p.showDeny, 20, 40) },
    rules: {
      approvedClaims: claims,
      bannedTerms: list(r.bannedTerms, 60, 60),
      noPrices: r.noPrices !== false,
      noPercentOff: r.noPercentOff !== false,
      saleLanguageRule: clean(r.saleLanguageRule, 300),
      saleWords: Array.isArray(r.saleWords) ? list(r.saleWords, 40, 40) : [...base.saleWords],
      targetLengthSec: [lo, Math.min(hi, 180)],
      safeZoneNotes: clean(r.safeZoneNotes, 400),
      productDelaySec: Math.max(0, Math.min(30, Math.round(Number(r.productDelaySec) || 0))),
    },
    reality: {
      locations: (Array.isArray(x.locations) ? x.locations : []).slice(0, 12).map((l) => {
        const ll = (l && typeof l === 'object' ? l : { name: l }) as Record<string, unknown>
        return { name: clean(ll.name, 60), accessNotes: clean(ll.accessNotes, 300), deny: list(ll.deny, 30, 40) }
      }).filter((l) => l.name),
      isTraveling: x.isTraveling === true,
      cast: (Array.isArray(x.cast) ? x.cast : []).slice(0, 6).map((m) => {
        const mm = (m && typeof m === 'object' ? m : { name: m }) as Record<string, unknown>
        return { name: clean(mm.name, 40), phone: clean(mm.phone, 30) }
      }).filter((m) => m.name),
      onePersonPerVideo: x.onePersonPerVideo !== false,
      appFootageReuse: x.appFootageReuse === true,
    },
    creatorFacts: list(o.creatorFacts, 15, 160),
    angles: list(o.angles, 12, 40).length ? list(o.angles, 12, 40) : [...DEFAULT_ANGLES],
    hooks: Array.isArray(o.hooks) ? list(o.hooks, 20, 80) : [...DEFAULT_HOOKS],
    references: String(o.references ?? '').slice(0, 8000),
    feedback: clean(o.feedback, 1500),
    target: Math.max(1, Math.min(MAX_PER_CAMPAIGN, Math.round(Number(o.target) || DEFAULT_TARGET))),
    deadline: typeof o.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.deadline) ? o.deadline : null,
  }
}

/** What a campaign still needs before it can write, in words (empty: ready). Pure. */
export function notReadyWords(c: Campaign): string[] {
  const out: string[] = []
  if (!c.product.name) out.push('the product name')
  if (!c.reality.locations.length) out.push('at least one place to film')
  if (!c.reality.cast.length) out.push('who is on camera')
  if (!c.rules.approvedClaims.length) out.push('the approved claims (from the brief)')
  return out
}

// ── Places: the deny words worth suggesting ──────────────────────────────────

/** Words a place usually rules out, suggested from its name and notes. Pure. */
export function suggestDeny(p: Pick<Place, 'name' | 'accessNotes'>): string[] {
  const t = `${p.name} ${p.accessNotes}`.toLowerCase()
  if (/airport/.test(t) && /before security|landside|check-?in/.test(t)) return ['gate', 'duty free', 'jet bridge', 'baggage claim', 'carousel', 'boarding', 'on the plane', 'plane window', 'lounge', 'runway']
  if (/ferry/.test(t)) return ['on board', 'onboard', 'deck', 'cabin']
  return []
}

// ── The rules from a brief ───────────────────────────────────────────────────

export const RULES_SYSTEM = `You read a brand's creator brief and pull out the rules a script writer must follow. Use only what the brief says; never invent a claim.
Answer with JSON only:
{"approvedClaims":[{"id":"c1","text":"one feature or claim scripts may state, in plain words"}],"bannedTerms":["words or names the brief forbids"],"noPrices":true,"noPercentOff":true,"saleLanguageRule":"when sale language is allowed, in the brief's words, or empty","targetLengthSec":[25,45],"safeZoneNotes":"aspect ratio, safe zones, captions, or empty","productDelaySec":0,"neverSay":["product names or competitors never to say"],"mustSpell":["brand words with required capitals"],"categoryWords":["the product's category words"]}
productDelaySec: the seconds before the product, the brand or the category may appear, when the brief says so, else 0.`

/** The rules a brief gave, as far as they read, folded onto what the creator
 *  already has (the creator's own entries are kept). Pure. */
export function rulesFromReply(text: string, had: Campaign): Campaign {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return had
  let j: Record<string, unknown>
  try { j = JSON.parse(m[0]) } catch { return had }
  const merged = readCampaign({
    ...had,
    product: {
      ...had.product,
      neverSay: Array.from(new Set([...had.product.neverSay, ...list(j.neverSay, 20, 60)])),
      mustSpell: had.product.mustSpell.length ? had.product.mustSpell : list(j.mustSpell, 6, 40),
      categoryWords: Array.from(new Set([...had.product.categoryWords, ...list(j.categoryWords, 12, 40)])),
    },
    rules: {
      ...had.rules,
      approvedClaims: Array.isArray(j.approvedClaims) && j.approvedClaims.length ? j.approvedClaims : had.rules.approvedClaims,
      bannedTerms: Array.from(new Set([...had.rules.bannedTerms, ...list(j.bannedTerms, 60, 60)])),
      noPrices: j.noPrices === false ? had.rules.noPrices : true,
      noPercentOff: j.noPercentOff === false ? had.rules.noPercentOff : true,
      saleLanguageRule: clean(j.saleLanguageRule, 300) || had.rules.saleLanguageRule,
      targetLengthSec: Array.isArray(j.targetLengthSec) ? j.targetLengthSec : had.rules.targetLengthSec,
      safeZoneNotes: clean(j.safeZoneNotes, 400) || had.rules.safeZoneNotes,
      productDelaySec: Number.isFinite(Number(j.productDelaySec)) && Number(j.productDelaySec) > 0 ? Number(j.productDelaySec) : had.rules.productDelaySec,
    },
  }, had.id)
  return merged
}

// ── Pace ─────────────────────────────────────────────────────────────────────

/** "X accepted of N" and the pace to the deadline. Pure. */
export function paceWords(c: Pick<Campaign, 'target' | 'deadline'>, scripts: Array<Pick<Script, 'status'>>, today: Date = new Date()): { accepted: number; line: string } {
  const accepted = scripts.filter((s) => s.status === 'accepted').length
  const left = Math.max(0, c.target - accepted)
  let line = `${accepted} accepted of ${c.target}.`
  if (c.deadline && left > 0) {
    const days = Math.ceil((Date.parse(`${c.deadline}T23:59:59Z`) - today.getTime()) / 86_400_000)
    const on = new Date(`${c.deadline}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
    line += days > 0 ? ` You need ${Math.ceil(left / days)} a day to reach ${c.target} by ${on}.` : ` The deadline (${on}) has passed with ${left} to go.`
  } else if (left === 0) line += ' Target reached.'
  return { accepted, line }
}
