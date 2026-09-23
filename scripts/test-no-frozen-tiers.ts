// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NO SCREEN NAMES A PLAN NOBODY CAN BUY.
//
// Creator and Studio are frozen. Five existing subscribers keep them and
// checkout will not sell one. SELLABLE_TIERS has said so for a while; the copy
// had not caught up, in about thirty places:
//
//   "Pinterest is a Studio plan feature. Upgrade to Studio or Pro…"
//   "Upgrade to Creator or higher to fix 404s."
//   "Passport Links is available on the Amazon, Studio, and Pro plans."
//   the pricing comparison table, which gave three values per row
//   the landing page, which said the Amazon toolkit is included "on Studio & Pro"
//
// Every upgrade message is shown to somebody who does NOT have the feature,
// which is somebody on the free trial, which is exactly the person who cannot
// buy the plan being named. The sentence written to convert them pointed at a
// dead end.
//
// So: no user-facing string may use Creator or Studio as an MVP plan name.
// lib/upgrade-copy builds the sentence from SELLABLE_TIERS and from the field
// the route already gates on, so it follows the product instead of trailing it.
//
// The words themselves are NOT banned. "YouTube Studio", "Creator Connections",
// "Creator Hub", "Shorts Studio", "CTA Studio" and a competitor called Cuppa
// Studio are all legitimate and all appear. What is banned is the plan-name
// shape, which is what the pattern below is built to recognise.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SELLABLE_TIERS, TIERS } from '../lib/tier'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// The premise. If one of these ever becomes sellable again, this whole file is
// wrong rather than merely noisy, so it fails loudly instead of quietly passing.
check('Creator and Studio are still frozen',
  !SELLABLE_TIERS.includes('creator') && !SELLABLE_TIERS.includes('studio'),
  `sellable: ${SELLABLE_TIERS.join(', ')}`)
check('and the plans that ARE sellable have labels',
  SELLABLE_TIERS.every(t => typeof TIERS[t].label === 'string' && TIERS[t].label.length > 0))

/** Phrases where these words are not a plan name. */
const NOT_A_PLAN = /YouTube Studio|Creator Hub|Creator Connections|Shorts Studio|CTA Studio|Cuppa Studio|Creator Studio|thumbnailcreator|Creator API|Creator name|Creator\/brand|Creator account|Creator Campaigns|Creator signup|Amazon Creator|Creator referral|creator's|content creator/gi

/** The shape of a plan-name mention: the word next to plan/tier vocabulary. */
const PLAN_SHAPE = new RegExp(
  [
    String.raw`\b(?:Creator|Studio)\s*\+`,
    String.raw`\b(?:Creator|Studio)\s+(?:plan|tier)\b`,
    String.raw`Upgrade\s+(?:to\s+)?(?:Creator|Studio)\b`,
    String.raw`\b(?:Creator|Studio)\s+or\s+(?:higher|Pro)\b`,
    String.raw`\b(?:Creator|Studio)\s*(?:,|·|&|\+)\s*(?:and\s+)?(?:Studio|Pro)\b`,
    String.raw`\b(?:Creator|Studio)\s*:\s*\d`,
    String.raw`\bon\s+(?:Studio|Creator)\b`,
    String.raw`(?:Amazon|,)\s*,?\s*(?:Studio|Creator)\s*,?\s*and\s+Pro`,
    // ── THE SHAPES /tour WROTE, WHICH NONE OF THE ABOVE CAUGHT ────────────
    //
    // The public product tour described MVP as Creator / Studio / Pro for
    // months after both were frozen: which networks each one unlocked, which
    // caps Pro beat, and an "why Pro" close that opened "Creator-tier MVP
    // gets you the writer." It taught a reader the shape of a product they
    // cannot buy, and it slipped past every pattern above because it used
    // ordinary prose instead of the phrases somebody thought to list.
    //
    // "Creator and Studio offer" — two plan names joined by a bare `and`,
    // where the separator patterns above all expect a comma or a bullet.
    String.raw`\b(?:Creator|Studio)\s+and\s+(?:Studio|Creator|Pro)\b`,
    // "Studio adds Pinterest", "Creator auto-posts to Facebook" — a plan name
    // as the SUBJECT of a verb, which is the plainest way to describe what a
    // plan does and was the one shape with no rule at all.
    String.raw`\b(?:Creator|Studio)\s+(?:adds|includes|gets|unlocks|auto-posts|lifts|offers?|covers?)\b`,
    // "Creator-tier MVP gets you the writer."
    String.raw`\b(?:Creator|Studio)-tier\b`,
    // "lower tiers", "what Creator and Studio offer": a comparison against the
    // plans below, on a product whose only plans are Free, Amazon and Pro.
    String.raw`\b(?:Creator|Studio)\s+(?:users?|subscribers?|accounts?|customers?)\b`,
  ].join('|'),
  'i',
)

/**
 * Files allowed to name a frozen plan, with the reason.
 *
 * The rule is "never recommend a plan nobody can buy", not "never print the
 * word". This notice is rendered ONLY for a grandfathered Creator subscriber
 * and explains the plan they are on: taking the name out would leave five
 * people reading about caps belonging to a plan the screen refuses to name.
 * Its upsell link was a real bug and is fixed separately — it pointed at
 * /billing?plan=studio, which checkout will not sell.
 */
const EXEMPT = new Map<string, string>([
  ['components/newsletter/LegacyCapsNotice.tsx', 'shown only to grandfathered Creator subscribers, about their own plan'],
  // The assistant's own reference doc. Its Creator section is headed "Legacy
  // Creator grandfathering" and opens "NOT A PLAN ON SALE … never suggest
  // either as an upgrade", so it exists to stop the assistant recommending a
  // frozen plan rather than to recommend one. Deleting it would leave the
  // five grandfathered subscribers with an assistant that cannot explain why
  // their caps differ, which is the question only they can ask.
  ['lib/assistant-features-doc.ts', 'tells the assistant these plans are unsellable, for the subscribers already on them'],
])

const ROOTS = ['app', 'components', 'lib', 'services']
const SKIP = /node_modules|\.next|\/admin\/|test-|\.test\./

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e)
    if (SKIP.test(f)) continue
    if (statSync(f).isDirectory()) walk(f, out)
    else if (/\.tsx?$/.test(f)) out.push(f)
  }
  return out
}

{
  const offenders: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      // Block comments stripped across the WHOLE file before splitting, because
      // they span lines: a line in the middle of a /* … */ carries no marker of
      // its own and reads as ordinary code. Newlines are preserved so the line
      // numbers in a failure still point at the right place.
      if (EXEMPT.has(file)) continue
      const src = readFileSync(file, 'utf8')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
        .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      src.split('\n').forEach((rawLine, i) => {
        let line = rawLine
        // Comments are where the history lives, and the history has to be
        // allowed to name what it replaced. This file would otherwise flag its
        // own explanation, which has happened three times today in other guards.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        // Comments anywhere on the line, not only at its start: a JSX
        // `{/* Scheduling (Studio+) */}` and a trailing `// opening Studio +
        // paginating…` are both notes to whoever reads the code, and both were
        // being reported as copy shown to a customer.
        line = line.replace(/\/\/.*$/, ' ')
        if (!/\S/.test(line)) return
        // Quoted strings AND JSX text. The first pass only read strings and
        // walked straight past `<th>Creator · Studio · Pro</th>`, which is the
        // column header of the comparison table on the pricing page: the single
        // most visible place either word appeared.
        const candidates = [
          ...[...line.matchAll(/['"`]([^'"`\n]{2,240}?)['"`]/g)].map(m => m[1]),
          ...[...line.matchAll(/>([^<>{}\n]{2,240}?)</g)].map(m => m[1]),
          // And the bare line with its tags stripped, for JSX prose that spans
          // several lines: "On Studio or Pro the whole Amazon toolkit…" sat on
          // a line with no angle bracket on it at all, so neither pattern above
          // could see it. Safe to add because the Creator/Studio pre-filter
          // below is case-SENSITIVE, so code like `tier === 'studio'` is not a
          // candidate.
          line.replace(/<[^>]*>/g, ' '),
        ]
        for (const raw of candidates.map(c => ({ 1: c }))) {
          const m = raw as unknown as RegExpMatchArray
          const text = m[1].replace(NOT_A_PLAN, '')
          if (!/\b(Creator|Studio)\b/.test(text)) continue
          if (!PLAN_SHAPE.test(text)) continue
          offenders.push(`${file}:${i + 1} — "${m[1].trim().slice(0, 90)}"`)
        }
      })
    }
  }
  for (const o of offenders) {
    check(o, false, 'names a plan checkout will not sell, to the one person who cannot buy it')
  }
}

// An exemption for a file that no longer exists is an exemption nobody reads,
// and it would silently widen if the path were reused later.
for (const [file, why] of EXEMPT) {
  check(`the exemption for ${file} still points at a real file`,
    (() => { try { readFileSync(file, 'utf8'); return true } catch { return false } })(),
    `exempted because: ${why}`)
}

// The detector has to be able to find one, or this passes by matching nothing.
{
  const caught = [
    'Pinterest is a Studio plan feature. Upgrade to Studio or Pro to pin.',
    'Upgrade to Creator or higher to fix 404s.',
    'Passport Links is available on the Amazon, Studio, and Pro plans.',
    'Creator: 10/mo · Studio: 30/mo · Pro: 150/mo',
    'the full toolkit on Studio & Pro',
  ]
  for (const s of caught) {
    check(`the detector still catches "${s.slice(0, 44)}…"`,
      PLAN_SHAPE.test(s.replace(NOT_A_PLAN, '')))
  }
  const allowed = [
    'Open this Short in YouTube Studio to download the original MP4',
    'Read your Creator Hub to mark which products you have a video for',
    'Brand deals (Creator Connections)',
    'Shorts Studio is a Pro feature.',
    'Cuppa Studio (multi-niche AI writer)',
  ]
  for (const s of allowed) {
    check(`and leaves "${s.slice(0, 44)}…" alone`,
      !PLAN_SHAPE.test(s.replace(NOT_A_PLAN, '')),
      'these are real product names, not MVP plans')
  }
}

if (failures.length) {
  console.error(`\n❌ no-frozen-tiers: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ no-frozen-tiers: no screen names Creator or Studio as a plan')
