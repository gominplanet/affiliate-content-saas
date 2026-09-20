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
const PAGE_RAW = read('app/(dashboard)/back-catalogue/page.tsx')
const PAGE = live(PAGE_RAW)
const MIGRATION = read('supabase/migrations/347_catalogue_runs.sql')

// ── it delivers, it does not download ───────────────────────────────────────
{
  check('the run hands videos to the normal storefront pipeline',
    /\/api\/global-sync\/start/.test(QUEUE),
    'a separate back-catalogue delivery path would drift from the one that gets used daily')
  // Mechanism, not vocabulary. An earlier version of this clause grepped for
  // the WORD "download" and fired on the page copy promising the creator
  // downloads nothing, which is the one sentence here most worth keeping.
  check('and nothing in it produces a file for the creator',
    !/createObjectURL|blob:|content-disposition|download\s*=|\.download\b|\.mp4['"`]/i
      .test(QUEUE + START + PAGE),
    'the moment this hands over a file it becomes a to-do list instead of a feature')
  check('the page says the creator downloads nothing',
    /You never download anything/.test(PAGE_RAW))
}

// ── every skipped video has a reason ────────────────────────────────────────
{
  check('the item table stores a reason',
    /reason\s+text/.test(MIGRATION))
  check('an ineligible video is kept, not dropped',
    /state: \(!v\.youtube_video_id \|\| !v\.asin\) \? 'skipped' : 'pending'/.test(START),
    'dropping it leaves a count with no way to find out what happened to the rest')
  check('the two up-front reasons are distinguished',
    /not on YouTube/.test(START) && /no product attached/.test(START),
    'one is unfixable and the other is a missing ASIN; a single "skipped" tells the creator nothing')
  check('the missing-track reason names the language',
    /no \$\{market\.langName\} audio track/.test(SCAN))
  check('the status route groups the reasons',
    /skippedReasons/.test(STATUS) && /skippedBy/.test(STATUS),
    '328 identical rows is not more informative than one line saying 328')
  check('and the page renders them',
    /Not going, and why/.test(PAGE_RAW))
}

// ── a failed check is not a verdict about the video ─────────────────────────
//
// The single most dangerous confusion here. A lookup that could not run and a
// video with no German track look identical from a null, and reporting the
// first as the second tells a creator their video cannot be localized when
// nobody ever asked.
{
  check('an unreadable lookup leaves the item pending',
    /if \(!info\) \{[\s\S]{0,400}continue/.test(SCAN),
    'marking it skipped records a verdict about the video from a failure that had nothing to do with it')
  check('and says it could not check, rather than that there is no track',
    /could not check yet/.test(SCAN))
  check('an unconfigured downloader checks nothing at all',
    /if \(!ingestConfigured\(\)\)/.test(SCAN)
    && SCAN.indexOf('ingestConfigured()') < SCAN.indexOf("eq('state', 'pending')"),
    'a batch marked ineligible because the service is switched off is a lie about every video in it')
}

// ── the scan trickles ───────────────────────────────────────────────────────
{
  check('the scan works in small batches',
    /const BATCH = \d+/.test(SCAN) && !/limit\(1000\)/.test(SCAN),
    'each check is a yt-dlp call through the proxy; 525 at once is a bot wall and a timeout')
  check('and the start route does no lookups of its own',
    !/listYouTubeAudioTracks/.test(START),
    'doing them inline would spend the whole request budget before the creator saw one result')
  check('the queue route batches too',
    /const BATCH = \d+/.test(QUEUE))
}

// ── the run only offers markets that need a dub ─────────────────────────────
{
  check('an English market is refused with a reason',
    /needsTranslation/.test(START) && /speaks English/.test(START),
    'those need no dub, so this feature adds nothing over the normal sync and should say so')
  const translated = MARKETS.filter((m) => m.needsTranslation)
  check('there are dubbed markets to offer', translated.length > 0)
  check('the page derives its list rather than typing one',
    /MARKETS\.filter\(\(m\) => m\.needsTranslation\)/.test(PAGE),
    'a typed list drifts from lib/markets the first time a market is added')
}

// ── the upload still needs the creator, and the page says so ────────────────
{
  check('the page explains that SCOUT sends them up',
    /open Storefront Sync with SCOUT running/.test(PAGE_RAW),
    'a run prepares everything unattended; implying the listings are already live would be the lie')
}

// ── the migration ───────────────────────────────────────────────────────────
{
  // EVERY create, not just one. Seb pastes this into the Supabase editor and
  // may well paste it twice; a single guarded statement followed by an
  // unguarded one fails halfway through and leaves the schema part-built.
  const unguarded = (kind: string) =>
    (MIGRATION.match(new RegExp(`create ${kind}\\s+(?!if not exists)`, 'gi')) ?? []).length
  check('every create is guarded, so it is safe to run twice',
    unguarded('table') === 0 && unguarded('index') === 0,
    `${unguarded('table')} unguarded create table, ${unguarded('index')} unguarded create index`)
  check('and every policy is dropped before it is created',
    (MIGRATION.match(/create policy/gi) ?? []).length
      === (MIGRATION.match(/drop policy if exists/gi) ?? []).length,
    'create policy has no if-not-exists form, so a second paste errors on the first one')
  check('one verdict per video per run',
    /unique \(run_id, video_id\)/.test(MIGRATION),
    'a re-scan must update the row, not add a second answer for the same video')
  check('RLS is on for both tables',
    (MIGRATION.match(/enable row level security/gi) ?? []).length === 2
    && (MIGRATION.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 2)
  check('items cascade from the run and the video',
    (MIGRATION.match(/on delete cascade/g) ?? []).length >= 4)
}

// ── house style ─────────────────────────────────────────────────────────────
{
  const copy = PAGE_RAW.match(/subtitle="([^"]*)"/)?.[1] ?? ''
  check('the subtitle was found', copy.length > 40, `${copy.length} chars`)
  check('no dash punctuation in the page copy',
    !/[—–]/.test(copy) && !/\S \- \S/.test(copy), copy.slice(0, 120))
}

if (failures.length) {
  console.error(`\n❌ back-catalogue: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ back-catalogue: a run ends in storefront listings, and every video it skips says why')
