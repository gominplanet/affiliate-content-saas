// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TRYBE PAGE, CLEANED UP (Seb, 2026-10-24: "take your time and fix all
// issues and illogical messes inside of the Trybe feature"). Holds what the
// review of the page around the tabs found:
//   - a first load that failed is said, with Try again, and nothing is
//     saved over settings that never loaded;
//   - ?tab= works for every tab, on every navigation, and a tab stays in the
//     address so a reload keeps it;
//   - the daily refresh calls a partial or fallback collection what it is;
//   - the inbox is read as soon as the TRYBE tab opens, and the automatic
//     jobs wait for it; the daily find says how it went;
//   - SCOUT sending by itself does not lock the page;
//   - "SCOUT did not answer" is not "not allowed";
//   - SCOUT is ticked only at the version sending needs;
//   - team-only parts follow View as, and team-only news stays with the team;
//   - links name where they go, and the referral is said on the link.
import { readFileSync } from 'node:fs'
import { releasesFor } from '../lib/scout-news'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')
const UI = read('components/labs/TrybeOutreach.tsx')

check('a failed first load shows Try again, and nothing saves over unloaded settings', /Your TRYBE page did not load/.test(UI) && /if \(!saved\) \{ toast\.error\('Your TRYBE settings did not load, so nothing was saved/.test(UI))
check('?tab= is read on every navigation, for every tab, inside Suspense', /function TabQueryWatcher\(/.test(UI) && /<Suspense fallback=\{null\}><TabQueryWatcher onTab=\{onTabQuery\} \/><\/Suspense>/.test(UI) && /if \(!t \|\| !TABS\.some\(x => x\.id === t\)\) return/.test(UI))
check('a tab goes into the address', /router\.replace\(`\?tab=\$\{t\}`, \{ scroll: false \}\)/.test(UI))
check('a partial or fallback collection is not "done"', /stopped at page/.test(UI) && /ok && !partial && !fellBack \? 'done'/.test(UI) && /in MVP\\u2019s earlier copy/.test(UI))
check('the inbox is read when the TRYBE tab opens', /was !== 'open' && was !== 'checking' && trybeTab === 'open'\) void loadInbox\(\)/.test(UI))
check('the automatic jobs wait for the TRYBE tab', (UI.match(/if \(ownTab && trybeTab !== 'open'\) return/g) || []).length >= 2)
check('the daily find says how it went wherever you are', /THE DAILY FIND SAYS HOW IT WENT/.test(UI) && !/SCOUT works in a tab behind this one for a few minutes/.test(UI))
check('SCOUT sending by itself does not lock the page', /const busy = !!finding \|\| pageRunning/.test(UI))
check('SCOUT not answering is said as that', /if \(res == null && !ask\) return \{ state: 'no-answer'/.test(read('lib/extension-frame.ts')) && /SCOUT did not answer just now, so MVP cannot tell whether it is allowed on TRYBE/.test(UI))
check('SCOUT is ticked only at the version sending needs', /access !== 'old' && scoutAtLeast\(scoutVersion, SCOUT_TRYBE_OWN_TAB_MIN_VERSION\), title: 'SCOUT up to date'/.test(UI))
check('team-only parts follow View as', /const isAdmin = realAdmin && \(viewTier === null \|\| viewTier === 'admin'\)/.test(UI))
const notes = releasesFor((g) => g !== 'team').flatMap((r) => r.notes.map((n) => n.text))
check('the intro video news is the team\'s until members have it', !notes.some((t) => /intro video goes with every request/.test(t)) && releasesFor(() => true).some((r) => r.notes.some((n) => /intro video/.test(n.text))))
check('links name where they go and the referral is on the link', /Install SCOUT from the Chrome Web Store/.test(UI) && /Join free on TRYBE <span className="font-normal">\(MVP&rsquo;s referral link\)<\/span>/.test(UI) && !/href="\/earnings" className="font-semibold underline">Sync your Amazon videos<\/a>/.test(UI))
check('See all new is not narrowed by a name search or pay filter', /setFilters\(\{ \.\.\.NO_FILTERS, newOnly: true \}\); setNameQ\(''\); setPayType\('any'\)/.test(UI))
check('This week reads the accepted brands for its order', /tab === 'sent' \|\| tab === 'week'\) && !requests\) void loadRequests\(\)/.test(UI))
check('the preview never says an old SCOUT or shows Your stage', /\{!preview && <TrybeStage /.test(UI) && /On your plan, the Top 100 and Meta ads are read with Pro\./.test(UI))

if (fails.length) { console.error('trybe-shell-cleanup failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-shell-cleanup: the TRYBE page loads honestly, deep links work, jobs wait for TRYBE, and team parts follow View as')
