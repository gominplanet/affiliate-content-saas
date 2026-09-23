// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TEN VIDEOS SET UP TOGETHER, AND A SCREEN THAT SAYS WHAT IS ACTUALLY TRUE.
//
// Video Launchpad is one video with somebody watching it. A batch is the same
// pipeline with the waiting taken out, and the two failure classes it invites
// are the ones this codebase produces over and over:
//
//   THE PAGE DECIDING FOR ITSELF. Five steps and a Launch button give a screen
//   plenty of chances to tick something the worker will refuse. Every state
//   here comes from lib/launch-batch, which the route and the page both read.
//
//   THE PLAN REPORTED AS THE RESULT. "Scheduled" must mean YouTube confirmed a
//   publish time, not that we worked one out. They are separate columns on
//   purpose and this pins them apart.
import { readFileSync } from 'node:fs'
import { batchSteps, launchBlocker, validateCtaPreset, launchOutcome, MAX_ITEMS, BATCH_COLUMNS, ITEM_COLUMNS, type BatchRow, type ItemRow } from '../lib/launch-batch'
import { channelBlocker, prepEta, minutesLeft, stepIsOptional, batchRecap, defaultBatchName } from '../lib/launch-batch'
import { validateThumbnailPreset, presetToRequestFields, defaultThumbnailPreset, styleReferenceAllowed, looksForRequest, LOOKS, presetSummary as presetSummaryOf } from '../lib/thumbnail-preset'
import { VISUAL_PRESETS } from '../lib/visual-presets'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const LIB = live(read('lib/launch-batch.ts'))
const DRAIN = live(read('app/api/cron/launch-drain/route.ts'))
const DRAIN_RAW = read('app/api/cron/launch-drain/route.ts')
const LAUNCH = live(read('app/api/launch/batches/[id]/launch/route.ts'))
const BATCH = live(read('app/api/launch/batches/[id]/route.ts'))
const ITEMS = live(read('app/api/launch/batches/[id]/items/route.ts'))
const ITEM = live(read('app/api/launch/items/[id]/route.ts'))
const BOARD = read('components/launch/LaunchBoard.tsx')
const STEPCARD = read('components/launch/StepCard.tsx')
const PAGE = read('app/(dashboard)/launch/page.tsx')
const M357 = read('supabase/migrations/357_launch_batches.sql')
const M358 = read('supabase/migrations/358_launch_batch_worker.sql')
const M359 = read('supabase/migrations/359_launch_batch_thumbnail.sql')
const PICKER = read('components/launch/ThumbnailPicker.tsx')
const PANEL = read('components/thumbnails/ThumbnailBoostPanel.tsx')
const GENROUTE = live(read('app/api/youtube/generate-thumbnail/route.ts'))
const VERCEL = read('vercel.json')
const NAV = read('components/layout/DashboardShellV2.tsx')

// A batch with everything answered, for driving the real rules rather than
// grepping the source that implements them.
function full(over: Partial<BatchRow> = {}): BatchRow {
  return {
    id: 'b', name: 'Batch', state: 'draft',
    cta: null, cta_chosen: true,
    thumbnail: null, thumbnail_chosen: true,
    markets: ['amazon.com'], daily_slots: ['09:00'], start_on: '2026-12-01',
    timezone: 'America/Toronto', ...over,
  }
}
function item(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: 'i', position: 0, source_url: 'https://x/v.mp4', rendered_url: 'https://x/r.mp4',
    asin: 'B0GTLR8ZQL', title: 'A video', title_source: 'creator',
    thumbnail_url: 'https://x/t.png',
    state: 'prepared', reason: null, ...over,
  }
}

// ── the steps are computed, not asserted by a screen ────────────────────────
{
  check('a batch with nothing in it starts at step one',
    batchSteps(full({ cta_chosen: false, markets: [], daily_slots: [], start_on: null }), [])
      .find((s) => s.current)?.id === 'videos',
    'the page has to have exactly one thing to point at')

  // EACH STEP IN TURN, and the current one is always the first that is not done.
  const b0 = full({ cta_chosen: false, markets: [], daily_slots: [], start_on: null })
  check('adding a video moves it on to the CTA',
    batchSteps(b0, [item({ asin: null, title: null })]).find((s) => s.current)?.id === 'cta')
  check('choosing a CTA moves it on to the countries',
    batchSteps(full({ markets: [], daily_slots: [], start_on: null }), [item({ asin: null, title: null })])
      .find((s) => s.current)?.id === 'countries')
  check('picking countries moves it on to the products',
    batchSteps(full({ daily_slots: [], start_on: null }), [item({ asin: null, title: null })])
      .find((s) => s.current)?.id === 'products')
  check('and a full set of products moves it on to the schedule',
    batchSteps(full({ daily_slots: [], start_on: null }), [item()])
      .find((s) => s.current)?.id === 'schedule')
  check('everything answered means no step is current',
    batchSteps(full(), [item()]).every((s) => !s.current),
    'a finished batch pointing at a step is a page that never lets go')

  // NO CTA IS AN ANSWER. Without cta_chosen it is the same empty column as
  // "not asked yet" and the batch waits forever for a decision already made.
  check('choosing no CTA counts as choosing',
    batchSteps(full({ cta: null, cta_chosen: true }), [item()]).find((s) => s.id === 'cta')?.done === true,
    '"none" and "not asked" are the same empty value without the flag')
  check('and not choosing does not',
    batchSteps(full({ cta_chosen: false }), [item()]).find((s) => s.id === 'cta')?.done === false)

  // THE PRODUCT STEP IS PER VIDEO, and one missing product is not done.
  check('one video without a product leaves the step open',
    batchSteps(full(), [item(), item({ id: 'j', position: 1, asin: null })])
      .find((s) => s.id === 'products')?.done === false)
  check('and the detail counts them rather than saying "incomplete"',
    /1 of your 2 still needs a product/.test(
      batchSteps(full(), [item(), item({ id: 'j', position: 1, asin: null })])
        .find((s) => s.id === 'products')?.detail ?? ''),
    'a creator with ten videos needs to know how many, not that something is wrong')
  // A COUNT IS ONLY A COUNT WHEN THERE IS SOMETHING TO COUNT AGAINST. Over a
  // batch of one, "1 still needs a product" reads as a request for ANOTHER
  // one, and was read exactly that way: "why does it want more asin".
  {
    const d = batchSteps(full(), [item({ asin: null })]).find((s) => s.id === 'products')?.detail ?? ''
    check('but a batch of one is told what to do, not counted',
      !/^\d/.test(d) && /ASIN|Amazon link/.test(d), d)
  }
}

// ── launch is refused with a reason, never just disabled ────────────────────
{
  check('an empty batch cannot launch',
    (launchBlocker(full(), []) ?? '').includes('Add at least one video'))
  check('an unfinished step is named in the refusal',
    (launchBlocker(full({ markets: [] }), [item()]) ?? '').includes('Amazon countries'),
    'a disabled button with nothing beside it is the dead end this codebase keeps producing')
  check('work still running is said to be running, not broken',
    /finishes on its own/.test(launchBlocker(full(), [item({ state: 'preparing' })]) ?? ''),
    '"not ready" reads as a failure when it is just not finished')
  check('a ready batch has no blocker',
    launchBlocker(full(), [item()]) === null)
  // A BLOCKED VIDEO DOES NOT HOLD THE OTHERS. Nine going out beats ten waiting.
  check('one blocked video does not stop the rest',
    launchBlocker(full(), [item(), item({ id: 'j', position: 1, state: 'blocked' })]) === null,
    'the batch goes without it and the response names what was left behind')
  check('but a batch of nothing BUT blocked videos is refused',
    (launchBlocker(full(), [item({ state: 'blocked' })]) ?? '').includes('Nothing is ready'))
}

// ── the CTA preset is ours, or it is refused ────────────────────────────────
//
// This is stored once and replayed by a background worker onto ten videos with
// nobody watching. An arbitrary URL would be a standing instruction to fetch
// and composite whatever it points at, every time.
{
  const supa = 'https://abc.supabase.co'
  check('a gallery design is accepted',
    validateCtaPreset({ stickerUrl: 'https://www.mvpaffiliate.io/cta-burner/burner01.png' }, supa).ok)
  check('and a badge in our own storage',
    validateCtaPreset({ stickerUrl: `${supa}/storage/v1/object/public/instagram-videos/u/b.png` }, supa).ok)
  for (const bad of [
    'https://evil.example.com/x.png',
    'https://www.mvpaffiliate.io/cta-burner/../../etc/passwd',
    `${supa}/storage/v1/object/public/other-bucket/b.png`,
    'javascript:alert(1)',
    '',
  ]) {
    check(`refused: ${bad || '(empty)'}`, !validateCtaPreset({ stickerUrl: bad }, supa).ok)
  }
  // CLAMPED, not trusted. A width of 40 would composite a badge forty times the
  // frame across ten videos before anybody saw one.
  const wild = validateCtaPreset(
    { stickerUrl: 'https://www.mvpaffiliate.io/cta-burner/b.png', widthPct: 40, xPct: -3, yPct: 99 }, supa)
  check('an absurd size is clamped rather than stored',
    wild.ok && wild.preset.widthPct <= 1 && wild.preset.xPct >= 0 && wild.preset.yPct <= 1,
    wild.ok ? `${wild.preset.widthPct}/${wild.preset.xPct}/${wild.preset.yPct}` : 'refused')
  // AND AGAIN WHERE IT IS USED. Validated once and trusted forever is how a
  // preset stored before a rule change keeps running under the old rule.
  check('the worker re-checks the design before it renders',
    /ctaStickerAllowed\(cta\.stickerUrl/.test(DRAIN),
    'this composites into ten videos unattended, so the check belongs at the moment of use')
}

// ── the plan and the fact are different things ──────────────────────────────
{
  // By id now: each video's time is looked up in the schedule, which holds
  // its own date and time when it has one.
  check('launching writes the PLANNED time',
    /planned_publish_at: schedule\.get\(ready\[i\]\.id\)!\.at\.toISOString\(\)/.test(LAUNCH))
  check('and does not call anything scheduled',
    !/state: 'scheduled'/.test(LAUNCH),
    'this route has not spoken to YouTube, so it cannot report what YouTube did')
  // STILL TRUE, in a conditional now: a row may not call itself scheduled
  // before updateVideoStatus has run. The literal moved when publishing
  // immediately was added, which is why this reads the ternary.
  check('the worker sets publish_at only after YouTube confirms',
    DRAIN.indexOf('updateVideoStatus') > -1
    && DRAIN.indexOf('updateVideoStatus') < DRAIN.indexOf("goNow ? 'published' : missed ? 'blocked' : 'scheduled'"),
    'writing it first would promise a publication that never happened')
  check('and the two columns are kept apart in the schema',
    /planned_publish_at/.test(M358) && /publish_at\s+timestamptz/.test(M357),
    'one column for both is how a screen reports the plan as the result')

  // A PUBLISH TIME IN THE PAST IS NEVER SHIFTED. That part has not changed and
  // is the reason this check exists: quietly moving a slot forward would
  // publish somebody's video at an hour they never chose.
  //
  // What changed is what a past slot MEANS. It used to stop the launch, which
  // made tomorrow the earliest anything could go out. It now means now, and the
  // list is still worked out because the screen has to say which videos those
  // are before the button is pressed.
  check('past slots are still identified, for the screen to name',
    /const immediate = planned\.filter\(\(p\) => p\.at\.getTime\(\) <= Date\.now\(\)\)/.test(LAUNCH) && /goingOutNow/.test(LAUNCH),
    'going public cannot be undone, so it cannot be a surprise')
  check('and they are not quietly moved to another hour',
    !/at\.setHours|addDays\(plan\.startOn, 1\)/.test(LAUNCH),
    'shifting a slot forward publishes at an hour nobody chose')
  // Per video now, and the refusal NAMES which videos have no time, so it can
  // be fixed without guessing.
  check('and a partial schedule is refused outright',
    /const unresolved = ready\.filter\(\(i\) => !schedule\.has\(i\.id\)\)/.test(LAUNCH)
    && /if \(unresolved\.length > 0\)/.test(LAUNCH),
    'publishing half a batch at hours nobody chose is worse than publishing none')
}

// ── a scheduled video goes private, then gets its time ─────────────────────
//
// Unchanged for anything with a future time. A video going out NOW is the one
// exception and it has to be: YouTube refuses a publishAt in the past, so "now"
// cannot be said that way at all, and uploading public is the same thing in the
// form the API accepts.
{
  check('anything with a time to wait for goes up private',
    /privacyStatus: goNow \? 'public' : 'private'/.test(DRAIN),
    'uploading public and scheduling afterwards puts it on the channel in between')
  check('and the schedule is a separate confirmed call',
    /updateVideoStatus\(videoId, \{/.test(DRAIN) && /publishAt: String\(it\.planned_publish_at\)/.test(DRAIN))
  check('which is skipped only for the ones going out now',
    /if \(!goNow && !missed\) \{[\s\S]{0,120}?updateVideoStatus/.test(DRAIN),
    'calling it with a past time fails every single time')
  check('one video per firing',
    /const PUBLISHES = 1/.test(DRAIN),
    'this downloads a whole file and uploads it again; two at once runs the function out of time')
}

// ── a failure says what a creator can do about it ───────────────────────────
{
  check('every step counts its tries',
    /render_tries/.test(DRAIN) && /thumb_tries/.test(DRAIN) && /publish_tries/.test(DRAIN),
    'without a count a failing step retries every minute forever and the board shows nothing')
  check('the try is counted BEFORE the attempt',
    DRAIN.indexOf('render_tries: tries + 1') < DRAIN.indexOf('const out = await renderCta'),
    'a render that kills the function would never record the try')
  check('a missing thumbnail does not block the video',
    /YouTube will use a frame from the video/.test(DRAIN_RAW),
    'a listing without a thumbnail is still a listing; refusing to launch over one is the wrong trade')
  check('a video with no product is waited for, not blocked',
    /if \(!asin \|\| !title\) continue/.test(DRAIN),
    'that step needs the creator, and calling it a failure is blaming them for taking their time')
  check('a render that failed goes back to draft rather than blocking',
    /state: 'draft',\s*\n?\s*reason:/.test(DRAIN),
    'one bad minute on the render service is not a verdict about the video')
}

// ── the Amazon half is the grid, not a second pipeline ──────────────────────
{
  check('a launched video joins the coverage grid',
    /from\('storefront_coverage'\)\.upsert/.test(DRAIN) && /from\('youtube_videos'\)\.upsert/.test(DRAIN),
    'a second Amazon pipeline drifts from the one that gets used daily')
  check('and Amazon gets the copy with no CTA burned in',
    /source_video_url: it\.clean_url/.test(DRAIN),
    'a storefront listing should not carry "link in the description"')
  // STILL NEVER THROWS, but it no longer says nothing. This check used to pin
  // the comment on a catch that swallowed everything, and that catch is what
  // hid the hand-over failing on EVERY launched video: the upsert named a
  // conflict key the table does not have, and left out a NOT NULL column.
  check('seeding the grid never fails the publish',
    /async function handOverToAmazon[\s\S]*?\} catch \(e\) \{\s*return \{ ok: false, error:/.test(DRAIN),
    'throwing after YouTube has the file sends it round the retry loop and uploads it twice')

  // THE CONFLICT KEY IS READ OFF THE SCHEMA, not off anyone's memory of it.
  // `onConflict: 'youtube_video_id'` against a table whose unique key is
  // (user_id, youtube_video_id) fails every insert with "no unique or
  // exclusion constraint matching the ON CONFLICT specification".
  const SCHEMA = read('supabase/schema.sql')
  const ytTable = SCHEMA.slice(SCHEMA.indexOf('create table if not exists public.youtube_videos'))
  const ytKey = (/unique \(([^)]+)\)/.exec(ytTable.slice(0, ytTable.indexOf(');')))?.[1] ?? '').replace(/\s+/g, '')
  const handOver = DRAIN.slice(DRAIN.indexOf('async function handOverToAmazon'), DRAIN.indexOf('async function noteHandOver'))
  const conflict = (/from\('youtube_videos'\)\.upsert\([\s\S]*?onConflict: '([^']+)'/.exec(handOver)?.[1] ?? '').replace(/\s+/g, '')
  check('the hand-over upserts on the key the table actually has',
    !!ytKey && conflict === ytKey,
    `table key (${ytKey}) vs onConflict (${conflict}): a mismatch fails every insert, silently`)

  // EVERY NOT NULL COLUMN WITHOUT A DEFAULT is supplied, also read off the
  // schema. channel_title was the one missing.
  const required = [...ytTable.slice(0, ytTable.indexOf(');')).matchAll(/^\s+([a-z_]+)\s+[a-z]+[^,\n]*not null(?![^,\n]*default)/gm)]
    .map((m) => m[1]).filter((c) => c !== 'id')
  const upsertBody = /from\('youtube_videos'\)\.upsert\(\{([\s\S]*?)\}, \{ onConflict/.exec(handOver)?.[1] ?? ''
  for (const col of required) {
    check(`the hand-over supplies ${col}`,
      new RegExp(`\\b${col}:`).test(upsertBody),
      'a NOT NULL column left out fails the insert, and this one never said so')
  }

  check('a failed hand-over is written on the row',
    /await noteHandOver\(sb, it\.id, handed\)/.test(DRAIN),
    '"Nothing is on YouTube yet" under a live video is what silence looks like here')
  check('and the later pass it promised exists and runs every firing',
    /async function repairs\(sb: Sb\)/.test(DRAIN) && /const repaired = await repairs\(sb\)/.test(DRAIN)
    && /\.is\('video_id', null\)/.test(DRAIN),
    'its comment said "the grid can be seeded on a later pass" and nothing ever did')
}

// ── the page leads, and never decides for itself ────────────────────────────
{
  check('every step state is read from the server',
    /steps\.find\(\(s\) => s\.id === id\)/.test(BOARD) && /j\.steps/.test(BOARD)
    && !/function batchSteps/.test(BOARD),
    'a page that works out its own ticks can tick a step the worker will refuse')
  check('and so is the reason launch is unavailable',
    /setBlocker\(j\.launchBlocker/.test(BOARD) && /\{blocker\}/.test(BOARD))
  check('exactly one step is open, and it is the one the server named',
    /const current = \(j\.steps \?\? \[\]\)\.find\(\(s: StepStatus\) => s\.current\)/.test(BOARD),
    'five equal boxes is a form, and a form makes the creator work out the order')
  // ── SAVING IS NOT NAVIGATING ─────────────────────────────────────────────
  //
  // The auto-open used to re-run after every save, which is fine in theory and
  // awful in practice: the countries step is a multi-select, so ticking France
  // completed it, the reload decided the current step was now the products one,
  // and the box the creator was working in folded shut under their hand.
  check('the page opens the right step once, then leaves it alone',
    /const autoOpened = useRef\(false\)/.test(BOARD)
    && /if \(!autoOpened\.current\) \{/.test(BOARD)
    && /autoOpened\.current = true \}/.test(BOARD),
    'auto-opening on every load turns every save into a navigation')
  check('and a save never re-opens a different step',
    !/pinned\.current = false/.test(BOARD)
    && !/autoOpened\.current = false[\s\S]{0,200}?await load\(batchId\)/.test(BOARD),
    'this is what folded the countries step shut on the first country ticked')
  check('typing is not overwritten by the poll either',
    /if \(dirty\.current\) return/.test(BOARD),
    'a twelve-second refresh landing mid-sentence wipes what they were writing')
  // GREEN MEANS DONE. A step is never ticked because it was visited.
  check('the tick is driven by done, not by having been opened',
    /\{done \? <Check size=\{14\} \/> : n\}/.test(STEPCARD))
  check('and "Do this next" points at the current step',
    /Do this next/.test(STEPCARD))

  // ── THE STEP SAYS WHICH PLATFORM IT IS ───────────────────────────────────
  //
  // It was called "Set the cadence and launch" and said nothing about YouTube,
  // so the first person to read it asked where YouTube had gone. The two halves
  // behave completely differently: YouTube is on the creator's schedule, Amazon
  // goes as each dub finishes.
  check('the schedule step is named for YouTube',
    /title: 'Schedule your YouTube posts'/.test(LIB),
    '"cadence" alone does not say which platform is being scheduled')
  check('and the page says Amazon is not on that schedule',
    /goes up as soon as its translation and dub are done/.test(BOARD),
    'a creator who assumes Amazon follows the same times is waiting for something that already happened')

  // THE HONEST SENTENCE ABOUT WHAT IS NOT AUTOMATIC.
  check('the page says which part needs their browser',
    /own logged-in Creator account/.test(BOARD),
    'promising a full walk-away and then needing the tab open is the promise this feature must not make')
  check('and the hero says what actually happens',
    /burns the CTA, builds every thumbnail/.test(PAGE))

  // NUMBERS THAT ARE CAPS ARE SAID, NOT SILENTLY APPLIED.
  check('dropping more than the cap says so',
    /Taking the first \$\{picked\.length\}/.test(BOARD),
    'twelve files becoming ten with no word is how somebody launches without two videos')
  check('and videos left behind by a launch are named',
    /left behind/.test(BOARD) && /leftBehind/.test(LAUNCH))
}

// ── counts come from Postgres ───────────────────────────────────────────────
{
  check('the item cap is counted in the database',
    /select\('id', \{ count: 'exact', head: true \}\)/.test(ITEMS),
    'counting a fetched array turned a page length into a total three times in this codebase')
  check('and so is a batch finishing',
    (DRAIN.match(/count: 'exact', head: true/g) ?? []).length >= 3)
  check(`the cap itself is one number, and it is ${MAX_ITEMS}`,
    /const MAX_ITEMS = 10/.test(LIB) && /MAX_ITEMS/.test(ITEMS) && /maxItems/.test(BOARD),
    'a cap typed twice disagrees with itself the first time it changes')
}

// ── removing a video does not leave a hole in the cadence ───────────────────
{
  check('positions are closed up after a delete',
    /if \(r\.position !== i\) await sb\.from\('launch_items'\)\.update\(\{ position: i \}\)/.test(ITEM),
    'position drives the publishing order, so a gap leaves an empty slot mid-run')
  check('and a video already on YouTube cannot be removed here',
    /Removing it here would not take it down/.test(read('app/api/launch/items/[id]/route.ts')),
    'a row deleted locally does not unschedule a video')
}

// ── it runs, and it is reachable ────────────────────────────────────────────
{
  check('the worker is scheduled',
    /\/api\/cron\/launch-drain/.test(VERCEL),
    'a cron nobody calls is a feature that works only in the repository')
  check('the page is in the nav',
    /href: '\/launch'/.test(NAV) && /Launch Batch/.test(NAV))
  check('and it is behind Labs while it is unproven',
    NAV.indexOf("label: 'Labs'") < NAV.indexOf("href: '/launch'"),
    'anything risky lives in Labs, which is the agreement that makes shipping straight to main safe')
}

// ── the migrations ──────────────────────────────────────────────────────────
{
  for (const [name, sql] of [['357', M357], ['358', M358]] as const) {
    const unguarded = (kind: string) =>
      (sql.match(new RegExp(`create ${kind}\\s+(?!if not exists)`, 'gi')) ?? []).length
    check(`migration ${name} is safe to run twice`,
      unguarded('table') === 0 && unguarded('index') === 0,
      `${unguarded('table')} table, ${unguarded('index')} index`)
    check(`migration ${name} drops every policy before creating it`,
      (sql.match(/create policy/gi) ?? []).length === (sql.match(/drop policy if exists/gi) ?? []).length)
  }
  check('357 has RLS on both tables',
    (M357.match(/enable row level security/gi) ?? []).length === 2
    && (M357.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 2,
    'these rows carry a creator’s unpublished videos')
  check('358 names the migration to run when 357 has not been',
    /Run migration 357 first/.test(M358),
    'Seb pastes these into the SQL editor and the error is all he gets')
}

// ── house style ─────────────────────────────────────────────────────────────
{
  const copy = [
    BOARD.match(/>[^<>{}]{25,}</g)?.join('\n') ?? '',
    PAGE.match(/subtitle="([^"]*)"/)?.[1] ?? '',
    read('components/launch/CtaPicker.tsx').match(/>[^<>{}]{25,}</g)?.join('\n') ?? '',
    LIB.match(/'[^']{25,}'/g)?.join('\n') ?? '',
  ].join('\n')
  check('there is copy to check', copy.length > 400, `${copy.length} chars`)
  check('no dash punctuation in anything a creator reads',
    !/[—–]/.test(copy), (copy.match(/.{0,50}[—–].{0,50}/) ?? [''])[0])
  check('no year stamped into the copy', !/\b20\d\d\b/.test(copy))
}

// ── the thumbnail look: chosen once, and the SAME generator Launchpad uses ──
//
// "the thumbnail gets made.. but with zero options" was the whole bug report.
// The batch called a simple builder of its own while Launchpad called the
// designed route, so one product could produce two different thumbnails and
// only one of them could be styled at all.
{
  const SUPA = 'https://abc.supabase.co'

  check('the batch has a thumbnail step of its own',
    batchSteps(full({ thumbnail_chosen: false }), [item()]).some(s => s.id === 'thumbnail'),
    'without a step there is nowhere to make the choice')

  // NOT ASKED IS NOT THE SAME AS KEPT THE DEFAULT, exactly as with the CTA.
  check('an unanswered look blocks the batch',
    !!launchBlocker(full({ thumbnail_chosen: false }), [item({ state: 'prepared' })]),
    'a batch would launch with a look the creator never saw')
  check('and keeping the house look is a real answer',
    !launchBlocker(full({ thumbnail_chosen: true, thumbnail: null }), [item({ state: 'prepared' })]),
    'null must mean "they chose the house look", not "they never said"')

  // THE STEP SAYS WHAT WAS CHOSEN, never what will happen.
  {
    const chosen = { ...defaultThumbnailPreset(), face: { kind: 'none' as const } }
    const d = batchSteps(full({ thumbnail_chosen: true, thumbnail: chosen }), [item()])
      .find(s => s.id === 'thumbnail')!.detail
    check('the step reports the choice', /product only/i.test(d), d)
    check('and never promises a future thumbnail', !/will be|going to/i.test(d), d)
  }

  // ── what a stored preset is allowed to be ────────────────────────────────
  //
  // It is replayed onto ten videos by a worker with nobody watching, so every
  // field is an enum, a clamped string, or a URL in our own storage.
  check('a look from somebody else’s server is refused',
    !styleReferenceAllowed('https://evil.example/pic.png', SUPA)
    && styleReferenceAllowed(`${SUPA}/storage/v1/object/public/headshots/u/a.png`, SUPA),
    'an arbitrary URL here is a standing instruction to fetch whatever it points at, ten times')
  {
    const v = validateThumbnailPreset({ styleReferenceUrl: 'https://evil.example/pic.png' }, SUPA)
    check('and dropping it is REPORTED, not silent', v.rejected.length > 0 && v.preset.styleReferenceUrl === null,
      'a look that was ignored must not come back looking like one that applied')
  }
  {
    const v = validateThumbnailPreset({ badgeText: 'x'.repeat(500), scenePrompt: 'y'.repeat(4000) }, SUPA)
    check('long text is clamped, not stored',
      v.preset.badgeText.length <= 40 && v.preset.scenePrompt.length <= 300,
      'a thousand words of badge text is a second prompt riding along on every render')
  }
  {
    const v = validateThumbnailPreset({ pose: 'jump', expression: 'smug-beyond-reason' }, SUPA)
    check('an unknown pose or expression falls back rather than being passed on',
      v.preset.pose === null && v.preset.expression === 'auto')
  }
  {
    const v = validateThumbnailPreset({ face: { kind: 'face', faceId: 'not-a-uuid' } }, SUPA)
    check('a face id that cannot exist becomes the usual face, and says so',
      v.preset.face.kind === 'auto' && v.rejected.length > 0)
  }
  check('a preset never refuses a save outright',
    validateThumbnailPreset('nonsense', SUPA).preset.headlineStyle === 'question',
    'a 400 here would lose every other change in the same request')

  // ── one generator, and the same field names ──────────────────────────────
  check('the batch calls the route Launchpad calls',
    /generate-thumbnail/.test(DRAIN) && /postToSelf/.test(DRAIN)
    // AT THE CALL SITE, not just somewhere in the file. A helper that exists
    // and is never reached passes a grep and builds the house look on all ten.
    && /await styledThumbnail\(/.test(DRAIN),
    'a second generator is why a batch thumbnail had no options in the first place')
  check('and asks for the designed path, as Launchpad does',
    /textMode: 'graphic'/.test(DRAIN),
    'a different textMode is a different image from the same controls')
  {
    // THE PANEL'S OWN FIELD NAMES. If the panel renames one, this catches the
    // batch still sending the old one, which would fail silently: the route
    // would simply not see the option and build the house look.
    const f = presetToRequestFields({
      ...defaultThumbnailPreset(), autoBadge: true, pose: 'hold', wearProduct: true,
      accentWord: 'FREE', styleReferenceUrl: 'https://x/y.png', scenePrompt: 'kitchen',
    })
    // Derived here, so they are not looked for in the panel.
    const DERIVED = new Set(['accentColor', 'noHuman', 'faceModelId'])
    // THE BATCH'S OWN, which the panel deliberately does not have: the look and
    // the badge are chosen for this batch rather than for the brand, so they
    // are checked against the ROUTE instead. Without that half, renaming one
    // would pass this block by being absent from both sides.
    const BATCH_ONLY = new Set(['visualPresetIds', 'decoration'])
    for (const k of Object.keys(f)) {
      if (DERIVED.has(k)) continue
      if (BATCH_ONLY.has(k)) {
        check(`the route still reads "${k}"`, GENROUTE.includes(k),
          'a field the route does not read is an option that silently does nothing')
        continue
      }
      check(`the panel still sends "${k}"`, PANEL.includes(k),
        'the batch and the panel must name the same field or the option is dropped in silence')
    }
  }
  check('the route accepts an internal call from the worker',
    /x-mvp-service/.test(GENROUTE) && /CRON_SECRET/.test(GENROUTE),
    'without it the worker gets a 401 and every batch thumbnail falls back to plain')
  check('and an internal call without an identity is refused',
    /Service call missing identity/.test(GENROUTE),
    'a secret with no user would generate against nobody’s account')

  // ── the fallback is visible ──────────────────────────────────────────────
  check('a fallback thumbnail is recorded as one',
    /thumbnail_source/.test(DRAIN) && /'plain'/.test(DRAIN) && /'styled'/.test(DRAIN),
    'a look that never applied looked exactly like one that did')
  check('and the row says so on screen',
    /thumbnail_source === 'plain'/.test(BOARD) && /plain look/.test(BOARD),
    'the sentence alone is missed by somebody scanning ten rows')
  check('the fallback keeps its reason when it reaches prepared',
    /usedPlain$[\s\S]{0,200}?could not be applied/m.test(DRAIN),
    'clearing the reason on the way to prepared erases the only place it was said')
  check('the picker exists and reuses the panel',
    /ThumbnailBoostPanel/.test(PICKER) && /useThumbnailBoost/.test(PICKER),
    'a second set of controls would drift from the one Launchpad has')

  // ── the look is chosen HERE, not in Brand Profile ────────────────────────
  //
  // "have all of the options.. so users dont have to go to brand profile to
  // change a look". And the deeper reason it cannot just write there: a look
  // picked for one batch is not a change to the brand, and storing it on the
  // brand would restyle the blog heroes and the pins along with it.
  {
    const P = defaultThumbnailPreset()
    check('every look the product renders is offered',
      LOOKS.length === VISUAL_PRESETS.length && LOOKS.length > 1,
      `${LOOKS.length} offered of ${VISUAL_PRESETS.length}`)

    // FOUR ANSWERS FROM TWO CONTROLS, and each one has to be distinguishable.
    check('no looks and no mixing leaves the brand alone',
      looksForRequest({ ...P }).length === 0
      // LEFT OUT OF THE BODY ENTIRELY, not sent empty. The route treats both
      // the same today, so this pins the intent rather than a live bug: a
      // field that is present but empty is one refactor away from meaning
      // "no look at all" instead of "the brand's own".
      && presetToRequestFields(P).visualPresetIds === undefined,
      'an empty list is one refactor away from meaning "no look" and dropping the brand’s own')
    check('one look, no mixing, is that look every time',
      JSON.stringify(looksForRequest({ ...P, lookIds: ['bold', 'neon'] })) === JSON.stringify(['bold']),
      'mixing off must mean one consistent set, not a quietly random one')
    check('mixing with looks ticked rolls among those',
      looksForRequest({ ...P, mixLooks: true, lookIds: ['bold', 'neon'] }).length === 2)
    check('mixing with none ticked rolls among all of them',
      looksForRequest({ ...P, mixLooks: true }).length === LOOKS.length,
      'surprise me has to reach every look or it is a narrower promise than it makes')

    // A LOOK NOTHING RENDERS IS WORSE THAN NO LOOK, because it produces the
    // default and that is indistinguishable from the choice having worked.
    const v = validateThumbnailPreset({ lookIds: ['bold', 'not-a-look'] }, 'https://a.supabase.co')
    check('an unknown look is filtered out before it is stored',
      v.preset.lookIds.length === 1 && v.preset.lookIds[0] === 'bold')

    check('the route rolls per image rather than per batch',
      /pickPresetId\(asked\)/.test(GENROUTE),
      'one roll for the whole batch would make "a different look on each" a lie')
    check('and an override that filters to nothing falls back to the brand',
      /asked\.length > 0/.test(GENROUTE),
      'falling back to the default instead would silently drop a look the creator already set')

    // THE STEP NAMES WHAT IT WILL DO. "Mixed" alone does not tell somebody
    // whether their three ticks took effect or whether it is rolling twenty.
    const summ = (over: Partial<typeof P>) => presetSummaryOf({ ...P, ...over })
    check('the summary distinguishes mixing all from mixing a few',
      summ({ mixLooks: true }) !== summ({ mixLooks: true, lookIds: ['bold', 'neon'] }))
    check('and names the single look when there is one',
      /bold/i.test(summ({ lookIds: ['bold'] })),
      '"one look on all of them" does not tell them which one')
  }

  // ── the badge, also on this page ─────────────────────────────────────────
  {
    const P = defaultThumbnailPreset()
    check('leaving the brand setting alone sends nothing',
      presetToRequestFields(P).decoration === undefined,
      'sending a value here would overwrite a brand setting the creator never touched')
    check('and a chosen badge is sent',
      presetToRequestFields({ ...P, decoration: 'none' }).decoration === 'none')
    // BOTH BRANCHES. The first version checked only the 'auto' one, so
    // deleting it left every named badge still working and the guard green
    // while "let the design decide" silently did nothing.
    check('the route honours it',
      /decorationChoice === 'auto'/.test(GENROUTE)
      && /forcedDecoration = null/.test(GENROUTE)
      && /decorationChoice && \['check', 'stars', 'arrow', 'none'\]\.includes\(decorationChoice\)/.test(GENROUTE),
      'a branch nothing reaches is an option that silently does nothing')
    const v = validateThumbnailPreset({ decoration: 'fireworks' }, 'https://a.supabase.co')
    check('an unknown badge falls back to the brand, not to none',
      v.preset.decoration === 'brand',
      'falling back to none would silently strip a badge the creator had set')
  }

  // ── English gets the words, everywhere else does not ─────────────────────
  //
  // Seb: "still english locations with titles and others without". It was the
  // behaviour already; what was missing was any screen saying so, which made
  // the text-free copy look like a thumbnail that had failed.
  {
    check('the picker says both images get made',
      /no words/i.test(PICKER) && /hook/i.test(PICKER),
      'the wordless copy is a deliberate choice and looked like a failure')
    // ON THE COUNTRY ROW, next to the language. The first version grepped the
    // whole file and was satisfied by the intro paragraph above the grid, so
    // deleting the per-country label left it green.
    check('and each country says which one it gets',
      /m\.langName\}, dubbed[\s\S]{0,40}?thumbnail with no words/.test(BOARD)
      && /English[\s\S]{0,20}?thumbnail with the hook/.test(BOARD),
      'said once in an intro paragraph is said nowhere, for somebody scanning the grid')
    check('the worker still builds the text-free copy',
      /withText: false/.test(DRAIN),
      'one image for every country is the failure this split exists to prevent')
  }

  // ── the room left, before the wall ───────────────────────────────────────
  {
    check('the page reports how many more Amazon takes today',
      /daily-room/.test(BOARD) && /more today/.test(BOARD),
      'a number that stops moving with no explanation reads as a break')
    // THE CALL SITE, not the import line. An import survives the call being
    // deleted, and this codebase has been caught by exactly that three times.
    check('and it is the same counting the queue enforces',
      /await dailyRoomFor\(/.test(live(read('app/api/global-sync/daily-room/route.ts')))
      && /await dailyRoomFor\(/.test(live(read('app/api/global-sync/deliver/queue/route.ts'))),
      'a page promising room the queue then refuses is worse than saying nothing')
  }

  // ── a fallback that cannot say why is a fallback nobody can fix ──────────
  //
  // The first real batch came back with "Your chosen look could not be
  // applied", which is equally true of a timeout, a missing saved face, a
  // spend cap and an ASIN we could not fetch. None of those has the same
  // answer, and the sentence pointed at none of them.
  {
    check('the styled call carries its reason back',
      /Promise<\{ url: string \| null; why: string \}>/.test(DRAIN),
      'returning null throws away the one fact that makes the failure fixable')
    // READ OFF THE RESPONSE, not just referenced. The first version matched
    // `body.error` two lines below, so gutting the line that actually reads the
    // response left the check green and the reason empty.
    check('the route’s own refusal is repeated',
      /if \(!res\.ok\) \{[\s\S]{0,300}?await res\.json\(\)[\s\S]{0,200}?body\.error/.test(DRAIN),
      'the route refuses for reasons a creator can act on, and they were discarded')
    check('a timeout names itself',
      /timed out|timedOut/.test(DRAIN) && /took longer than/.test(DRAIN),
      'a timeout is the one cause whose fix is a number in this file, not anything the creator can do')
    check('and the row carries it',
      /\$\{plainWhy\}/.test(DRAIN),
      'a reason kept in a variable and never written is a reason nobody reads')
  }

  // ── the firing budget actually fits in the function ──────────────────────
  //
  // Each video needs TWO images: the styled one over a network call, and the
  // text-free copy built in process. Two videos a firing meant four image
  // generations inside a 300 second function, so the last was killed by the
  // platform with its try already counted, and three firings spent a video's
  // whole retry budget on a timeout that was never its fault.
  {
    const num = (name: string) => {
      const m = DRAIN.match(new RegExp(`const ${name} = ([0-9_]+)`))
      return m ? Number(m[1].replace(/_/g, '')) : NaN
    }
    const images = num('IMAGES')
    const callMs = num('THUMB_CALL_MS')
    const capMs = num('maxDuration') * 1000
    check('the drain declares a cap, a per-call budget and a batch size',
      Number.isFinite(images) && Number.isFinite(callMs) && Number.isFinite(capMs),
      `IMAGES=${images} THUMB_CALL_MS=${callMs} cap=${capMs}`)
    // A MARGIN, not a dead heat. The writes after the image still have to
    // happen, and a firing that ends exactly on the cap loses them.
    check('and a firing cannot outlive the function',
      images * callMs <= capMs - 30_000,
      `${images} image(s) x ${callMs / 1000}s leaves no room in ${capMs / 1000}s`)
    // THE BUDGET IS PER IMAGE. Counting videos put both of a video's images in
    // one function, which left the styled call about two minutes, and the
    // designed path does not reliably finish in two minutes: the first real
    // batch fell back to the plain builder with the look never applied.
    check('the budget is spent per image, not per video',
      /if \(!it\.thumbnail_url && budget > 0\)/.test(DRAIN)
      && /if \(!it\.thumbnail_clean_url && budget > 0\)/.test(DRAIN),
      'one budget for both images is what starved the styled call')
    // TWO IMAGES NEED TWO ALLOWANCES. Sharing one budget of three would leave
    // a video that spent two firings succeeding with a single retry left.
    const thumbTries = num('THUMB_TRIES')
    const tries = num('TRIES')
    check('the thumbnail step has its own try budget, sized for two images',
      Number.isFinite(thumbTries) && thumbTries >= tries * 2
      && /tries >= THUMB_TRIES/.test(DRAIN),
      `THUMB_TRIES=${thumbTries} against TRIES=${tries}`)
  }

  // ── the migration ────────────────────────────────────────────────────────
  check('the columns exist and can be added twice',
    /add column if not exists thumbnail jsonb/.test(M359)
    && /add column if not exists thumbnail_chosen/.test(M359)
    && /add column if not exists thumbnail_source/.test(M359),
    'a migration that only runs once is one Seb cannot safely re-paste')
  // ON THE SHARED LISTS, which is where the columns live now. Checking the
  // route source was right when each route wrote its own select and became a
  // check of nothing the moment they stopped.
  check('and the shared column lists carry them',
    /thumbnail,thumbnail_chosen/.test(BATCH_COLUMNS) && /thumbnail_source/.test(ITEM_COLUMNS),
    'a column nothing selects is a column the page never sees')
}

// ── the CTA is for YouTube, and Amazon gets the file without it ─────────────
//
// Seb, mid-build: "the CTA burn is only for Youtube.. the video without the cta
// is for amazon". `clean_url` was declared in migration 357 and read by the
// Amazon hand-off from the day it was written, and NOTHING ever set it, so
// every batch listing was handed a null video.
{
  check('the render writes both files',
    /rendered_url: out\.url, clean_url: it\.source_url/.test(DRAIN),
    'the CTA copy is for YouTube; Amazon gets the file the creator uploaded')
  check('a batch with no CTA still writes the clean copy',
    /rendered_url: it\.source_url, clean_url: it\.source_url/.test(DRAIN),
    'no CTA means both destinations get the same file, not that one gets null')
  check('Amazon is handed the clean copy',
    /source_video_url: it\.clean_url/.test(DRAIN),
    'a burned-in "link in the description" on a storefront points at nothing')
  check('and never falls back to the rendered one',
    !/source_video_url: it\.clean_url \?\? it\.rendered_url/.test(DRAIN)
    && !/clean_url \|\| it\.rendered_url/.test(DRAIN),
    'that fallback would put the CTA on Amazon silently, which is the exact thing clean_url exists to prevent')
}

// ── a video that is working and one that is stuck must not read the same ────
//
// Seb, looking at a batch: "what is happening". The row said "Building the
// thumbnail", which is what it said one second in and what it would have said
// forty minutes in. Three separate things made that unanswerable, and all
// three are the same mistake in different places.
{
  const TITLEROUTE = live(read('app/api/launch/items/[id]/title/route.ts'))

  // 1. THE WRITE WAS NEVER CHECKED. A column the patch names that the table
  //    does not have fails the whole update, so the state never moves and the
  //    try count climbs behind a sentence that never changes.
  check('a thumbnail write that fails is noticed',
    /const \{ error: wrote \} = await sb\.from\('launch_items'\)\.update\(patch\)/.test(DRAIN),
    'fire and forget is how a row sat on one sentence for forty minutes')
  check('and the failure lands on the row in words',
    /could not be saved/.test(DRAIN),
    'a failure only in the logs is a failure the creator cannot see')
  // THE SECOND WRITE TOUCHES ONLY OLD COLUMNS, or the report fails for the
  // same reason the thing it is reporting failed.
  {
    // SLICED FROM THE TOP OF THE BLOCK, not from the message inside it. The
    // first version started at the sentence, so a column added ABOVE that line
    // was outside the slice and the check passed over the exact bug it is for.
    const at = DRAIN.indexOf('if (wrote) {')
    const after = at > -1 ? DRAIN.slice(at) : ''
    const reportPatch = after.slice(0, after.indexOf('.eq(\'id\', it.id)'))
    check('the report cannot fail the same way',
      at > -1 && /could not be saved/.test(reportPatch)
      && !/thumbnail_source|thumbnail_url|state:/.test(reportPatch),
      'reporting a bad column through another new column reports nothing')
  }

  // 2. THE SCREEN HAD NO FACTS. Attempts and time since anything happened are
  //    the only two things that separate slow from stopped.
  check('the row says which attempt it is on',
    /function progressNote/.test(BOARD) && /try \$\{tries\} of 3/.test(BOARD),
    '"Building the thumbnail" is the same sentence on try one and try three')
  check('and says when nothing has moved for a while',
    /nothing for \$\{mins\} minutes/.test(BOARD),
    'a slow image model and a worker that is not running look identical without this')
  check('the tries and the timestamp actually reach the page',
    // MEMBERSHIP, NOT ADJACENCY. This pinned the three names in a row, so
    // inserting a fourth column between them failed a check about columns
    // being absent while all three were still there.
    ['render_tries', 'thumb_tries', 'updated_at'].every((c) => ITEM_COLUMNS.split(',').includes(c)),
    'a column the route does not select is a fact the screen cannot report')
  check('and it is only said while something is running',
    /it\.state === 'rendering' \|\| it\.state === 'preparing'/.test(BOARD),
    'a try count beside a finished video is noise')

  // 3. AN ASIN WAS ACCEPTED AS A TITLE. It would have gone to YouTube exactly
  //    as typed and been the source text for every translation.
  check('an ASIN in the title box is called out',
    /titleIsAsin/.test(BOARD) && /That is the ASIN, not a title/.test(BOARD),
    'nothing stopped B0H3P7H9T2 becoming a YouTube title and ten translations')
  check('and MVP will write the title instead',
    /Write it for me/.test(BOARD) && /items\/\$\{item\.id\}\/title/.test(BOARD),
    'typing ten titles by hand is the opposite of walking away from the computer')
  check('the title writer is the one the studio uses',
    /generateProductTitleOptions/.test(TITLEROUTE),
    'a second title writer drifts from the first')
  check('it needs the product first, and says so',
    /Set the product first/.test(TITLEROUTE),
    'a title written from nothing is a title about nothing')
  check('an ASIN already in the box is not fed back as a hint',
    /hint\.toUpperCase\(\) !== asin\.toUpperCase\(\)/.test(TITLEROUTE),
    'passing the ASIN in as the video title asks the writer to work from noise')
  check('and it offers rather than saves',
    /NOT SAVED/.test(read('app/api/launch/items/[id]/title/route.ts'))
    && !/update\(\{ title/.test(TITLEROUTE),
    'a title written into the row without being read is the plan reported as the result')
  check('a video already on YouTube keeps its title',
    /already on YouTube/.test(TITLEROUTE),
    'two titles disagreeing with nothing saying which is live')
}

// ── every route must fetch the columns the rules read ───────────────────────
//
// THE BUG THIS EXISTS FOR. lib/launch-batch decides what "ready" means and both
// routes call it, and the launch route even carried a comment saying so. It was
// still wrong: each route had its own hand-written select, `thumbnail_chosen`
// was added to one and not the other, and the launch route read it as undefined
// and refused a batch whose Launch button the page had just enabled.
//
// A function cannot be the single source of truth about a row when its callers
// disagree about which row to fetch. So the column lists move into the same
// module as the rules, and this checks that nothing reads a field the lists do
// not carry.
{
  const batchCols = new Set(BATCH_COLUMNS.split(','))
  const itemCols = new Set(ITEM_COLUMNS.split(','))

  // READ OFF THE RULES THEMSELVES. Every `batch.x` and `i.x` in the source of
  // batchSteps and launchBlocker is a column those functions need.
  const rules = LIB.slice(LIB.indexOf('export function batchSteps'))
  const wantBatch = new Set([...rules.matchAll(/\bbatch\.([a-z_]+)/g)].map(m => m[1]))
  const wantItem = new Set([
    ...rules.matchAll(/\bi\.([a-z_]+)/g),
    ...rules.matchAll(/\bitems\.filter\(\(i\) => [^)]*?i\.([a-z_]+)/g),
  ].map(m => m[1]))

  check('the rules read something at all', wantBatch.size > 2 && wantItem.size > 0,
    `${wantBatch.size} batch fields, ${wantItem.size} item fields`)
  for (const f of wantBatch) {
    check(`every route fetches batch.${f}`, batchCols.has(f),
      'a field the rules read and no route fetches is undefined, which reads as "not answered"')
  }
  // THE ONE DELIBERATE EXCEPTION, and it has to earn it. A video's own date
  // and time are loaded by a second query, withOwnSchedules, because main
  // deploys before the SQL is run: in ITEM_COLUMNS they would fail every item
  // query in that gap, and a failed select reads as a batch with no videos.
  // So they are exempt from this list ONLY while both routes call the loader
  // that fetches them, which is exactly the property this section protects.
  const LOADS_OWN = /withOwnSchedules\(sb, id,/
  const ownLoaded = LOADS_OWN.test(read('app/api/launch/batches/[id]/route.ts'))
    && LOADS_OWN.test(LAUNCH)
  check('both routes load each video\'s own time',
    ownLoaded,
    'a field the rules read and a route never fetches is undefined, and undefined reads as "follows the pattern"')
  for (const f of wantItem) {
    if ((f === 'custom_publish_date' || f === 'custom_publish_time') && ownLoaded) continue
    check(`every route fetches item.${f}`, itemCols.has(f),
      'a field the rules read and no route fetches is undefined, which reads as "not answered"')
  }

  // AND NO ROUTE MAY WRITE ITS OWN LIST. That is the shape of the original bug:
  // two lists that agreed until one of them changed.
  for (const [name, src] of [['the batch route', BATCH], ['the launch route', LAUNCH]] as const) {
    check(`${name} uses the shared column lists`,
      /\.select\(BATCH_COLUMNS\)/.test(src) && /\.select\(ITEM_COLUMNS\)/.test(src),
      'a hand-written select is a second list that drifts the day a column is added')
    check(`${name} hand-writes no batch select`,
      !/\.select\('id,name,state/.test(src),
      'the second list is exactly what refused a batch the page had called ready')
  }
}

// ── launching right away ────────────────────────────────────────────────────
//
// The earliest first day was tomorrow and a slot already gone was an error, so
// a batch finished in the morning could not put anything out until the next
// day. Picking today and pressing Launch is somebody asking for it to go now.
{
  // WHAT IT COMPUTES, not what it is called. The first version checked the
  // function's NAME, and a rename is not what this regression looks like:
  // adding a day back inside a function still called earliestDay is.
  {
    const at = BOARD.indexOf('function earliestDay')
    const body = at > -1 ? BOARD.slice(at, BOARD.indexOf('\n}', at)) : ''
    check('today is an allowed first day',
      at > -1 && /format\(new Date\(\)\)/.test(body) && !/86_?400_?000|\+ 1\b|addDays/.test(body),
      'a minimum of tomorrow is what made the feature wait a day for no reason')
    check('and the date input uses it',
      /min=\{earliestDay\(batch\.timezone\)\}/.test(BOARD),
      'a helper nothing passes to min is a helper that changes nothing')
  }
  // THE CALL SITE, not the import. An import survives the `if` being gutted,
  // which is how this repo has been caught four times now.
  // THE LINE IS THE DATE, PER VIDEO. It used to be drawn on the pattern's
  // first day alone, which a video with its own date never went near.
  check('a slot already gone is no longer refused',
    !/YouTube refuses a publish time in the past/.test(LAUNCH)
    && /const stale = datesBeforeToday\(planned, plan\.timezone\)/.test(LAUNCH)
    && /if \(stale\.length > 0\)/.test(LAUNCH),
    'refusing it is what forced tomorrow; the line is the date, not the time')
  check('a first day before today still is refused',
    /already been and gone/.test(LAUNCH),
    'ten videos going public at once cannot be undone')

  // YOUTUBE CANNOT BE TOLD "NOW". It refuses a publishAt in the past, so the
  // only way to say it is to upload public instead of private-then-schedule.
  // PUBLISHED AND SCHEDULED ARE DIFFERENT FACTS, and this row has kept them
  // apart from the start.
  check('a video that went now is published, not scheduled',
    /state: goNow \? 'published' : missed \? 'blocked' : 'scheduled'/.test(DRAIN),
    'a board promising a future publication for a video already on the channel')
  check('and it records when it actually went',
    /publish_at: goNow \? stamp\(\) : missed \? null : it\.planned_publish_at/.test(DRAIN),
    'writing this morning’s slot at two in the afternoon is the plan reported as the result')

  // ── NOTHING GOES PUBLIC THAT NOBODY CHOSE ─────────────────────────────
  //
  // THE CLOCK DECIDED, and published a video on a real channel. LACES STAY
  // PUT was set for 17:00 and Launch was pressed while 17:00 was still ahead;
  // the uploader reached it at 18:09, saw a past time, read that as "now",
  // and uploaded it public. Nobody had been told, because at the press there
  // was nothing to warn about. "Now" is a decision only if it was true when
  // the creator made it, so the launch route records it and the uploader
  // reads that instead of the clock.
  check('going public now needs the creator\'s agreement, not just a past time',
    /const goNow = due && agreedNow\.has\(it\.id\)/.test(DRAIN)
    && !/const goNow = new Date\(String\(it\.planned_publish_at\)\)\.getTime\(\) <= Date\.now\(\)/.test(DRAIN),
    'reading the clock at upload time publishes a slot that merely passed while the video was queued')
  check('the launch route records which ones were agreed, at the press',
    /\.update\(\{ publish_now: true \}\)\.in\('id', nowIds\)/.test(LAUNCH)
    && /const nowIds = immediate\.map/.test(LAUNCH),
    'the press is the only moment "now" is true')
  // FAILS SAFE. Before migration 365 the column does not exist; if reading it
  // failed the whole upload loop, nothing would upload, and if it defaulted
  // to "agreed", everything overdue would go public.
  check('a missing publish_now column means nothing is treated as agreed',
    /const agreedNow = new Set<string>\(\)[\s\S]{0,400}?if \(!nowErr\) for/.test(DRAIN), '')
  check('and the launch reply only promises "now" when it was recorded',
    /goingOutNow: publishNowRecorded \? immediate\.length : 0/.test(LAUNCH), '')
  check('a missed slot stays private and the row says what to do',
    /reason: missed\s*\n?\s*\? `Kept private\./.test(DRAIN) && /YouTube Studio/.test(DRAIN), '')
  check('and it is not offered a Try again that would miss the same slot',
    /it\.state === 'blocked' && !\/\^Kept private\\\.\/\.test/.test(BOARD), '')
  const M365 = read('supabase/migrations/365_launch_item_publish_now.sql')
  check('publish_now defaults to false',
    /publish_now boolean not null default false/.test(M365),
    'a default of true would publish every overdue video')

  // THE SCREEN SAYS SO BEFORE THE BUTTON. Going public cannot be undone.
  check('the preview says which go out immediately',
    /as soon as it is uploaded/.test(BOARD),
    'printing this morning’s time beside a video about to go out says the opposite of what happens')
  check('and it is said above the Launch button',
    /go public as soon as they are uploaded/.test(BOARD),
    'the one irreversible thing on the page should be read before it is pressed')
}

// ── YouTube waits, Amazon does not, and the screen says which is which ──────
//
// Seb, reading the launch result: "what does this mean.. youtube is schedule on
// the 23rd and amazon too?" It was not, and never has been: the file reaches
// YouTube within a minute of Launch and the Amazon hand-off happens right
// after it, so only YouTube GOING PUBLIC waits for the time. One paragraph
// covering both is what made them look like one thing.
{
  const DELIVERY = live(read('lib/storefront-delivery.ts'))
  const RETRY = live(read('app/api/launch/items/[id]/retry/route.ts'))

  // THE CALL IS UNCONDITIONAL, which is the actual invariant. The first
  // version tested whether `planned_publish_at` appeared near the call, which
  // it does for an unrelated reason: proximity is not a gate.
  {
    const at = DRAIN.indexOf('await handOverToAmazon(')
    const before = at > -1 ? DRAIN.slice(Math.max(0, at - 400), at) : ''
    check('nothing gates the Amazon side on the publish time',
      at > -1 && !/if \([^)]*\b(Date\.now|planned_publish_at|goNow)\b[^)]*\)\s*\{?\s*$/.test(before.trim()),
      'a listing waiting on a YouTube slot would be a day of storefront sales lost for nothing')
    // AND THE QUEUE THAT FEEDS IT DOES NOT WAIT EITHER.
    check('the publish step does not wait for the slot to arrive',
      !/gte\('planned_publish_at'|lte\('planned_publish_at'/.test(DRAIN),
      'claiming only videos whose time has come would hold the storefronts back too')
  }
  check('the result names the two sides apart',
    /YouTube: automatic/.test(BOARD) && /Amazon: you press the button/.test(BOARD),
    'one paragraph covering both is what made them read as one date')
  check('and states the daily allowance in the creator’s terms',
    /20 a day on the US store and 10 a day on each other one/.test(BOARD),
    'the rule exists and was enforced, but nowhere on this page said it')

  // THE SENTENCE WAS FALSE. This page used SCOUT to check sign-in and never
  // uploaded, so the tab it asked you to keep open did nothing for Amazon.
  check('the page actually uploads to Amazon',
    /deliverPreparedStorefronts/.test(BOARD) && /Upload to Amazon \(/.test(BOARD),
    'it asked for a tab to be kept open for work it never did')
  // THE CALL SITE IN EACH, not the import. An import survives its own call
  // being replaced by an inline fetch, which is precisely the second uploader
  // this check exists to forbid.
  // BOTH CALL IT, with or without a scope. The launch page passes one now, so
  // pinning the empty-parens form checked a call shape rather than the shared
  // path it exists to protect.
  check('and uses the same delivery as the storefront board',
    /await deliverPreparedStorefronts\(\)/.test(live(read('components/storefront/CoverageBoard.tsx')))
    && /await deliverPreparedStorefronts\(\{/.test(BOARD)
    && /export async function deliverPreparedStorefronts/.test(DELIVERY),
    'two uploaders agree only until one of them learns something')
  check('and neither board queues for itself',
    !/deliver\/queue/.test(live(read('components/storefront/CoverageBoard.tsx')))
    && !/deliver\/queue/.test(BOARD),
    'a board calling the queue directly is the second uploader wearing the shared one\u2019s import')
  // BOTH HALVES. The identifier alone matched with one of the two uses gone,
  // so this pins the exclusion AND the fact that the held-back ones are kept
  // and counted rather than quietly dropped.
  check('the shared delivery still holds back an unfinished dub',
    /filter\(\(i: any\) => !i\?\.audioIsMasterFallback\)/.test(DELIVERY)
    && /filter\(\(i: any\) => i\?\.audioIsMasterFallback\)/.test(DELIVERY)
    && /waitingOnDub/.test(DELIVERY),
    'English audio under a French title is invisible except to a French shopper pressing play')
  check('and still reports the cap',
    /daily limit/i.test(DELIVERY),
    'a number that stops moving with no explanation reads as a break')
}

// ── giving up must not destroy the reason ───────────────────────────────────
//
// "YouTube would not take this video after 3 tries" fits a disconnected
// channel, a rejected file, a quota and a strike equally badly. Every attempt
// had already written YouTube's own words onto the row, and the give-up line
// overwrote them at the exact moment somebody went looking.
{
  const RETRY = live(read('app/api/launch/items/[id]/retry/route.ts'))

  for (const [step, marker] of [
    ['the publish step', 'The last thing it said'],
    ['the render step', 'The last thing that went wrong'],
  ] as const) {
    check(`${step} keeps the real error when it gives up`, DRAIN.includes(marker),
      'the one fact that tells four causes apart, deleted on the last try')
  }
  check('and both fetch the column they read it from',
    (DRAIN.match(/publish_tries,reason/g) ?? []).length === 1
    && (DRAIN.match(/render_tries,reason/g) ?? []).length === 1,
    'a reason the select does not fetch is undefined, and the fallback fires every time')
  check('a give-up with nothing recorded says so rather than inventing',
    /gave no reason we could read/.test(DRAIN) && /nothing said why/.test(DRAIN),
    'a confident sentence over an unknown cause is worse than admitting it')

  // A WAY BACK. Every cause named is something a creator can fix.
  check('a blocked video can be tried again',
    /items\/\$\{id\}\/retry/.test(BOARD) && /Try again/.test(BOARD)
    && /export async function POST/.test(RETRY))
  check('the retry keeps the work and resets only the tries',
    // Matched either way it can be written, since these are assignments onto a
    // patch object rather than literal properties.
    /render_tries\s*[:=]\s*0/.test(RETRY)
    && /thumb_tries\s*[:=]\s*0/.test(RETRY)
    && /publish_tries\s*[:=]\s*0/.test(RETRY)
    && !/rendered_url\s*[:=]\s*null|thumbnail_url\s*[:=]\s*null/.test(RETRY),
    'starting from scratch throws away a finished render and two thumbnails')
  check('it goes back to the step that failed, worked out from what exists',
    /!item\.rendered_url/.test(RETRY) && /!item\.thumbnail_url/.test(RETRY),
    'remembering which step failed is a second copy of the truth')
  check('and a video already on YouTube cannot be retried',
    /already on YouTube/.test(RETRY),
    're-running the publish step would upload it twice')
}

// ── a missing channel is caught before Launch, not after three tries ────────
//
// The first real batch ran the whole pipeline, uploaded nothing, and reported
// "YouTube would not take this video after 3 tries". Whether a channel can
// receive an upload is knowable before the button is pressed, and learning it
// afterwards costs a render, two thumbnails and three attempts per video.
{
  const READY = live(read('lib/launch-readiness.ts'))

  check('a batch with no pushable channel is blocked with a sentence',
    !!channelBlocker(false) && /Settings/.test(channelBlocker(false) || ''),
    'a refusal that does not say where to go is a dead end')
  check('and one with a channel is not',
    channelBlocker(true) === null)
  check('it promises the setup is kept',
    /kept/.test(channelBlocker(false) || ''),
    'somebody who thinks they will lose ten videos of setup will not go and fix it')

  // PULL-ONLY IS NOT PUSHABLE. A channel added by URL has no tokens and cannot
  // receive an upload, and counting it is what makes "a channel exists" the
  // wrong question.
  check('only a channel with tokens counts',
    /not\('oauth_refresh_token', 'is', null\)/.test(READY),
    'a pull-only channel exists and cannot be uploaded to')
  check('a failed lookup does not block a launch that would have worked',
    /return true/.test(READY.slice(READY.indexOf('} catch {'))),
    'unknown is not blocked, and the publish step still reports honestly')

  // BOTH CALLERS, ONE ANSWER. The page enabling a button the route refuses is
  // a bug this pair has already produced once.
  check('the page and the launch route ask the same function',
    /await launchReadiness\(/.test(BATCH) && /await launchReadiness\(/.test(LAUNCH),
    'two readiness checks disagree the day one of them learns something')
  check('and neither calls the pure rules directly any more',
    !/launchBlocker\(b, items\)/.test(BATCH) && !/launchBlocker\(batch as BatchRow/.test(LAUNCH),
    'calling the half that skips the channel check is how the two would drift')
  check('the steps are reported before the channel',
    READY.indexOf('launchBlocker(batch, items)') < READY.indexOf('channelBlocker('),
    '"connect a channel" is useless to somebody who has not added a video yet')
}

// ── an ASIN in the title box blocks the step ────────────────────────────────
//
// The page warned "That is the ASIN, not a title" underneath a step ticked
// green that said "Every video has a product and a title". Both were on screen
// at once and the tick is the one people believe. A title goes on YouTube
// exactly as typed and is the source text every translation is made from, so
// this is ten listings, not one field.
{
  const asinItem = item({ asin: 'B0H3P7H9T2', title: 'B0H3P7H9T2', state: 'prepared' })
  const realItem = item({ asin: 'B0H3P7H9T2', title: 'Steam lift pro review', state: 'prepared' })
  const stepOf = (its: ItemRow[]) => batchSteps(full(), its).find((x) => x.id === 'products')!

  check('an ASIN used as a title is not done',
    stepOf([asinItem]).done === false,
    'a green tick over a warning is the tick people believe')
  check('and a real title is',
    stepOf([realItem]).done === true)
  check('the step says which videos and what to do',
    /ASIN/.test(stepOf([asinItem]).detail) && /Write it for me/.test(stepOf([asinItem]).detail),
    'a refusal with no next move is the dead end this repo keeps producing')
  check('and it blocks the launch, not just the tick',
    !!launchBlocker(full(), [asinItem]) && !launchBlocker(full(), [realItem]),
    'a step that is not done must stop the button, or the tick was the only thing that changed')
  // CASE AND SPACING DO NOT RESCUE IT.
  check('case and padding do not get past it',
    stepOf([item({ asin: 'B0H3P7H9T2', title: ' b0h3p7h9t2 ', state: 'prepared' })]).done === false)
  // AND A VIDEO WITH NO PRODUCT YET IS NOT ACCUSED OF THIS.
  check('a video with no product is not called out for it',
    /ASIN|Amazon link/.test(stepOf([item({ asin: null, title: 'Something', state: 'prepared' })]).detail)
    && !/not a title/.test(stepOf([item({ asin: null, title: 'Something', state: 'prepared' })]).detail),
    'the earlier problem is the one to name first')
}

// ── the two boxes must be tellable apart, and must not wipe each other ──────
//
// Both held the same ASIN, neither had a label once filled, and the warning
// about the TITLE was rendered under the PRODUCT box. So the box that got
// edited was the wrong one, the product was cleared, and the step then read
// "1 still needs a product", which over a batch of one reads as a request for
// another: "why does it want more asin.. i only uploaded 1 video".
{
  check('both boxes are labelled, not just placeheld',
    /Title, for YouTube and the English stores/.test(BOARD)
    && />Product</.test(BOARD),
    'a placeholder disappears the moment a box has anything in it')

  // THE WARNING SITS WITH THE BOX IT IS ABOUT. This is the whole bug: it was
  // under the product input, so that is the one that got edited.
  {
    const titleAt = BOARD.indexOf('Title, for YouTube and the English stores')
    const warnAt = BOARD.indexOf('That is the ASIN, not a title')
    const productAt = BOARD.indexOf('>Product<')
    check('the ASIN warning sits with the title box, not the product box',
      titleAt > -1 && warnAt > titleAt && productAt > warnAt,
      'a warning under the wrong input points somebody at the wrong field')
  }

  // ONE FIELD'S SAVE MUST NOT WIPE THE OTHER. Both were always sent, so an
  // empty box deleted its column even when the creator was editing its
  // neighbour, and an empty product is stored as no product at all.
  check('only the fields that changed are sent',
    /if \(title !== \(item\.title \?\? ''\)\) body\.title = title/.test(BOARD)
    && /if \(product !== \(item\.asin \?\? ''\)\) body\.product = product/.test(BOARD),
    'sending both means emptying one box deletes it while you edit the other')
  check('and the save goes through that one function',
    /onClick=\{save\}/.test(BOARD) && /function save\(\)/.test(BOARD),
    'a second inline save is the copy that keeps sending both')
}

// ── the description is where the affiliate link lives ───────────────────────
//
// Nothing ever wrote launch_items.description, so every batch video went to
// YouTube with an empty one. The CTA burned into that same frame says "link in
// the description". The video pointed at nothing and earned nothing, which
// made the YouTube half of this feature decorative.
{
  const META = live(read('app/api/youtube/generate-metadata/route.ts'))

  check('the worker writes a description before publishing',
    /patch\.description = meta\.description/.test(DRAIN)
    && /await videoMetadata\(/.test(DRAIN),
    'an empty description is a video with no affiliate link at all')
  check('from the writer Launchpad uses, not a second one',
    /generate-metadata/.test(DRAIN),
    'two description writers drift, and this one carries the link')
  check('and only when there is not one already',
    /if \(!String\(it\.description \|\| ''\)\.trim\(\)\)/.test(DRAIN),
    'rewriting a description the creator edited would throw their work away')
  // THE EXACT HEADER. "x-mvp-service-user" contains "x-mvp-service", so the
  // loose version matched the identity line while the secret line was gutted.
  check('the route accepts the internal call',
    /headers\.get\('x-mvp-service'\)/.test(META) && /CRON_SECRET/.test(META),
    'without it the worker gets a 401 and every video ships linkless')
  check('and an internal call with no identity is refused',
    /Service call missing identity/.test(META))

  check('the description reaches the upload',
    /description: \(it\.description \|\| ''\)\.slice\(0, 4900\)/.test(DRAIN)
    && /planned_publish_at,publish_tries,reason/.test(DRAIN),
    'a column the publish step does not select is a description that never ships')
  check('and the tags go with it',
    /tags: String\(it\.tags \|\| ''\)/.test(DRAIN) && /title,description,tags,rendered_url/.test(DRAIN),
    'tags were written and then dropped on the way to YouTube')

  // A VIDEO THAT EARNS NOTHING MUST NOT LOOK LIKE ONE THAT DOES.
  check('the row says when there is no link',
    /no link in the description/.test(BOARD),
    'the whole point of the burned-in CTA is a link that has to exist')
  check('and it is a best effort, not a block',
    /metaMissing/.test(DRAIN) && !/state: 'blocked'[\s\S]{0,200}?description/.test(DRAIN),
    'a video on the channel beats a video held back over its description')
}

// ── the page keeps what it launched, and says how long the rest will take ───
{
  const MOVE = live(read('app/api/launch/items/[id]/move/route.ts'))

  // A LAUNCHED BATCH USED TO DISAPPEAR. The page found the first unlaunched
  // batch, so the moment one finished it showed the empty "start a batch"
  // screen: ten videos scheduled across ten days, and no record of them on the
  // page that scheduled them.
  check('every batch is listed, not just the open one',
    /const \[batches, setBatches\]/.test(BOARD) && /batches\.map\(\(b\)/.test(BOARD),
    'a finished batch vanishing is the page forgetting what it just did')
  check('and the most recent is shown when none are open',
    /all\.find\(\(b\) => b\.state !== 'launched'\) \?\? all\[0\]/.test(BOARD),
    'falling through to an empty screen is what made it look like nothing happened')
  check('a new batch can be started while one is still going',
    /New batch/.test(BOARD),
    'somebody posting three a day sets up the next one before the last finishes')
  check('switching batches lets the new one point at its own step',
    /function openBatch\(id: string\)[\s\S]{0,200}?autoOpened\.current = false/.test(BOARD),
    'inheriting the last batch’s open step is state bleeding between two things')

  // ORDER IS THE PUBLISHING ORDER, and it was whatever a file dialog returned.
  check('a video can be moved in the run',
    /items\/\$\{id\}\/move/.test(BOARD) && /export async function POST/.test(MOVE),
    'position decides which video goes out today and which goes out next week')
  check('the whole batch is renumbered rather than two rows swapped',
    /next\.splice\(to, 0, next\.splice\(at, 1\)\[0\]\)/.test(MOVE),
    'a swap against a list with a hole in it moves a video nobody asked to move')
  check('nothing already on YouTube is moved',
    /already has its time on YouTube/.test(MOVE) && /already on YouTube, so it cannot swap/.test(MOVE),
    'its time is set on YouTube’s side, so the page would just disagree with the channel')
  check('and moving past the end is not an error',
    /ok: true, moved: false/.test(MOVE),
    '"that failed" about a button with nowhere to go is noise')

  // THE DESCRIPTION IS READABLE AND EDITABLE before it reaches YouTube.
  check('the description can be seen and changed',
    /See the description/.test(BOARD) && /body\.description = desc/.test(BOARD),
    'MVP writes the affiliate link in there and nobody could check it')

  // HOW LONG, counted rather than guessed.
  {
    const it = (over: Partial<ItemRow>): ItemRow => item(over)
    check('nothing left to prepare says nothing',
      prepEta([it({ state: 'prepared' })]) === null,
      'a permanent "preparing" line is one nobody reads')
    check('a draft video counts its render and both images',
      minutesLeft([it({ state: 'draft', thumbnail_url: null, thumbnail_clean_url: null })]) === 3,
      'the drain does one image a firing and fires once a minute, so this is arithmetic')
    check('an image already built is not counted again',
      minutesLeft([it({ state: 'preparing', thumbnail_url: 'https://x/t.png', thumbnail_clean_url: null })]) === 1)
    check('and the words hedge, because a firing can go on a retry',
      /About/.test(prepEta([it({ state: 'draft', thumbnail_url: null })]) ?? ''),
      'a number stated as a promise is one that gets held against you')
    check('it says the tab can be closed',
      /close this tab/.test(prepEta([it({ state: 'draft', thumbnail_url: null })]) ?? ''),
      'that is the entire promise of the feature and it was said nowhere near the waiting')
  }

  // THE PREVIEW IS YOUTUBE ONLY, and saying so is why a creator asked whether
  // Amazon was waiting for the same date.
  check('the schedule preview says Amazon is not on it',
    /Amazon is not on this schedule/.test(BOARD),
    'a list of dates with no caveat reads as the whole plan')
}

// ── the page has to be navigable, not just correct ──────────────────────────
//
// Before a live run: "I want the UI better.. easier to navigate and show
// users' options clearly". Six accordions, one open at a time, with the
// Launch button inside the last one and no way to see how far through you
// were. Correct, and hard to use.
{
  // OPTIONAL MEANS OPTIONAL, AND IT HAS TO SAY SO. Six numbered steps with
  // ticks read as six things you must do, so somebody works through a CTA
  // gallery and twenty looks believing the batch will not go without them.
  check('the two steps that can be left alone say so',
    stepIsOptional('cta') && stepIsOptional('thumbnail'),
    'a two minute setup reads as a twenty minute one without this')
  check('and the ones that cannot do not',
    !stepIsOptional('videos') && !stepIsOptional('products')
    && !stepIsOptional('countries') && !stepIsOptional('schedule'),
    'marking a required step optional is worse than marking none')
  check('the card renders the mark',
    /optional && !done/.test(STEPCARD) && /optional/.test(BOARD),
    'a flag no screen shows changes nothing')
  // ONLY WHILE IT IS STILL OPEN. "Optional" beside a finished step is noise.
  check('and only while the step is unanswered',
    /optional && !done/.test(STEPCARD),
    'a tick and an "optional" chip on the same row is two answers to one question')

  check('the page shows how far through you are',
    /of \{steps\.length\} done/.test(BOARD),
    'three steps in, nearly finished and barely started look identical')

  // THE BUTTON WAS INSIDE STEP SIX. Reaching it meant scrolling past
  // everything and opening an accordion.
  check('Launch rides along rather than hiding in the last step',
    /sticky bottom-3/.test(BOARD),
    'the one action on the page should not be something you have to find')
  check('and the reason it is disabled is beside it',
    /\{blocker \?\? \(unsaved\.length > 0/.test(BOARD) && /: launched\s*\n?\s*\?/.test(BOARD),
    'a greyed button with nothing next to it is the dead end this repo keeps producing')

  // EVERY DECISION IN ONE PLACE, at the moment they all matter at once.
  {
    const lines = batchRecap(full({ cta: null, thumbnail: null }), [item({ state: 'prepared' })])
    check('there is a recap before the irreversible button',
      lines.length >= 4 && /batchRecap\(/.test(BOARD),
      'scrolling back through six accordions to check what you chose is hoping, not reviewing')
    check('it says what happens to YouTube and to Amazon separately',
      lines.some((l) => /YouTube/.test(l)) && lines.some((l) => /Amazon/.test(l)),
      'the two are on different clocks and the recap is where that lands')
    check('and it names the ones that cannot go',
      /cannot/.test(batchRecap(full(), [item({ state: 'prepared' }), item({ id: 'j', position: 1, state: 'blocked' })]).join(' ')),
      'a count of what goes out, over a batch where something will not, is a half truth')
    check('a no-CTA batch says so rather than staying silent',
      lines.some((l) => /No CTA/.test(l)),
      'silence about a choice reads as the choice not having been made')
  }

  // TEN ROWS OF FORM IS A WALL, and the wall hides the row that needs you.
  check('a finished video folds away',
    /setOpenRow\(false\)/.test(BOARD) && /const \[openRow, setOpenRow\]/.test(BOARD),
    'ten open editors buries the one that is incomplete')
  check('and an unfinished one opens itself',
    /useState\(incomplete\)/.test(BOARD),
    'the row that needs attention is exactly the row that should not be folded')
  check('folding never eats unsaved typing',
    /disabled=\{changed \|\| incomplete\}/.test(BOARD),
    'losing somebody’s edit without saying so is the worst kind of tidy')
}

// ── a batch arrives named, and can be renamed or binned ─────────────────────
//
// Three rows reading "Untitled batch · 1 video" are not a list, they are three
// identical buttons, and none of them could be deleted: a launched batch was
// refused outright on the grounds that deleting the row does not unschedule
// anything. That reasoning is right and the conclusion was wrong, because a
// page that fills with rows you cannot act on teaches people to ignore it.
{
  const BATCHES = live(read('app/api/launch/batches/route.ts'))

  const name = defaultBatchName(new Date('2026-09-22T14:05:00Z'), 'America/Toronto')
  check('a new batch is named with something that tells it apart',
    /\d/.test(name) && !/Untitled/i.test(name), name)
  check('and never carries a year',
    !/\b20\d\d\b/.test(name), name)
  check('the zone is the creator’s, not the server’s',
    // THE DATE, not just "the two strings differ". Forcing only the date
    // formatter to UTC still left the CLOCK differing, so the loose version
    // passed over a name filed under the wrong day.
    defaultBatchName(new Date('2026-09-23T02:00:00Z'), 'America/Toronto').startsWith('22 Sept')
    && defaultBatchName(new Date('2026-09-23T02:00:00Z'), 'UTC').startsWith('23 Sept'),
    'a batch made late at night would be filed under tomorrow')
  check('a zone nobody recognises does not throw',
    defaultBatchName(new Date(), 'Not/AZone').length > 0,
    'a bad zone must not take batch creation down with it')
  check('the create route uses it',
    /defaultBatchName\(new Date\(\), timezone\)/.test(BATCHES)
    && !/'Untitled batch'/.test(BATCHES),
    'a helper the route does not call leaves every row saying Untitled')

  // DELETE IS ALLOWED, AND THE TRUTH IS SAID FIRST.
  // THE GUARD CLAUSE ITSELF. Checking for the absence of an old sentence
  // passed over a restored refusal that simply worded it differently, and
  // checking that the query param is PARSED passed over a branch gated on
  // `false` that never reads it.
  check('a launched batch can be deleted',
    /if \(launched && !confirmed\) \{/.test(BATCH),
    'a list of finished rows nobody can tidy is a list nobody reads')
  check('but only when the caller says it meant it',
    /const confirmed = new URL\(req\.url\)\.searchParams\.get\('confirm'\) === '1'/.test(BATCH)
    && /const launched = batch\.state === 'launched' \|\| batch\.state === 'launching'/.test(BATCH)
    && /needsConfirm: true/.test(BATCH),
    'this is the one delete somebody could expect to take the videos down')
  check('and the refusal says what stays up',
    /leaves the videos on YouTube and the listings on Amazon/.test(BATCH),
    'a confirm that does not say what survives is not informed consent')
  check('the page confirms before it calls',
    /window\.confirm/.test(BOARD) && /stay on YouTube and the listings stay on Amazon/.test(BOARD),
    'the server sentence is no use if the browser never shows it')
  check('and it sends the confirm only for a launched one',
    /\$\{gone \? '\?confirm=1' : ''\}/.test(BOARD),
    'asking twice about a draft that published nothing is noise')

  // DELETING THE ONE YOU ARE LOOKING AT has to leave you somewhere.
  check('deleting the open batch moves to another',
    /rest\.find\(\(b\) => b\.state !== 'launched'\) \?\? rest\[0\]/.test(BOARD),
    'a page left pointing at a row that no longer exists')
  check('and the rename is on the row it renames',
    /renameBatch\(b\.id, b\.name\)/.test(BOARD) && /name: \(body\.name/.test(BATCHES + BATCH),
    'a name nothing can change is a name you live with')
}

// ── a button that reads your typing must act on your typing ─────────────────
//
// The Product box had an ASIN in it, the Write it for me button was enabled by
// that text, and pressing it answered "Set the product first" because the ROUTE
// reads the saved row and the button read the box. True, and it reads as
// broken: the product is plainly on screen an inch away.
{
  check('writing a title saves an unsaved product first',
    /const unsaved = product\.trim\(\) && product !== \(item\.asin \?\? ''\)/.test(BOARD)
    && /await onSave\(item\.id, \{ product \}\)/.test(BOARD),
    'the button is enabled by the box, so it has to act on the box')
  // ORDER MATTERS. Saving after asking is the same bug with extra steps.
  check('and does it before asking for the title',
    BOARD.indexOf('await onSave(item.id, { product })')
      < BOARD.indexOf('/title`, { method: \'POST\' }'),
    'asking first and saving after leaves the route reading the old row')
  check('the dirty flag is cleared so the reload is not fought',
    /dirty\.current = false\n        await onSave\(item\.id, \{ product \}\)/.test(BOARD),
    'a reload landing on a row still marked dirty leaves the box out of step with the server')
  check('nothing is saved when the product has not changed',
    /if \(unsaved\) \{/.test(BOARD),
    'a write on every press is a request nobody asked for')
  check('and the button says what it will do',
    /Saves the product first if you have not/.test(BOARD),
    'a button with a hidden side effect is one people press twice')
}

// ── a batch can only ever upload its own videos, to its own countries ───────
//
// THE WORST BUG OF THE FEATURE. A creator picked the United States and Germany
// for a batch, pressed Upload to Amazon, and SCOUT opened amazon.es,
// amazon.fr and amazon.it: storefronts never chosen for those videos, on their
// real Creator account.
//
// The cause was one missing argument. The delivery queue returns EVERY
// localized target on the account when it is called with no scope, which is
// correct for the storefront board (the standing grid is its whole job) and
// catastrophic anywhere else. The launch page called it with nothing.
{
  const QUEUE = live(read('app/api/global-sync/deliver/queue/route.ts'))
  const DELIVERY = live(read('lib/storefront-delivery.ts'))

  // BOTH HALVES. Looking the videos up and then not narrowing the query with
  // what came back is the same bug with extra steps, and it reads as finished.
  check('the queue can be scoped to named videos',
    /\.in\('video_id', onlyVideoIds\)/.test(QUEUE) && /q = q\.in\('job_id', ids\)/.test(QUEUE),
    'without a scope every call reaches the whole account')
  check('and to named countries',
    /onlyDomains/.test(QUEUE) && /q\.in\('domain', onlyDomains\)/.test(QUEUE),
    'the batch knows both, and either alone still leaves a way to publish somewhere nobody chose')

  // NO SILENT WIDENING. A scope that matches nothing must return nothing.
  check('a scope that matches nothing returns nothing',
    /if \(ids\.length === 0\) return NextResponse\.json\(\{ ok: true, items: \[\]/.test(QUEUE),
    'falling back to everything is exactly what published to Spain')

  check('the delivery helper passes a scope through',
    /qs\.set\('videoIds'/.test(DELIVERY) && /qs\.set\('domains'/.test(DELIVERY),
    'an argument the helper drops is a scope that never reaches the server')
  check('the launch page sends its own batch',
    /const videoIds = items\.map\(\(i\) => i\.video_id\)/.test(BOARD)
    && /domains: batch\?\.markets\.map\(\(m\) => m\.domain\)/.test(BOARD),
    'this is the one call that must never mean "everything"')
  // THE WHOLE COLUMN, NOT A SUBSTRING OF ANOTHER ONE. `youtube_video_id` was
  // already in this list and contains `video_id`, so a regex was satisfied by a
  // column that carries a different id entirely.
  check('and the video ids actually reach the page',
    ITEM_COLUMNS.split(',').includes('video_id'),
    'a column the route does not select is a scope built from undefined')

  // NOTHING ON YOUTUBE MEANS NOTHING FOR AMAZON, and saying so beats an
  // unscoped call that finds somebody else's backlog.
  check('a batch with nothing on YouTube says so rather than uploading',
    /None of these are on YouTube yet/.test(BOARD),
    'an empty scope must not become an absent scope')

  // THE STOREFRONT BOARD IS THE EXCEPTION and stays unscoped on purpose.
  check('the storefront board still asks for the whole grid',
    /await deliverPreparedStorefronts\(\)/.test(read('components/storefront/CoverageBoard.tsx')),
    'the standing grid is that page’s entire job')
}

// ── the panel after Launch says what happened, not what was asked for ──────
//
// A creator launched one video. The panel read "1 video scheduled" in green,
// with the publication time under it, and the board directly below read
// "Cannot go: YouTube would not take this video after 3 tries". Both were on
// screen together. The green one was built from the launch call's reply, a
// count of rows handed to the worker, captured once and never looked at again.
{
  const OUTCOME = live(read('lib/launch-batch.ts'))
  // COMMENT-STRIPPED, because every negative check below is about a sentence
  // being gone from the screen, and the note explaining why it went carries
  // the old wording word for word.
  const SCREEN = live(BOARD)

  const blockedOnly = launchOutcome([{ state: 'blocked' }])
  check('one video that could not go is not a video scheduled',
    blockedOnly.tone === 'warn' && !/scheduled/i.test(blockedOnly.headline),
    `read: ${blockedOnly.headline}`)

  const mixed = launchOutcome([
    { state: 'scheduled', video_id: 'v1' }, { state: 'blocked' }, { state: 'rendering' },
  ])
  check('a mixed batch leads with the ones that stopped',
    // "needs you", not "could not go": a video kept private after a missed
    // slot is on the channel, so "could not go" is no longer true of every
    // blocked row, and "needs you" is.
    mixed.tone === 'warn' && /1 needs you/.test(mixed.headline),
    `read: ${mixed.headline}`)

  const working = launchOutcome([{ state: 'rendering' }, { state: 'prepared' }])
  check('nothing on YouTube yet never reads as done',
    working.tone === 'busy' && /Nothing is on YouTube yet/.test(working.headline),
    `read: ${working.headline}`)

  const done = launchOutcome([
    { state: 'scheduled', video_id: 'v1' }, { state: 'published', video_id: 'v2' },
  ])
  check('and a batch that really is on YouTube says so',
    done.tone === 'good' && done.onYouTube === 2 && done.amazonBlocker === null,
    `read: ${done.headline} / ${done.amazonBlocker}`)

  // THE BUTTON KNOWS BEFORE IT IS PRESSED. It used to be live whatever the
  // batch was doing and only said in a toast, afterwards, that there was
  // nothing to send.
  check('Amazon is blocked, with a reason, while nothing is on YouTube',
    /no video for Amazon to list/.test(OUTCOME)
    && /disabled=\{busy === 'amazon' \|\| !!out\.amazonBlocker\}/.test(BOARD),
    'a button that can only fail should say so before it is pressed')

  check('the panel counts rows rather than the launch reply',
    /const out = launchOutcome\(items/.test(SCREEN) && !/launched\.scheduled/.test(SCREEN),
    'a number captured once cannot disagree with the board under it, it can only be wrong')

  // AND IT SURVIVES A RELOAD, which is when somebody actually comes back for
  // the Amazon button.
  check('a launched batch still shows its panel after a refresh',
    /batch\.state === 'launched' \|\| batch\.state === 'launching'\) && \(\(\) =>/.test(BOARD),
    'state set by pressing a button is gone the moment the tab is reloaded')

  // ONE STORY ABOUT AMAZON, not two contradicting each other three lines apart.
  check('the Amazon heading does not promise something automatic',
    !/Amazon: straight away/.test(SCREEN) && /Amazon: you press the button/.test(SCREEN),
    'it said "straight away" and then that it needed this tab open')

  // ── a file name is not a title, and MVP writes the real one ──────────────
  //
  // Adding videos to a batch seeded each title from the uploaded file name and
  // nothing ever replaced it, so STEAM BRUSH WORKS?.mp4 became the video's
  // title, the subject given to the thumbnail generator, the subject given to
  // the description writer, and the title on YouTube. The same channel's
  // Launchpad videos read "Finally, a Camping Table That Actually Fits in the
  // Boot". The batch had a Write it for me button, one press per video.
  {
    const ITEMS_POST = live(read('app/api/launch/batches/[id]/items/route.ts'))
    const ITEM_PATCH = live(read('app/api/launch/items/[id]/route.ts'))

    check('where a title came from is recorded when it is written',
      /title_source: body\.titleSource === 'creator' \? 'creator' : 'filename'/.test(ITEMS_POST)
      && /titleSource: 'filename'/.test(SCREEN),
      'no pattern separates a file name from a title somebody meant, only provenance does')
    check('a typed title becomes the creator’s and is never overwritten',
      /patch\.title_source = 'creator'/.test(ITEM_PATCH),
      'the worker would otherwise replace a title somebody chose')
    check('the worker writes a title for anything nobody chose',
      /if \(titleSource !== 'creator' && titleSource !== 'mvp'\)/.test(DRAIN)
      && /await productTitle\(it\.user_id, title, asin\)/.test(DRAIN),
      'a button that must be pressed once per video is not an unattended batch')
    check('and writes it before the thumbnail and the description are built',
      DRAIN.indexOf('await productTitle(') > -1
      && DRAIN.indexOf('await productTitle(') < DRAIN.indexOf('await styledThumbnail('),
      'both are written FROM the title, so fixing it after leaves an image about a file name')
    check('it writes it once, not on every firing',
      /title_source: 'mvp'/.test(DRAIN) && /titleSource !== 'mvp'/.test(DRAIN),
      'rewriting an MVP title every minute would spend a call a minute per video')
    check('the file name is not fed back to the writer as the subject',
      /videoTitle: '',\n      asin,/.test(DRAIN),
      'handing it back produced five variations on a file name')
    check('the worker can see the provenance',
      /asin,title,title_source,description/.test(DRAIN)
      && ITEM_COLUMNS.split(',').includes('title_source'),
      'a column neither query selects is a decision made on undefined')
    check('and the row says whose title it is',
      /still your file name/.test(SCREEN) && /title by MVP/.test(SCREEN),
      'a file name and a written title look identical on a row')

    // THE STEP SAYS IT TOO, rather than ticking green over ten file names.
    const fileNamed = batchSteps(full(), [item({ title: 'steam brush works', title_source: 'filename' })])
      .find((s) => s.id === 'products')
    check('the products step names the ones still on a file name',
      !!fileNamed && /name of the file you uploaded/.test(fileNamed.detail),
      `read: ${fileNamed?.detail}`)
  }

  // ── one launch, one upload, whatever fails afterwards ────────────────────
  //
  // A creator launched a single video and found THREE copies of it on their
  // real channel, all stuck on "Pending, processing will begin shortly", while
  // the page said the upload had failed. All three uploads had succeeded. What
  // failed was the next call, the one that sets the publish time, and the retry
  // went back to the top and sent the file again.
  check('a row that already has a video id never uploads again',
    /let videoId = String\(it\.youtube_video_id \|\| ''\)\.trim\(\)/.test(DRAIN)
    && /if \(!videoId\) \{/.test(DRAIN),
    'every retry re-uploaded, and a real channel collected three copies of one video')
  check('the id is written the moment YouTube hands it over',
    /\.update\(\{ youtube_video_id: videoId, updated_at: stamp\(\) \}\)/.test(DRAIN),
    'bundling it into the update at the end of the block is how it got lost')
  check('and the worker can actually see it',
    /planned_publish_at,publish_tries,reason,youtube_video_id'\)/.test(DRAIN),
    'a column the query does not select is a resume that never happens')
  check('a schedule that fails says the video is on the channel',
    /the video is on your channel but YouTube would not set its publish time/.test(DRAIN),
    'it said "check the channel is still connected" over a video that had uploaded three times')
  check('Try again resumes rather than re-uploads',
    /setting the publish time on the video already on your channel/.test(live(read('app/api/launch/items/[id]/retry/route.ts')))
    && /youtube_video_id'\)/.test(read('app/api/launch/items/[id]/retry/route.ts')),
    'the one button offered after this failure must not be the thing that duplicates')

  // AN ATTEMPT THAT NEVER CAME BACK IS NOT THE SAME AS A REFUSAL.
  check('an attempt is recorded while it runs',
    /reason: `Attempt \$\{tries \+ 1\} of \$\{TRIES\} is running now\.`/.test(DRAIN),
    'a firing killed mid-upload used to burn a try and write nothing at all')
  check('and three attempts that never reported back say so',
    /stopped before they could report back, which is a time problem rather than a YouTube one/.test(DRAIN)
    // THE TEST ITSELF, not the name. `const inflight = false` satisfied a
    // check for the word and turned every timeout back into a refusal.
    && /const inflight = \/\^Attempt \\d\+ of \\d\+ is running now/.test(DRAIN),
    'quoting the in-flight note back as "the last thing YouTube said" would hide a timeout')

  // ── the thumbnail we designed has to reach the channel ───────────────────
  //
  // It never did. The worker built one for every video, stored both versions,
  // gave the clean copy to Amazon and uploaded to YouTube without setting it,
  // so the channel ran whichever frame YouTube chose. The board looked right
  // because it draws the file we made, not the one on the video.
  check('the launch worker sets the thumbnail it designed',
    /yt\.uploadThumbnail\(videoId,/.test(DRAIN),
    'the method existed the whole time and this was its one missing caller')
  check('and a refused thumbnail never sends the video back for a second upload',
    /thumb\.error = \(te instanceof Error/.test(DRAIN)
    && !/throw/.test(DRAIN.slice(DRAIN.indexOf('yt.uploadThumbnail'), DRAIN.indexOf('yt.uploadThumbnail') + 400)),
    'the video is on the channel by then, so throwing here uploads it twice')
  check('the outcome is written whichever way it went',
    /thumbnail_set_at: thumb\.at/.test(DRAIN) && /thumbnail_error: thumb\.error/.test(DRAIN),
    'one nullable timestamp cannot tell "refused" apart from "not tried yet"')
  check('the board reads them',
    ITEM_COLUMNS.split(',').includes('thumbnail_set_at')
    && ITEM_COLUMNS.split(',').includes('thumbnail_error'),
    'a column the route does not select is a fact the page cannot show')
  check('and says which frame the channel is actually running',
    /YouTube picked its own frame/.test(SCREEN) && /thumbnail set/.test(SCREEN),
    'the row drew our designed image either way, which is the plan reported as the result')

  // AND THE WORKER NEVER WRITES THE SENTENCE THAT MEANS "NO REASON".
  check('a failed upload records whatever was thrown',
    /YouTube refused it and the error was \$\{String\(e\)/.test(DRAIN),
    'the fallback used to be the exact string the give-up path discards as unreadable')
}

// ── a scheduled video is checked, not assumed ──────────────────────────────
//
// `publishes` wrote `state: goNow ? 'published' : 'scheduled'` once, at upload,
// and nothing ever came back. A video scheduled for Tuesday read "Scheduled on
// YouTube, goes live 23 Sept 11:30" in green on Tuesday, on Wednesday and next
// month, whether or not YouTube made it public. And YouTube does fail to: a
// video can still be processing, be age restricted, or take a copyright claim,
// and the publishAt quietly does not fire. Every one of those looked like
// success, because the only thing the screen knew was what had been ASKED for.
//
// 'published' was also unreachable for a scheduled video: only the publish-now
// path ever wrote it, so the board had a state it could never show for exactly
// the videos most likely to need it.
{
  const M362 = read('supabase/migrations/362_confirm_what_happened.sql')

  check('something goes back and asks YouTube',
    /async function confirms\(sb: Sb\)/.test(DRAIN) && /await confirms\(sb\)/.test(DRAIN),
    'a state written once at upload is a promise, and the board was printing it as a record')
  check('and only public counts as published',
    /if \(m && m\.status === 'public'\)/.test(DRAIN) && /state: 'published', confirmed_at/.test(DRAIN),
    'anything else is the video not being on the channel for the people it was scheduled for')

  // A CHECK THAT COULD NOT RUN IS NOT A VERDICT, which is the rule the rest of
  // this worker already follows.
  check('a failed lookup never writes a verdict',
    /confirm lookup failed/.test(DRAIN)
    && /catch \(e\) \{[\s\S]{0,400}?confirm lookup failed[\s\S]{0,120}?continue/.test(DRAIN),
    'saying "it did not publish" because our own call failed is worse than saying nothing')

  check('it waits past the moment before asking',
    /const CONFIRM_GRACE_MS = 5 \* 60_000/.test(DRAIN) && /lte\('publish_at', cutoff\)/.test(DRAIN),
    'YouTube does not flip a video on the second, so an instant check writes a false failure')
  check('and it stops asking eventually',
    /const CONFIRM_TRIES = 6/.test(DRAIN) && /tries >= CONFIRM_TRIES/.test(DRAIN),
    'a video that never publishes must not be polled forever')

  // GONE AND STILL PRIVATE ARE DIFFERENT ANSWERS with different things to do.
  check('a removed video reads differently from a stuck one',
    /no longer has this video/.test(DRAIN) && /still has this private/.test(DRAIN),
    'one means check the channel, the other means wait or fix a claim')

  check('the worker can see what it needs',
    /select\('id,user_id,title,youtube_video_id,publish_at,confirm_tries'\)/.test(DRAIN),
    'a column the query does not select is a decision made on undefined')
  check('and the columns exist, twice-runnable',
    // ON launch_items, NOT just anywhere in the file. storefront_coverage gains
    // columns with the same two names in the same migration, so a bare search
    // passed with the launch_items block deleted entirely.
    /alter table public\.launch_items\s+add column if not exists confirm_tries integer not null default 0,\s+add column if not exists confirmed_at timestamptz;/.test(M362),
    'a column the code writes and the database has not got fails silently on every row')
}

if (failures.length) {
  console.error(`\n❌ launch-batch: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ launch-batch: ten videos, one CTA, a schedule YouTube confirmed, and a page that never ticks a step the worker would refuse')
