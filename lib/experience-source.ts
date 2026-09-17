// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT IS THIS POST ALLOWED TO CLAIM THE WRITER DID?
//
// MVP's reviews are worth something because they are built on a video the
// creator actually shot. That transcript is first-hand experience nobody else
// has, and it is the whole reason a generated post is a review rather than a
// rewrite of the listing. When it is there, the post may say "I", because the
// person did the thing.
//
// The trouble is the paths where there is no video. The campaign, deal and
// paste-a-link flows all generate from a product listing and a scraped brief,
// and the writer prompt those paths share says:
//
//   "TRANSCRIPT IS LAW ... You ARE that reviewer, write in first person, in
//    their voice, only about things THEY experienced."
//
// With no transcript, "things THEY experienced" is an empty set, and a model
// told to write first person about an empty set invents the experience. That is
// not a style problem. It is a post claiming somebody used a product they have
// never touched, under a real person's byline.
//
// The campaign path already carried a rule against it. A rule, in the prompt,
// with nothing checking the output, while lib/deal-scrub.ts has shipped an
// enforcing scrub for exactly this since the deal hub was built and three other
// paths already run it. Asking and never checking is how the earlier failures in
// this codebase happened: a post that "used Passport" while containing a
// geni.us link, a garment check whose silence looked identical to a pass.
//
// So this decides, once, for every path: where did the first-hand experience in
// this post come from, and therefore what may it say.
//
//   video        the creator filmed it. First person is earned.
//   creator-note the creator wrote down what they did with it. Also earned, but
//                bounded by what the note actually says.
//   none         nobody touched it. The post is an assessment, not a review,
//                and the output is scrubbed rather than trusted.

export type ExperienceSource = 'video' | 'creator-note' | 'none'

export interface ExperienceInput {
  /** The video transcript, when this post came from one. */
  transcript?: string | null
  /** First-hand notes the creator typed for THIS product, on a path with no
   *  video. Their own words about their own use. */
  creatorNote?: string | null
}

export interface ExperienceRule {
  source: ExperienceSource
  /** May the post say "I tested this"? */
  mayClaimFirsthand: boolean
  /** Must the finished HTML be scrubbed of review language before it ships?
   *  True exactly when nothing backs a first-hand claim. */
  mustScrub: boolean
  /** The instruction block for the writer. */
  prompt: string
}

/**
 * Below this a note is a fragment, not an account of using something.
 *
 * "Great product" is not first-hand experience, and treating it as a licence to
 * write a first-person review would be worse than having no note at all: it
 * would launder an invented review through a creator's three words.
 */
const MIN_NOTE_WORDS = 15

const words = (s: string | null | undefined): number => {
  const t = String(s ?? '').trim()
  return t ? t.split(/\s+/).filter(Boolean).length : 0
}

/** Below this a transcript is not a review either. Roughly thirty seconds of
 *  speech, which is a mention rather than a test. */
const MIN_TRANSCRIPT_WORDS = 80

export function resolveExperience(input: ExperienceInput): ExperienceRule {
  const transcriptWords = words(input.transcript)
  const noteWords = words(input.creatorNote)

  if (transcriptWords >= MIN_TRANSCRIPT_WORDS) {
    return {
      source: 'video',
      mayClaimFirsthand: true,
      mustScrub: false,
      prompt: `EXPERIENCE: you filmed this.

The transcript is your own account of using this product, so write in the first
person and mean it. Everything personal in this post must trace to a moment in
that transcript. Do not add an experience you did not describe on camera, and do
not round a small observation up into a longer test than you ran.`,
    }
  }

  if (noteWords >= MIN_NOTE_WORDS) {
    return {
      source: 'creator-note',
      mayClaimFirsthand: true,
      mustScrub: false,
      prompt: `EXPERIENCE: there is no video, but you wrote down what you did with this.

YOUR NOTES:
"""
${String(input.creatorNote).trim()}
"""

First person is allowed here, and ONLY for what those notes cover. They are
shorter than a transcript, so the first-hand part of this post is shorter too.
Use it where it counts and let the rest of the post be assessment rather than
recollection. Do not extend a single observation into weeks of testing.`,
    }
  }

  return {
    source: 'none',
    mayClaimFirsthand: false,
    mustScrub: true,
    prompt: `EXPERIENCE: none. You have NOT used this product.

There is no video and no notes from you, so this post is an informed assessment
built from the listing, the specs and the research brief. That is a legitimate
and useful thing to write. What it is not is a review.

DO NOT claim, imply, or imply-by-phrasing that you or "we" bought, owned,
tested, tried, used, unboxed or lived with this. Banned phrasings, and every
variant of them:
  "in our testing"   "after a few weeks"   "my unit"   "we put this through"
  "I've had this for"   "in my experience with"   "I picked one up"
Writing in the first person about a product nobody touched puts a fabricated
experience under a real person's byline.

Write it as what it is: here is what this product claims, here is what the specs
and the data actually support, here is who it suits and who it does not. Judgement
is yours to give. Experience is not yours to claim.`,
  }
}
