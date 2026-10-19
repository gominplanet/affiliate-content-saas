// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FACTS ONLY ON A THUMBNAIL (Seb, 2026-10-19: "titles cannot invent situations
// or facts or results or tests.. mvp needs to base itself on actual facts from
// the user").
//
// The art director is told to write only from the facts. This is the check
// after it, because a model told not to invent still writes "SPOILER: YES!",
// "4-IN-1 CONFIRMED!", "ALL SEASON LONG" and "GLOW ALL NIGHT", none of which
// the video said. Two kinds of word are checked against the facts MVP had (the
// creator's own words from the video or post, the video title, and the
// product listing):
//
//   A verdict, a test, a time span or a guarantee. Allowed only when the facts
//   say it too: "TESTED" needs the creator to have tested it.
//   A number. Allowed only when that number is in the facts: "77 LBS" needs
//   77 somewhere in the listing or the video.
//
// The creator's own text is never checked: those are their facts. Pure.

/** Words that claim something happened or was proven. Each is allowed only
 *  when the facts contain it. Matched as whole words, case-insensitive. */
const CLAIMS: Array<{ re: RegExp; needs: RegExp; says: string }> = [
  { re: /\bconfirm(ed|s)?\b/i, needs: /\bconfirm/i, says: 'CONFIRMED' },
  { re: /\bprove[dn]?\b|\bproof\b/i, needs: /\bprove|\bproof\b/i, says: 'PROVEN' },
  { re: /\btested\b|\btest(ing)?\b/i, needs: /\btest/i, says: 'TESTED' },
  { re: /\bverified\b/i, needs: /\bverif/i, says: 'VERIFIED' },
  { re: /\bspoiler\b/i, needs: /\bspoiler\b/i, says: 'SPOILER' },
  { re: /\bverdict\b/i, needs: /\bverdict\b/i, says: 'VERDICT' },
  { re: /\bresults?\b/i, needs: /\bresults?\b/i, says: 'RESULTS' },
  { re: /\bguarantee[ds]?\b/i, needs: /\bguarantee/i, says: 'GUARANTEED' },
  { re: /(^|\s)(yes|no)\s*!/i, needs: /$^/, says: 'a YES! or NO! answer' },
  { re: /\ball\s+(night|day|season|week|year|summer|winter|month)\b/i, needs: /\ball\s+(night|day|season|week|year|summer|winter|month)\b/i, says: 'a time span like ALL NIGHT' },
  { re: /\b24\s*\/\s*7\b/, needs: /\b24\s*\/\s*7\b/, says: '24/7' },
  { re: /\b(long[\s-]?term|forever)\b/i, needs: /\b(long[\s-]?term|forever)\b/i, says: 'LONG TERM' },
  { re: /\b(days|weeks|months|years)\s+later\b/i, needs: /\b(days|weeks|months|years)\s+later\b/i, says: 'a time span like WEEKS LATER' },
  { re: /\bafter\s+\d+\s*(day|week|month|year|hour)s?\b/i, needs: /\bafter\s+\d+\s*(day|week|month|year|hour)s?\b/i, says: 'a time span like AFTER 30 DAYS' },
  { re: /\bbefore\s*(&|and|vs\.?)\s*after\b/i, needs: /\bbefore\s*(&|and|vs\.?)\s*after\b/i, says: 'BEFORE AND AFTER' },
  { re: /\b(i|we)\s+(tried|used)\b/i, needs: /\b(tried|used)\b/i, says: 'I TRIED' },
  { re: /#\s?1\b|\bnumber\s+one\b|\bbest\s+ever\b/i, needs: /#\s?1\b|\bnumber\s+one\b|\bbest\s+ever\b/i, says: '#1 or BEST EVER' },
]

/** The facts as one lower-cased text, numbers kept as they are written. */
export function factsText(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join('\n').toLowerCase()
}

/** Numbers in a text: "77 LBS", "4-IN-1", "8HR", "12.2". */
function numbersIn(text: string): string[] {
  return Array.from(new Set((text.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.'))))
}

/** Why this text is not backed by the facts, one reason per problem, or []
 *  when it is. Empty text is fine. Pure. */
export function unsupportedClaims(text: string, facts: string): string[] {
  const t = String(text || '').trim()
  if (!t) return []
  const f = String(facts || '').toLowerCase()
  const out: string[] = []
  for (const c of CLAIMS) {
    if (c.re.test(t) && !c.needs.test(f)) out.push(`says ${c.says}, which nothing in the video, post or listing says`)
  }
  const factNums = new Set(numbersIn(f))
  for (const n of numbersIn(t)) {
    if (!factNums.has(n)) out.push(`says ${n}, a number that is not in the video, post or listing`)
  }
  return out
}

/** One brief's text after the check: the one extra kept only when backed,
 *  why the headline is not backed ('' when it is), and what was changed, in
 *  words, for the screen. The headline itself is swapped by factCheckBriefs,
 *  which can see the other briefs. Pure. */
export interface FactCheckedText { badge: string; callouts: string[]; notes: string[]; headlineWhy: string }

export function checkBriefText(
  b: { line1: string; line2: string; badge?: string; callouts?: string[] },
  facts: string,
  opts: { lockedHeadline?: boolean } = {},
): FactCheckedText {
  const notes: string[] = []
  const headline = `${b.line1} ${b.line2}`.trim()
  const headWhy = opts.lockedHeadline ? [] : unsupportedClaims(headline, facts)
  const badge = String(b.badge || '').trim()
  const badgeWhy = unsupportedClaims(badge, facts)
  if (badge && badgeWhy.length) notes.push(`Left out the badge "${badge}": it ${badgeWhy[0]}.`)
  const callouts: string[] = []
  for (const c of (b.callouts || [])) {
    const why = unsupportedClaims(c, facts)
    if (why.length) notes.push(`Left out "${c}": it ${why[0]}.`)
    else callouts.push(c)
  }
  return { badge: badgeWhy.length ? '' : badge, callouts, notes, headlineWhy: headWhy[0] || '' }
}

/** The headline used when no brief wrote one the facts back. Says nothing
 *  happened, so it can never be wrong about the video. */
export const SAFE_HEADLINE = {
  statement: { line1: 'WHAT YOU', line2: 'ACTUALLY GET' },
  question: { line1: 'IS IT', line2: 'ANY GOOD?' },
} as const

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

/** The concept is prose the image model follows closely, so a phrase it
 *  quotes in capitals is a phrase it may draw. One that is not the headline
 *  or the one extra goes, because the only words on the design are those. Returns
 *  the cleaned concept and the quotes that claimed something unbacked. */
export function cleanConcept(concept: string, allowedText: string, facts: string): { concept: string; dropped: string[] } {
  const allowed = ` ${squash(allowedText)} `
  const dropped: string[] = []
  const out = String(concept || '').replace(/"([^"\n]{1,80})"|“([^”\n]{1,80})”/g, (whole, a?: string, b?: string) => {
    const q = (a ?? b ?? '').trim()
    const s = squash(q)
    // Only words written as they would be drawn: in capitals, like every
    // headline here. A lowercase quote ("a pop-art feel") describes a look.
    if (!s || /[a-z]/.test(q) || !/[A-Z0-9]/.test(q) || allowed.includes(` ${s} `)) return whole
    if (unsupportedClaims(q, facts).length) dropped.push(q)
    return s.includes(' ') ? 'the headline' : 'the key word'
  })
  return { concept: out, dropped }
}

/** Every brief, checked: an unbacked headline is swapped for another brief's
 *  backed one, or for SAFE_HEADLINE when none is, an unbacked extra is left
 *  out rather than replaced, and the concept loses quotes of words that are
 *  no longer on the design. textNotes says what changed and why. Pure. */
export function factCheckBriefs<B extends { line1: string; line2: string; emphasisWord?: string; badge?: string; callouts?: string[]; concept?: string }>(
  briefs: B[],
  facts: string,
  opts: { lockedHeadline?: boolean; question?: boolean } = {},
): Array<B & { textNotes: string[] }> {
  const checked = briefs.map((b) => ({ b, c: checkBriefText(b, facts, opts) }))
  const backed = checked.filter((x) => !x.c.headlineWhy).map((x) => x.b)
  let next = 0
  return checked.map(({ b, c }) => {
    const notes = [...c.notes]
    let { line1, line2 } = b
    let emphasisWord = b.emphasisWord ?? ''
    if (c.headlineWhy) {
      const swap = backed.length ? backed[next++ % backed.length] : null
      const safe = opts.question ? SAFE_HEADLINE.question : SAFE_HEADLINE.statement
      line1 = swap ? swap.line1 : safe.line1
      line2 = swap ? swap.line2 : safe.line2
      emphasisWord = swap ? (swap.emphasisWord ?? '') : ''
      notes.push(`Did not use the headline "${`${b.line1} ${b.line2}`.trim()}": it ${c.headlineWhy}. Used "${`${line1} ${line2}`.trim()}" instead.`)
    }
    const kept = [line1, line2, c.badge, ...c.callouts].join(' ')
    const concept = cleanConcept(b.concept ?? '', kept, facts)
    for (const q of concept.dropped) notes.push(`Took "${q}" out of the design description: nothing in the video, post or listing says it.`)
    return { ...b, line1, line2, emphasisWord, badge: c.badge, callouts: c.callouts, concept: concept.concept, textNotes: notes }
  })
}
