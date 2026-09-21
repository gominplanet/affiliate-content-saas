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
import { batchSteps, launchBlocker, validateCtaPreset, MAX_ITEMS, type BatchRow, type ItemRow } from '../lib/launch-batch'

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
const VERCEL = read('vercel.json')
const NAV = read('components/layout/DashboardShellV2.tsx')

// A batch with everything answered, for driving the real rules rather than
// grepping the source that implements them.
function full(over: Partial<BatchRow> = {}): BatchRow {
  return {
    id: 'b', name: 'Batch', state: 'draft',
    cta: null, cta_chosen: true,
    markets: ['amazon.com'], daily_slots: ['09:00'], start_on: '2026-12-01',
    timezone: 'America/Toronto', ...over,
  }
}
function item(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: 'i', position: 0, source_url: 'https://x/v.mp4', rendered_url: 'https://x/r.mp4',
    asin: 'B0GTLR8ZQL', title: 'A video', thumbnail_url: 'https://x/t.png',
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
    /1 still needs a product/.test(
      batchSteps(full(), [item(), item({ id: 'j', position: 1, asin: null })])
        .find((s) => s.id === 'products')?.detail ?? ''),
    'a creator with ten videos needs to know how many, not that something is wrong')
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
  check('launching writes the PLANNED time',
    /planned_publish_at: planned\[i\]\.at\.toISOString\(\)/.test(LAUNCH))
  check('and does not call anything scheduled',
    !/state: 'scheduled'/.test(LAUNCH),
    'this route has not spoken to YouTube, so it cannot report what YouTube did')
  check('the worker sets publish_at only after YouTube confirms',
    DRAIN.indexOf('updateVideoStatus') < DRAIN.indexOf("state: 'scheduled'"),
    'writing it first would promise a publication that never happened')
  check('and the two columns are kept apart in the schema',
    /planned_publish_at/.test(M358) && /publish_at\s+timestamptz/.test(M357),
    'one column for both is how a screen reports the plan as the result')

  // A PUBLISH TIME IN THE PAST IS REFUSED, NOT SHIFTED. YouTube rejects it, and
  // quietly moving it would publish somebody's video at an hour they never chose.
  check('past slots stop the launch and are named',
    /slotsAlreadyPast\(planned\)/.test(LAUNCH) && /pastSlots/.test(LAUNCH))
  check('and a partial schedule is refused outright',
    /planned\.length !== ready\.length/.test(LAUNCH),
    'publishing half a batch at hours nobody chose is worse than publishing none')
}

// ── the video goes private, then gets its time ──────────────────────────────
{
  check('it is uploaded private',
    /privacyStatus: 'private'/.test(DRAIN),
    'uploading public and scheduling afterwards puts it on the channel in between')
  check('and the schedule is a separate confirmed call',
    /updateVideoStatus\(videoId, \{/.test(DRAIN) && /publishAt: String\(it\.planned_publish_at\)/.test(DRAIN))
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
  check('seeding the grid never fails the publish',
    /async function handOverToAmazon/.test(DRAIN) && /catch \{ \/\* the video is scheduled/.test(DRAIN_RAW),
    'throwing after YouTube has the file sends it round the retry loop and uploads it twice')
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

if (failures.length) {
  console.error(`\n❌ launch-batch: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ launch-batch: ten videos, one CTA, a schedule YouTube confirmed, and a page that never ticks a step the worker would refuse')
