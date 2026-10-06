// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE shared "clickable title" directive for every title MVP writes (YouTube
// long-form titles, blog post titles, comparison / buying-guide titles), so the
// house style is consistent instead of drifting per prompt.
//
// The rule: questions in titles are proven to lift click-through, so a healthy
// share of every title set must be a QUESTION. Titles that are not questions
// must still use a proven "clickable framing" — the four families below and
// their variations — never a flat, descriptive label.
//
// The families are patterns to VARY, not strings to copy. Copying one verbatim
// across many videos is exactly the templated sameness we want to avoid.
//
// Hard rule carried everywhere (product + writing): NEVER inject a calendar
// year into a title. Titles must stay evergreen.

/** The four clickable framing families, each with several worded variations so
 *  the model has a spread to draw from and never repeats one exact phrasing. */
export const CLICKABLE_FRAMINGS: ReadonlyArray<{ family: string; examples: string[] }> = [
  {
    family: 'Explore the features',
    examples: [
      'Exploring Every Feature of {X}',
      'A Full Walkthrough of {X}',
      'Inside {X}: Every Feature, Tested',
      'What {X} Can Actually Do',
    ],
  },
  {
    family: 'Test the "best" claim',
    examples: [
      'Testing Why {X} Might Be the Best {category}',
      'Is {X} Really the Best {category}? I Put It to the Test',
      'Putting {X} to the Test',
      'Why {X} Could Be the Best {category} Right Now',
    ],
  },
  {
    family: 'How to use it',
    examples: [
      'How to Use {X} Like a Pro',
      'How to Set Up {X} the Right Way',
      'How to Get the Most Out of {X}',
      'The Right Way to Use {X}',
    ],
  },
  {
    family: 'Everything you must know',
    examples: [
      'Everything You Need to Know About {X}',
      'What You Must Know Before Buying {X}',
      '{X} Explained: What Nobody Shows You',
      'The Complete Guide to {X}',
    ],
  },
]

/** Question framings — the highest-CTR shape. Worded to steer clear of the
 *  overused openings other prompts already ban ("Worth It?", "Before You Buy"). */
export const QUESTION_FRAMINGS: readonly string[] = [
  'Is {X} Really the Best {category}?',
  'Does {X} Actually Work?',
  'Can {X} Replace Your {alternative}?',
  'Should You Buy {X}?',
  'What Makes {X} Different?',
  'How Good Is {X}, Really?',
  'Is {X} the {category} to Beat?',
]

function list(items: readonly string[]): string {
  return items.map(s => `"${s}"`).join(' · ')
}

/**
 * Directive for a SET of YouTube long-form titles (the 5-option strategist).
 * Requires a question share plus clickable framings for the rest, with no two
 * titles sharing a framing family.
 */
export function clickableTitleRulesForYouTube(count = 5): string {
  const minQuestions = Math.max(1, Math.ceil(count * 0.6))
  return `TITLE STYLE (required mix — questions are PROVEN to lift click-through):
- The "best" title (the one pre-selected for the creator) MUST be a QUESTION. Questions lead; statements are the alternates.
- At least ${minQuestions} of the ${count} titles MUST be a QUESTION the viewer wants answered, ending with "?". Ground it in a real feature, claim or pain point. Shapes to VARY (never copy verbatim): ${list(QUESTION_FRAMINGS)}.
- EVERY title that is NOT a question MUST use one of these clickable framings — never a flat descriptive label. Vary the exact wording every time; the examples are patterns, not strings to reuse:
${CLICKABLE_FRAMINGS.map(f => `  • ${f.family}: ${list(f.examples)}`).join('\n')}
- No two of the ${count} titles may share the same framing family. Spread across families and the question shapes.
- Replace {X} with the real product name, {category} with its true product category, and {alternative} with what it replaces. Never leave a placeholder in.
- NEVER put a calendar year in any title. Titles must stay evergreen.
- ONE WORD IN CAPITALS. Every title puts the single word that carries its point in ALL CAPS, for emphasis (two words only when they are one idea, like "NOT WORK"). The rest stays in normal title case. Pick the word a viewer would stress out loud: the verb, the surprise, the doubt. Never the brand or product name, never a whole phrase. Examples: "Can You HEAR the Difference in Sound?", "It Did NOT WORK the First Time? Why?", "Home Blood Pressure Monitor but Is It EASY to Use?"`
}

// ── ONE WORD IN CAPITALS (YouTube titles from Co-Pilot and Liftoff) ─────────
// Seb's rule: every YouTube title MVP writes stresses one word in ALL CAPS
// ("Can You HEAR the Difference in Sound?"). The prompt asks for it; this
// makes sure of it, because a model asked for one thing among twenty forgets
// it now and then. Acronyms and model codes (LED, USB, 4K, X200) are not
// emphasis, so a title whose only capitals are those still gets a word.

const ACRONYMS = new Set([
  'USB', 'LED', 'LEDS', 'LCD', 'OLED', 'QLED', 'TV', 'TVS', 'HD', 'UHD', 'FHD', 'AI', 'PC', 'PCS', 'RGB', 'HDMI', 'SSD', 'HDD', 'GPS',
  'DIY', 'UV', 'AC', 'DC', 'BBQ', 'XL', 'XXL', 'XS', 'ANC', 'APP', 'IOS', 'MAC', 'RV', 'ATV', 'UTV', 'EV', 'MPH', 'PSI', 'BPA', 'FAQ',
  'NFC', 'VR', 'AR', 'CPU', 'GPU', 'RAM', 'DSLR', 'USA', 'US', 'UK', 'EU', 'OK', 'ID', 'IP', 'WIFI', 'NBA', 'NFL', 'MLB', 'DJ', 'ASMR',
  'POV', 'ROI', 'SPF', 'CBD', 'MAX', 'PRO', 'II', 'III', 'IV', 'TWS', 'IPX', 'PD', 'GAN', 'AAA', 'AA', 'ADHD',
])
/** Words worth stressing, in order of preference, when the model stressed none. */
const STRESS = [
  'not', 'never', 'actually', 'really', 'worth', 'wrong', 'better', 'worse', 'best', 'worst', 'easy', 'hard', 'fail', 'failed',
  'broke', 'work', 'works', 'real', 'fake', 'stop', 'every', 'only', 'nobody', 'everyone', 'secret', 'surprised', 'shocked',
  'hear', 'see', 'feel', 'smell', 'taste', 'quiet', 'loud', 'fast', 'slow', 'cheap', 'premium', 'tiny', 'huge', 'strong', 'last',
]
const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'it', 'its', "it's", 'this', 'that', 'my', 'your', 'i', 'you', 'we', 'vs', 'so', 'do', 'does', 'did', 'be', 'are', 'was', 'can', 'will', 'how', 'why', 'what', 'who', 'when'])

const core = (w: string) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9']+$/g, '')
const isEmphasis = (w: string) => {
  const c = core(w)
  const letters = c.replace(/[^A-Za-z]/g, '')
  return letters.length >= 2 && c === c.toUpperCase() && !/\d/.test(c) && !ACRONYMS.has(letters.toUpperCase())
}

/**
 * Make sure one word is in capitals. Leaves a title that already stresses a
 * word (or two) alone; turns an all-capitals title back into title case with
 * one word kept; otherwise picks the word to stress, never one from the
 * product's name. Pure.
 */
export function emphasizeOneWord(title: string, productName?: string | null): string {
  const t = String(title || '').trim()
  if (!t) return t
  const words = t.split(/(\s+)/)
  const real = words.filter((w) => /\S/.test(w) && /[A-Za-z]/.test(w))
  const stressed = real.filter(isEmphasis)
  // SHOUTED: most of the title in capitals reads as spam, not as emphasis.
  // Back to title case (acronyms kept), then one word chosen as below.
  if (real.length >= 4 && stressed.length > Math.max(2, Math.floor(real.length / 2))) {
    const calm = words.map((w) => {
      if (!/\S/.test(w) || !isEmphasis(w)) return w
      const c = core(w)
      return w.replace(c, c.charAt(0) + c.slice(1).toLowerCase())
    }).join('')
    return emphasizeOneWord(calm, productName)
  }
  if (stressed.length > 0) return t
  const named = new Set(String(productName || '').toLowerCase().split(/\s+/).map(core).filter(Boolean))
  const candidates = words.map((w, i) => ({ w, i, c: core(w).toLowerCase() }))
    .filter((x) => /\S/.test(x.w) && /^[a-z][a-z']*$/.test(x.c) && x.c.length >= 3 && !SMALL.has(x.c) && !named.has(x.c))
  if (candidates.length === 0) return t
  const pick = candidates.find((x) => STRESS.includes(x.c))
    // No stress word: the longest plain word in the second half, where the
    // point of a title usually lands, else the longest anywhere.
    || [...candidates.filter((x) => x.i >= words.length / 2)].sort((a, b) => b.c.length - a.c.length)[0]
    || [...candidates].sort((a, b) => b.c.length - a.c.length)[0]
  words[pick.i] = pick.w.replace(core(pick.w), core(pick.w).toUpperCase())
  return words.join('')
}

/**
 * Directive for a SINGLE blog post title (review / from-link). Blog titles are
 * SEO-constrained (must carry the canonical product name, ≲65 chars), so the
 * framing sits alongside the name as its "angle".
 */
export function clickableTitleRulesForBlog(): string {
  return `TITLE STYLE: the title's "angle" is THIS post's own deciding finding, not a stock framing: the specific trade-off, number, or who it is for, in the creator's words where they fit ("Quiet Enough for an Apartment, Too Small for a Family", "Half the Weight of My Old One, Same Suction"). A question is fine when it is this product's own question ("Can One Router Cover a Two-Story House?"), never a generic one that fits any product ("Does it actually work?", "Should you buy it?", "Is it really the best?"). Never "Tested:" or any claim of testing unless the post comes from the creator's own video or notes. Never a flat label such as "Review" or "Overview" alone. The same framing must not repeat across this creator's recent titles. NEVER put a calendar year in the title.`
}

/**
 * Directive for a comparison / buying-guide title, where the subject is a
 * CATEGORY rather than one product.
 */
export function clickableTitleRulesForComparison(): string {
  return `TITLE STYLE (clickable — questions are proven to lift clicks): prefer a QUESTION about the category ("Which {category} Should You Actually Buy?", "Is the Pricier {category} Really Better?") or a tested-claim framing ("Testing Which {category} Is Really the Best", "Every {category} Worth Buying, Tested", "Everything You Need to Know Before Buying a {category}"). Word it fresh — these are patterns, not strings to copy. Never a flat label like "Best {category}" alone. NEVER put a calendar year in the title.`
}
