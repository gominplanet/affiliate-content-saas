// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What still reads as machine-written after every other pass, counted.
//
// THE LIST IS DOCUMENTED, NOT GUESSED. The vocabulary and patterns are the ones
// Wikipedia's editors catalogue in "Signs of AI writing", the excess words the
// Science Advances study found flooding post-2023 text (delve, showcase,
// underscore), and the structures readers used to spot AI articles 299 times
// out of 300 in Russell, Karpinska and Iyyer (2025): negative parallelisms,
// stock openers and closers, uniform sentence length.
//
// It never rewrites. It reports, so the gate can hold a post and say exactly
// which lines tripped it, and the count is kept on the post.

export interface AiTell { kind: string; sample: string }

const VOCAB = [
  'delve', 'delves', 'delving', 'tapestry', 'testament to', 'pivotal', 'underscore', 'underscores',
  'intricate', 'foster', 'fosters', 'seamless', 'seamlessly', 'elevate', 'elevates', 'game-changer',
  'game changer', 'boasts', 'embark', 'realm', 'navigate the', 'look no further', 'in conclusion',
  "in today's fast-paced", 'in the world of', 'a must-have', 'unleash', 'unlock the',
  'meticulous', 'meticulously', 'showcase', 'showcases', 'landscape of', 'ever-evolving',
  'it is worth noting', "it's worth noting", 'rest assured', 'whether you\'re a', 'at the end of the day',
]

const text = (html: string) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'")
  .replace(/\s+/g, ' ').trim()

const around = (t: string, i: number, len: number) => t.slice(Math.max(0, i - 30), Math.min(t.length, i + len + 30)).trim()

export function findAiTells(html: string): AiTell[] {
  const t = text(html)
  const out: AiTell[] = []
  for (const w of VOCAB) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    const m = re.exec(t)
    if (m) out.push({ kind: `word: ${w}`, sample: around(t, m.index, m[0].length) })
  }
  const patterns: Array<[string, RegExp]> = [
    ['"not just X, but Y"', /\bnot (?:just|only|merely) [^.!?]{1,70}?,? but (?:also )?/i],
    ['"it\'s not X, it\'s Y"', /\bit'?s not (?:just )?[^.!?]{1,50}?[,;] it'?s\b/i],
    ['"serves as"', /\bserves as (?:a|an|the)\b/i],
    ['stock closer', /\b(?:overall|all in all|to sum up|in summary),? (?:the|this|it)\b[^.!?]{0,80}\b(?:solid|great|excellent|worthy|worth)\b/i],
  ]
  for (const [kind, re] of patterns) {
    const m = re.exec(t)
    if (m) out.push({ kind, sample: around(t, m.index, m[0].length) })
  }
  // Dashes the model's way: unspaced, between words, more than once. Amazon
  // titles carry spaced dashes ("Charger – 65W") and ranges use en dashes
  // ("5–10 days"); both land in posts people write too, and in every post that
  // names the product, so a single dash anywhere would flag them all.
  const dashes = [...t.matchAll(/[A-Za-z]—[A-Za-z]/g)]
  if (dashes.length >= 2) out.push({ kind: 'em dashes', sample: around(t, dashes[0].index ?? 0, 3) })
  // Sentence rhythm: people vary it, models level it. Only judged on posts
  // long enough for the measure to mean something.
  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.split(/\s+/).length).filter((n) => n >= 3)
  if (sentences.length >= 25) {
    const mean = sentences.reduce((a, b) => a + b, 0) / sentences.length
    const sd = Math.sqrt(sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / sentences.length)
    if (mean > 0 && sd / mean < 0.35) out.push({ kind: 'uniform sentence length', sample: `sentences average ${Math.round(mean)} words with little variation` })
  }
  return out
}

/** A post is held when this many tells survive every pass. */
export const AI_TELL_HOLD_AT = 4
