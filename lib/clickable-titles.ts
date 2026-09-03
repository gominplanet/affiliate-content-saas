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
  const minQuestions = Math.max(1, Math.round(count * 0.4))
  return `TITLE STYLE (required mix — questions are PROVEN to lift click-through):
- At least ${minQuestions} of the ${count} titles MUST be a QUESTION the viewer wants answered, ending with "?". Ground it in a real feature, claim or pain point. Shapes to VARY (never copy verbatim): ${list(QUESTION_FRAMINGS)}.
- EVERY title that is NOT a question MUST use one of these clickable framings — never a flat descriptive label. Vary the exact wording every time; the examples are patterns, not strings to reuse:
${CLICKABLE_FRAMINGS.map(f => `  • ${f.family}: ${list(f.examples)}`).join('\n')}
- No two of the ${count} titles may share the same framing family. Spread across families and the question shapes.
- Replace {X} with the real product name, {category} with its true product category, and {alternative} with what it replaces. Never leave a placeholder in.
- NEVER put a calendar year in any title. Titles must stay evergreen.`
}

/**
 * Directive for a SINGLE blog post title (review / from-link). Blog titles are
 * SEO-constrained (must carry the canonical product name, ≲65 chars), so the
 * framing sits alongside the name as its "angle".
 */
export function clickableTitleRulesForBlog(): string {
  return `TITLE STYLE (clickable — questions are proven to lift clicks): the title's "angle" must be EITHER a question ("Is it really the best {category}?", "Does it actually work?", "Should you buy it?") OR one of these clickable framings, worded fresh each time (patterns, not strings to copy): "Exploring every feature", "Tested: why it might be the best {category}", "How to use it like a pro", "Everything you need to know". Never a flat descriptive label such as "Review" or "Overview" alone. NEVER put a calendar year in the title.`
}

/**
 * Directive for a comparison / buying-guide title, where the subject is a
 * CATEGORY rather than one product.
 */
export function clickableTitleRulesForComparison(): string {
  return `TITLE STYLE (clickable — questions are proven to lift clicks): prefer a QUESTION about the category ("Which {category} Should You Actually Buy?", "Is the Pricier {category} Really Better?") or a tested-claim framing ("Testing Which {category} Is Really the Best", "Every {category} Worth Buying, Tested", "Everything You Need to Know Before Buying a {category}"). Word it fresh — these are patterns, not strings to copy. Never a flat label like "Best {category}" alone. NEVER put a calendar year in the title.`
}
