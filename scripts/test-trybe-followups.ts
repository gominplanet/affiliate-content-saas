// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE THREE FOLLOW UPS (Seb, 2026-10-24: "yes do all three"), after the TRYBE
// cleanup:
//   1. a draft written before the core message last changed is marked in
//      Ready to send, with Rewrite (migration 457, core_saved_at);
//   2. a video TRYBE takes from Upload ticks Submitted on its sample in This
//      week, and says so, or says what to tick by hand;
//   3. the setup card points to the TRYBE card instead of repeating its
//      buttons, the TRYBE pop-up waits while SCOUT opens the tab, and the
//      team's Top 100 is one daily chain (filed, then counted) that does not
//      ask TRYBE twice for the same words.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')
const ROUTE = read('app/api/labs/trybe/route.ts')
const UI = read('components/labs/TrybeOutreach.tsx')

// 1. Earlier core message.
const MIG = read('supabase/migrations/457_trybe_core_saved_at.sql')
check('migration 457 adds core_saved_at, safe to run twice', /add column if not exists core_saved_at timestamptz/.test(MIG) && !/drop |alter column/i.test(MIG))
check('the server stamps it only when the words change, on its own', /const coreChanged = coreMessage != null && coreMessage !== \(await readSettings\(admin, ownerId\)\)\.coreMessage\.trim\(\)/.test(ROUTE) && /if \(coreChanged\) \{ try \{ await admin\.from\('trybe_outreach_settings'\)\.update\(\{ core_saved_at: now \}\)/.test(ROUTE) && /coreSavedAt: \(data\?\.core_saved_at/.test(ROUTE))
check('a draft older than it is marked, with Rewrite, one by one or all together', /stale=\{!!coreSavedAt && !!b\.drafted_at && Date\.parse\(b\.drafted_at\) < Date\.parse\(coreSavedAt\)\}/.test(UI) && /From your earlier core message: Rewrite/.test(UI) && /Rewrite the \{old\.length\} from your earlier core message/.test(UI))
check('a hand edit is no longer from the earlier message', /drafted_at: draft \? now : null/.test(ROUTE))

// 2. Upload ticks Submitted.
const UP = read('components/labs/TrybeUpload.tsx')
check('a video TRYBE took ticks Submitted on its one matching sample', /async function tickSubmitted\(/.test(UP) && /action: 'tick', id: hits\[0\]\.id, field: 'submitted', on: true/.test(UP) && /const tick = await tickSubmitted\(v\.choice\)/.test(UP))
check('anything short of a tick is said, apart and in amber', /Tick Submitted in This week for the right/.test(UP) && /This week was not updated/.test(UP) && /color: v\.week\.ok \? '#15803D' : '#B45309'/.test(UP))
check('the picker keeps the product names for the match', /productNames: opts\.products\.filter\(\(pp\) => ids\.includes\(pp\.id\)\)\.map\(\(pp\) => pp\.name\)/.test(read('components/labs/DropTrybePicker.tsx')))

// 3. Setup card and the Top 100.
check('setup steps point to the TRYBE card instead of a second button', /x\.todo = 'Use the TRYBE card at the top of this page\.'/.test(UI))
check('the TRYBE pop-up waits while SCOUT opens the tab', /holdPopup=\{autoOpening\}/.test(UI) && /if \(holdPopup\) return/.test(read('components/labs/TrybeTabGate.tsx')))
check('the team\'s Top 100 is one chain: filed, then counted', /THE TEAM'S TOP 100, ONE DAILY CHAIN/.test(UI) && /if \(countDue\) await readTop100\(true\)/.test(UI) && (UI.match(/await collectTop100\(/g) || []).length === 2)
check('the daily refresh files before it counts', /Filing TRYBE\\u2019s Top 100 for Make videos/.test(UI))
check('counting reuses the words already filed', /from: 'filed'/.test(ROUTE) && /top25 = top25\.filter\(w => !filedBy\.has\(w\.submissionId\)\)/.test(ROUTE))

if (fails.length) { console.error('trybe-followups failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-followups: earlier drafts marked, uploads tick This week, one Top 100 chain and one place to act on TRYBE')
