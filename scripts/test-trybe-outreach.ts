// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE OUTREACH KEEPS ITS BRAKES ON, AND SAYS WHAT HAPPENED.
//
// Seb, 2026-10-06: start at 20 requests a day and work up, with time between
// sends "so it doesn't seem like it's a bot doing it". This guard holds the
// cap (rolling 24 hours, unanswered sends counted), the gaps, the draft rules
// (no dashes, no year), and the honest outcome words on screen.
import { readFileSync } from 'node:fs'
import { clampCap, countsTowardCap, nextGapMs, sanitizeScanned, tidyDraft, sendUrl, MIN_GAP_MS, MAX_GAP_MS, BREAK_MS, DEFAULT_DAILY_CAP } from '../lib/trybe-outreach'
import { pageSummary, normalizeSite } from '../lib/trybe-research'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }

// Cap
check('default cap is 20', DEFAULT_DAILY_CAP === 20 && clampCap(undefined) === 20)
check('cap is held to 1..50', clampCap(0) === 1 && clampCap(500) === 50 && clampCap(35) === 35)
const now = Date.parse('2026-10-06T12:00:00Z')
check('a sent request from 23h ago counts', countsTowardCap({ status: 'sent', send_started_at: '2026-10-05T13:00:00Z' }, now))
check('a sent request from 25h ago does not', !countsTowardCap({ status: 'sent', send_started_at: '2026-10-05T11:00:00Z' }, now))
check('an unanswered send counts', countsTowardCap({ status: 'sending', send_started_at: '2026-10-06T11:59:00Z' }, now))
check('a failed send does not', !countsTowardCap({ status: 'failed', send_started_at: null }, now))
check('already requested does not', !countsTowardCap({ status: 'already', send_started_at: '2026-10-06T11:59:00Z' }, now))

// Gaps
for (const r of [0, 0.5, 0.999]) {
  const g = nextGapMs(1, () => r)
  check(`gap ${r} is 45 to 120 seconds`, g >= MIN_GAP_MS && g <= MAX_GAP_MS)
}
check('every fifth send takes a longer break', nextGapMs(5, () => 0) >= BREAK_MS[0])
check('MIN gap is at least 45 seconds', MIN_GAP_MS >= 45_000)

// Scanned input is untrusted
check('a bad brand id is refused', sanitizeScanned({ brandId: '<script>', name: 'X' }) === null)
const ok = sanitizeScanned({ brandId: 'c147d498-df8d-47e0-98c9-156bfbfdaea5', name: ' Next  Meds ', brandUrl: 'https://evil.example/x', totalCreators: '150', trybeScore: '95', creatorEarnings: '$30K+' })
check('a good brand is kept and tidied', !!ok && ok.name === 'Next Meds' && ok.totalCreators === 150 && ok.trybeScore === 95)
check('a send address off TRYBE is dropped', !!ok && ok.brandUrl === null)
check('the fallback send address is on TRYBE', sendUrl('abc123', null).startsWith('https://jointrybe.com/creator/discover?brand='))

// Drafts
const t = tidyDraft('"Hi there — love your Pro Blender – it rocks - truly."')
check('dashes become commas, quotes trimmed', !/[—–]/.test(t) && !/ - /.test(t) && !t.startsWith('"'))
check('long drafts end on a sentence', tidyDraft('Short one. '.repeat(200), 300).endsWith('.'))

// Research parsing
const s = pageSummary('<html><head><title>Acme &amp; Co</title><meta name="description" content="Cold brew kits"></head><body><nav>Menu</nav><h1>Brew better</h1><script>x()</script><p>Our kit.</p></body></html>')
check('summary has title, description, heading, text', s.includes('Acme & Co') && s.includes('Cold brew kits') && s.includes('Brew better') && s.includes('Our kit') && !s.includes('x()') && !s.includes('Menu'))
check('a site without scheme is accepted', normalizeSite('acme.com') === 'https://acme.com/')
check('tracking params are dropped', normalizeSite('https://acme.com/?utm_source=trybe&a=1') === 'https://acme.com/?a=1')

// Prompt and screen
const LIB = readFileSync('lib/trybe-outreach.ts', 'utf8')
check('the prompt forbids a year and invented facts', /Never write a year/.test(LIB) && /NEVER invent facts/.test(LIB))
const UI = readFileSync('components/labs/TrybeOutreach.tsx', 'utf8')
check('unconfirmed is shown apart from sent', UI.includes('Not confirmed') && UI.includes("b.status === 'sent'"))
check('a draft written without the website says so', UI.includes('Website not read'))
const ROUTE = readFileSync('app/api/labs/trybe/route.ts', 'utf8')
check('the cap is enforced on the server at claim', /action === 'claim'[\s\S]*used >= settings\.dailyCap/.test(ROUTE))
check('it is Labs only', ROUTE.includes("canUsePreview('trybe_outreach'"))
const BG = readFileSync('extension/background.js', 'utf8')
check('SCOUT only reports sent when the box closed', /if \(gone\) \{ steps\.push\('closed'\); return \{ outcome: 'sent'/.test(BG))
check('a late SCOUT answer is unconfirmed, never failed', /MVP_TRYBE_SEND[\s\S]{0,200}outcome: 'unconfirmed'/.test(BG))

if (failures.length) { console.error('TRYBE outreach checks failed:\n - ' + failures.join('\n - ')); process.exit(1) }
console.log('trybe-outreach: all checks passed')
