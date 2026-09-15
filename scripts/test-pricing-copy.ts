// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A number a customer reads has to be the number the server gives them.
//
// There were three price lists: the homepage, /pricing and the billing page. Two
// of them restated the allowances by hand, under a comment claiming lib/tier.ts
// was the source of truth. The hand copies had drifted, and every drift was in
// the customer's favour on the page and against them in the product:
//
//   Studio advertised 1,000 AI assistant messages. Enforced: 400.
//   Pro advertised 2,500. Enforced: 800.
//   Studio advertised 15 Photobooth headshots. Enforced: 12.
//   Studio and Pro advertised a fixed monthly deal-post count. Enforced: deals
//     draw from the shared generations pool, so the number did not exist.
//   Creator and Studio sold "LoRA retrains", retired 2026-05-22.
//
// /api/assistant/chat reads TIERS[tier].assistantMessagesPerMonth and stops
// there, so a Pro customer paying $199 was promised 2,500 messages and cut off
// at 800 with no warning. That is not a copy nit. It is a refund conversation.
//
// This file asserts the two things that keep it fixed: the copy INTERPOLATES the
// allowances rather than typing them, and no stale figure survives anywhere in
// the rendered feature lists.
import { readFileSync } from 'node:fs'
import { TIERS, SELLABLE_TIERS, type Tier } from '../lib/tier'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const HOME = readFileSync('app/page.tsx', 'utf8')
const BILLING = readFileSync('app/(dashboard)/billing/page.tsx', 'utf8')
// THE FIFTH PRICE LIST. /pricing is a separate page from the homepage and this
// suite never looked at it, so the two-plan change on 2026-09-15 missed it
// entirely: it went on selling Creator and Studio with live Buy buttons, quoted
// Pro's design caps from before they were resized, still advertised LoRA
// retrains (retired 2026-05-22), and put a year in a copy string. Every fault
// this file was written to catch, sitting one route away from where it looked.
const PRICING_PAGE = readFileSync('app/pricing/page.tsx', 'utf8')

/** The feature-list block on the homepage: the only part that quotes numbers. */
const cards = HOME.slice(HOME.indexOf('const PRICING_TIERS'), HOME.indexOf('cta: \'Go Pro\'') + 200)
check('the homepage pricing block was found', cards.length > 1000, `${cards.length} chars`)

// ── the copy reads the allowances instead of restating them ─────────────────
{
  for (const [file, src] of [['homepage', HOME], ['billing page', BILLING]] as const) {
    check(`the ${file} reads the tier table`, /from '@\/lib\/tier'/.test(src),
      'a hand-kept mirror is what drifted')
  }
  // The two SELLABLE plans (2026-09-15). Creator and Studio are frozen: their
  // cards are gone from the homepage because nobody new can buy one, so there
  // is no card left to drift. Their allowances still live in TIERS for the five
  // subscribers who keep them, and the billing page still renders a legacy
  // subscriber's own plan as their current one.
  for (const t of SELLABLE_TIERS) {
    check(`the ${t} card interpolates its allowances`,
      new RegExp(`TIERS\\.${t}\\.`).test(cards),
      'a typed number cannot follow the one the server enforces')
  }
  check('the homepage sells only the two plans',
    !/name: 'Creator'/.test(cards) && !/name: 'Studio'/.test(cards),
    'a frozen plan with a live Buy button creates a sixth subscriber on a plan we decided not to support')
  check('the billing page derives its plan rows', /TIERS\[t\]\.postsPerMonth/.test(BILLING))
  check('and offers only the sellable plans',
    /const planDetails = SELLABLE_TIERS\.map/.test(BILLING),
    'the old hardcoded list omitted Amazon entirely, so an Amazon customer saw three plans and none was theirs')
  check('and its prices', /price: TIERS\[t\]\.price/.test(BILLING),
    'three hand-kept price lists is how one of them goes stale unnoticed')
}

// ── no stale figure survives in the rendered copy ───────────────────────────
//
// Scan the feature strings for "<number> <thing>" and compare against what the
// tier actually grants. Only checks the allowances that appear as bare numbers
// in the copy; the point is that a WRONG one cannot sit there quietly.
{
  const NUMERIC: Array<{ key: keyof typeof TIERS.pro; label: RegExp; name: string }> = [
    { key: 'assistantMessagesPerMonth', label: /([\d,]+) AI assistant messages/, name: 'assistant messages' },
    { key: 'photoboothPerMonth', label: /([\d,]+) Photobooth headshots/, name: 'Photobooth headshots' },
    { key: 'collabsPerMonth', label: /([\d,]+) brand[- ](?:collab pitch emails|pitches)/, name: 'brand pitches' },
    { key: 'scriptsPerMonth', label: /([\d,]+) video scripts/, name: 'video scripts' },
    { key: 'postsPerMonth', label: /([\d,]+) generations/, name: 'generations' },
  ]

  // Split the block into one chunk per tier so a figure is checked against the
  // right plan rather than against whichever tier happens to match first.
  const chunk = (t: Tier) => {
    const at = cards.indexOf(`name: '${t[0].toUpperCase()}${t.slice(1)}'`)
    if (at < 0) return ''
    const next = cards.indexOf("    name: '", at + 10)
    return cards.slice(at, next < 0 ? cards.length : next)
  }

  for (const t of SELLABLE_TIERS) {
    const c = chunk(t)
    check(`the ${t} card was located`, c.length > 200, `${c.length} chars`)
    for (const f of NUMERIC) {
      const m = c.match(f.label)
      if (!m) continue
      // An interpolated value renders as ${TIERS...} in source, never as digits.
      // Digits here mean somebody typed a number back in.
      const typed = Number(m[1].replace(/,/g, ''))
      const actual = TIERS[t][f.key] as number | null
      check(`the ${t} card's ${f.name} figure matches the plan`,
        typed === actual,
        `copy says ${typed}, ${t} grants ${actual}`)
    }
  }
}

// ── claims for things that no longer exist ──────────────────────────────────
{
  // LoRA training was retired 2026-05-22; faces are capped by maxFaces and there
  // is no retrain to sell. lib/tier.ts says so at the top of the file.
  check('nothing still sells LoRA retrains', !/LoRA/i.test(cards),
    'the Art Director has used the uploaded selfies directly since May')

  // Deal posts are not a separate monthly number on the shared-pool tiers:
  // dealsPerMonth is null there, meaning they draw from postsPerMonth.
  for (const t of ['studio', 'pro'] as const) {
    if (TIERS[t].dealsPerMonth !== null) continue
    const c = cards.slice(cards.indexOf(`name: '${t[0].toUpperCase()}${t.slice(1)}'`))
    const claim = c.match(/([\d,]+) deal posts/)
    check(`the ${t} card does not invent a deal-post cap`,
      claim === null,
      `copy says ${claim?.[1]} deal posts a month; that plan draws them from its ${TIERS[t].postsPerMonth} generations`)
  }
}

// ── the sanity check on the checker ─────────────────────────────────────────
{
  // If the block-finding above silently matched nothing, every check passes by
  // finding nothing to disagree with.
  check('the scan actually saw real copy',
    /AI assistant messages/.test(cards) && /Photobooth headshots/.test(cards),
    'the slice missed the feature lists, so the checks above prove nothing')
}

// ── /pricing is held to the same rules as the homepage ─────────────────────
{
  check('/pricing reads the tier table', /from '@\/lib\/tier'/.test(PRICING_PAGE),
    'a hand-kept mirror is what drifted, and this page was the last one still hand-kept')
  check('/pricing sells only the two plans',
    !/tier: 'creator'/.test(PRICING_PAGE) && !/tier: 'studio'/.test(PRICING_PAGE),
    'a frozen plan with a live Buy button creates a subscriber on a plan we decided not to support')
  check('and still offers the Amazon plan', /tier="amazon"/.test(PRICING_PAGE),
    'the $99 plan is half the product; a pricing page without it is a pricing page for Pro')
  check('nothing on /pricing still sells LoRA retrains', !/LoRA/i.test(PRICING_PAGE),
    'retired 2026-05-22; there is no retrain to sell')
}

// ── no year in any customer-facing copy ────────────────────────────────────
//
// A hard rule: the year never appears inside a title or a generated copy
// string. A stamped date ("Updated Sep 11, 2026") is fine, and so is a
// copyright line, because neither is a title.
//
// Placeholders count. `placeholder='e.g. "Best Wine Travel Protectors in 2026"'`
// is not decoration, it is an instruction: it teaches the creator to type the
// year into a title that then dates itself the moment the year turns.
{
  const COPY_FILES = [
    'app/page.tsx',
    'app/pricing/page.tsx',
    'app/(dashboard)/buying-guides/page.tsx',
    'app/(dashboard)/comparison/page.tsx',
  ]
  for (const f of COPY_FILES) {
    const src = readFileSync(f, 'utf8')
    // Comments are not copy. Both kinds carry dates legitimately (a changelog
    // note, a "why this changed on 2026-08" rationale), and a scanner that
    // cannot tell a comment from a headline fails the build for prose nobody
    // reads.
    let inBlock = false
    for (const line of src.split('\n')) {
      const t = line.trim()
      if (inBlock) { if (t.includes('*/')) inBlock = false; continue }
      if (t.startsWith('{/*') || t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; continue }
      if (t.startsWith('//') || t.startsWith('*')) continue
      // getFullYear() in a footer or a date formatter is not a title.
      if (/getFullYear\(\)/.test(line)) continue
      const hit = line.match(/(?:for |in |\()(20\d{2})\)?/)
      if (!hit) continue
      check(`${f} puts no year in its copy`, false,
        `"${t.slice(0, 90)}" — a year in a title dates the content the day the year turns`)
    }
  }
}

if (failures.length) {
  console.error(`\n❌ pricing-copy: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ pricing-copy: every advertised allowance is read from the plan the server enforces')
