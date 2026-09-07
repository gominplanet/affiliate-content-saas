// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The face the creator asked for.
//
// Expression was never theirs to choose. It came from the psychological angle
// the art director picked, and with the Question hook style it was pinned to
// skeptical, doubtful or unsure, because a question headline reads best over a
// doubtful face. That is true, and it is also why every thumbnail a creator
// generated in a row came back wearing the same frown. A channel needs range.
//
// So: a creator picks, and their pick wins over the angle, the brief and the
// scene preset. Leaving it on Auto keeps exactly the old behaviour.
//
// WHY EACH ONE IS A PARAGRAPH AND NOT A WORD. "Happy" to an image model is a
// stock smile: the same symmetrical, teeth-out, dead-eyed grin every time, on a
// face that no longer looks like the creator. Naming the parts (what the brows
// do, whether the eyes crease, where the mouth goes, where they are looking)
// is what produces a real face instead of a mask, and it is what keeps two
// different picks actually looking different from each other.
//
// None of these may touch identity. They describe what a face DOES, never what
// it looks like, so the identity lock in the prompt stays the only thing
// deciding who the person is.

export type ExpressionKey =
  | 'auto' | 'serious' | 'happy' | 'surprised' | 'skeptical'
  | 'excited' | 'confused' | 'unimpressed' | 'confident'

export interface ExpressionOption {
  key: ExpressionKey
  /** What the creator sees on the chip. */
  label: string
  /** One line under it, so a creator picks by what it is FOR. */
  hint: string
  /** What the image model is told. Empty for 'auto'. */
  directive: string
  /** Is a closed-mouth smile the WRONG answer for this one?
   *
   *  The face judge exists to catch the polite, non-committal closed-mouth
   *  smile these models fall back to whenever an expression is hard, and telling
   *  it to fail that smile is what makes it useful for Surprised or Confused.
   *
   *  It also made Confident unpassable. That expression is defined as "a knowing
   *  closed-lip smirk", so the judge was told to reject the correct answer, said
   *  DIFFERENT, paid for a re-render, and said DIFFERENT again. A guard that
   *  fails the thing it is guarding is worse than no guard, so the rule is
   *  per-expression rather than global. */
  politeSmileIsWrong: boolean
}

export const EXPRESSIONS: ExpressionOption[] = [
  {
    key: 'auto',
    label: 'Auto',
    hint: 'MVP matches the face to the headline',
    directive: '',
    // Never read: Auto generates no portrait and so is never judged.
    politeSmileIsWrong: false,
  },
  {
    key: 'serious',
    label: 'Serious',
    hint: 'Straight talk, no gimmick',
    directive:
      'a level, unsmiling look straight down the lens: brows flat and relaxed, eyes steady and direct, lips closed with the jaw set. Composed and matter-of-fact, not angry, not stern, not glaring',
    // Unsmiling is the whole point, so a polite smile is a real failure here.
    politeSmileIsWrong: true,
  },
  {
    key: 'happy',
    label: 'Happy',
    hint: 'They liked it',
    directive:
      'a genuine warm smile that reaches the eyes: cheeks lifted, the corners of the eyes creasing, an easy open-lipped smile rather than a wide forced grin. Relaxed brows. It must read as a real person pleased with something, never a stock-photo smile',
    politeSmileIsWrong: false,
  },
  {
    key: 'surprised',
    label: 'Surprised',
    hint: 'Did not expect that',
    directive:
      'caught off guard: eyebrows high, forehead lightly creased, eyes wide and round, mouth open in a soft O. Genuine surprise, not fear and not a scream',
    politeSmileIsWrong: true,
  },
  {
    key: 'skeptical',
    label: 'Skeptical',
    hint: 'Best over a question headline',
    directive:
      'openly doubtful: ONE eyebrow raised while the other stays level, eyes slightly narrowed and fixed on the lens, mouth closed and pressed a little to one side, chin dipped. Unconvinced and weighing it up, not annoyed',
    politeSmileIsWrong: true,
  },
  {
    key: 'excited',
    label: 'Excited',
    hint: 'High energy, big reaction',
    directive:
      'lit up: eyebrows raised high, eyes wide and bright, a big open-mouthed grin mid-reaction as if talking, head tilted slightly back. Real energy, the face of someone in the middle of saying "look at this"',
    politeSmileIsWrong: true,
  },
  {
    key: 'confused',
    label: 'Confused',
    hint: 'Wait, what?',
    directive:
      'puzzled: brows drawn together and pulled slightly up in the middle, forehead creased, head tilted to one side, mouth just open. Genuinely trying to work something out, not frowning in anger',
    politeSmileIsWrong: true,
  },
  {
    key: 'unimpressed',
    label: 'Unimpressed',
    hint: 'Honest, when it did not deliver',
    directive:
      'distinctly underwhelmed: eyelids lowered, one eyebrow slightly raised, mouth flat with the corners turned faintly down, a small shrug in the shoulders. Deadpan and unconvinced, never disgusted or sneering',
    politeSmileIsWrong: true,
  },
  {
    key: 'confident',
    label: 'Confident',
    hint: 'The verdict is in',
    directive:
      'a knowing closed-lip smirk, one corner of the mouth up, chin slightly raised, eyes calm and locked on the lens, eyebrows relaxed. Someone who has already made up their mind and is about to tell you',
    politeSmileIsWrong: false,
  },
]

const BY_KEY = new Map(EXPRESSIONS.map(e => [e.key, e]))

/** The stored value, if it is one we know. Anything else is 'auto', so an old
 *  client or a hand-edited request can never inject prompt text of its own. */
export function normalizeExpression(raw: unknown): ExpressionKey {
  const k = String(raw ?? '').trim().toLowerCase()
  return BY_KEY.has(k as ExpressionKey) ? (k as ExpressionKey) : 'auto'
}

/**
 * The clause the image model is given, or null on Auto.
 *
 * It says "override" out loud because it has to beat instructions already in
 * the prompt: the angle's own scene preset, and the art director's brief, both
 * of which name an expression of their own. A directive that merely coexists
 * with those produces an average of the two, which is a face doing nothing.
 */
export function expressionDirective(key: ExpressionKey): string | null {
  const e = BY_KEY.get(key)
  if (!e || !e.directive) return null
  return `FACIAL EXPRESSION (the creator chose this — it OVERRIDES any other expression, mood or reaction described anywhere else in this brief): give them ${e.directive}. Everything about WHO they are stays exactly as the reference photos show; this changes only what their face is doing.`
}

/** True when the creator has actually chosen, so callers can tell a real pick
 *  apart from the default. */
export function hasExpressionChoice(key: ExpressionKey): boolean {
  return key !== 'auto' && BY_KEY.has(key)
}

/** The plain words for a pick, for anywhere that needs to NAME the choice
 *  rather than instruct on it: the art-director brief, a log line, a label. */
export const EXPRESSION_LABEL: Record<ExpressionKey, string> = EXPRESSIONS.reduce((acc, e) => {
  acc[e.key] = e.key === 'auto' ? 'whatever fits the headline' : `${e.label.toLowerCase()} (${e.hint.toLowerCase()})`
  return acc
}, {} as Record<ExpressionKey, string>)

/** The expression description ALONE, with none of the design-brief framing.
 *
 *  expressionDirective() is written to win an argument inside a thumbnail brief
 *  ("it OVERRIDES any other expression described anywhere else"). In a portrait
 *  prompt there is no argument to win and no other brief, so that wrapper is
 *  noise diluting the only sentence that matters. */
export function expressionDescription(key: ExpressionKey): string | null {
  return BY_KEY.get(key)?.directive || null
}

/** Whether the face judge may treat a closed-mouth smile as an automatic fail.
 *
 *  False for Confident and Happy, whose correct answers ARE closed-lipped or
 *  gently smiling. A judge told to reject that will reject the right portrait,
 *  charge for a second render, and reject that one too. */
export function politeSmileIsWrong(key: ExpressionKey): boolean {
  return BY_KEY.get(key)?.politeSmileIsWrong === true
}
