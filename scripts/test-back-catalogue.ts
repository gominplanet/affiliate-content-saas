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
const M349 = read('supabase/migrations/349_catalogue_run_summary.sql')
const M350 = read('supabase/migrations/350_catalogue_summary_resolving.sql')

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
    /blockedReasons = reasonsFor\(\(b\) => !b\.domain && b\.state === 'skipped'\)/.test(STATUS))
  // NO NUMBER ON THIS SCREEN IS A PAGE LENGTH. A real run reported "472 of 583"
  // for a catalogue over a thousand, because the route counted the rows it had
  // fetched and PostgREST caps a response at 1000.
  check('and counts videos in Postgres, not in a fetched array',
    /rpc\('catalogue_run_summary'/.test(STATUS)
    // BOTH counts, the total and the pending one. Checking that the phrase
    // appears once passed while the total had been switched to count(*).
    && (M349.match(/count\(distinct video_id\)/g) ?? []).length >= 2,
    'counting a fetched array turns the row cap into the number on screen')
  check('the counts never come from the length of a row fetch',
    !/\brows\.length\b/.test(STATUS) && !/items\.length/.test(STATUS),
    'that is the cap-as-total bug, and it has now appeared three times in this feature')
  check('a summary that cannot be read is said out loud',
    /Could not read this run/.test(STATUS) && /status: 500/.test(STATUS),
    'a screen quietly showing zeros is worse than one saying the count could not be read')
  check('and the screen prints the cause it was sent',
    /state\.detail/.test(STAGE_RAW),
    'dropping the detail is how a screen prints a guess while the real error sits unread')
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

// ── one video, on the same path as the whole catalogue ──────────────────────
{
  check('a single video can be checked by pasting its link',
    /onlyVideo/.test(START) && /extractYouTubeVideoId/.test(START),
    '"does this work" should not cost a 3000 video run to answer')
  check('and it runs the same code, not a shortcut',
    // The narrowing is ONE eq on the enumeration query. A separate branch that
    // skipped the scanner or the queue would make the test worth nothing.
    /if \(onlyVideoId\) q = q\.eq\('id', onlyVideoId\)/.test(START)
    && (START.match(/catalogue_run_items'\)\.insert/g) ?? []).length === 1,
    'a test that exercises a path the real run does not take proves nothing')
  check('a link MVP has never seen says what to do about it',
    /Sync your channel on the YouTube page first/.test(START),
    'a video on the channel but not in MVP needs a sync, not a bug report')
  check('and an unparseable link is refused before any lookup',
    /does not look like a YouTube link/.test(START))
  check('a single-video test refuses to silently resume a big run',
    /Press Start a different run to close it/.test(START) && /status: 409/.test(START),
    'handing back a 3000 video run to someone who pasted one link is the stale-ticks bug again')
  check('the start error is readable, not a three second toast',
    /duration: 10000/.test(STAGE_RAW),
    '"sync your channel first" is an instruction and has to survive long enough to read')
  check('a one-video run does not claim to be a slice of the catalogue',
    /!j\.onlyVideo\) setScope/.test(STAGE_RAW),
    '"your newest 1 out of 3290" is true and useless, and reads like something went wrong')
  check('the button says which of the two it will do',
    /Check that one video/.test(STAGE_RAW) && /Check my catalogue/.test(STAGE_RAW),
    'one button that does two very different things should say which one is armed')
}

// ── an unreadable product link is work, not a refusal ───────────────────────
//
// THE 884. Reading youtube_videos.asin found a product on almost none of one
// creator's catalogue, and adding product_url moved it by one. The link was in
// the YouTube description all along, often as a geni.us short link that hides
// the ASIN behind a redirect. Reporting all of that as "no product attached"
// blamed the creator for a lookup MVP had never done.
{
  check('the description is searched for the product link',
    /asinFromAmazonUrl\(String\(v\.description/.test(START)
    && /select\([^)]*description/.test(START),
    'MVP never wrote the description, so it is the one place the link survives')
  check('a short link is queued for resolution, not written off',
    /SHORTENED\.test\(text\)/.test(START) && /state: 'resolving'/.test(START),
    'geni.us hides the ASIN behind a redirect; that is a lookup, not a missing product')
  // THE CALL, not the declaration. An unwired resolveProducts still satisfies a
  // check for the name while every short-link video sits in 'resolving' forever.
  check('and the scanner actually follows it',
    /await resolveProducts\(sb\)/.test(SCAN) && /resolveProductLink\(/.test(SCAN),
    'a resolving state nothing resolves is just a nicer word for stuck')
  check('the resolved ASIN is cached on the video',
    /from\('youtube_videos'\)\.update\(\{ asin: resolved\.asin \}\)/.test(SCAN),
    'migration 204 exists precisely so this redirect is followed once, not every run')
  check('a link that resolves somewhere other than Amazon says so',
    /goes somewhere other than Amazon/.test(SCAN),
    "a brand's own shop cannot become an Amazon listing however long we wait, and that is different from having no link")
  check('a resolution that fell over is retried, not recorded',
    /could not follow the product link yet, retrying/.test(SCAN),
    'the same rule as an unreadable track list: a failed lookup is not a verdict about the video')
  check('resolving videos are not counted as finished',
    /state in \('pending', 'resolving'\)/.test(M350),
    '"checked 1000 of 1000" while the scanner is still working is a finished bar over an unfinished job')
  check('and the screen shows them as work in progress',
    /still finding the product/.test(STAGE_RAW) && /videos\?\.resolving/.test(STAGE_RAW))
  check('a resolving row is kept out of the not-going list',
    /!b\.domain && b\.state === 'skipped'/.test(STATUS),
    'otherwise "following the product link" appears under a heading that says Not going')
}

// ── a queued listing is followed to its end ─────────────────────────────────
//
// THE PILL THAT LIES BY STANDING STILL. Queueing 150 listings set 150 items to
// 'queued' and nothing moved them again: one that uploaded and one whose dub
// failed both read "queued" forever. Same failure this feature exists to stop,
// one step further down the pipeline.
{
  check('queued items are reconciled against the storefront pipeline',
    /reconcileQueued/.test(SCAN) && /from\('global_sync_targets'\)/.test(SCAN),
    "nothing else writes back, so 'queued' would be the last thing the screen ever said")
  // BOTH have to exist. indexOf returns -1 for a call that was deleted, and
  // -1 is less than any real position, so the bare comparison passed for a
  // reconcile that had been removed altogether.
  const recAt = SCAN.indexOf('reconcileQueued(sb)')
  const ingestAt = SCAN.indexOf('if (!ingestConfigured())')
  check('and the reconcile runs even with the downloader off',
    recAt >= 0 && ingestAt >= 0 && recAt < ingestAt,
    'a delivered listing is not news that has to wait for the video service')
  check('a failure carries the pipeline\'s own words',
    /t\.detail \|\| 'the storefront sync failed/.test(SCAN),
    'a bare "failed" is a second screen that knows something broke and not what')
  check('a market with no target row is named, not guessed',
    /the sync has no job for this store/.test(SCAN))
  check('the reconcile reads the target rather than trusting the writer',
    /t\.state === 'delivered'/.test(SCAN) && /t\.state === 'failed'/.test(SCAN),
    "a target reaches 'failed' from three places; teaching each one about this feature is the twenty-copies mistake")
  check('the screen keeps polling while anything is queued',
    /stillMoving/.test(STAGE_RAW) && /!stillMoving && poll\.current/.test(STAGE_RAW),
    "stopping at 'ready' freezes 150 pills on 'queued' whatever actually happens to them")
}

// ── the ticks describe the run, not a stale selection ───────────────────────
//
// SEEN ON A REAL RUN. France and Spain were ticked while the numbers underneath
// came from a five-market run: changing a tick cleared the local run, and the
// next Find resumed the one still open on the server with its original markets.
// The ticks and the results were describing different things.
{
  check('the ticks follow the run once one exists',
    /runDomains \? runDomains\.includes\(m\.domain\) : picked\.includes\(m\.domain\)/.test(STAGE_RAW),
    'ticks that describe a selection the run does not have are worse than no ticks')
  // NOT A STANDING WARNING. An earlier version compared the run's markets to the
  // local selection and shouted on every resumed run, contradicting ticks that
  // had already switched to showing the run. The honest fix is to adopt the
  // run's markets and say so once, at the moment of resuming.
  check('and a resumed run hands its markets back',
    /resumed: true, domains: its/.test(START) && /if \(Array\.isArray\(j\.domains\)[\s\S]{0,80}setPicked\(j\.domains\)/.test(STAGE_RAW),
    'leaving the selection stale means Start a different run silently goes back to it')
  check('and the resume is announced rather than silent',
    /Picking up the run already in progress\. The markets above now show/.test(STAGE_RAW),
    'silently handing back a different run is how the creator reads five markets as two')
  check('a run can actually be abandoned, not just forgotten',
    // The BUTTON has to call it. A declared-but-unwired abandon() still
    // satisfies a check for the name, and the run stays open on the server.
    /export async function DELETE/.test(STATUS)
    && /onClick=\{\(\) => void abandon\(\)\}/.test(STAGE_RAW)
    && /method: 'DELETE'/.test(STAGE_RAW),
    'clearing local state leaves the run open, so the next Find resumes it again')
  check('and start refuses to resume an abandoned one',
    /OPEN_STATES = \['queued', 'scanning'\]/.test(START) && !/'abandoned'/.test(START),
    'an abandoned run that is still resumable is the same trap with an extra click')
}

// ── the cards ───────────────────────────────────────────────────────────────
{
  check('the status route answers per video, not only per bucket',
    /\bcards,/.test(STATUS) && /markets: domainList\.map/.test(STATUS),
    'a creator wants "this one can go to Germany free and France for a dub", which is a row about a video')
  check('and decodes the title rather than printing the entity',
    /decodeHtmlEntities\(v\.title/.test(STATUS),
    'titles come off YouTube as "I&#39;ve", which renders on the card exactly like that')
  check('the screen draws a card per video with a pill per store',
    /cards!\.map/.test(STAGE_RAW) && /c\.markets\.map/.test(STAGE_RAW))
  check('a pill sends just that one',
    /send\(\{ itemIds: \[\.\.\.chosen\] \}\)/.test(STAGE_RAW))
  check('the card list is capped in the query, not after the fetch',
    /limit 250/.test(M349) && /in\('video_id', cardIds\)/.test(STATUS),
    'slicing after the fetch still pulls every row and still hits the cap')
  check('and the screen says when there are more',
    /there are more/.test(STAGE_RAW) && /moreThanShown/.test(STAGE_RAW),
    'a silently truncated list is the cap-as-total bug again')
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
  for (const [name, sql] of [['347', M347], ['348', M348], ['349', M349], ['350', M350]] as const) {
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

  check('349 leaves RLS in charge',
    /security invoker/.test(M349) && !/security definer/.test(M349),
    'a definer function here hands any signed-in user the counts for anybody else\'s run')

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
