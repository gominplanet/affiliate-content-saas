// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW LONG A POST IS ALLOWED TO BE IS DECIDED BY HOW MUCH SOURCE IT HAS.
//
// The length target used to be a brand setting and nothing else. A creator
// picked "Deep" once, and from then on every post was asked for 2,500 to 3,200
// words no matter what it had to work with. The writer's real source is the
// creator's own video transcript, which was capped at 12,000 characters, about
// 2,000 words. So on a long target the model was asked to produce a thousand
// words it had no material for, and it did, because that is what models do when
// you give them a number.
//
// That invented remainder is the single most recognisable thing about a low
// quality page. Google's own guidance names it: content that adds nothing a
// reader could not get elsewhere, produced to hit a length. On one MVP site 394
// posts sat in "Crawled, currently not indexed", which is Google saying it read
// the page and declined to spend index space on it.
//
// So the rule is now: the post may expand on its source, it may not invent past
// it. A transcript is spoken and loose, so a written version of the same
// material legitimately runs somewhat longer. Somewhat. Not fivefold.
//
// Two things this must never do.
//
// It must not silently shrink what the creator asked for. Someone who picked
// "Deep" and gets 900 words is owed the reason, or the setting looks broken and
// they file a bug against the wrong thing. Every trim carries a sentence saying
// which video was short.
//
// And it must not pay for source it will not use. The transcript slice sent to
// the writer scales with the requested length, so a creator asking for a short
// post is not billed for 40,000 characters of context.

export type PostLength = 'short' | 'medium' | 'long' | 'deep'

/** Everything factual the writer has to work from. */
export interface SourceMaterial {
  /** The creator's own video. The primary source and the reason MVP posts are
   *  worth anything: it is first-hand experience nobody else has. */
  transcript?: string | null
  /** Scraped brand/product page brief, when research ran. */
  productResearch?: string | null
  /** Amazon listing title and bullets. */
  productInfo?: string | null
}

export interface SourceBudget {
  /** The phrase handed to the writer, e.g. "900 to 1,500 words". */
  label: string
  minWords: number
  maxWords: number
  /** Words of real source material behind the post. */
  sourceWords: number
  /** How much transcript to send to the model, in characters. */
  transcriptChars: number
  /** True when the requested length was more than the source can carry. */
  trimmed: boolean
  /** True when there is barely any source at all. */
  thin: boolean
  /** What to tell the creator. Null when nothing needs saying. */
  note: string | null
}

/**
 * How far a post may run past its source.
 *
 * A transcript is speech: filler, repetition, half-finished sentences. Writing
 * it up drops some of that and adds structure, headings and specifics, so a
 * written version legitimately lands somewhat longer than the spoken one. 1.4
 * is generous for that and still nowhere near enough room to invent a section.
 */
const EXPANSION = 1.4

/** Below this a post is not a post, whatever the source says. */
const FLOOR_WORDS = 450

/** Under this much source, the honest answer is that there is not enough. */
const THIN_SOURCE_WORDS = 350

/** What each requested length means, before the source gets a say. */
const REQUESTED: Record<PostLength, number> = {
  short: 900,
  medium: 1500,
  long: 2500,
  deep: 3200,
}

/**
 * Transcript characters to send, by requested length.
 *
 * This used to be a flat 12,000 for everyone, which starved long posts of the
 * one source that makes them worth reading while still charging short posts for
 * context they never needed. A 40 minute review has the material for a deep
 * post; it was being truncated to the first third and then asked to fill the
 * rest from nothing.
 */
const TRANSCRIPT_CHARS: Record<PostLength, number> = {
  short: 12000,
  medium: 16000,
  long: 28000,
  deep: 40000,
}

const words = (s: string | null | undefined): number => {
  const t = String(s ?? '').trim()
  if (!t) return 0
  return t.split(/\s+/).filter(Boolean).length
}

/** Normalise whatever the brand row holds into a known length. */
export function asPostLength(raw: string | null | undefined): PostLength {
  const s = String(raw ?? '').trim().toLowerCase()
  return s === 'short' || s === 'medium' || s === 'long' || s === 'deep' ? s : 'medium'
}

/**
 * Decide how long this specific post is allowed to be.
 *
 * The answer is the smaller of what the creator asked for and what the material
 * supports, never a number the source cannot stand behind.
 */
export function planSourceBudget(
  requestedRaw: string | null | undefined,
  source: SourceMaterial,
): SourceBudget {
  const requested = asPostLength(requestedRaw)
  const transcriptChars = TRANSCRIPT_CHARS[requested]

  // Only the transcript that will actually be sent counts as source. Material
  // truncated before it reaches the model cannot support a single sentence.
  const transcriptSent = String(source.transcript ?? '').slice(0, transcriptChars)
  const sourceWords = words(transcriptSent) + words(source.productResearch) + words(source.productInfo)

  const asked = REQUESTED[requested]
  const supported = Math.round(sourceWords * EXPANSION)
  const maxWords = Math.max(FLOOR_WORDS, Math.min(asked, supported))
  const minWords = Math.max(300, Math.round(maxWords * 0.7))

  const trimmed = maxWords < asked
  const thin = sourceWords < THIN_SOURCE_WORDS

  let note: string | null = null
  if (thin) {
    note = `There are only about ${sourceWords.toLocaleString()} words of source material for this post, counting your video and the product details. A post written from that has to either stay short or start making things up, and Google is good at spotting the second one. A longer video, or a product page worth scraping, is what makes a longer post possible.`
  } else if (trimmed) {
    note = `You asked for ${labelFor(asked)} but this post is capped at about ${maxWords.toLocaleString()} words, because that is as far as your video and product details actually stretch. The rest would have been invented, and invented filler is the main reason Google declines to index a page. Record longer and the cap rises on its own.`
  }

  return {
    label: `${minWords.toLocaleString()} to ${maxWords.toLocaleString()} words`,
    minWords,
    maxWords,
    sourceWords,
    transcriptChars,
    trimmed,
    thin,
    note,
  }
}

/**
 * How many FAQ questions this post has earned.
 *
 * The prompt used to demand a minimum of seven, targeting eight to ten, and
 * finished the instruction with: "if you genuinely can't write 7 unique
 * non-repeating questions from the buckets below, write 7 anyway". That is an
 * order to pad, in writing, and the same prompt separately complains that an
 * audit found the FAQ echoing the body across five recent posts. It was going to.
 *
 * The rationale for a high count was real: answer engines lift Q&A chunks
 * verbatim, so more good questions means more chances to be cited. The mistake
 * was setting a floor. A citation comes from a question a buyer actually asks
 * and the source can actually answer. Seven manufactured ones do not become a
 * citation, they become a recognisable padding signature on every URL.
 *
 * So the count scales with the material, and the floor is zero. A post with
 * nothing left to ask ships without a FAQ, which is allowed and always was.
 */
export function planFaqCount(sourceWords: number): number {
  if (!Number.isFinite(sourceWords) || sourceWords < THIN_SOURCE_WORDS) return 0
  if (sourceWords < 800) return 3
  if (sourceWords < 1500) return 4
  if (sourceWords < 2500) return 5
  return 6
}

/** Human name for a requested word count, used only inside the note. */
function labelFor(asked: number): string {
  if (asked >= REQUESTED.deep) return 'a deep post'
  if (asked >= REQUESTED.long) return 'a long post'
  if (asked >= REQUESTED.medium) return 'a medium post'
  return 'a short post'
}
