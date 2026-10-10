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
import { ccShouldHideMissing, ccHideMissingBlock, describeCcMergeOutcome } from '../lib/cc-merge-mode'

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
// 2026-10-07: a member scan writes only the live numbers it read (a field it
// did not read is simply not sent, so the stored value stays), on campaigns
// already in the catalogue; the rest are skipped and counted.
check('a field Amazon left out keeps its value; rows that cannot be stored are skipped, counted', /if \(typeof v !== 'number' \|\| !Number\.isFinite\(v\) \|\| v < 0\) continue/.test(IL) && /skipped\+\+/.test(IL) && /return NextResponse\.json\(\{ ok: true, upserted, skipped, failed, nowFull, unknown, capped \}\)/.test(IL))

// ── Campaigns missing from Amazon's export are marked full, never deleted ─────
{
  const live = { live: 955236 }
  check('a whole export hides what it left out; a partial upload or replace mode does not', ccShouldHideMissing('add-only', 442394, live) && !ccShouldHideMissing('add-only', 40000, live) && !ccShouldHideMissing('add-only', null, live) && !ccShouldHideMissing('replace', 900000, live))
  // 2026-10-10: 105,838 rows (one part of the export) marked the rest full.
  check('the partial upload that emptied the catalogue (105,838 of 955,236) hides nothing, and says why', !ccShouldHideMissing('add-only', 105838, live) && /looks like part of the export/.test(ccHideMissingBlock('add-only', 105838, live) || ''))
  check('Amazon\'s export without spot counts can still hide what it left out', ccShouldHideMissing('add-only', 442394, { live: 955236, stagedHasSpots: false }))
  check('a live count MVP could not read blocks the hide', !ccShouldHideMissing('add-only', 900000, { live: null }))
  const M424 = read('supabase/migrations/424_cc_export_without_counts.sql')
  check('migration 424: a campaign in the export with no count becomes open, count unknown; a real or recent live count is kept', /WHEN EXCLUDED\.available_slot IS NOT NULL THEN EXCLUDED\.available_slot WHEN c\.available_slot > 0 THEN c\.available_slot WHEN c\.last_live_at > now\(\) - interval '24 hours' THEN c\.available_slot ELSE NULL END/.test(M424))
  check('migration 424: missing from the export is full, count known or not', /AND \(c\.available_slot > 0 OR c\.available_slot IS NULL\)/.test(M424) && !/IF NOT EXISTS \(SELECT 1 FROM cc_campaign_catalog_import WHERE available_slot IS NOT NULL\)/.test(M424))
  check('the uploader accepts an export without slot columns and says what that means', /key: 'available_slot', label: 'Open slots', required: false/.test(read('components/admin/CcCatalogUploader.tsx')) && /Amazon&rsquo;s export does not include spot counts/.test(read('components/admin/CcCatalogUploader.tsx')))
  const R = read('app/api/cc/campaigns/route.ts')
  check('"Has open spots" means open or count unknown', /qb\.or\('available_slot\.gt\.0,available_slot\.is\.null'\)/.test(R) && !/qb\.gt\('available_slot', 0\)/.test(R))
  check('the CC page says when everything is marked full, and a card says when the count is unknown', /spotsMissing/.test(R) && /Every campaign in MVP\\'s catalogue is marked full right now/.test(read('app/(dashboard)/cc-campaigns/page.tsx')) && /Spot count not given/.test(read('app/(dashboard)/cc-campaigns/page.tsx')))
  const M = read('supabase/migrations/403_cc_hide_missing.sql')
  check('migration 403 sets open spots to 0 on rows not in staging, and deletes nothing', /SET available_slot = 0/.test(M) && /c\.available_slot > 0/.test(M) && /NOT EXISTS \(\s*SELECT 1 FROM cc_campaign_catalog_import/.test(M) && !/DELETE/i.test(M.replace(/--[^\n]*/g, '')))
  const D = read('app/api/cron/drain-cc-import/route.ts')
  check('the background drain runs the hide pass after an add-only merge, and says when it skipped it', /phase = 'hide'/.test(D) && /rpc\('hide_cc_missing_cursor'/.test(D) && /hideSkipped: 'run migration 403'/.test(D) && /ccHideMissingBlock\(mode, staged, await ccHideFacts\(admin\)\)/.test(D) && /hideSkipped: block/.test(D))
  const A = read('app/api/admin/import-cc-catalog/route.ts')
  check('a foreground add-only merge hands off to the hide pass; "hide missing" works on the merged upload', /hideBlocked = ccHideMissingBlock\(mode, stagedNow, await ccHideFacts\(admin\)\)/.test(A) && /mode === 'hide-missing'/.test(A) && /Nothing was marked full\. \$\{blocked\}/.test(A))
  const P = read('app/(dashboard)/admin/cc-import/page.tsx')
  check('the admin page shows how many were marked full, or that it was skipped and why', /Hide campaigns missing from this upload/.test(P) && /campaigns missing from the upload were marked full/.test(P) && /were NOT marked full/.test(P))
  check('the merge result says the hide is running', /being marked full in the background/.test(describeCcMergeOutcome({ mode: 'add-only', upserted: 10, purged: 0, hiding: true })))
}

if (failures.length) {
  console.error('❌ cc-full guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ cc-full guard passed: full campaigns are said and hidden, live spots refresh after a scan')
