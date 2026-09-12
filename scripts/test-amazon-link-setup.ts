// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The setup screen on the tier we advertise was selling a competitor.
//
// /amazon/social opened its Affiliate setup with "Geniuslink is best (it
// geo-routes to each visitor's local store); an Amazon Associates tag alone also
// works." Passport Links did not appear anywhere on the page.
//
// Passport IS geo-routing, it is ours, and it is included in the plan. So a
// paying Amazon subscriber was being sent to open a third-party account to buy a
// feature they had already paid us for, on the first screen the ads deliver them
// to.
//
// It is worse than a missed cross-sell. lib/link-style pickLinkStyle returns
// 'passport' ahead of everything else whenever it is on, so a creator who
// followed the advice and pasted Geniuslink keys would have them silently
// ignored the day they found the toggle. The screen recommending Geniuslink was
// outranked by a switch it never mentioned.
//
// Two things are asserted. The status this panel shows must match what
// pickLinkStyle will actually do, because a panel that describes a setup nobody
// is using is how this went unnoticed. And Passport has to be offered first,
// with a way to turn it on from here.
import { amazonLinkStatus, amazonLinkOptions } from '../lib/amazon-link-setup'
import { pickLinkStyle } from '../lib/link-style'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the panel agrees with the engine ────────────────────────────────────────
//
// The one that matters. If these two ever disagree the screen is lying about
// where a creator's commission is going.
{
  const cases = [
    { passportEnabled: true,  passportCanUse: true,  hasGeniuslink: true,  amazonTag: 'gomin0e-20' },
    { passportEnabled: true,  passportCanUse: true,  hasGeniuslink: false, amazonTag: 'gomin0e-20' },
    { passportEnabled: false, passportCanUse: true,  hasGeniuslink: true,  amazonTag: 'gomin0e-20' },
    { passportEnabled: false, passportCanUse: true,  hasGeniuslink: false, amazonTag: 'gomin0e-20' },
    { passportEnabled: false, passportCanUse: false, hasGeniuslink: true,  amazonTag: '' },
  ]
  for (const c of cases) {
    const shown = amazonLinkStatus(c).style
    const engine = pickLinkStyle({
      passportEligible: c.passportEnabled,
      // The Amazon publish path stores no blog_social_link_mode, so the engine
      // falls through to "geniuslink if keys, else direct" exactly as the panel
      // does.
      mode: null,
      hasBitly: false,
      hasGeniuslink: c.hasGeniuslink,
    })
    // 'tag' and 'none' are both the engine's 'direct': the difference is only
    // whether there is a tag to earn with, which the engine does not model and
    // the creator very much needs told.
    const asEngine = shown === 'tag' || shown === 'none' ? 'direct' : shown
    check(`the panel matches pickLinkStyle for ${JSON.stringify(c)}`,
      asEngine === engine, `panel ${shown} (${asEngine}) vs engine ${engine}`)
  }
}

// ── Passport wins, and the wasted keys are named ────────────────────────────
{
  const both = amazonLinkStatus({ passportEnabled: true, passportCanUse: true, hasGeniuslink: true, amazonTag: 'gomin0e-20' })
  check('Passport is what is reported when it is on', both.style === 'passport')
  check('and the idle Geniuslink keys are called out',
    /not in use/i.test(both.warning ?? ''), String(both.warning),
    )
  check('the warning says how to change it', /[Tt]urn Passport off/.test(both.warning ?? ''), String(both.warning))

  // Passport routes, the tag earns. On is not the same as earning.
  const noTag = amazonLinkStatus({ passportEnabled: true, passportCanUse: true, hasGeniuslink: false, amazonTag: '' })
  check('Passport with no tag is reported as not earning', noTag.earning === false)
  check('and says the tag is what is missing', /Associates tag/.test(noTag.warning ?? ''), String(noTag.warning))
}

// ── the states that should point at Passport ────────────────────────────────
{
  const geni = amazonLinkStatus({ passportEnabled: false, passportCanUse: true, hasGeniuslink: true, amazonTag: 'gomin0e-20' })
  check('a Geniuslink user is told Passport is included',
    /included in your plan/i.test(geni.warning ?? ''), String(geni.warning))
  check('but is still reported as earning', geni.earning === true,
    'their links work; this is a better-option nudge, not a fault')

  const tagOnly = amazonLinkStatus({ passportEnabled: false, passportCanUse: true, hasGeniuslink: false, amazonTag: 'gomin0e-20' })
  check('a tag-only user is told what they lose', /cannot buy from/i.test(tagOnly.detail), tagOnly.detail)
  check('and offered Passport', /Passport/.test(tagOnly.warning ?? ''), String(tagOnly.warning))

  // Never dangle it in front of a plan that cannot have it.
  const freeGeni = amazonLinkStatus({ passportEnabled: false, passportCanUse: false, hasGeniuslink: true, amazonTag: '' })
  check('a plan without Passport is not nagged about it',
    !/Passport/.test(freeGeni.warning ?? ''), String(freeGeni.warning))
  const freeTag = amazonLinkStatus({ passportEnabled: false, passportCanUse: false, hasGeniuslink: false, amazonTag: 'x-20' })
  check('nor on the tag-only path', !/Passport/.test(freeTag.warning ?? ''), String(freeTag.warning))
}

// ── nothing set up is stated plainly ────────────────────────────────────────
{
  const none = amazonLinkStatus({ passportEnabled: false, passportCanUse: true, hasGeniuslink: false, amazonTag: '' })
  check('an unset account is not earning', none.earning === false)
  check('and is told the posts earn nothing', /earn nothing/i.test(none.detail), none.detail)
  check('and what to do about it', /Associates tag/.test(none.warning ?? ''), String(none.warning))
}

// ── the order the options are offered in ────────────────────────────────────
{
  const o = amazonLinkOptions(true)
  check('Passport is first', o[0].key === 'passport')
  check('and marked recommended', o[0].recommended === true)
  check('the tag is second, because everything needs it', o[1].key === 'tag')
  check('Geniuslink is last', o[2].key === 'geniuslink')
  check('and nothing else claims to be recommended',
    o.filter(x => x.recommended).length === 1)
  check('the Geniuslink blurb warns it is outranked',
    /Passport takes priority/i.test(o[2].blurb), o[2].blurb)

  check('Passport is not recommended to a plan that cannot use it',
    amazonLinkOptions(false)[0].recommended === false)
}

// ── the screen itself ───────────────────────────────────────────────────────
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const UI = readFileSync('components/amazon/AffiliateSetup.tsx', 'utf8')
  const PAGE = readFileSync('app/(dashboard)/amazon/social/page.tsx', 'utf8')

  check('the panel reads the Passport setting', /fetch\('\/api\/passport'\)/.test(UI),
    'without it the panel cannot know which method is actually in force')
  check('and reports the computed status rather than its own guess', /amazonLinkStatus\(/.test(UI))
  check('Passport can be switched on from here', /'\/api\/passport'[\s\S]{0,200}?enabled: passport/.test(UI),
    'naming it without a switch just moves the dead end')
  check('a failed switch is not reported as saved',
    /could not be switched/i.test(UI),
    'a green Saved over a toggle that did not move is the failure this file is about')

  // The sentence that started it. Checked against the CODE with comment lines
  // stripped: the note at the top of that file quotes the old copy to explain
  // why it is gone, and a whole-file search would match that forever.
  const stripComments = (src: string) => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  check('the page no longer calls Geniuslink the best option',
    !/Geniuslink is best/.test(stripComments(UI)) && !/Geniuslink is best/.test(stripComments(PAGE)))
  check('the comment stripper works',
    stripComments('  // Geniuslink is best\nreal code').indexOf('Geniuslink is best') === -1,
    'if this fails the check above proves nothing')
  check('and the page walkthrough names Passport',
    /Passport Links/.test(PAGE),
    'step 2 told them to enter a Geniuslink key and never mentioned what they already own')
}

if (failures.length) {
  console.error(`\n❌ amazon-link-setup: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ amazon-link-setup: Passport leads, the panel reports what the engine will actually do, and idle Geniuslink keys are named')
