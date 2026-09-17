// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW MUCH OF THIS POST IS THE SAME AS EVERY OTHER POST?
//
// This exists because the answer was being guessed at, including by me. The
// first estimate put it at 400 to 800 words per post and counted a 61 line
// inline <style> block toward the total. That was wrong in a way worth writing
// down: search engines strip the CONTENTS of <style> and <script> before they
// extract text, so repeated CSS is page weight and nothing else. It was never
// feeding the near-duplicate signal it was blamed for.
//
// What does feed it is repeated visible TEXT. On an MVP post that is the
// affiliate disclaimer (emitted more than once), the fixed section labels, the
// CTA eyebrow and button copy, the price strip, the related-posts heading and
// its chips, and the byline and newsletter furniture the plugin adds at render
// time. Individually small. Identical on every URL, and front-loaded above the
// first original sentence.
//
// So this counts it. Not to produce a score, but so a claim about it can be
// checked instead of asserted, and so the effect of removing a block is a
// measured before and after rather than a hopeful commit message.
//
// The phrase list is deliberately OUR strings only. It does not try to detect
// generic repetition, because a creator whose posts genuinely share a subject
// will repeat words legitimately, and calling that boilerplate would be an
// accusation invented out of a vocabulary.

export interface BoilerplateWeight {
  /** Visible words in the post, after style/script contents are removed. */
  totalWords: number
  /** Words belonging to strings MVP emits on every post. */
  boilerplateWords: number
  /** Everything else. The part that is actually this post. */
  originalWords: number
  /** boilerplateWords / totalWords, 0 when the post is empty. */
  ratio: number
  /** Which known phrases were found, most costly first. */
  found: Array<{ phrase: string; times: number; words: number }>
}

/**
 * Text MVP puts on every post.
 *
 * Kept as literals rather than patterns so that adding a block to the writer and
 * forgetting to add it here shows up as an unexplained gap between this count
 * and the real one, rather than being silently absorbed by a clever regex.
 */
const CHROME: string[] = [
  // Affiliate disclosure. The top-of-post copy is required and stays; what this
  // counts is how many TIMES the same sentence appears on one page.
  'This post contains affiliate links. As an Amazon Associate, we earn from qualifying purchases at no extra cost to you.',
  'This post contains affiliate links. We may earn a commission on purchases made through links on this site, at no extra cost to you.',
  'Clicking takes you to Amazon. As an Amazon Associate we earn from qualifying purchases',
  'pricing and availability subject to change',
  "Clicking takes you to the seller's website. We may earn a small commission if you purchase, at no extra cost to you.",
  // Fixed section furniture.
  'Watch Our Review',
  'Quick Verdict',
  'Buy if you:',
  'Skip if you:',
  'Wait if you:',
  'Frequently Asked Questions',
  "What we'd improve",
  'At a glance',
  // Calls to action, emitted more than once per post.
  'Get the best price on Amazon',
  'Get the best price today',
  'Get it now',
  'Learn more',
  // Related posts block.
  'Also worth considering',
  // Rendered by the WordPress plugin, so it is on the page Google reads even
  // though it is not in blog_posts.content.
  'Reviewed by',
  'How we test',
  'About the reviewer',
  'More about me',
  'Read more about me',
  'Want the best Amazon finds in your inbox?',
  'A short monthly email with the products I tested + actually liked. No spam.',
  'Subscribe',
  // Comparison table caption.
  'Comparison drawn from what',
]

/** Single-word labels, matched only as whole words so "Pros" inside prose is
 *  not counted as a heading. */
const CHROME_WORDS: string[] = ['Pros', 'Cons']

const countWords = (s: string): number => {
  const t = s.trim()
  return t ? t.split(/\s+/).filter(Boolean).length : 0
}

/**
 * Visible text of a post, the way a search engine would extract it.
 *
 * The contents of <style> and <script> go, not just their tags. Stripping only
 * the tags leaves raw CSS sitting in the text, which is how a 61 line
 * stylesheet came to be counted as several hundred words of duplicate prose.
 */
export function visibleText(html: string): string {
  return String(html ?? '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Measure how much of a post is the same as every other post.
 *
 * `extraChrome` lets a caller add the strings a particular site renders, such as
 * a creator's own disclosure wording, so the count reflects the page a reader
 * actually gets rather than the template it came from.
 */
export function boilerplateWeight(html: string, extraChrome: string[] = []): BoilerplateWeight {
  const text = visibleText(html)
  const totalWords = countWords(text)
  if (totalWords === 0) {
    return { totalWords: 0, boilerplateWords: 0, originalWords: 0, ratio: 0, found: [] }
  }

  const found: BoilerplateWeight['found'] = []
  let boilerplateWords = 0

  const phrases = [...CHROME, ...extraChrome.filter(p => p && p.trim().length > 3)]
  for (const phrase of phrases) {
    const re = new RegExp(escapeRe(phrase), 'gi')
    const times = (text.match(re) || []).length
    if (times === 0) continue
    const words = countWords(phrase) * times
    boilerplateWords += words
    found.push({ phrase, times, words })
  }

  for (const word of CHROME_WORDS) {
    const re = new RegExp(`\\b${escapeRe(word)}\\b`, 'g')
    const times = (text.match(re) || []).length
    if (times === 0) continue
    boilerplateWords += times
    found.push({ phrase: word, times, words: times })
  }

  // A post cannot be more than entirely boilerplate. Overlapping phrases (a
  // disclaimer that contains a shorter matched fragment) would otherwise push
  // the count past the word total and produce a ratio above 1, which is not a
  // measurement, it is an artefact.
  boilerplateWords = Math.min(boilerplateWords, totalWords)

  found.sort((a, b) => b.words - a.words)

  return {
    totalWords,
    boilerplateWords,
    originalWords: totalWords - boilerplateWords,
    ratio: boilerplateWords / totalWords,
    found,
  }
}

/**
 * What to tell the creator, or null when there is nothing worth saying.
 *
 * Thresholds are about the reader, not a rule. A short post carries the same
 * fixed furniture as a long one, so the same number of boilerplate words is a
 * much larger share of it, and that is exactly when it is worth flagging.
 */
export function describeBoilerplate(w: BoilerplateWeight): string | null {
  if (w.totalWords === 0) return null
  if (w.ratio < 0.15) return null
  const pct = Math.round(w.ratio * 100)
  const top = w.found.find(f => f.times > 1)
  const repeated = top ? ` The same line appears ${top.times} times: "${top.phrase.slice(0, 60)}".` : ''
  return `${pct}% of this post is text that appears on every one of your posts, not writing about this product.${repeated} Google compares pages by their visible text, so a high share here makes your posts look like each other.`
}
