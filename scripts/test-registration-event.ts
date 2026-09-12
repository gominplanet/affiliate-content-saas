// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The event the ad campaign optimizes on has to actually fire.
//
// WHAT HAPPENED. The Amazon campaign's ad set optimizes on
// COMPLETE_REGISTRATION. Over its first two days the pixel received 758
// PageViews, 57 ViewContents, 6 InitiateCheckouts, one Purchase and 2 Leads,
// and ZERO CompleteRegistrations, from browser or server. Meta's own campaign
// `results` field read "Not available" for that indicator. So delivery was
// being steered towards people who perform an action Meta had never once
// observed, and it was priced accordingly: $85 CPM and $5.78 per link click,
// against $56 and $1.87 on the previous campaign.
//
// The event was reported from /onboarding, two ways, on the theory that every
// new account renders that page. For a PAID buyer that was never true:
// /api/auth/signup-paid creates the account already-confirmed and returns a
// Stripe Checkout URL whose success_url is /billing, so they never come back
// through the auth callback and never render /onboarding. There was no code
// path for their registration to fire on.
//
// THE RULE THIS FILE DEFENDS. A registration is reported from the server
// routes a registration cannot avoid, never from a page that merely tends to
// get rendered. Today that is the email-confirmation callback and the paid
// signup route. Both halves carry registrationEventId so Meta counts one
// conversion, and both log when Meta refuses, because a tracking call that
// quietly returns false is indistinguishable from no signups at all.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const CALLBACK = read('app/api/auth/callback/route.ts')
const PAID = read('app/api/auth/signup-paid/route.ts')
const ONB = read('app/onboarding/page.tsx')
const REG = read('lib/meta-registration.ts')
const CAPI = read('lib/meta-capi.ts')

// ── both chokepoints report ─────────────────────────────────────────────────
{
  check('the email-confirmation callback reports the registration',
    /reportRegistration\(/.test(CALLBACK) && /source: 'email-confirmation'/.test(CALLBACK),
    'this is where a trial registration actually completes')

  check('the paid signup route reports the registration',
    /reportRegistration\(/.test(PAID) && /source: 'paid-signup'/.test(PAID),
    'a paid buyer never reaches the auth callback or /onboarding, so if this goes, they go uncounted')

  check('neither blocks the response on Meta',
    /after\(async \(\) => \{/.test(CALLBACK) && /after\(async \(\) => \{/.test(PAID),
    'a slow Graph call must not delay a confirmation redirect or a checkout handoff')
}

// ── /onboarding must NOT be the source of truth again ───────────────────────
{
  check('/onboarding no longer reports the registration',
    !/CompleteRegistration/.test(ONB) || !/sendMetaEvent|MetaTrack event="CompleteRegistration"/.test(ONB),
    'reporting it from a page produced zero events while the campaign optimized on it')
  check('/onboarding does not call the Conversions API at all',
    !/sendMetaEvent/.test(ONB))
  check('and does not carry a CompleteRegistration browser tag',
    !/event="CompleteRegistration"/.test(ONB))
}

// ── one conversion, not two, and not a fresh one on every login ─────────────
{
  check('the reporter dedups on the account id',
    /registrationEventId\(opts\.userId\)/.test(REG),
    'so a repeat send collapses into one conversion instead of inflating the metric')
  check('registrationEventId is still derived from the user id alone',
    /return `reg_\$\{userId\}`/.test(CAPI))
  check('the callback only counts a genuinely new account',
    /isNewAccount/.test(CALLBACK) && /created_at/.test(CALLBACK),
    'a future magic-link or recovery flow through this route must not re-report an old account')
}

// ── a refusal has to be visible ─────────────────────────────────────────────
{
  check('the callback logs when Meta refuses the event',
    /console\.error\([^)]*CompleteRegistration NOT accepted/.test(CALLBACK),
    'silence and zero signups looked identical for two days; they must not again')
  check('the paid route logs when Meta refuses the event',
    /console\.error\([^)]*CompleteRegistration NOT accepted/.test(PAID))
  check('sendMetaEvent still returns the real outcome rather than the attempt',
    /Returns true only when Meta actually accepted/.test(CAPI))
  check('each send says which route it came from',
    /registration_source: opts\.source/.test(REG),
    'so a gap is attributable to one route rather than to registrations in general')
}

if (failures.length) {
  console.error(`\n❌ registration-event: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ registration-event: reported from the two routes a signup cannot avoid, deduped per account, and loud when Meta refuses')
