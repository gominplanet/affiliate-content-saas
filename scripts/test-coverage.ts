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
const M353 = read('supabase/migrations/353_coverage_stock.sql')
const M354 = read('supabase/migrations/354_coverage_dub.sql')
const M355 = read('supabase/migrations/355_coverage_stages.sql')
const DUBLIB = live(read('lib/dub-target.ts'))
const DUBROUTE = live(read('app/api/global-sync/dub/route.ts'))
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

// ── the product check runs BEFORE anything is dubbed ────────────────────────
//
// The drain went product → track list → pipeline, so a product Amazon Japan has
// never sold still got translated, dubbed and given a thumbnail, and the
// creator found out at the upload. That is the most expensive possible moment
// to learn it, and every minute before it was spent on a listing that could not
// exist.
{
  check('there is an existence pass',
    /async function stock\(sb: Sb\)/.test(DRAIN) && /const stocked = await stock\(sb\)/.test(DRAIN),
    'declared and actually called, because a step nothing calls is a comment')

  // THE ORDER, from the source positions. A reordering of these two lines is
  // invisible on every screen, and it puts the whole cost back.
  const stockAt = DRAIN.indexOf('const stocked = await stock(sb)')
  const checkAt = DRAIN.indexOf('const checked = await checks(sb)')
  check('and it runs before the track check that starts the dub',
    stockAt > -1 && checkAt > -1 && stockAt < checkAt,
    'checks() decides the voice and prepare() hands it to the render pipeline; both are downstream of this')

  // THE CLAIM QUERY, which is what actually enforces it. The line order above
  // only decides who goes first in one firing; this is what stops a cell with
  // no answer yet being picked up at all.
  check('a cell with no stock answer cannot reach the dub',
    /\.eq\('state', 'unknown'\)\s*\n?\s*\.not\('asin', 'is', null\)\.not\('stock', 'is', null\)/.test(DRAIN)
    || /not\('stock', 'is', null\)/.test(DRAIN.slice(DRAIN.indexOf('async function checks'))),
    'without this clause the ordering is a convention, and conventions do not survive a refactor')

  // ONLY, and the word has to be tested. The first version of this clause
  // looked for `answer === 'not_listed'`, which stays right there when a second
  // answer is added beside it with an ||, so out of stock could start blocking
  // and the guard would still pass. The body is read whole instead.
  const blocksBody = (LIB.replace(/\s+/g, ' ').match(/function stockBlocks\([^)]*\)[^{]*\{(.*?)\}/) ?? [])[1] ?? ''
  check('and only "not sold there" blocks',
    /not_listed/.test(blocksBody) && !/in_stock|out_of_stock|no_answer/.test(blocksBody),
    `${blocksBody.trim()} — out of stock is temporary and a video prepared today is ready when stock returns`)

  // FOUR ANSWERS. A boolean forces "not sold there" and "nobody could look"
  // into the same value, and Australia has no Keepa domain at all, so every
  // Australian cell would have been recorded as not sold there.
  for (const v of ['in_stock', 'out_of_stock', 'not_listed', 'no_answer']) {
    check(`the stock answer can say ${v}`, new RegExp(`'${v}'`).test(LIB))
  }
  check('Australia is answered as unanswerable, not as absent',
    /marketByDomain\(r\.domain\)\?\.keepa == null/.test(DRAIN) && /'no_answer'/.test(DRAIN),
    'Keepa dropped amazon.com.au, and recording that as "not sold in Australia" is a lie the creator cannot check')
  check('a missing lookup is never a verdict',
    /if \(!p\) continue/.test(DRAIN) && /ABSENT FROM THE RESPONSE/.test(read('app/api/cron/coverage-drain/route.ts')),
    'Keepa returns a product with a null title for an ASIN it has no listing for, so absent means the request failed')
  check('the blocked reason names one country',
    /Amazon does not sell this product in \$\{country\}/.test(DRAIN)
    && /THE DOMAIN IS PART OF THE KEY/.test(read('app/api/cron/coverage-drain/route.ts')),
    'grouping without the domain named every country in the group on a cell blocked in one of them')

  // The pool is shared with Deal Radar and the Finder, and this fires every
  // minute.
  check('it yields the Keepa pool to interactive use',
    /fetchKeepaTokenStatus/.test(DRAIN) && /MIN_KEEPA_TOKENS/.test(DRAIN),
    'a background grid spending the pool every minute starves the screens somebody is waiting on')
  check('and answers are shared across creators',
    /from\('passport_asin_market'\)/.test(DRAIN),
    'two creators promoting the same product should pay for one lookup between them')

  // THE SCREEN. A check that has stopped running must not read as progress.
  check('waiting on the product check is counted apart from being prepared',
    /and stock is null/.test(M355) && /'checking'/.test(M355)
    && /checking: checking\.get\(m\.domain\) \?\? 0/.test(MAP),
    'a Keepa key that expired would otherwise show as steady progress forever')
  // THE SECOND WAIT TOO. The track check needs the ingest service and working
  // cookies, and when either is down it returns nothing and touches no rows.
  // Folded into 'preparing' that is indistinguishable from work in progress,
  // which is the same bug one step further along.
  check('and so is waiting on the language check',
    /and stock is not null/.test(M355) && /'tracking'/.test(M355)
    && /tracking: tracking\.get\(m\.domain\) \?\? 0/.test(MAP),
    'it breaks for completely different reasons than the product check, so one number for both can only say "something is happening"')
  check('and the board says both in words',
    /checking the product/.test(BOARD_RAW) && /checking the audio/.test(BOARD_RAW),
    'a number with no label is the silence this codebase keeps producing')
  // Subtracting BOTH. Leaving one in would double-count it: once under its own
  // heading and again inside "being prepared".
  check('and neither is also counted as being prepared',
    /- \(checking\.get\(m\.domain\) \?\? 0\) - \(tracking\.get\(m\.domain\) \?\? 0\)/.test(MAP),
    'a cell shown under two headings at once makes the row add up to more than the market has')
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

  // STOCK MEANS STOCK. The drain passed `dubbed` as `inStock`, so "YouTube
  // already has French" and "the product is buyable in France" landed in the
  // same slot while the column comment and the screen both said stock.
  check('and the stock term is fed the stock answer',
    /inStock: cell\.stock === 'in_stock'/.test(DRAIN)
    && !/inStock: dubbed/.test(DRAIN),
    'passing "already dubbed" as stock made the ordering mean something other than what it says')
  check('cheap to deliver is its own, smaller term',
    /alreadyDubbed\?: boolean \| null/.test(LIB)
    && /if \(alreadyDubbed\) score \+= \d+/.test(LIB)
    && /alreadyDubbed: dubbed/.test(DRAIN),
    'a free dub is worth something, just not the same thing as a product somebody can buy')
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

// ── the grid dubs its own videos, and ready means ready ─────────────────────
//
// THE WORST BUG THIS FEATURE HAS HAD. /api/global-sync/dub needs a signed-in
// creator and the only caller was the browser, so the background grid created
// the sync job, let the recovery cron translate the title and description, and
// marked the cell ready. Nothing dubbed. The delivery queue serves the master
// render when a target has no dubbed file, so amazon.fr would have received a
// French title, a French description and ENGLISH AUDIO, reported as ready the
// whole way. Invisible from every angle except a French shopper pressing play.
{
  check('the background lane dubs',
    /async function dubs\(sb: Sb\)/.test(DRAIN) && /const audio = await dubs\(sb\)/.test(DRAIN),
    'declared and actually called; a step nothing calls is a comment')

  // ONE LANE. A second copy in the cron is where the YouTube-track-first
  // ordering stops happening with nothing on screen to show it.
  check('through the same function the browser uses',
    /import \{ dubTarget \} from '@\/lib\/dub-target'/.test(DRAIN)
    && /dubTarget\(\{/.test(DRAIN) && /dubTarget\(/.test(DUBROUTE),
    'two implementations of the dub drift, and the drift only shows to a shopper')
  check('and the cron does not re-implement it',
    !/synthesizeSpeech|renderDub|translateScript/.test(DRAIN),
    'the moment the cron synthesizes its own audio there are two lanes')
  // THE ORDERING, not the import. Deleting the track branch leaves both names
  // sitting in the import line, so the identifiers alone proved nothing and
  // this clause passed over a lane that had stopped checking. The position is
  // what the claim is actually about: free audio must be looked for before any
  // of the paid work starts. scripts/test-youtube-dub-track pins the same rule
  // in more detail; it is repeated here because this is the file somebody reads
  // when they touch the background lane.
  const trackAt = DUBLIB.indexOf('hasAudioTrack(tracks, marketLang)')
  const translateAt = DUBLIB.indexOf('await translateScript(')
  check('the lane still tries YouTube’s own track first',
    trackAt > -1 && translateAt > -1 && trackAt < translateAt,
    'it is already translated, already timed to the picture and already paid for')

  // NO CREDIT WITHOUT A PERSON. The cloned voice is the only paid lane.
  check('the background never spends a cloned-voice credit',
    /requestedStandard: true/.test(DRAIN),
    'nobody is present to agree to spending one, and the standard voice is free')

  // READY MEANS READY. This is the actual fix.
  check('a market that needs a dub is not called ready when its job opens',
    /const dubIds = g\.rows\.filter\(\(r\) => marketByDomain\(r\.domain\)\?\.needsTranslation\)/.test(DRAIN)
    && /\.update\(\{ sync_job_id: job\.id, reason: null, updated_at: now \}\)\.in\('id', dubIds\)/.test(DRAIN),
    'marking every market ready at job creation is exactly what shipped English audio to amazon.fr')
  check('and only reaches ready once the audio exists',
    /if \(target\.video_url\)/.test(DRAIN) && /state: 'ready'/.test(DRAIN),
    'ready has to mean ready or the whole board is a claim again')
  check('the English stores are still ready straight away',
    /const englishIds = g\.rows\.filter\(\(r\) => !marketByDomain\(r\.domain\)\?\.needsTranslation\)/.test(DRAIN),
    'they take the master as it is, and holding them behind a dub they do not need would be a different lie')

  // NO SECOND JOB. Leaving a cell in 'preparing' would have prepare() pick it
  // up again and re-render the whole video.
  check('a cell waiting on its dub is not re-prepared',
    /\.eq\('state', 'preparing'\)\.is\('sync_job_id', null\)/.test(DRAIN),
    'a second job per video re-renders everything a second time')

  // A DUB THAT KEEPS FAILING SAYS SO.
  check('a failing dub stops and names the reason',
    /DUB_TRIES/.test(DRAIN) && /could not produce the \$\{mkt\.langName\} audio after/.test(DRAIN),
    'sitting in preparing forever is the silence that looks exactly like work in progress')
  check('the try is counted before the attempt',
    DRAIN.indexOf('dub_attempts: tries + 1') < DRAIN.indexOf('const res = await dubTarget'),
    'a render that kills the function would never record the try and the cell would retry forever')
  check('a video with no transcript blocks instead of retrying',
    /res\.noTranscript/.test(DRAIN) && /nothing to translate into speech/.test(DRAIN),
    'that one does not fix itself, so two more tries buy nothing')
  check('the voice is recorded from what ran',
    /voice: res\.voice/.test(DRAIN),
    'a YouTube track and our own synthesis are the same URL from the outside')

  // THE UPLOAD. The queue's master fallback is correct for English and for a
  // deliberate skip, and is always an unfinished dub here.
  check('the board never uploads a market still missing its dub',
    /audioIsMasterFallback/.test(BOARD_RAW) && /const items = all\.filter/.test(BOARD_RAW),
    'the queue falls back to the master, which is English audio under a translated title')
  check('and says so rather than dropping them quietly',
    /still waiting on their translated audio/.test(BOARD_RAW)
    && /held back until their translated audio is ready/.test(BOARD_RAW),
    'a silent filter is how four of five reads as complete')
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

  // THE FIVE MINUTE WINDOW. drain-global-sync only claims a job nothing has
  // touched for five minutes, and that exists so it never races the request
  // driving it. There is no request here and there never will be, so the window
  // was dead time paid on every batch of six videos.
  check('the job is handed over immediately, not in five minutes',
    /STALL_AFTER_MS/.test(DRAIN) && /updated_at: handOver/.test(DRAIN),
    'nobody is driving these jobs, so the anti-race window is pure waiting')

  // AFTER THE TARGETS EXIST. A backdated job with no targets yet reads as
  // "nothing left to localize", and the recovery cron closes it out as done,
  // taking every market on it with it.
  const targetsAt = DRAIN.indexOf("from('global_sync_targets').insert(targets)")
  const handOverAt = DRAIN.indexOf('updated_at: handOver')
  check('and only once its markets are written',
    targetsAt > -1 && handOverAt > -1 && targetsAt < handOverAt,
    'a job handed over empty is closed as done and every market on it is lost')
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
  for (const [name, sql] of [['351', M351], ['352', M352], ['353', M353], ['354', M354], ['355', M355]] as const) {
    const unguarded = (kind: string) =>
      (sql.match(new RegExp(`create ${kind}\\s+(?!if not exists)`, 'gi')) ?? []).length
    check(`migration ${name} is safe to run twice`,
      unguarded('table') === 0 && unguarded('index') === 0,
      `${unguarded('table')} table, ${unguarded('index')} index`)
    check(`migration ${name} drops every policy before creating it`,
      (sql.match(/create policy/gi) ?? []).length === (sql.match(/drop policy if exists/gi) ?? []).length)
  }
  // A column added to a table that is not there takes the whole file down on
  // the line it happens to be on, and "relation does not exist" is not an
  // instruction. The first draft of 353 died exactly this way.
  check('353 names the migration to run when a prerequisite is missing',
    /Run migration 351 first/.test(M353) && /Run migration 294 first/.test(M353),
    'Seb pastes these into the SQL editor and the error is all he gets')
  check('and it does not take the geo work down over another feature’s cache',
    /raise notice/i.test(M353) && /keepa_product_cache/.test(M353),
    'that column belongs to the EPC enrichment and nothing in coverage reads it')
  // ONE LIVE DEFINITION, and it is the newest. Re-running an older copy would
  // silently drop a count the board reads, and the board would then show zero
  // rather than an error.
  check('the summary\u2019s live definition is the newest migration',
    /create or replace function public\.storefront_coverage_summary/.test(M355)
    && /Supersedes the copies in 352 and 353/.test(M355)
    && /SUPERSEDED BY 353/.test(M352),
    'an earlier copy re-run after this one takes a count away and the screen shows zero instead of saying so')
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
