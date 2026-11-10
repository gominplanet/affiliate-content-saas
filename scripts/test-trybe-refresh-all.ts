// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// REFRESH EVERYTHING (Seb, 2026-11-10: "I just want one button that refreshes
// the updates ... the brands, the new brands, the data from tribe ... all of
// the metadata, not just 20 or 30 ... a button that just runs and runs until
// all of the jobs are complete"). The team's Daily refresh became Refresh
// everything. Held on the traps: products had a 40 round cap and stopped the
// first time TRYBE asked to slow down; websites, ranks, Google, TikTok and pay
// lines were never in it (60 websites every 10 minutes, by themselves); a
// press within 12 hours skipped the brand list and the Top 100; and the pay
// line pass looked at the same first 1,000 rows for ever.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

const UI = read('components/labs/TrybeOutreach.tsx')
const run = UI.slice(UI.indexOf('async function dailyRefresh('), UI.indexOf('// OPENED BY SCOUT FOR THE MORNING RUN'))
const ROUTE = read('app/api/labs/trybe/route.ts')
const LIB = read('lib/trybe-directory-refresh.ts')
const CRON = read('app/api/cron/trybe-directory/route.ts')

// The steps, in order, each until done.
check('the run has every job: TRYBE ready, Top 100, brand list, products, websites and how known, Meta ads', ["id: 'trybe'", "id: 'top100'", "id: 'list'", "id: 'products'", "id: 'sites'", "id: 'meta'"].every((x, i, a) => run.indexOf(x) >= 0 && (i === 0 || run.indexOf(a[i - 1]) < run.indexOf(x))))
check('a press reads the brand list and the Top 100 again unless read within the hour (a Stop then a press carries on)', /const DAILY_FRESH_MS = 1 \* 3600_000/.test(UI))
const products = run.slice(run.indexOf("step('products', 'running', 'Reading each brand"), run.indexOf('const split = sum.read'))
check('products run until none is left, with no cap on rounds', /for \(;;\) \{/.test(products) && !/round < 40/.test(products) && /if \(!r\.left \|\| \(!r\.read && !r\.failed\)\) break/.test(products))
check('TRYBE asking to slow down is a pause of a minute, up to five times, not the end', /if \(\+\+slowDowns > SLOW_DOWN_TRIES\) \{ refused = true; break \}/.test(products) && /const SLOW_DOWN_WAIT_MS = 60_000/.test(UI) && /const SLOW_DOWN_TRIES = 5/.test(UI))
const sites = run.slice(run.indexOf('sitesDone = (async () => {'), run.indexOf('// 5. Meta ads for EVERY brand'))
check('websites, ranks, Google, TikTok and pay lines run from the button until none is left', /api\(\{ action: 'directory_refresh', pay: firstPass \}, \{ retry: true \}\)/.test(sites) && /if \(leftAll === 0\) break/.test(sites) && /if \(\+\+idle >= 2\)/.test(sites))
check('that step runs beside the Meta ads, and the run ends only when both have', run.indexOf('sitesDone = (async () => {') < run.indexOf('// 5. Meta ads for EVERY brand') && /\n\s*await sitesDone\n/.test(run) && /if \(sitesDone\) await \(sitesDone as Promise<void>\)\.catch/.test(run))
check('Meta ads still run until every brand is counted', /for \(;;\) \{\n\s*if \(dailyStop\.current \|\| leftRef\.current\)/.test(run) && /\.slice\(0, DAILY_META_CHUNK\)/.test(run))
check('Stop stops every step, and each says so', /stopRest\(\['products', 'sites', 'meta'\], 'Stopped\.'\)/.test(run) && /stopRest\(\['sites', 'meta'\], 'Stopped\.'\)/.test(run) && /why = 'Stopped\.'/.test(sites))

// The server.
const act = ROUTE.slice(ROUTE.indexOf("if (action === 'directory_refresh') {"), ROUTE.indexOf("if (action === 'daily_refresh') {"))
check('the server step is the team’s, and answers with what is left', /if \(tier !== 'admin'\) return NextResponse\.json\(\{ error: 'Refresh everything is for the MVP team\.' \}, \{ status: 403 \}\)/.test(act) && /const left = await directoryLeft\(admin\)/.test(act))
check('the cron and the button run the same passes', /import \{ payLinePass, popularityPass, sitesPass, socialsPass, BUDGET_MS, POP_BUDGET_MS \} from '@\/lib\/trybe-directory-refresh'/.test(CRON) && /from '@\/lib\/trybe-directory-refresh'/.test(ROUTE))
check('what is left counts websites never read, ranks and Google searches never read or over two weeks old, and TikTok checks', /web_rank_checked_at\.is\.null,web_rank_checked_at\.lt\./.test(LIB) && /google_checked_at\.is\.null,google_checked_at\.lt\./.test(LIB) && /\.is\('site_fetched_at', null\)\.not\('website', 'is', null\)/.test(LIB))
check('pay lines go through every brand a page at a time, not the same first 1,000', /\.order\('brand_id', \{ ascending: true \}\)/.test(LIB) && /if \(after\) q = q\.gt\('brand_id', after\)/.test(LIB))
check('the run log keeps all six steps', /\.slice\(0, 8\)\.map\(\(x\) =>/.test(ROUTE))

// The name.
const code = UI.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
check('the button and its card say Refresh everything, and no creator facing words still say Daily refresh', /<RotateCcw size=\{12\} \/> Refresh everything/.test(UI) && /Refresh everything \{daily\.running/.test(UI) && !/'[^'\n]*Daily refresh[^'\n]*'|`[^`\n]*Daily refresh[^`\n]*`|>[^<\n]*Daily refresh[^<\n]*</.test(code))
check('no dashes in the new words', !/[–—]/.test(sites + products))

if (fails.length) { console.error(`❌ trybe-refresh-all: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
console.log('✅ trybe-refresh-all: one button runs every TRYBE job until it is done, the server’s beside SCOUT’s, and Stop keeps what was read')
