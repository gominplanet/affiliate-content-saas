// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A SLOT WITH NO NUMBER BESIDE IT READS AS THE CEILING.
//
// A creator running four YouTube channels signed up, saw one channel slot, and
// asked whether MVP could handle four. It handles ten, on Pro. He was on the
// free trial, which connects one.
//
// The screen was not wrong. It said "Connecting more than one YouTube channel
// is a Pro feature", which is true. It named a plan and never named a capacity,
// and somebody holding four channels is asking exactly one question. This is the
// screen where people decide whether to pay, and it was answering a question
// nobody had.
//
// So every state says a number, and the number comes from the tier table rather
// than from a sentence, because a cap written into copy is a second source of
// truth and this codebase has been bitten by several of those already.
import { channelAllowance, multiChannelPlans } from '../lib/channel-allowance'
import { TIERS, SELLABLE_TIERS } from '../lib/tier'
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the premise this whole module rests on ────────────────────────────────
{
  const { names, max } = multiChannelPlans()
  check('some sellable plan still runs more than one channel', names.length > 0 && max > 1,
    `${names.join(', ')} / max ${max} — if this ever stops being true the copy below promises something that is not for sale`)
  check('and the trial still runs exactly one', TIERS.trial.youtubeChannels === 1,
    String(TIERS.trial.youtubeChannels))
  for (const t of SELLABLE_TIERS) {
    check(`${t} has a channel number`, typeof TIERS[t].youtubeChannels === 'number')
  }
}

// ── THE CASE THAT PROMPTED THIS ───────────────────────────────────────────
{
  const a = channelAllowance('trial', 1)
  const { max } = multiChannelPlans()

  check('the trial line says how many the plan connects', /connects one youtube channel/i.test(a.line), a.line)
  check('and names the real ceiling', a.line.includes(String(max)),
    `the creator had four channels and needed to know it does ${max}; ${a.line}`)
  check('and says the limit is the plan\'s, not the product\'s',
    /not the product/i.test(a.line), a.line)
  check('and offers somewhere to go', a.needsUpgrade)
  check('and does not pretend more can be added here', !a.canAddMore)
}

// ── a plan with room says where it stands ─────────────────────────────────
{
  const pro = SELLABLE_TIERS.find(t => TIERS[t].youtubeChannels > 1)
  if (!pro) {
    check('a multi-channel plan exists to test', false)
  } else {
    const cap = TIERS[pro].youtubeChannels
    const a = channelAllowance(pro, 3)
    check('it counts what is connected', a.line.startsWith('3 of '), a.line)
    check('and out of how many', a.line.includes(String(cap)), a.line)
    check('and allows another', a.canAddMore)
    check('and does not push an upgrade', !a.needsUpgrade,
      'nudging somebody who already has room is noise that makes the real nudge worth less')

    const full = channelAllowance(pro, cap)
    check('at the cap it says so', /all \d+ of your plan/i.test(full.line), full.line)
    check('and tells them how to swap', /disconnect one/i.test(full.line), full.line)
    check('and stops offering to add', !full.canAddMore)
    check('and still does not push an upgrade', !full.needsUpgrade,
      'there is no bigger plan to move to; suggesting one would be a dead end')
  }
}

// ── the number is never written by hand ───────────────────────────────────
//
// The whole point. If the copy stopped following TIERS, this screen would go on
// promising a capacity the product had changed.
{
  const { max } = multiChannelPlans()
  const trial = channelAllowance('trial', 0).line
  const numbers = (trial.match(/\d+/g) ?? []).map(Number)
  check('the number in the trial line matches the tier table',
    numbers.every(n => n === max),
    `${numbers.join(', ')} vs max ${max}`)

  // Comparing the OUTPUT cannot catch a hardcoded figure, because today the
  // hardcoded figure would be the right one: writing 10 into the sentence
  // produces exactly the same line as reading 10 from TIERS. It only diverges
  // the day somebody changes the cap, which is the day nobody is looking.
  //
  // So this is checked on the source instead: the sentence has to INTERPOLATE
  // the value. Comments stripped first, because the note above quotes the
  // literal it is warning about.
  const src = readFileSync('lib/channel-allowance.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

  check('the ceiling is interpolated, not typed', /runs up to \$\{max\} channels/.test(src),
    'a number typed into this sentence is a second source of truth, and it reads as correct until the cap changes')
  check('and the cap comes from TIERS', /TIERS\[[^\]]+\]\.youtubeChannels/.test(src))
  check('with no bare two-digit number in the copy',
    !/`[^`]*\b\d{2,}\b[^`]*`/.test(src),
    'the only numbers in these sentences should arrive by interpolation')
}

// ── nothing crashes on a tier we do not recognise ─────────────────────────
//
// This renders on a settings page. An unknown tier string must produce a
// sentence, not a blank space where the explanation was.
{
  for (const junk of [null, undefined, 'nonsense', '']) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = channelAllowance(junk as any, 0)
    check(`"${String(junk)}" still produces a sentence`, a.line.length > 20, a.line)
    check(`"${String(junk)}" is treated as the smallest plan`, a.needsUpgrade,
      'falling back to a generous cap would promise capacity nobody paid for')
  }
}

// ── house style ───────────────────────────────────────────────────────────
{
  const lines = [
    channelAllowance('trial', 0).line,
    channelAllowance('trial', 1).line,
    ...SELLABLE_TIERS.flatMap(t => [
      channelAllowance(t, 0).line,
      channelAllowance(t, TIERS[t].youtubeChannels).line,
    ]),
  ]
  for (const l of lines) {
    check(`no dash punctuation in "${l.slice(0, 40)}…"`, !/[—–]|\s-\s/.test(l))
    check(`no year in "${l.slice(0, 40)}…"`, !/\b20\d{2}\b/.test(l))
    // Creator and Studio are frozen; no screen may name one as a plan.
    check(`no frozen plan named in "${l.slice(0, 40)}…"`,
      !/\b(Creator|Studio)\s+(plan|tier)\b|Upgrade to (Creator|Studio)\b/i.test(l))
  }
}

if (failures.length) {
  console.error(`\n❌ channel-allowance: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ channel-allowance: every state names a number, and the number comes from the tier table')
