// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY POST HAD THE SAME SKELETON, AND THE PROMPT KNEW.
//
// The writer prompt carried this, verbatim:
//
//   "SECTION-DENSITY VARIANCE — no two posts may have the same shape. The audit
//    found that across recent posts the body settled into a near-identical
//    pattern... Never default to 'seven' because the template said so."
//
// and then, four hundred lines further down:
//
//   "[4] BODY — 7 REQUIRED SECTIONS"
//     Section A: Hook opener
//     Section B: Product mechanics
//     ... through Section G, in that order, on every post.
//
// A model handed an abstract instruction and a concrete template follows the
// template. So every post on a site opened the same way, moved through the same
// seven topics in the same order, and closed the same way. At 279 posts that is
// not a blog, it is one page with the nouns swapped, and Google's near-duplicate
// handling reads it exactly that way.
//
// A prompt instruction that nothing verifies is a wish. So the shape is decided
// here, in code, per post, and the prompt renders what it is given.
//
// Three properties this must have, and the third is the one that makes it real:
//
//   Deterministic. The same post regenerated produces the same shape, or a
//   rebuild silently restructures a published article.
//
//   Varied. Two posts by the same creator get different section counts, a
//   different selection of topics, and a different order.
//
//   Checked. The shape is recorded as a signature and compared against that
//   creator's recent posts. A collision is reshuffled rather than shipped. This
//   is the part a prompt could never do, because a prompt cannot see the last
//   ten posts.

/** One body section the writer must produce. */
export interface SectionRole {
  key: string
  /** What the section is for. The writer picks its own heading words. */
  brief: string
}

export interface StructurePlan {
  sections: SectionRole[]
  /** Optional furniture, decided per post rather than once per brand. */
  blocks: {
    verdictBox: boolean
    scorecard: boolean
    prosCons: boolean
    specsTable: boolean
    improvements: boolean
  }
  /** Short stable description of this shape, stored so the next post can
   *  avoid repeating it. */
  signature: string
  /** How many attempts it took to find an unused shape. Surfaced so a creator
   *  who has genuinely exhausted the space can be told, rather than quietly
   *  served a repeat. */
  attempts: number
  /** True when every attempt collided and a repeat was unavoidable. */
  repeated: boolean
}

/** What a brand has switched off entirely. A per-post plan may drop a block
 *  the brand allows; it may never add one the brand disabled. */
export interface BlockPermissions {
  verdictBox?: boolean
  scorecard?: boolean
  prosCons?: boolean
  specsTable?: boolean
  improvements?: boolean
}

export interface StructureInput {
  /** Stable per-post identifier: a video id, or an ASIN on the campaign path.
   *  Same post in, same shape out. */
  seed: string
  /** Words of real source material, from lib/source-budget.ts. Depth decides
   *  how many sections the post can carry without padding. */
  sourceWords: number
  /** True when there is a named alternative worth a comparison section. */
  hasComparison?: boolean
  /** Signatures of this creator's recent posts, newest first. */
  recentSignatures?: string[]
  permissions?: BlockPermissions
}

/**
 * The opener. Always first, always present.
 *
 * This one is not shuffled and that is deliberate. A reader decides in about
 * five seconds, so the first section is the one place where the right answer is
 * the same on every post: start with the moment, not the summary.
 */
const HOOK: SectionRole = {
  key: 'hook',
  brief: 'Open on a specific moment from the video. Not a summary of what the post will cover.',
}

/**
 * The middle. A post draws from these, and which ones it draws is the variance.
 *
 * Wider than the old fixed seven on purpose. Seven roles in a fixed order give
 * exactly one shape; eleven roles sampled five to nine at a time give enough
 * distinct shapes that a creator can publish for years without repeating.
 */
const MIDDLE: SectionRole[] = [
  { key: 'mechanics', brief: 'How the thing actually works, and what is inside it.' },
  { key: 'performance', brief: 'What happened when it was used for real, from the video.' },
  { key: 'friction', brief: 'What is annoying about it. Grounded in the source, never invented.' },
  { key: 'setup', brief: 'Getting started with it: unboxing, assembly, the first hour.' },
  { key: 'durability', brief: 'How it holds up over time, or what suggests it will not.' },
  { key: 'value', brief: 'What the money actually buys, against what else it could buy.' },
  { key: 'context', brief: 'Where this sits in its category and who else makes one.' },
  { key: 'edge-cases', brief: 'The situations it is not built for, and what happens then.' },
  { key: 'maintenance', brief: 'Cleaning, storage, consumables, and what ownership costs after the purchase.' },
  { key: 'comparison', brief: 'Straight comparison against the named alternative.' },
  { key: 'misconception', brief: 'The thing buyers get wrong about this product before they own it.' },
]

/** Sections that read as an ending. One of these lands last. */
const CLOSERS: SectionRole[] = [
  { key: 'audience', brief: 'Who this is genuinely for, and who should not buy it.' },
  { key: 'advice', brief: 'What to know before buying, including which version or size.' },
  { key: 'verdict-long', brief: 'The considered verdict, beyond the short one at the top.' },
]

/** Deterministic 32-bit hash of a string. */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Seeded generator. mulberry32: small, fast, and the same everywhere. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates, driven by the seeded generator so it is reproducible. */
function shuffled<T>(items: T[], next: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * How many body sections this post can carry.
 *
 * Tied to source depth, because section count is just another way to pad. Nine
 * sections over a thin transcript is seven headings with nothing under them.
 */
function sectionCountFor(sourceWords: number, next: () => number): number {
  const w = Number.isFinite(sourceWords) ? sourceWords : 0
  let lo: number
  let hi: number
  if (w < 400) { lo = 3; hi = 4 }
  else if (w < 900) { lo = 4; hi = 5 }
  else if (w < 1800) { lo = 5; hi = 7 }
  else { lo = 6; hi = 9 }
  return lo + Math.floor(next() * (hi - lo + 1))
}

function buildOnce(input: StructureInput, salt: number): { sections: SectionRole[]; blocks: StructurePlan['blocks'] } {
  const next = rng(hashString(`${input.seed}#${salt}`))
  const total = sectionCountFor(input.sourceWords, next)

  // A comparison section with nothing to compare against is an invitation to
  // invent a competitor, so it is only in the pool when one actually exists.
  const pool = MIDDLE.filter(s => s.key !== 'comparison' || input.hasComparison === true)

  const closer = shuffled(CLOSERS, next)[0]
  const middleCount = Math.max(1, total - 2) // hook and closer take the other two
  const middle = shuffled(pool, next).slice(0, middleCount)

  const perm = input.permissions ?? {}
  const allow = (k: keyof BlockPermissions) => perm[k] !== false
  // Each block is allowed to be absent. The old behaviour set them once per
  // brand, so every post on a site carried the identical set of furniture.
  const blocks = {
    verdictBox: allow('verdictBox') && next() < 0.75,
    scorecard: allow('scorecard') && next() < 0.6,
    prosCons: allow('prosCons') && next() < 0.7,
    specsTable: allow('specsTable') && next() < 0.55,
    improvements: allow('improvements') && next() < 0.35,
  }

  return { sections: [HOOK, ...middle, closer], blocks }
}

/** A shape's fingerprint: the ordered section keys plus which blocks are on. */
export function signatureOf(sections: SectionRole[], blocks: StructurePlan['blocks']): string {
  const b = [
    blocks.verdictBox ? 'v' : '',
    blocks.scorecard ? 's' : '',
    blocks.prosCons ? 'p' : '',
    blocks.specsTable ? 't' : '',
    blocks.improvements ? 'i' : '',
  ].join('')
  return `${sections.map(s => s.key).join('>')}|${b || '-'}`
}

/** How many reshuffles to try before accepting a repeat. */
const MAX_ATTEMPTS = 12

/**
 * Decide this post's shape, avoiding the shapes the creator recently published.
 */
export function planPostStructure(input: StructureInput): StructurePlan {
  const recent = new Set((input.recentSignatures ?? []).filter(Boolean))

  let last = buildOnce(input, 0)
  let signature = signatureOf(last.sections, last.blocks)
  let attempts = 1

  while (recent.has(signature) && attempts < MAX_ATTEMPTS) {
    last = buildOnce(input, attempts)
    signature = signatureOf(last.sections, last.blocks)
    attempts++
  }

  return {
    sections: last.sections,
    blocks: last.blocks,
    signature,
    attempts,
    repeated: recent.has(signature),
  }
}

/**
 * Render the plan as the body instruction the writer receives.
 *
 * Deliberately does NOT hand over heading text. The writer chooses the words;
 * the plan chooses the shape. Supplying both is how every post on a site came
 * to open with the same sentence shape and close with the same section.
 */
export function structureToPrompt(plan: StructurePlan): string {
  const lines = plan.sections.map((s, i) =>
    `  ${i + 1}. [${s.key}] ${s.brief}`)
  return `[4] BODY: EXACTLY ${plan.sections.length} SECTIONS, IN THIS ORDER

This shape was chosen for THIS post and is different from your recent ones. It is
not a template and there is no standard set of sections: the count, the topics and
the order all change from post to post, on purpose.

Write your own H2 heading for each. The heading must describe what that section
actually says, in your voice. Do not echo the bracketed key, and do not use a
generic label such as "Features" or "Final Thoughts".

${lines.join('\n')}

Cover ONLY these ${plan.sections.length}. Do not add a section because a previous
post had one, and do not merge two because they seem similar. If the source does
not support one of them, write it short and honest rather than padding it out.`
}
