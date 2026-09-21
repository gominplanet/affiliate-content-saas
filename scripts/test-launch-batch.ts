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
  check('and the route reads them back',
    /thumbnail,thumbnail_chosen/.test(BATCH) && /thumbnail_source/.test(BATCH),
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
    /render_tries,thumb_tries,updated_at/.test(BATCH),
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

if (failures.length) {
  console.error(`\n❌ launch-batch: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ launch-batch: ten videos, one CTA, a schedule YouTube confirmed, and a page that never ticks a step the worker would refuse')
