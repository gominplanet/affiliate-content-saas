// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY WORD ON THE IMAGE IS READ BACK (Seb, 2026-10-19: spell check every
// word, not just the headline).
//
// The old check read the big headline alone, on purpose: badges and the
// product's packaging carry text MVP never wrote. That is how "Q12.2 25W"
// went out on a chip nobody looked at. So the reader now gets the whole list
// of what the design was meant to carry (the headline, the one badge or chip,
// a call to action where the format has one), is told to leave the product's
// own printing out, and says what it actually read.
//
// Pure: the prompt, the parse and the retry note. The call itself lives in
// the thumbnail route, which owns the client and the billing.

export interface ReadBackWant {
  /** The headline as asked for, both lines. */
  headline: string
  /** The one badge or chip, or '' when the design carries none. */
  extra?: string
  /** True when the format adds a call to action (LINK IN BIO, TAP TO SHOP). */
  cta?: boolean
}

export interface ReadBack {
  /** false only when something is misspelled, cut off or garbled; null when
   *  the reader could not answer, which never triggers a re-render. */
  ok: boolean | null
  headlineWrong: boolean
  extraWrong: boolean
  strayWrong: boolean
  /** What is wrong, one sentence each, for the log and the screen. */
  problems: string[]
}

export function readBackPrompt(want: ReadBackWant): string {
  const extra = (want.extra || '').trim()
  return `Read EVERY piece of text in this thumbnail, exactly as the letters appear. Leave out only words printed on the product itself (its label, packaging or logo).

The design was meant to carry only:
- the headline: "${want.headline.replace(/\s+/g, ' ').trim()}"
- ${extra ? `one small badge or chip: "${extra}"` : 'no badge or chip'}${want.cta ? '\n- a short call to action such as "LINK IN BIO" or "TAP TO SHOP"' : ''}

Reply with ONLY JSON:
{"headline":"<the big headline as you read it>","headlineSame":true|false,"extra":"<the badge or chip as you read it, or empty>","extraSame":true|false|null,"other":["<any other text you can read>"],"otherBad":true|false}

headlineSame is false ONLY if a headline word is misspelled, cut off, or has letters missing or added. Ignore line breaks, punctuation and capitalisation.
extraSame is null when there is no badge or chip, and false only if it is misspelled or cut off.
other lists text that is not the headline, not the badge or chip, not the call to action, and not printed on the product.
otherBad is true if any text in other is misspelled, garbled, or letters that make no word.`
}

/** The reader's JSON, turned into a verdict. Anything unreadable is null,
 *  never a failure: a checker that is down must not double the bill. Pure. */
export function parseReadBack(raw: string, want: ReadBackWant): ReadBack {
  const unknown: ReadBack = { ok: null, headlineWrong: false, extraWrong: false, strayWrong: false, problems: [] }
  const text = String(raw || '')
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b <= a) return unknown
  let j: { headline?: unknown; headlineSame?: unknown; extra?: unknown; extraSame?: unknown; other?: unknown; otherBad?: unknown }
  try { j = JSON.parse(text.slice(a, b + 1)) } catch { return unknown }
  if (typeof j.headlineSame !== 'boolean') return unknown
  const said = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const headline = want.headline.replace(/\s+/g, ' ').trim()
  const extra = (want.extra || '').trim()
  const problems: string[] = []
  const headlineWrong = j.headlineSame === false
  if (headlineWrong) problems.push(`the headline reads "${said(j.headline)}" instead of "${headline}"`)
  const extraWrong = !!extra && j.extraSame === false
  if (extraWrong) problems.push(`the chip reads "${said(j.extra)}" instead of "${extra}"`)
  const other = Array.isArray(j.other) ? j.other.map(said).filter(Boolean).slice(0, 4) : []
  const strayWrong = j.otherBad === true && other.length > 0
  if (strayWrong) problems.push(`it added text that is wrong: "${other.join('", "')}"`)
  return { ok: problems.length === 0, headlineWrong, extraWrong, strayWrong, problems }
}

/** What the one re-render is told. A wrong chip or stray text the creator did
 *  not type is LEFT OUT rather than tried again, because a second try at small
 *  text is the same coin and the headline does not need it. Pure. */
export function readBackRetryNote(r: ReadBack, opts: { extraTyped: boolean }): string {
  const lines = [`THE PREVIOUS ATTEMPT GOT TEXT WRONG: ${r.problems.join('; ')}. Render every word complete and correctly spelled, letter for letter.`]
  if ((r.extraWrong || r.strayWrong) && !opts.extraTyped) lines.push('This time leave out the small badge or chip entirely: the headline is the only text on the design.')
  if (r.strayWrong) lines.push('Do not add any other words anywhere.')
  return lines.join(' ')
}

/** Which render to keep after the one retry: the retry unless it is known to
 *  be worse. A retry that misspells a different word is not an improvement,
 *  and an unknown verdict is not a failure. Pure. */
export function keepRetry(first: ReadBack, second: ReadBack): boolean {
  if (second.ok !== false) return true
  return second.problems.length < first.problems.length
}
