// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// When Passport is on and the post goes out without it, somebody has to say so.
//
// passportLinkForUser returned a bare `null` for five different situations, and
// only one of them is "nothing is wrong":
//
//   Passport is switched off            → fall through, correctly, silently
//   the plan does not include Passport  → fall through, silently
//   there is no ASIN to route           → fall through, silently
//   the mint failed                     → fall through, silently
//   the lookup threw                    → fall through, silently
//
// Every caller read that null as the first one. So a creator on the Amazon plan
// with Passport switched on, whose mint failed, published a plain amazon.com
// link, saw a green "Posted", and had nothing anywhere — not the post, not the
// composer, not the Affiliate setup panel — that could have told them the
// geo-routing they turned on did not happen. The panel goes on reporting
// "Passport Links", and it is right to: the SETTING is Passport. Only the post
// knows what the link turned out to be.
//
// This is the same shape as the geni.us-over-Passport bug that shipped 35 posts
// with the wrong link: the screen reported the plan rather than the artifact.
// So the reason is now carried out of the mint, and the Amazon publish path
// turns it into a sentence the creator actually sees.
import { readFileSync } from 'node:fs'
import { passportFallbackNote, type PassportMintReason } from '../lib/passport-links'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const ALL: PassportMintReason[] = ['ok', 'off', 'tier', 'bad-asin', 'mint-failed', 'error']

// ── which reasons are faults, and which are just how things are ─────────────
{
  check('a successful mint says nothing', passportFallbackNote('ok') === null)
  check('Passport switched off says nothing', passportFallbackNote('off') === null,
    'most creators do not use Passport; nagging them on every post is noise')

  for (const r of ['tier', 'bad-asin', 'mint-failed', 'error'] as const) {
    check(`${r} produces a sentence`, typeof passportFallbackNote(r) === 'string' && (passportFallbackNote(r) as string).length > 20)
  }

  // Exhaustive. A reason added later with no note falls through the switch and
  // returns undefined, which reads as "nothing to say" — the failure this file
  // exists to stop, reintroduced quietly.
  for (const r of ALL) {
    check(`${r} is handled at all`, passportFallbackNote(r) !== undefined, 'undefined is not null')
  }
}

// ── the notes are printed as-is, so they have to stand alone ────────────────
{
  for (const r of ALL) {
    const n = passportFallbackNote(r)
    if (n === null) continue
    check(`${r} reads as a complete sentence`, /^[A-Z]/.test(n) && /\.$/.test(n), n)
    // The composer prints the note with no framing of its own. A fragment like
    // "could not mint" would be shown to a creator exactly like that.
    check(`${r} names Passport or the link, not a code`, /Passport|Amazon link/.test(n), n)
  }

  const broke = passportFallbackNote('mint-failed') as string
  check('a failed mint says what the post actually carried', /plain Amazon link/i.test(broke), broke)
  check('and that they are still earning', /tag still earns/i.test(broke), broke)
  check('and what it costs them', /outside the US/i.test(broke), broke,
    )
  check('a failed mint and a thrown lookup read the same to the creator',
    passportFallbackNote('error') === broke,
    'the distinction is ours, not theirs')

  const tier = passportFallbackNote('tier') as string
  check('an ineligible plan is named as a plan problem', /plan/i.test(tier), tier)
}

// ── the Amazon publish path uses it ─────────────────────────────────────────
{
  const SRC = readFileSync('lib/amazon-pin-publish.ts', 'utf8')
  const code = SRC.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  check('the resolver asks WHY, not just whether',
    /passportLinkForUserDetailed\(/.test(code),
    'the plain form cannot tell an off switch from a broken one')
  check('and turns the reason into a note', /passportFallbackNote\(/.test(code))

  // Order matters. The chosen style has to be known BEFORE the mint is
  // attempted, or there is no way to know whether an empty result is normal.
  const styleAt = code.indexOf('getLinkStyle(')
  const mintAt = code.indexOf('passportLinkForUserDetailed(')
  check('the link style is read before the mint is attempted',
    styleAt > -1 && mintAt > -1 && styleAt < mintAt,
    `style at ${styleAt}, mint at ${mintAt}`)

  // The exact line the bug lived on.
  check('the silent catch around the mint is gone',
    !/catch \{ \/\* fall through to normal resolution \*\/ \}/.test(SRC),
    'that comment WAS the bug: it described the fallback and never reported it')

  check('the note is only raised for creators who chose Passport',
    /cfg\.style === 'passport'/.test(code),
    'telling a Geniuslink user their Passport link failed is its own kind of wrong')

  // A post with no ASIN cannot be geo-routed at all. Worth saying to somebody
  // who switched Passport on, and silent for everybody else.
  check('a post with no ASIN is covered too', /passportFallbackNote\('bad-asin'\)/.test(code))
}

// ── the plain wrapper still exists for the other twenty call sites ──────────
{
  const SRC = readFileSync('lib/passport-links.ts', 'utf8')
  check('passportLinkForUser is still exported',
    /export async function passportLinkForUser\(/.test(SRC),
    'twenty call sites read it; changing its shape is a separate job')
  check('and delegates rather than duplicating the rules',
    /passportLinkForUserDetailed\([^)]*\)\)\.url/.test(SRC),
    'two copies of the eligibility ladder is how they drift')

  // The comment that had gone stale. canUsePassport is every PAID plan, Amazon
  // included, and a reader chasing an Amazon link bug would have believed this.
  //
  // Matched on the ASSERTIVE form only. The note that replaced it quotes the old
  // wording to explain why it is gone, and a plain search would fail on that
  // forever — the same trap as scripts/test-amazon-link-setup.ts.
  const asserts = (src: string) => src.split('\n')
    .filter(l => /Studio \+ Pro only/.test(l) && !/"Studio \+ Pro only"/.test(l))
  check('no comment still claims Passport is Studio and Pro only',
    asserts(SRC).length === 0, asserts(SRC).join(' | '))
  check('the quote-aware filter still catches a real claim',
    asserts('// Studio + Pro only — even if the flag is set').length === 1,
    'if this fails the check above proves nothing')
  check('and the tier gate names the plans it actually allows',
    /Creator, Amazon,\s*\n?\s*\/\/\s*Studio, Pro and admin|Creator, Amazon, Studio, Pro and admin/.test(SRC),
    'the next reader needs the true list, not just the absence of a false one')
}

// ── a substituted link does not get a green tick ────────────────────────────
{
  for (const f of ['components/amazon/PostComposer.tsx', 'components/amazon/PinterestComposer.tsx']) {
    const UI = readFileSync(f, 'utf8')
    check(`${f} colours the result by whether there is a note`,
      /result\.note \? 'border-\[#ff9500\]/.test(UI),
      'a substituted link inside a green Posted box is the same as not saying it')
    check(`${f} does not bury the note at 11px grey`,
      !/result\.note && <p className="text-\[11px\]"/.test(UI),
      'it was rendered smaller than the caption hint next to it')
  }
}

if (failures.length) {
  console.error(`\n❌ passport-fallback: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ passport-fallback: a Passport link that never got minted is now a sentence on the post, not a silent plain Amazon URL')
