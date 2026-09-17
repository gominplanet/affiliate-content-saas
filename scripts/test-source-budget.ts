// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does a post stay inside what its source can actually support?
//
// This exists because of a measured failure. One MVP site had 394 posts sitting
// in Google's "Crawled, currently not indexed", which is Google saying it read
// the page and decided not to spend index space on it. The prompt was asking for
// up to 3,200 words from a transcript truncated at 12,000 characters, about
// 2,000 words, so on every long post the model was told to produce a thousand
// words it had no material for. It did. That invented remainder is the most
// recognisable property of a page Google declines.
//
// The other half is about not lying to the creator. Someone who picks "Deep" and
// receives 900 words must be told their video was short, or the setting looks
// broken and they report the wrong bug.
import {
  planSourceBudget, planFaqCount, asPostLength,
  type SourceMaterial,
} from '../lib/source-budget'
import { readFileSync } from 'fs'
import { join } from 'path'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

/** N words of plausible source text. */
const src = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

// ── the failure this file exists for ────────────────────────────────────────
// A 90 second video and a request for a deep post. The old code asked for 3,200
// words from roughly 200 words of material.
{
  const b = planSourceBudget('deep', { transcript: src(200) })
  check('a thin source does not license a deep post', b.maxWords < 1000, `${b.maxWords}`)
  check('and the shortfall is admitted, not hidden', b.thin === true)
  check('with a sentence the creator can act on',
    !!b.note && /longer video/i.test(b.note), b.note ?? 'no note')
  check('the note says how much material there actually was',
    !!b.note && /200 words of source/i.test(b.note), b.note ?? 'no note')
}

// ── a real video gets the length it earns ───────────────────────────────────
{
  const b = planSourceBudget('deep', { transcript: src(3000), productInfo: src(200) })
  check('a long video supports a long post', b.maxWords >= 3000, `${b.maxWords}`)
  check('and is not trimmed', b.trimmed === false)
  check('so nothing needs explaining', b.note === null, b.note ?? '')
}

// ── the cap never exceeds what was asked for ────────────────────────────────
// Source is not a licence to overshoot the creator's own setting.
{
  const b = planSourceBudget('short', { transcript: src(10000) })
  check('a huge transcript does not override a short setting', b.maxWords <= 900, `${b.maxWords}`)
}

// ── trimming is always explained ────────────────────────────────────────────
{
  const b = planSourceBudget('deep', { transcript: src(1200) })
  check('a mid-length video trims a deep request', b.trimmed === true)
  check('and says so in the creator\'s terms',
    !!b.note && /capped at about/i.test(b.note), b.note ?? 'no note')
  check('naming invention as the reason rather than a system limit',
    !!b.note && /invented/i.test(b.note), b.note ?? 'no note')
  check('and telling them what raises it',
    !!b.note && /Record longer/i.test(b.note), b.note ?? 'no note')
}

// ── only transcript that is actually SENT counts ────────────────────────────
// Material truncated before it reaches the model cannot support a sentence of
// the post. Counting the whole transcript would reintroduce the exact bug: a
// 40,000 word transcript sliced to 12,000 characters, budgeted as if all of it
// were available.
{
  const b = planSourceBudget('short', { transcript: src(40000) })
  check('the budget counts the slice, not the whole transcript',
    b.sourceWords < 4000, `${b.sourceWords} words counted from a 40,000 word transcript`)
  check('and the slice size is reported', b.transcriptChars === 12000, `${b.transcriptChars}`)
}

// ── a longer request buys more transcript, a shorter one does not ───────────
// The flat 12,000 starved long posts of the one source worth having while
// charging short posts for context they never used.
{
  const shortB = planSourceBudget('short', { transcript: src(20000) })
  const deepB = planSourceBudget('deep', { transcript: src(20000) })
  check('a deep post is sent more of the video', deepB.transcriptChars > shortB.transcriptChars,
    `${deepB.transcriptChars} vs ${shortB.transcriptChars}`)
  check('and can therefore be genuinely longer', deepB.maxWords > shortB.maxWords,
    `${deepB.maxWords} vs ${shortB.maxWords}`)
}

// ── product research counts as source ───────────────────────────────────────
{
  const bare = planSourceBudget('long', { transcript: src(800) })
  const researched = planSourceBudget('long', { transcript: src(800), productResearch: src(600) })
  check('a scraped product brief raises the ceiling', researched.maxWords > bare.maxWords,
    `${researched.maxWords} vs ${bare.maxWords}`)
}

// ── a post is never below a usable length ───────────────────────────────────
{
  const b = planSourceBudget('short', { transcript: '' })
  check('with no source at all there is still a floor', b.maxWords >= 400, `${b.maxWords}`)
  check('and the creator is told there is no material', b.thin === true)
  check('the range is coherent', b.minWords <= b.maxWords, `${b.minWords} > ${b.maxWords}`)
}

// ── the label is what the writer is handed ──────────────────────────────────
{
  const b = planSourceBudget('medium', { transcript: src(2000) })
  check('the label states a range in words', /^\d[\d,]* to \d[\d,]* words$/.test(b.label), b.label)
  check('and uses no dash punctuation', !/[–—]/.test(b.label), b.label)
}

// ── an unknown setting does not crash or default to the maximum ─────────────
{
  check('an unknown length falls back to medium', asPostLength('enormous') === 'medium')
  check('null falls back to medium', asPostLength(null) === 'medium')
  check('a known one is preserved', asPostLength('deep') === 'deep')
  const b = planSourceBudget(undefined, { transcript: src(5000) })
  check('and the fallback is not the largest tier', b.maxWords <= 1500, `${b.maxWords}`)
}

// ── the FAQ floor is gone ───────────────────────────────────────────────────
// The prompt said: "if you genuinely can't write 7 unique non-repeating
// questions from the buckets below, write 7 anyway". That is an order to pad,
// in writing, on every post.
{
  check('a thin post ships with no FAQ at all', planFaqCount(200) === 0, `${planFaqCount(200)}`)
  check('a modest post gets a few', planFaqCount(1000) === 4, `${planFaqCount(1000)}`)
  check('even the richest post stays well under the old minimum',
    planFaqCount(100000) < 7, `${planFaqCount(100000)}`)
  check('the count rises with the material',
    planFaqCount(900) < planFaqCount(3000))
  check('a nonsense input is not a licence to pad', planFaqCount(NaN) === 0)
}

// ── the prompt must no longer order the model to invent questions ───────────
{
  const strip = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const PROMPT = strip(readFileSync(join(__dirname, '..', 'services/claude/index.ts'), 'utf8'))
  check('the comment stripper works',
    strip('  // write 7 anyway\nreal code').indexOf('write 7 anyway') === -1,
    'if this fails the checks below prove nothing')
  check('the "write 7 anyway" instruction is gone',
    !/write \d+ anyway/i.test(PROMPT),
    'the prompt literally ordered the model to pad')
  check('no hard FAQ minimum is stated',
    !/minimum \d+ questions/i.test(PROMPT),
    'a floor on question count is a floor on invention')
  check('the length target is computed, not literal',
    /Target post length: \$\{sourceBudget\.label\}/.test(PROMPT),
    'the target must come from the source budget')
  // Section-rhythm guidance ("one deep dive: 320-450 words") is legitimate and
  // stays. What must not survive is a literal POST-length range, which can only
  // be a four-figure number, because that is a target the source cannot veto.
  check('no hardcoded post-length range survives in the prompt',
    !/\d,\d{3}\s*(?:to|[–—-])\s*\d[\d,]{3,}\s*words/i.test(PROMPT),
    'a literal range is a target the source cannot veto')
  check('the hard ceiling is stated as a number the model must not exceed',
    /HARD CEILING: \$\{sourceBudget\.maxWords/.test(PROMPT))
  check('the transcript slice is budgeted, not a flat constant',
    /transcript\.slice\(0, sourceBudget\.transcriptChars\)/.test(PROMPT),
    'budgeting for source the writer never receives is the original bug in a new costume')
  check('the FAQ count is computed per post',
    /EXACTLY \$\{faqCount\}/.test(PROMPT))
}

// ── break tests ─────────────────────────────────────────────────────────────
// Ahead of the report, because a block appended after it is never read.
{
  const breaks: string[] = []
  const broke = (name: string, cond: boolean) => { if (!cond) breaks.push(name) }

  // Break 1: the original bug. Ignore the source, hand back the brand tier.
  broke('a deep request on a thin source is caught',
    planSourceBudget('deep', { transcript: src(200) }).maxWords < 1000)

  // Break 2: counting the whole transcript rather than the slice that is sent.
  broke('counting the unsent transcript is caught',
    planSourceBudget('short', { transcript: src(40000) }).sourceWords < 4000)

  // Break 3: trimming without telling anyone, which is how a setting comes to
  // look broken and the creator reports the wrong bug.
  broke('a silent trim is caught',
    planSourceBudget('deep', { transcript: src(1200) }).note !== null)

  // Break 4: an FAQ floor of any kind.
  broke('an FAQ floor is caught', planFaqCount(200) === 0 && planFaqCount(0) === 0)

  // Break 5: an unknown brand setting falling through to the largest tier,
  // which would quietly restore the old behaviour for every malformed row.
  broke('an unknown setting defaulting to deep is caught',
    planSourceBudget('something-else', { transcript: src(5000) }).maxWords <= 1500)

  for (const b of breaks) failures.push(`BREAK TEST MISSED ${b}`)
}

if (failures.length) {
  console.error(`\n❌ source-budget: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('✅ source-budget: a post never runs further than the material behind it, and every trim says why')
