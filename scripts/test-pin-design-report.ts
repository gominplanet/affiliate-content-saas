// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AN OFF-BRAND PIN MUST NOT LOOK LIKE A DESIGNED ONE TO THE CODE.
//
// A scheduled pin went live in the old photo-scene look while the three before
// it carried the account's designed layout. Nothing errored, nothing logged,
// and nobody could have known except by looking at Pinterest. The cause was not
// the fallback existing; a fallback is correct, because a missing pin is worse
// than an off-brand one. The cause was that buildPinAssets returned an
// imageBase64 either way, so "we got bytes" WAS the success signal, and the two
// outcomes were indistinguishable everywhere downstream.
//
// Worse, the prerender cron banked the fallback onto the row as the finished
// pin. The publish cron's fast path then posted it and never ran the
// art-director code at all, so the one path that could have retried was skipped
// by the row we had just filled in.
//
// This guards the thing that actually failed: not "does the designed pin work"
// (it does, three pins in a row prove it), but "can a downgrade ship without
// anybody being able to tell". Every clause below is a way that silence could
// come back.
import { readFileSync } from 'node:fs'
import {
  isDesignedPin, pinWasDowngraded, describePinDowngrade, pinDesignTag,
  isTransientPinDowngrade, type PinDesignOutcome,
} from '../lib/pin-design-outcome'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const ASSETS = live(read('lib/pin-assets.ts'))
const PRERENDER = live(read('app/api/cron/prerender-pins/route.ts'))
const PUBLISH = live(read('app/api/cron/process-scheduled/route.ts'))
const MANUAL = live(read('app/api/blog/pinterest-post/route.ts'))
const PREVIEW = live(read('app/api/blog/pinterest-preview/route.ts'))
const MODAL = live(read('components/PinterestPreviewModal.tsx'))

// ── the outcome is reported at all ──────────────────────────────────────────
{
  check('buildPinAssets returns an outcome',
    /outcome: PinDesignOutcome/.test(ASSETS) && /outcome: \{ design, downgrade/.test(ASSETS),
    'without this the caller cannot tell a designed pin from the old look')
  check('the design is named from what produced the bytes',
    /const design: PinDesign = artDirected/.test(ASSETS),
    'naming it from what was REQUESTED is how the report becomes a wish')

  // The invisible one. No product photo means the designed branch never runs,
  // so there is no throw and nothing to catch. It has to be recorded BEFORE the
  // attempt or it cannot be recorded at all.
  check('a missing product reference is recorded as a downgrade',
    /'no-product-reference'/.test(ASSETS),
    'this is the most common cause and the one with no error to catch')
  check('and it is decided before the attempt, not in a catch',
    ASSETS.indexOf("let downgrade: PinDowngrade") < ASSETS.indexOf('artDirected = await generateArtDirectorPin'),
    'a skipped `if` throws nothing, so a catch block can never see this case')
  check('a null from the art director is recorded',
    /if \(!artDirected\) downgrade = 'art-director-returned-null'/.test(ASSETS))
  check('the cheap composite path is nameable',
    /usedExistingImage = !!rawImage/.test(ASSETS) && /'composite-thumbnail'/.test(ASSETS),
    'this is the exact path that produced the pin that was reported')
}

// ── the prerender cron cannot bank a silent downgrade ───────────────────────
{
  check('prerender checks the design before storing',
    /isDesignedPin\(assets\.outcome\.design\)/.test(PRERENDER),
    'it used to store any imageBase64, which wrote the fallback on as final')
  check('a transient downgrade releases the claim for a retry',
    /isTransientPinDowngrade[\s\S]{0,400}image_media_type: null/.test(PRERENDER),
    'the fast path then skips the row, so fire-time gets its chance')
  check('a deterministic one is banked rather than retried forever',
    /banking the fallback/.test(PRERENDER),
    'a retry loop on a failure that cannot succeed bills an image gen a minute')
  check('and either way it is written down',
    /pin_design: tag/.test(PRERENDER))
}

// ── the publish cron records what shipped ───────────────────────────────────
{
  check('the publish path records the design',
    /pin_design: pinDesignTag\(assets\.outcome\)|pin_design: tag/.test(PUBLISH))
  check('and warns when it is shipping a downgrade',
    /shipping \$\{tag\}/.test(PUBLISH))
  // Against the LIVE source, and against the try/catch rather than the comment
  // that explains it. The first version matched the comment text, which live()
  // strips, so it could never pass; and a comment is not the behaviour anyway.
  check('a failed write never blocks the pin',
    /try \{[^}]*pin_design[\s\S]{0,120}?\} catch/.test(PUBLISH),
    'reporting is not worth losing a post over, and the column may not be applied yet')
}

// ── the manual and bulk path records it too ─────────────────────────────────
//
// Added after the first version shipped. The two crons were instrumented and
// this route was not, which left the path a creator triggers BY HAND with the
// original blind spot: it asks for the designed pin, takes whatever bytes come
// back, and writes down nothing.
{
  check('the manual pin route records what it built',
    /builtDesign = pinDesignTag\(a\.outcome\)/.test(MANUAL))
  check('and warns when it is a downgrade',
    /shipping \$\{builtDesign\}/.test(MANUAL))
  check('it writes pin_design alongside the pin id',
    /pin_design: builtDesign/.test(MANUAL))

  // The honest gap. When the CALLER supplies a pre-composed image, this route
  // did not make it and cannot know how it was made. Guessing 'art-director'
  // there would rebuild the blind spot with more confidence than before.
  check('a caller-supplied image records nothing rather than guessing',
    /let builtDesign: string \| null = null/.test(MANUAL)
      && /builtDesign \?/.test(MANUAL),
    'writing a design we did not produce is a worse lie than writing none')
}

// ── the creator sees it BEFORE they publish ─────────────────────────────────
//
// The database column answers "how often". The preview answers "this one, now,
// while you can still do something about it". The pin that started all this was
// only discoverable by noticing the live pin looked unlike the last three.
{
  check('the preview returns a human note',
    /designNote: describePinDowngrade\(a\.outcome, true\)/.test(PREVIEW))
  check('the modal accepts it', /designNote\?: string \| null/.test(MODAL))
  // The INTERPOLATION, not the condition. `data.designNote && (` is also a
  // substring of the line above it, `data.imageBase64 && !data.designNote &&`,
  // so the first version passed on the clause that HIDES the caption while the
  // note itself rendered nowhere. Break-testing caught it.
  check('and renders it',
    /(?<!!)data\.designNote && \(/.test(MODAL)
      && /\{data\.designNote\}/.test(MODAL)
      && /Not your designed pin/.test(MODAL),
    'the text has to reach the screen, not merely be referenced in a condition')
  check('the modal says nothing on a clean pin',
    /data\.imageBase64 && !data\.designNote/.test(MODAL),
    'a warning slot that also fires on success is one people stop reading')
}

// ── the classification itself ───────────────────────────────────────────────
{
  const o = (design: PinDesignOutcome['design'], downgrade: PinDesignOutcome['downgrade']): PinDesignOutcome =>
    ({ design, downgrade })

  check('the two designed pins count as designed',
    isDesignedPin('art-director') && isDesignedPin('art-director-collage'))
  check('and every fallback does not',
    !isDesignedPin('composite-thumbnail') && !isDesignedPin('scene-overlay')
      && !isDesignedPin('collage-fallback') && !isDesignedPin('none'))

  // The distinction that keeps this from crying wolf: the cheap path is a
  // legitimate configuration, not a fault. Only an unmet REQUEST is a downgrade.
  check('a cheap pin nobody asked to design is not a downgrade',
    !pinWasDowngraded(o('composite-thumbnail', 'not-requested'), false),
    'bulk pushes deliberately skip the art director; flagging those is noise')
  check('the same pin IS a downgrade when the design was requested',
    pinWasDowngraded(o('composite-thumbnail', 'no-product-reference'), true))
  check('a designed pin is never a downgrade',
    !pinWasDowngraded(o('art-director', null), true))

  check('only the transient cause is worth retrying',
    isTransientPinDowngrade('art-director-returned-null')
      && !isTransientPinDowngrade('no-product-reference')
      && !isTransientPinDowngrade('roundup-needs-two-photos')
      && !isTransientPinDowngrade(null),
    'retrying a deterministic failure costs an image generation and changes nothing')

  check('the stored tag carries both halves',
    pinDesignTag(o('composite-thumbnail', 'no-product-reference')) === 'composite-thumbnail:no-product-reference',
    'the design alone does not say WHY, and why is what somebody acts on')
  check('and a clean pin stores no reason',
    pinDesignTag(o('art-director', null)) === 'art-director')
}

// ── the message is for a person, not for us ─────────────────────────────────
{
  const o: PinDesignOutcome = { design: 'composite-thumbnail', downgrade: 'no-product-reference' }
  const msg = describePinDowngrade(o, true) || ''
  check('a downgrade explains itself', msg.length > 30, msg)
  check('in words, not in an enum',
    !/no-product-reference|art-director-returned-null/.test(msg),
    'the token is for a query; the sentence is for the person whose pin looks wrong')
  check('and says what to do about it', /Check that|regenerate/i.test(msg))
  check('nothing is said when nothing went wrong',
    describePinDowngrade({ design: 'art-director', downgrade: null }, true) === null,
    'a report that speaks on success is a report people stop reading')

  // House style, on a string a creator reads.
  for (const d of ['no-product-reference', 'art-director-returned-null', 'roundup-needs-two-photos'] as const) {
    const m = describePinDowngrade({ design: 'composite-thumbnail', downgrade: d }, true) || ''
    check(`no dash punctuation in the ${d} message`, !/[—–]|\s-\s/.test(m), m)
    check(`no year in the ${d} message`, !/\b20\d{2}\b/.test(m))
  }
}

// ── the migration exists and is honest about null ───────────────────────────
{
  const MIG = read('supabase/migrations/344_blog_posts_pin_design.sql')
  check('the column is added idempotently', /add column if not exists pin_design/.test(MIG))
  check('and null is documented as "unknown", not as "designed"',
    /Null means the pin predates this column, NOT that it was designed/.test(MIG),
    'a null read as success would rebuild the exact blind spot this fixes')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
