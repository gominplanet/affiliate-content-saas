/**
 * FULL CAMPAIGNS STOP SHOWING AS OPEN.
 *
 * 1. Accept on a full campaign: SCOUT said "Already accepted, you're in",
 *    because Amazon's full page says "accepted creators" and the
 *    already-accepted test ran first. Now full is checked first, a click is
 *    checked against Amazon's answer, and MVP marks the campaign full in the
 *    shared catalogue so it drops out of "Has open spots" for everyone.
 * 2. After a Smart-Scan, the live spot counts for what was scanned go into the
 *    catalogue (ingest-live, which had silently written nothing: it sent the
 *    generated rep_asin and a missing updated_at column).
 *
 * Run: npx tsx scripts/test-cc-full.ts
 */
import { readFileSync } from 'node:fs'
import { liveSpotTerms } from '../lib/cc-live-spots'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

const BG = readFileSync('extension/background.js', 'latin1')

// ── Behaviour: run SCOUT's own accept function against fake pages ─────────────
const src = BG.slice(BG.indexOf('function acceptCampaignInPage() {'), BG.indexOf('// After the click: what did Amazon answer?'))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (bodyText: string, buttons: Array<{ text: string; disabled?: boolean }> = []): any => {
  const els = buttons.map((b) => ({ innerText: b.text, disabled: !!b.disabled, getAttribute: () => null, scrollIntoView: () => {}, click: () => {} }))
  const document = { body: { innerText: bodyText }, querySelectorAll: () => els }
  // eslint-disable-next-line no-new-func
  return new Function('document', `${src}; return acceptCampaignInPage()`)(document)
}
const full1 = run('BREATHE EASY dog cough support. This campaign has reached the maximum number of accepted creators.')
check('a full campaign page is "full", not "already accepted" (the bug)', full1.full === true && full1.ok === false && !full1.already)
check('Amazon\'s words come back with it', /maximum number of accepted creators/.test(full1.said || ''))
check('"no spots left" reads as full', run('Sorry, there are no spots left for this campaign.').full === true)
check('a disabled Accept on a full page is full', run('This campaign is full.', [{ text: 'Accept campaign', disabled: true }]).full === true)
check('a really accepted campaign still reads as accepted', run('You have accepted this campaign. Message the brand.').already === true)
check('an open campaign gets its Accept pressed', run('Commission 50%. 44 of 800 spots left.', [{ text: 'Accept campaign' }]).clicked === 'Accept campaign')

// ── SCOUT wiring ──────────────────────────────────────────────────────────────
check('a full result ends the retries at once', /if \(r && \(r\.ok \|\| r\.full\)\) return r/.test(BG) && /if \(r && r\.full\) return r/.test(BG))
check('a click is checked against what Amazon answered, ignoring wording already there', /func: acceptOutcomeInPage/.test(BG) && /v\.said !== \(r\.preFull \|\| ''\)/.test(BG))

// ── MVP side ──────────────────────────────────────────────────────────────────
const EF = read('lib/extension-frame.ts')
check('a full accept marks the campaign full for everyone, and says so', /if \(resp\.full\) \{/.test(EF) && /\/api\/cc\/campaign-full/.test(EF) && /This campaign is full on Amazon/.test(EF))
const R = read('app/api/cc/campaign-full/route.ts')
check('the route sets open spots to 0 for that campaign only', /\.update\(\{ available_slot: 0 \}\)\.eq\('campaign_id', campaignId\)/.test(R) && /amzn1\\\.campaign/.test(R))
const CC = read('app/(dashboard)/cc-campaigns/page.tsx')
check('a full campaign card reloads away, and bulk accept counts full on its own', /if \(res\.full\) onActed\?\.\(\)/.test(CC) && /full on Amazon \(taken off the list\)/.test(CC))
check('the open-spots filter is what hides them (on by default)', /available_slot/.test(read('app/api/cc/campaigns/route.ts')))

// ── Live spots after Smart-Scan ───────────────────────────────────────────────
check('focus keyword first, else up to 3 distinct brands', JSON.stringify(liveSpotTerms('  dog ', ['A'])) === '["dog"]' && JSON.stringify(liveSpotTerms('', ['Alfa', 'alfa', null, 'Levoit', 'Dreame', 'Anker'])) === '["Alfa","Levoit","Dreame"]')
const SS = read('components/campaigns/SmartScanPanel.tsx')
check('Smart-Scan refreshes live spots for what it scanned and shows the outcome', /refreshLiveSpots\(terms\)/.test(SS) && /Live open spots updated for/.test(SS) && /Could not check live open spots on Amazon this time/.test(SS))
const IL = read('app/api/campaigns/ingest-live/route.ts')
check('ingest-live no longer writes the generated rep_asin or a missing updated_at', !/rep_asin:/.test(IL) && !/updated_at:/.test(IL))
check('a field Amazon left out keeps its value; rows that cannot be stored are skipped, counted', /if \(empty && old\[k\] != null\) m\[k\] = old\[k\]/.test(IL) && /skipped\+\+/.test(IL) && /return NextResponse\.json\(\{ ok: true, upserted, skipped, failed, nowFull \}\)/.test(IL))

if (failures.length) {
  console.error('❌ cc-full guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ cc-full guard passed: full campaigns are said and hidden, live spots refresh after a scan')
