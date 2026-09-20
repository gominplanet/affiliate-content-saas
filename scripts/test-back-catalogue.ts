// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BACK CATALOGUE ENDS IN LISTINGS, AND NAMES EVERY VIDEO IT SKIPS.
//
// YouTube auto-dubs part of a channel. One creator: 197 of 525 videos already
// carry a German track, which is 197 amazon.de listings available at no dub
// cost. MVP could not see any of them, because it only ever looked at the one
// video being published.
//
// TWO THINGS THIS MUST NOT BECOME, and both are the easy version to build.
//
//   A DOWNLOADER. Scan the channel, fetch the dubbed files, hand over a folder.
//   That is a to-do list: the creator still opens Creator Hub, picks the
//   marketplace, uploads, retypes the title and attaches the ASIN, which is
//   nearly all of the work and exactly what MVP exists to remove. A run goes
//   through the normal storefront pipeline and no file reaches their machine.
//
//   A PERCENTAGE. "197 of 525" is what a bulk scanner reports and it explains
//   nothing about the other 328. Every video that is not going carries a
//   reason, because "no German track" and "no product attached" are different
//   problems and only one of them is the creator's to fix.
//
// TWO CLAUSES HERE ARE PAID FOR IN A FAILED TEST RUN. The first version of this
// feature told a creator that 885 of his 1000 videos had no product attached. It
// read youtube_videos.asin, which is only written at blog-generation time, while
// the sync pipeline resolves the ASIN out of product_url. And the 1000 was the
// query cap presented as if it were his channel. Both are guarded below.
import { readFileSync } from 'node:fs'
import { MARKETS } from '../lib/markets'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const START = live(read('app/api/catalogue/start/route.ts'))
const SCAN = live(read('app/api/cron/catalogue-scan/route.ts'))
const QUEUE = live(read('app/api/catalogue/queue/route.ts'))
const STATUS = live(read('app/api/catalogue/[id]/route.ts'))
const STAGE_RAW = read('components/launchpad/BackCatalogueStage.tsx')
const STAGE = live(STAGE_RAW)
const LAUNCHPAD_RAW = read('app/(dashboard)/launchpad/page.tsx')
const LABS_RAW = read('app/(dashboard)/back-catalogue/page.tsx')
const M347 = read('supabase/migrations/347_catalogue_runs.sql')
const M348 = read('supabase/migrations/348_catalogue_multi_market.sql')

// ── it delivers, it does not download ───────────────────────────────────────
{
  check('the run hands videos to the normal storefront pipeline',
    /\/api\/global-sync\/start/.test(QUEUE),
    'a separate back-catalogue delivery path would drift from the one that gets used daily')
  // Mechanism, not vocabulary. An earlier version of this clause grepped for the
  // WORD "download" and fired on the copy promising the creator downloads
  // nothing, which is the one sentence here most worth keeping.
  check('and nothing in it produces a file for the creator',
    !/createObjectURL|blob:|content-disposition|download\s*=|\.download\b|\.mp4['"`]/i
      .test(QUEUE + START + STAGE),
    'the moment this hands over a file it becomes a to-do list instead of a feature')
  check('the screen says the creator downloads nothing',
    /You never download anything/.test(STAGE_RAW))
}

// ── the product is resolved the way the pipeline resolves it ────────────────
//
// THE 885. Gating on the asin column alone reported "no product attached" for
// nearly a whole catalogue, because that column is written at blog-generation
// time and product_url is the one that is actually populated.
{
  check('the ASIN falls back to the product link',
    /asinFromAmazonUrl\(/.test(START) && /product_url/.test(START),
    'youtube_videos.asin is empty on most of a catalogue; product_url is where the link lives')
  check('and the enumeration reads product_url out of the table',
    /select\([^)]*product_url/.test(START),
    'the fallback cannot fire on a column the query never asked for')
}

// ── a cap is never presented as a total ─────────────────────────────────────
{
  check('the true catalogue size is counted, not assumed',
    /count: 'exact', head: true/.test(START) && /total/.test(START),
    'without the real number the cap becomes the number on screen')
  check('and the screen says when it is looking at a slice',
    /out of \{scope\.total\}/.test(STAGE_RAW),
    '"1000 videos" when a creator has 3412 is a false statement about their channel')
}

// ── every skipped video has a reason ────────────────────────────────────────
{
  check('the item table stores a reason',
    /reason\s+text/.test(M347))
  check('an ineligible video is kept, not dropped',
    /state: 'skipped'/.test(START) && /reason:/.test(START),
    'dropping it leaves a count with no way to find out what happened to the rest')
  check('the two up-front reasons are distinguished',
    /not on YouTube/.test(START) && /no product attached/.test(START),
    'one is unfixable and the other is a missing ASIN; a single "skipped" tells the creator nothing')
  check('the missing-track reason names the language',
    /no \$\{market\.langName\} audio track/.test(SCAN))
  check('the status route groups the whole-video reasons',
    /blockedReasons/.test(STATUS),
    '328 identical rows is not more informative than one line saying 328')
  check('and the screen renders them',
    /Not going to any store, and why/.test(STAGE_RAW) && /blockedReasons!\.map/.test(STAGE_RAW))
}

// ── a whole-video verdict is counted once, not once per market ──────────────
{
  check('a verdict about the video carries no marketplace',
    /WHOLE_VIDEO = ''/.test(START) && /domain: WHOLE_VIDEO/.test(START),
    'writing it per market makes a five-store run report "no product attached" five times')
  check('the status route separates the two kinds',
    /blockedRows = rows\.filter\(\(r\) => !r\.domain\)/.test(STATUS))
  check('and counts videos distinctly',
    /byVideo\.set\(r\.video_id/.test(STATUS) && /videosTotal = byVideo\.size/.test(STATUS),
    'counting rows would report a five-market run as five times the size of the channel')
}

// ── a failed check is not a verdict about the video ─────────────────────────
//
// The single most dangerous confusion here. A lookup that could not run and a
// video with no German track look identical from a null, and reporting the
// first as the second tells a creator their video cannot be localized when
// nobody ever asked.
{
  check('an unreadable lookup leaves the item pending',
    /if \(!info\) \{[\s\S]{0,600}continue/.test(SCAN),
    'marking it skipped records a verdict about the video from a failure that had nothing to do with it')
  check('and says it could not check, rather than that there is no track',
    /could not check yet/.test(SCAN))
  check('an unconfigured downloader checks nothing at all',
    /if \(!ingestConfigured\(\)\)/.test(SCAN)
    && SCAN.indexOf('ingestConfigured()') < SCAN.indexOf("eq('state', 'pending')"),
    'a batch marked ineligible because the service is switched off is a lie about every video in it')
}

// ── one lookup answers every market ─────────────────────────────────────────
{
  // POSITIONAL, because "the file mentions byVideo" is satisfied by a scan that
  // went back to one lookup per row. The call has to sit between the loop over
  // videos and the loop over that video's market rows, which is the only
  // arrangement where one lookup answers several markets.
  const perVideo = SCAN.indexOf('of byVideo.values()')
  const lookup = SCAN.indexOf('listYouTubeAudioTracksDetailed(')
  const perRow = SCAN.indexOf('for (const row of group)')
  check('the scan groups its work by video',
    perVideo >= 0 && lookup > perVideo && perRow > lookup,
    'the track list names every language at once, so checking per market pays for the same call twice')
  check('and looks up once per group, not once per row',
    (SCAN.match(/listYouTubeAudioTracksDetailed\(/g) ?? []).length === 1)
  check('the scan works in small batches',
    /const BATCH = \d+/.test(SCAN) && !/limit\(1000\)/.test(SCAN),
    'each check is a yt-dlp call through the proxy; 525 at once is a bot wall and a timeout')
  check('and the start route does no lookups of its own',
    !/listYouTubeAudioTracks/.test(START),
    'doing them inline would spend the whole request budget before the creator saw one result')
  check('the queue route batches too',
    /const BATCH = \d+/.test(QUEUE))
  check('and sends one job per video carrying all its markets',
    /markets = group\.map/.test(QUEUE),
    'a job per market duplicates the localizing and the thumbnail for the same video')
}

// ── the run only offers markets that need a dub ─────────────────────────────
{
  check('an English market is refused with a reason',
    /needsTranslation/.test(START) && /speaks English/.test(START),
    'those need no dub, so this feature adds nothing over the normal sync and should say so')
  const translated = MARKETS.filter((m) => m.needsTranslation)
  check('there are dubbed markets to offer', translated.length > 0)
  check('the screen derives its list rather than typing one',
    /MARKETS\.filter\(\(m\) => m\.needsTranslation\)/.test(STAGE),
    'a typed list drifts from lib/markets the first time a market is added')
  check('and several can be picked at once',
    /domains: picked/.test(STAGE),
    'one store per run would pay for the same track lookup again for the next one')
}

// ── a missing dub is the paid lane, not a refusal ───────────────────────────
//
// THE SECOND WAY THIS FEATURE LIES BY OMISSION. A video YouTube has not dubbed
// can still go: /api/global-sync/dub synthesizes it, which is the lane the
// Launchpad stepper has always used. Recording that as "skipped" tells a creator
// their video cannot reach Germany when the truth is that it costs a dub.
{
  check('a video with no track is offered, not refused',
    /state: 'paid'/.test(SCAN) && !/state: 'skipped', reason: `no \$\{market\.langName\}/.test(SCAN),
    'the same pipeline dubs it; calling that skipped hides a listing the creator would have paid for')
  check('and the reason says MVP would dub it',
    /so MVP would dub it/.test(SCAN))
  check('the pill names the cost rather than only colouring it',
    /free`/.test(STAGE_RAW) && /uses a dub`/.test(STAGE_RAW),
    'a colour is not a statement, and the creator is about to spend on it')
  check('a pending market reads as unchecked, not as no track',
    /checking`/.test(STAGE_RAW),
    'a lookup that has not landed and a video with no track look identical from a null')
  check('a bulk press never sweeps up the paid ones',
    /const states = \(itemIds\.length > 0 \|\| body\.includePaid\)/.test(QUEUE),
    'spending a creator dub credits on a press they read as "send the free ones" is the worst outcome here')
  check('the hand-picked send is priced before it is pressed',
    /chosenCost/.test(STAGE_RAW) && /using a dub<\/strong>/.test(STAGE_RAW),
    'the cost belongs next to the button, not on the credits screen afterwards')
}

// ── the cards ───────────────────────────────────────────────────────────────
{
  check('the status route answers per video, not only per bucket',
    /cards: videos/.test(STATUS) && /markets: domainList\.map/.test(STATUS),
    'a creator wants "this one can go to Germany free and France for a dub", which is a row about a video')
  check('the screen draws a card per video with a pill per store',
    /cards!\.map/.test(STAGE_RAW) && /c\.markets\.map/.test(STAGE_RAW))
  check('a pill sends just that one',
    /send\(\{ itemIds: \[\.\.\.chosen\] \}\)/.test(STAGE_RAW))
  check('the card list is capped and says so when it is',
    /const CARD_LIMIT = \d+/.test(STATUS) && /\.slice\(0, CARD_LIMIT\)/.test(STATUS) && /the first \$\{v\.shown\} of \$\{v\.actionable\}/.test(STAGE_RAW),
    'a thousand cards is a dead tab, and a silently truncated list is the cap-as-total bug again')
}

// ── it lives in Launchpad, and in one copy ──────────────────────────────────
{
  check('Launchpad offers the channel as a starting point',
    /BackCatalogueStage/.test(LAUNCHPAD_RAW) && /Already on YouTube/.test(LAUNCHPAD_RAW),
    'this is the half of Launchpad that does not need a file uploaded')
  check('the Labs page runs the same component',
    /from '@\/components\/launchpad\/BackCatalogueStage'/.test(LABS_RAW) && LABS_RAW.length < 2500,
    'a second copy drifts, and the drift shows up as two screens disagreeing about a run')
  // Anchored to the paragraph that appears once videos are queued, not to any
  // mention of SCOUT anywhere in the file. A toast still carrying the word does
  // not tell someone reading the panel what they have to do next.
  check('the upload still needs the creator, and the queued panel says so',
    /Queued videos are localized[\s\S]{0,400}SCOUT\s*\n?\s*running to send them up/.test(STAGE_RAW),
    'a run prepares everything unattended; implying the listings are already live would be the lie')
}

// ── the migrations ──────────────────────────────────────────────────────────
{
  // EVERY create, not just one. Seb pastes these into the Supabase editor and
  // may well paste them twice; a single guarded statement followed by an
  // unguarded one fails halfway through and leaves the schema part-built.
  for (const [name, sql] of [['347', M347], ['348', M348]] as const) {
    const unguarded = (kind: string) =>
      (sql.match(new RegExp(`create ${kind}\\s+(?!if not exists)`, 'gi')) ?? []).length
    const unguardedCol =
      (sql.match(/add column\s+(?!if not exists)/gi) ?? []).length
    check(`migration ${name} is safe to run twice`,
      unguarded('table') === 0 && unguarded('index') === 0 && unguardedCol === 0,
      `${unguarded('table')} table, ${unguarded('index')} index, ${unguardedCol} column`)
    check(`migration ${name} drops every policy before creating it`,
      (sql.match(/create policy/gi) ?? []).length
        === (sql.match(/drop policy if exists/gi) ?? []).length,
      'create policy has no if-not-exists form, so a second paste errors on the first one')
  }
  check('347 has RLS on both tables',
    (M347.match(/enable row level security/gi) ?? []).length === 2
    && (M347.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 2)
  check('347 cascades items from the run and the video',
    (M347.match(/on delete cascade/g) ?? []).length >= 4)
  check('348 allows one verdict per video PER MARKET',
    /unique index[\s\S]{0,200}\(run_id, video_id, domain\)/.test(M348),
    'a re-scan must update the row, not add a second answer for the same video and store')
  // The 347 constraint was declared inline, so its name is whatever Postgres
  // generated. Dropping a guessed name succeeds while leaving it in place, and
  // it then rejects the second market of every run.
  check('348 drops the old one-row-per-video constraint by shape, not by name',
    /pg_constraint/.test(M348) && /conkey/.test(M348),
    'a guessed constraint name drops nothing and the failure only shows on the second market')
  // BOTH backfills. Checking for one `update` statement passed while the first
  // was commented out, because the second was still there.
  check('348 backfills market rows from their run',
    /update public\.catalogue_run_items[\s\S]{0,300}from public\.catalogue_runs r/.test(M348),
    'a new column left null on live rows makes every existing run unreadable')
  check('348 marks the remaining rows as whole-video verdicts',
    /update public\.catalogue_run_items[\s\S]{0,200}set domain = ''/.test(M348),
    'a null domain is neither a market answer nor a video answer, and reads as both')
}

// ── house style ─────────────────────────────────────────────────────────────
{
  const copy = [
    ...STAGE_RAW.match(/>[^<>{}]{40,}</g) ?? [],
    LABS_RAW.match(/subtitle="([^"]*)"/)?.[1] ?? '',
    LAUNCHPAD_RAW.match(/subtitle="([^"]*)"/)?.[1] ?? '',
  ].join('\n')
  check('there is copy to check', copy.length > 200, `${copy.length} chars`)
  check('no dash punctuation in the user-facing copy',
    !/[—–]/.test(copy) && !/\S \- \S/.test(copy),
    (copy.match(/.{0,40}[—–].{0,40}/) ?? [''])[0])
  check('no year stamped into the copy',
    !/\b20\d\d\b/.test(copy))
}

if (failures.length) {
  console.error(`\n❌ back-catalogue: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ back-catalogue: a run ends in storefront listings, and every video it skips says why')
