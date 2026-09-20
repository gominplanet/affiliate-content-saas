// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// STOREFRONT COVERAGE IS A STANDING MAP, NOT A RUN.
//
// The feature this replaces modelled runs: you start one, it scans, it ends.
// That is not a thing in a creator's world, and it produced the same class of
// trap three times in one day. A run left open in another tab. Market ticks
// describing a different run than the numbers underneath them. An error that
// said "press Start a different run" while that button only existed once a run
// was loaded, so the one instruction between the creator and the thing they
// wanted pointed at empty space.
//
// What is actually true: a creator has N videos and M ticked storefronts, and
// every one of those N times M cells has exactly one answer on every day of the
// year. The grid does not start or finish. It drains.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const DRAIN = live(read('app/api/cron/coverage-drain/route.ts'))
const MAP = live(read('app/api/coverage/route.ts'))
const MKTS = live(read('app/api/coverage/markets/route.ts'))
const LIB = live(read('lib/storefront-coverage.ts'))
const M351 = read('supabase/migrations/351_storefront_coverage.sql')
const M352 = read('supabase/migrations/352_coverage_summary.sql')
const VERCEL = read('vercel.json')
const BOARD_RAW = read('components/storefront/CoverageBoard.tsx')
const SYNC_PAGE = read('app/(dashboard)/global-sync/page.tsx')
const LAUNCHPAD = read('app/(dashboard)/launchpad/page.tsx')
const NAV = read('components/layout/DashboardShellV2.tsx')
const SEARCH = read('lib/app-search-index.ts')

// ── it is a grid, and nobody starts it ──────────────────────────────────────
{
  check('one row per video per market, forever',
    /unique \(user_id, video_id, domain\)/.test(M351),
    'a run is not a thing in a creator’s world; "is this video earning in Germany" is')
  check('and the drain needs nobody to press anything',
    /export async function GET\(request: Request\)/.test(DRAIN) && /CRON_SECRET/.test(DRAIN)
    && !/runId/.test(DRAIN),
    'every trap in the feature this replaces came from a run somebody had to start, resume or abandon')
  check('a new video joins the grid on its own',
    /async function enrol/.test(DRAIN) && /await enrol\(sb\)/.test(DRAIN),
    'a grid that only fills when somebody remembers to scan is a run wearing a different word')
}

// ── uploaded is not live ────────────────────────────────────────────────────
{
  check('uploaded and live are separate states',
    /'uploaded'/.test(LIB) && /'live'/.test(LIB) && /uploaded[\s\S]*?not the same as/i.test(M351),
    'collapsing them turns the map into a claim about what was attempted')
  check('and the drain will only ever claim uploaded',
    /state: 'uploaded'/.test(DRAIN) && !/state: 'live'/.test(DRAIN),
    'SCOUT finishing an upload is not the video being on the product page')
  check('the headline counts videos, not rows',
    /count\(distinct c\.video_id\)/.test(M352),
    'a video live in five countries counted as five would flatter the number fivefold')
}

// ── ticking a market and reaching it are different facts ────────────────────
{
  check('the tick and the sign-in are stored apart',
    /enabled\s+boolean/.test(M351) && /signin_state\s+text/.test(M351),
    'a screen that conflates them promises listings in a country the creator cannot reach')
  check('SCOUT reports the fact and never changes the choice',
    /The tick is NOT touched here/.test(read('app/api/coverage/markets/route.ts')),
    'an extension deciding which countries a creator wants is the wrong way round')
  check('an unrecognised sign-in state becomes unknown',
    /VALID_SIGNIN\.has\(String\(s\.status\)\)/.test(MKTS),
    'a state nobody defined renders as a blank label and reads as fine')
  // THE FIELD, not the name. Renaming the local left the identifier in the
  // response and the check passed over a screen that no longer reported it.
  check('and ready in an unreachable market is counted apart',
    /unreachable: readyButUnreachable/.test(MAP),
    'a queue that looks busy while nothing can move is the worst kind of progress bar')
  check('unticking never deletes the work already done',
    /UNTICKING NEVER DELETES/.test(read('app/api/coverage/markets/route.ts')),
    're-ticking Japan next month should not re-follow every redirect and re-dub every video')
}

// ── recency and stock decide the order ──────────────────────────────────────
{
  // THE TERM HAS TO BE APPLIED. `inStock` survives in the signature when the
  // bonus itself is deleted, so the name alone proves nothing.
  check('the order is recency plus stock, in one place',
    /export function coveragePriority/.test(LIB)
    && /if \(inStock\) score \+= \d+/.test(LIB)
    && /score \+= Math\.max\(0, 1000 - days\)/.test(LIB),
    'two copies of a priority rule drift, and the drift is invisible until the wrong thing is done first')
  check('and the drain claims by it',
    (DRAIN.match(/order\('priority', \{ ascending: false \}\)/g) ?? []).length >= 3,
    'a queue that is not ordered by value spends three thousand lookups in upload order')
  check('the index matches the claim so it never scans the finished rows',
    /where state in \('unknown', 'preparing'\)/.test(M351),
    'finished cells are most of the table and it should never pay to skip past them')
}

// ── no number is a page length ──────────────────────────────────────────────
{
  check('the map counts in Postgres',
    /rpc\('storefront_coverage_summary'/.test(MAP) && /security invoker/.test(M352),
    'PostgREST caps a response at 1000 rows, which turned a page length into a total three times')
  check('and a summary it could not read says so',
    /Could not read your coverage/.test(MAP) && /status: 500/.test(MAP),
    'a screen quietly showing zeros is worse than one saying the count could not be read')
  check('the definer trap is avoided',
    !/security definer/.test(M352),
    'a definer function hands any signed-in user the map for anybody else’s account')
}

// ── a failed lookup is never a verdict ──────────────────────────────────────
{
  check('an unreadable track list leaves the cell alone',
    /NOBODY LOOKED/.test(read('app/api/cron/coverage-drain/route.ts')),
    'telling a creator their video cannot reach Germany when nobody looked is the worst thing here')
  check('a product lookup that threw is retried, not recorded',
    /Left alone so the next firing retries it/.test(read('app/api/cron/coverage-drain/route.ts')))
  check('and a failed prepare keeps the pipeline’s own words',
    /could not open a sync job yet/.test(DRAIN),
    'a bare "failed" is a second screen that knows something broke and not what')
}

// ── one pipeline, not two ───────────────────────────────────────────────────
{
  check('preparing writes the same rows a single video writes',
    /from\('global_sync_jobs'\)/.test(DRAIN) && /from\('global_sync_targets'\)/.test(DRAIN),
    'a second delivery path drifts from the one that gets used daily')
  check('and it does not re-implement the localizing',
    !/localizeMetadata|translateScript/.test(DRAIN),
    'the recovery cron already finishes any job nothing has touched for five minutes')
  check('one job per video carries all its markets',
    /targets = g\.rows\.map/.test(DRAIN),
    'a job per country re-renders the same video once per country')
}

// ── it actually runs ────────────────────────────────────────────────────────
{
  check('the drain is scheduled',
    /\/api\/cron\/coverage-drain/.test(VERCEL),
    'a cron nobody calls is a feature that works only in the repository')
}

// ── one feature, one page ───────────────────────────────────────────────────
//
// There were three doors to this job: a Launchpad tab, a Labs page that scanned
// the channel, and Storefront Sync asking for one master video at a time. All
// three ended in the same sync jobs, so the split achieved nothing except
// making a creator choose a door before they could ask their actual question.
{
  // THE JSX, not the import. Swapping the component back while leaving the
  // import line satisfied a check for the name.
  check('Storefront Sync is the whole feature',
    /<CoverageBoard \/>/.test(SYNC_PAGE),
    'the page that used to ask for one master video is where the catalogue lives now')
  check('and the other doors are gone',
    !/BackCatalogueStage/.test(LAUNCHPAD)
    && !/'\/back-catalogue'/.test(NAV)
    && !/'\/back-catalogue'/.test(SEARCH),
    'a retired surface left in the nav is a door onto a model that no longer exists')
  // The SENTENCE that redirects, not any mention of the page. Launchpad names
  // Storefront Sync in several places for other reasons.
  check('Launchpad describes only the job it still has',
    /not on YouTube yet/.test(LAUNCHPAD)
    && /already on your channel are handled on Storefront Sync/.test(LAUNCHPAD),
    'a page promising something it no longer does sends the creator to the wrong place')
  check('the board reads the same delivery queue a single video fills',
    /\/api\/global-sync\/deliver\/queue/.test(BOARD_RAW),
    'a second delivery path drifts from the one that gets used daily')
}

// ── the board is a window, not the worker ───────────────────────────────────
{
  check('ticking a market is all it takes to start',
    /\/api\/coverage\/markets/.test(BOARD_RAW) && !/runId/.test(BOARD_RAW),
    'anything a creator has to start is something they can forget, abandon or start twice')
  // THE CALL. The import survives a board that assumes everyone is signed in.
  check('SCOUT establishes sign-in and the board only reports it',
    /await requestStorefrontPreflight\(ticked\)/.test(BOARD_RAW) && /signin:/.test(BOARD_RAW),
    'a server has no session on amazon.de and would be guessing')
  // THE BUTTON. "Sign in" appears in the toast that follows it too, so the
  // bare phrase passed over a button relabelled to name the problem only.
  check('and a store that is not signed in offers the way to fix it',
    /await requestStorefrontLogin\(domain\)/.test(BOARD_RAW)
    && /<LogIn size=\{12\} \/> Sign in/.test(BOARD_RAW),
    'naming a problem without the button that solves it is the dead end this feature kept producing')
  check('live and uploaded are shown apart on screen',
    /> live<\/span>/.test(BOARD_RAW) && /> uploaded<\/span>/.test(BOARD_RAW),
    'one is confirmed on the storefront and the other is only what SCOUT did')
  check('and unreachable ready listings are said out loud',
    /are prepared for countries you are not signed in to/.test(BOARD_RAW),
    'a queue that looks busy while nothing can move is the worst kind of progress')
}

// ── the migrations ──────────────────────────────────────────────────────────
{
  for (const [name, sql] of [['351', M351], ['352', M352]] as const) {
    const unguarded = (kind: string) =>
      (sql.match(new RegExp(`create ${kind}\\s+(?!if not exists)`, 'gi')) ?? []).length
    check(`migration ${name} is safe to run twice`,
      unguarded('table') === 0 && unguarded('index') === 0,
      `${unguarded('table')} table, ${unguarded('index')} index`)
    check(`migration ${name} drops every policy before creating it`,
      (sql.match(/create policy/gi) ?? []).length === (sql.match(/drop policy if exists/gi) ?? []).length)
  }
  check('351 has RLS on both tables',
    (M351.match(/enable row level security/gi) ?? []).length === 2
    && (M351.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 2)
}

// ── house style ─────────────────────────────────────────────────────────────
{
  const copy = [
    [MAP, MKTS, DRAIN].join('\n').match(/'[^']{25,}'/g)?.join('\n') ?? '',
    BOARD_RAW.match(/>[^<>{}]{30,}</g)?.join('\n') ?? '',
    SYNC_PAGE.match(/subtitle="([^"]*)"/)?.[1] ?? '',
  ].join('\n')
  check('there is copy to check', copy.length > 200, `${copy.length} chars`)
  check('no dash punctuation in the user-facing copy',
    !/[—–]/.test(copy), (copy.match(/.{0,40}[—–].{0,40}/) ?? [''])[0])
  check('no year stamped into the copy', !/\b20\d\d\b/.test(copy))
}

if (failures.length) {
  console.error(`\n❌ coverage: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ coverage: a standing map ordered by value, where uploaded is not live and nobody has to start anything')
