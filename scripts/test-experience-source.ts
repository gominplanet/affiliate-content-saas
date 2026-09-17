// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Can a post claim the creator used a product they never touched?
//
// MVP's reviews are worth something because they are built on a video the
// creator actually shot. The shared writer prompt says so, in these words:
//
//   "TRANSCRIPT IS LAW ... You ARE that reviewer, write in first person, in
//    their voice, only about things THEY experienced."
//
// On the campaign, deal and paste-a-link paths there is no transcript, so
// "things THEY experienced" is an empty set and a model told to write first
// person about an empty set invents the experience. That is not a style problem.
// It is a fabricated account of using a product, published under a real person's
// name.
//
// The campaign path already carried a rule against it. A rule, in a prompt, with
// nothing checking the output, while lib/deal-scrub.ts has enforced exactly this
// on three other paths since the deal hub was built. Asking and never checking
// is the failure mode this codebase keeps rediscovering.
import { resolveExperience } from '../lib/experience-source'
import { scrubReviewLanguage } from '../lib/deal-scrub'
import { readFileSync } from 'fs'
import { join } from 'path'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

// ── a video earns the first person ──────────────────────────────────────────
{
  const r = resolveExperience({ transcript: words(400) })
  check('a real transcript is first-hand experience', r.source === 'video')
  check('so the post may say "I"', r.mayClaimFirsthand === true)
  check('and nothing needs scrubbing', r.mustScrub === false)
  check('but it is still bounded by what was filmed',
    /Do not add an experience you did not describe on camera/.test(r.prompt), r.prompt)
  check('and cannot be rounded up into a longer test',
    /round a small observation up/.test(r.prompt))
}

// ── no video and no note earns nothing ──────────────────────────────────────
// This is the case the campaign, deal and paste-a-link paths are always in.
{
  const r = resolveExperience({ transcript: null })
  check('no source is recognised as no source', r.source === 'none')
  check('the post may not claim first-hand use', r.mayClaimFirsthand === false)
  check('and the output is scrubbed rather than trusted', r.mustScrub === true)
  check('the instruction says plainly that the product was not used',
    /You have NOT used this product/.test(r.prompt), r.prompt)
  check('and names the specific phrasings that smuggle it back in',
    /in our testing/.test(r.prompt) && /after a few weeks/.test(r.prompt) && /my unit/.test(r.prompt))
  check('while still giving the writer something legitimate to do',
    /informed assessment/.test(r.prompt) && /Judgement\s+is yours to give/.test(r.prompt), r.prompt)
  check('and naming the actual harm rather than a style preference',
    /under a real\s+person's byline/.test(r.prompt), r.prompt)
}

// ── a creator note is first-hand experience too ─────────────────────────────
// Seb's rule: a video review is sufficient on its own, so the note is only for
// the paths where there is no video.
{
  const note = 'I have had this on my desk for about three weeks. The clamp marks softwood if you overtighten it, and the USB passthrough only does 5W despite what the box says.'
  const r = resolveExperience({ transcript: null, creatorNote: note })
  check('a substantial note is recognised as experience', r.source === 'creator-note')
  check('so the first person is allowed', r.mayClaimFirsthand === true)
  check('and the output is not scrubbed', r.mustScrub === false)
  check('the note itself reaches the writer verbatim',
    r.prompt.includes('The clamp marks softwood'), r.prompt)
  check('bounded to what the note covers',
    /ONLY for what those notes cover/.test(r.prompt))
  check('and explicitly not stretched into weeks of testing',
    /Do not extend a single observation/.test(r.prompt))
}

// ── a scrap of a note is not experience ─────────────────────────────────────
// Treating three words as a licence would be worse than having no note: it
// would launder an invented review through a creator's throwaway comment.
{
  const r = resolveExperience({ transcript: null, creatorNote: 'Great product, love it.' })
  check('a throwaway comment is not first-hand experience', r.source === 'none', r.source)
  check('and cannot buy a first-person review', r.mayClaimFirsthand === false)
  check('so the output is still scrubbed', r.mustScrub === true)
}

// ── a passing mention is not a review either ────────────────────────────────
{
  const r = resolveExperience({ transcript: 'quick shoutout to this thing, anyway' })
  check('a few seconds of speech is not a test', r.source === 'none', r.source)
  const real = resolveExperience({ transcript: words(90) })
  check('but a real review is', real.source === 'video')
}

// ── a video beats a note, and neither is ignored ────────────────────────────
{
  const both = resolveExperience({ transcript: words(400), creatorNote: 'I used it for a month and the hinge loosened right up on me after a while.' })
  check('a video takes precedence over a note', both.source === 'video')
  check('and the post may still claim first-hand', both.mayClaimFirsthand === true)
}

// ── empty and malformed input never grants a claim ──────────────────────────
{
  for (const bad of [null, undefined, '', '   ', '\n\n']) {
    const r = resolveExperience({ transcript: bad as string | null, creatorNote: bad as string | null })
    if (r.mayClaimFirsthand || !r.mustScrub) {
      check(`empty input (${JSON.stringify(bad)}) grants nothing`, false, r.source)
      break
    }
  }
  check('no empty or blank input ever grants a first-hand claim', true)
}

// ── the scrub actually removes the claims ───────────────────────────────────
// The rule is only worth having if the enforcement does something.
{
  const claimed = '<p>I tested this for three weeks and I bought one for my sister. In my experience the battery lasts all day.</p>'
  const clean = scrubReviewLanguage(claimed)
  check('"I tested this" does not survive', !/I tested this/i.test(clean), clean)
  check('and neither does the rest of the fabricated account',
    !/I bought one/i.test(clean), clean)
  check('while the post still reads as a sentence', clean.length > 40, clean)
}

// ── both generation paths resolve it AND enforce it ─────────────────────────
{
  const strip = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const SVC = strip(readFileSync(join(__dirname, '..', 'services/claude/index.ts'), 'utf8'))
  check('the comment stripper works',
    strip('  // resolveExperience(\nreal code').indexOf('resolveExperience(') === -1)

  const resolved = (SVC.match(/resolveExperience\(\{/g) || []).length
  check('both generation paths resolve the experience', resolved === 2, `${resolved} call sites`)

  const enforced = (SVC.match(/experience\.mustScrub \? scrubReviewLanguage/g) || []).length
  check('and both enforce it on the output, rather than asking and hoping',
    enforced === 2, `${enforced} enforcement points`)

  check('the video path passes the real transcript',
    /resolveExperience\(\{ transcript: video\.transcript/.test(SVC))
  check('the campaign path passes null, because it never has one',
    /resolveExperience\(\{ transcript: null, creatorNote: input\.creatorNote/.test(SVC))
  check('the instruction reaches the writer on both paths',
    (SVC.match(/\$\{experienceBlock\}/g) || []).length === 2,
    'a rule the model never sees is not a rule')
  check('and what backed the post is recorded on the output',
    /experienceSource: experience\.source/.test(SVC),
    'so a post written with no experience is distinguishable afterwards')
}

// ── break tests ─────────────────────────────────────────────────────────────
{
  const breaks: string[] = []
  const broke = (name: string, cond: boolean) => { if (!cond) breaks.push(name) }

  // Break 1: the original bug. No source, but the first person allowed anyway.
  broke('a no-source post claiming first-hand is caught',
    resolveExperience({ transcript: null }).mayClaimFirsthand === false)

  // Break 2: asking without checking, which is what the campaign path did.
  broke('a no-source post that is not scrubbed is caught',
    resolveExperience({ transcript: null }).mustScrub === true)

  // Break 3: a three word note buying a first-person review.
  broke('a throwaway note treated as experience is caught',
    resolveExperience({ transcript: null, creatorNote: 'Great product, love it.' }).source === 'none')

  // Break 4: a passing mention treated as a filmed review.
  broke('a ten word transcript treated as a review is caught',
    resolveExperience({ transcript: 'quick shoutout to this thing, anyway' }).source === 'none')

  // Break 5: the scrub being a no-op, which would make the whole rule theatre.
  broke('a scrub that removes nothing is caught',
    !/I tested this/i.test(scrubReviewLanguage('<p>I tested this for three weeks.</p>')))

  // Break 6: blank input falling through to a claim.
  broke('a blank note granting a claim is caught',
    resolveExperience({ transcript: '   ', creatorNote: '   ' }).mayClaimFirsthand === false)

  for (const b of breaks) failures.push(`BREAK TEST MISSED ${b}`)
}

if (failures.length) {
  console.error(`\n❌ experience-source: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('✅ experience-source: a post only claims what someone actually did, and the output is checked rather than trusted')
