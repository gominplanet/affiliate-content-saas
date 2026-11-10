// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A SERVER'S ERROR PAGE, IN WORDS, AND ASKED AGAIN WHEN IT PASSES (Seb,
// 2026-11-10: Refresh everything's Meta ads step said "<html> <head><title>502
// Bad Gateway</title> ... cloudflare ...", and the run ended there; the
// morning run "did not start" with no reason given).
import { readFileSync } from 'node:fs'
import { plainServerError, isPassingTrouble, looksLikeHtml, PASSING_WAITS_MS } from '../lib/upstream-words'
import { errText } from '../lib/err-text'
import { autoRunWords } from '../lib/trybe-morning'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }

const seb = '<html> <head><title>502 Bad Gateway</title></head> <body> <center><h1>502 Bad Gateway</h1></center> <hr><center>cloudflare</center> </body> </html>'
const said = plainServerError(seb)
check('the page Seb saw is said in one sentence, naming the error and where it came through', said === "A service MVP's server relies on did not answer (502 Bad Gateway, through Cloudflare). This is usually over within a minute.", said)
check('no HTML is ever shown', !looksLikeHtml(said) && !looksLikeHtml(errText(new Error(seb))) && errText(new Error(seb)) === said)
check('words that are not a page stay as they were', plainServerError('TRYBE refused the request.') === 'TRYBE refused the request.' && errText('Plain words') === 'Plain words')
check('a gateway page or a dropped connection passes on its own, and is asked again', isPassingTrouble(500, seb) && isPassingTrouble(502, '') && isPassingTrouble(504, '') && isPassingTrouble(null, 'Failed to fetch') && isPassingTrouble(null, 'fetch failed') && isPassingTrouble(522, ''))
check('a refusal or a mistake is never asked again', !isPassingTrouble(400, 'Bad request') && !isPassingTrouble(403, 'The daily refresh is for the MVP team.') && !isPassingTrouble(500, 'duplicate key value violates unique constraint') && !isPassingTrouble(404, ''))
check('asked again four times, about half a minute in all', PASSING_WAITS_MS.length === 4 && PASSING_WAITS_MS.reduce((a, b) => a + b, 0) === 37000)

const P = readFileSync('components/labs/TrybeOutreach.tsx', 'utf8')
check('Refresh everything asks again after a passing trouble at every server step, and says it in words if it does not pass', /api\(\{ action: 'catalog_refresh' \}, \{ retry: true \}\)/.test(P) && /api\(\{ action: 'directory_refresh', pay: firstPass \}, \{ retry: true \}\)/.test(P) && /includeMine: true, filters: NO_FILTERS \}, \{ retry: true \}\)/.test(P) && /x\.text = e instanceof Error \? `\$\{plainServerError\(e\.message\)\} It was asked again/.test(P))
check('only reading, or a step that says asking twice does no harm, is asked again', /const again = !body \|\| opts\.retry === true/.test(P))
check('saving Meta ad counts is asked again after a passing trouble', /isPassingTrouble\(r \? r\.status : null, why\)/.test(readFileSync('components/labs/metaAdsRead.ts', 'utf8')))

// The morning run.
check('a morning run whose page could not load tries again every minute for 20 minutes, and tells MVP why', /if \(autoTries === 0\) void api\(\{ action: 'daily_refresh', autoBlocked: `this page could not load: \$\{loadError\}` \}/.test(P) && /if \(autoTries >= 20\) return/.test(P) && /setTimeout\(\(\) => \{ void load\(\)\.then\(\(\) => setAutoTries\(\(n\) => n \+ 1\)\) \}, 60_000\)/.test(P))
check('anything else holding it back is said after 90 seconds', /autoHeldBy\.current = loadError \? '' : loading \? /.test(P) && /autoBlocked: autoHeldBy\.current/.test(P))
check('the server keeps the reason beside the run', /const BLOCKED_KEY = 'daily_refresh_auto_blocked'/.test(readFileSync('app/api/labs/trybe/route.ts', 'utf8')))
const T0 = Date.parse('2026-11-10T11:00:00Z')
const rec = { startedAt: new Date(T0 - 86_400_000).toISOString(), finishedAt: new Date(T0 - 86_000_000).toISOString(), steps: [], blockedAt: new Date(T0 + 30_000).toISOString(), blockedWhy: "this page could not load: A service MVP's server relies on did not answer (502 Bad Gateway, through Cloudflare). This is usually over within a minute." }
const w = autoRunWords(rec, T0, T0 + 3600_000)
check('the card says why the morning run could not start, instead of "open the tab to see why"', w.tone === 'warn' && /but the run could not start: this page could not load: A service/.test(w.text) && !/Open the MVP tab/.test(w.text), w.text)
const old = autoRunWords({ ...rec, blockedAt: new Date(T0 - 86_400_000 * 2).toISOString() }, T0, T0 + 3600_000)
check('a reason from an earlier morning is not given for this one', /did not start in it/.test(old.text))
check('no dashes in what it says', ![said, w.text].some((x) => /[–—]| - /.test(x)))

if (fails.length) { console.error(`❌ upstream-words: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
console.log('✅ upstream-words: a server error page said in words, a passing one asked again in Refresh everything, and a morning run that could not start says why')
