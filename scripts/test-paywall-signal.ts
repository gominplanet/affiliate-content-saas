// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Registrations look healthy and nobody upgrades" has two opposite causes.
//
// The Amazon campaign advertises the $79 tier: publishing to three channels from
// one screen, pitches written for you. Both are withheld from the free trial on
// purpose. That is the funnel: the creator makes a design, holds it, and the
// publish button is the wall.
//
// If upgrades do not come, the reporting between CompleteRegistration and a
// purchase is empty, and these two look identical:
//
//   the ad brought people who were never going to pay
//   the ad brought the right people and they never got as far as the wall
//
// One is an audience problem, the other is a product problem, and acting on the
// wrong one costs a week of spend. So reaching the paywall is its own event.
//
// Two things have to stay true or the number lies: it must fire from every
// surface that refuses a paid capability, and it must count people rather than
// clicks.
import { paywallEventId, type PaywallSurface } from '../lib/paywall-signal'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── one person, not one click ───────────────────────────────────────────────
{
  const a = paywallEventId('user-1', 'publish-facebook')
  check('the id is stable for the same person and surface',
    a === paywallEventId('user-1', 'publish-facebook'),
    'Meta dedupes on event_id; an unstable id turns one frustrated creator into five conversions')
  check('different people are different events',
    a !== paywallEventId('user-2', 'publish-facebook'))
  check('different surfaces are different events',
    a !== paywallEventId('user-1', 'publish-instagram'),
    'hitting the publish wall and the pitch wall are two different findings')
  check('the id names the surface', a.includes('publish-facebook'), a)
}

// ── every wall reports ──────────────────────────────────────────────────────
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')

  const WALLS: Array<[string, PaywallSurface]> = [
    ['app/api/amazon/fb/route.ts', 'publish-facebook'],
    ['app/api/amazon/ig/route.ts', 'publish-instagram'],
    ['app/api/amazon/pin/route.ts', 'publish-pinterest'],
    ['app/api/collaborations/generate/route.ts', 'brand-pitch'],
  ]
  for (const [file, surface] of WALLS) {
    const src = readFileSync(file, 'utf8')
    check(`${surface} reports when it refuses`,
      new RegExp(`reportPaywallReached\\([^)]*surface: '${surface}'`).test(src),
      'a wall that does not report is a wall nobody can prove anyone reached')
    // Before the refusal, so a return added above it later cannot orphan the
    // call without the diff looking wrong.
    check(`and reports before it returns 403`,
      src.indexOf(`surface: '${surface}'`) < src.indexOf('403', src.indexOf(`surface: '${surface}'`)),
      file)
  }

  // The publish refusals carry a machine-readable code so the UI can offer an
  // upgrade rather than render a paid-plan sentence as a generic red error.
  for (const [file] of WALLS.slice(0, 3)) {
    const src = readFileSync(file, 'utf8')
    check(`${file} marks the refusal as an upgrade, not an error`,
      /code: 'upgrade_required'/.test(src))
  }

  // A CUSTOM event. Teaching a campaign to optimise for people who hit a
  // paywall is the exact opposite of what anybody wants, and Meta optimises on
  // standard events.
  const LIB = readFileSync('lib/paywall-signal.ts', 'utf8')
  check('the event is custom', /eventName: 'PaywallReached'/.test(LIB))
  for (const standard of ['Purchase', 'InitiateCheckout', 'CompleteRegistration', 'Lead', 'AddToCart']) {
    check(`it is not reported as ${standard}`, !new RegExp(`eventName: '${standard}'`).test(LIB),
      'a standard event here would steer delivery toward people who cannot pay')
  }

  // Telemetry must never be in the path of the answer the creator is waiting on.
  check('the report is fire-and-forget', /void sendMetaEvent\(/.test(LIB),
    'awaiting a Graph call adds its latency to a refusal that is already decided')
  check('and it swallows its own failures', /\.catch\(\(\) => undefined\)/.test(LIB))
}

if (failures.length) {
  console.error(`\n❌ paywall-signal: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ paywall-signal: every wall reports once per person, as a diagnostic and not as something to optimise for')
