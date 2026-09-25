// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A YouTube draft is finished through its Edit draft window, and every answer
// is read back before anything is scheduled.
//
// WHAT WENT WRONG. SCOUT's finish opened a video's own panels (/edit,
// /monetization, /endscreens). A draft has none: its page shows a banner and
// one button, Edit draft, which opens the step-by-step window. The panel code
// found nothing, and Co-Pilot still printed "Paid promotion checked, AI-use
// answered, notify off" because it wrote its own sentence over SCOUT's. It
// also passed notify as a plain false, whatever the creator's toggle said, and
// every older click helper clicked twice, which unticks a checkbox it ticked.
//
// This guard holds the shape of the fix:
//   - drafts go through Edit draft, in the creator's order
//   - each answer is read back, and the disclosure gates Visibility
//   - the schedule is only pressed when the date and time read back
//   - the screens show SCOUT's words and never invent a tick
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  storeStudioRun, readStudioRun, studioRunHeadline, studioStepTone, studioSetVisibility,
  studioDisclosuresConfirmed, draftVisibility, normalizeStudioOptions, productLinkFor,
} from '../lib/studio-finish'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const root = new URL('..', import.meta.url).pathname
const read = (p: string) => readFileSync(join(root, p), 'utf8')
// Comments and import lines out, so a sentence ABOUT the rule cannot satisfy it.
const code = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/^\s*import\s/.test(l))
  .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
  .join('\n')

const BG = code(read('extension/background.js'))
// Raw too: a `/*` inside one of background.js's regexes opens a false block
// comment for the stripper above, and a large stretch of the file vanishes.
const BG_RAW = read('extension/background.js')
const slice = (from: string, len: number) => { const at = BG.indexOf(from); return at < 0 ? '' : BG.slice(at, at + len) }

// ── the kit ──────────────────────────────────────────────────────────────
const kit = slice('function studioKitInstallInPage()', 60000)
check('the draft toolkit exists', kit.length > 0)
const kitClick = kit.slice(kit.indexOf('const click = (el) =>'), kit.indexOf('const click = (el) =>') + 500)
check('the kit clicks once',
  /el\.click\(\)/.test(kitClick) && !/'mouseup', 'click'\]/.test(kitClick),
  'a dispatched click on top of el.click() ticks a checkbox and unticks it')
check('no older finish helper clicks twice either',
  BG_RAW.indexOf('function studioFinishMonetizeInPage') > 0
    && !/'mouseup', 'click'\]/.test(BG_RAW.slice(BG_RAW.indexOf('function studioFinishMonetizeInPage'), BG_RAW.indexOf('function studioApplyDisclosuresInPage'))))
check('a control belongs to the nearest section naming exactly one question',
  /hits\.length === 1\) return hits\[0\]/.test(kit) && /hits\.length > 1\) return null/.test(kit),
  'eight ancestors up is the whole form, where "Yes" is both the paid answer and the AI answer')
check('answers are read back after the click',
  /const again = pickRadio\(section, choiceRe, scope\) \|\| el/.test(kit) && /confirmed: isChecked\(again\)/.test(kit))
check('the kit never presses Escape (it closes the whole draft window)',
  !/key: 'Escape'/.test(kit))

// ── the steps, in the creator's order ────────────────────────────────────
check('open presses Edit draft', /findBtn\(\/\^edit draft\$\/i, document\)/.test(kit))
check('and returns to Details when the draft reopens on a later page', /step-badge-0/.test(kit))
const details = kit.slice(kit.indexOf('K.steps.details'), kit.indexOf('K.steps.monetization'))
check('details opens Show more', /show more/i.test(details))
check('paid promotion is answered Yes', /answerRadio\('paid', \/\^yes\\b\/i, dlg\)/.test(details))
check('AI use is answered No', /answerRadio\('altered', \/\^no\\b\/i, dlg\)/.test(details))
check('the notify box follows the toggle exactly',
  /answerCheckbox\('notify', o\.notify === true, dlg\)/.test(details))
check('details is only ok when every answer read back', /out\.ok = failed\.length === 0/.test(details))
const tag = kit.slice(kit.indexOf('K.steps.tagproduct'), kit.indexOf('K.steps.endscreen'))
check('only a result above "Similar results" is ever tagged',
  /similar results/i.test(tag) && /getBoundingClientRect\(\)\.top < limit/.test(tag))
const vis = kit.slice(kit.indexOf('K.steps.visibility'), kit.indexOf('window.__mvpKit = K'))
check('Schedule is pressed only after the date reads back',
  /if \(!dateOk\) \{[^}]*nothing was scheduled/.test(vis))
check('and the time', /readTime\(timeInput\.value\) !== H \* 60 \+ Mi\) \{[^}]*nothing was scheduled/.test(vis))
check('the final button must say what was asked before it is pressed',
  /!wantRe\.test\(lbl\)/.test(vis) && /finish\(\/\^schedule\$\/i/.test(vis))
check('the zone is the one Studio shows', /GMT/.test(vis))

// ── the order and the gate ───────────────────────────────────────────────
const run = slice('async function runStudioDraft(', 6000)
check('runStudioDraft exists', run.length > 0)
const gateAt = run.indexOf('if (!details.ok)')
const firstNext = run.indexOf("exec('next'")
check('a disclosure that did not read back stops the run before any Next',
  gateAt > 0 && firstNext > gateAt, 'a draft must never reach Visibility without its paid promotion')
check('steps not reached are listed as not reached', /notReached: true/.test(run))
const orch = slice('async function scanStudioFinish(', 9000)
check('scanStudioFinish tries the draft first', /draftFirst/.test(orch) && /runStudioDraft\(tabId, videoId, want\)/.test(orch))
check('and says which way Studio went', /'draft'\)/.test(orch) && /path: 'video'/.test(orch))
const handler = slice("msg.type === 'MVP_STUDIO_FINISH'", 900)
const bgTimeout = Number((handler.match(/error: 'timeout' \}\)[^\n]*?, (\d+)\)/) || [])[1] || 0)
check('a timed-out run stops, and only one runs at a time',
  /_studioAbort = true; sendResponse/.test(handler) && /if \(_studioBusy\) \{ sendResponse/.test(handler)
    && /if \(_studioAbort\) return \{ step, ok: false, notReached: true/.test(BG),
  'the page was told "timeout" and the run carried on, and could press Schedule afterwards')
check('a Studio run keeps the worker alive', /const keepAlive = startKeepAlive\(\)[\s\S]{0,400}STUDIO_VIDEO\(videoId, startPanel\)/.test(BG))
check('a problem in the checks stops before Visibility',
  /if \(settled === 'problem'\)/.test(kit) && /if \(!ck\.ok\) \{/.test(run))
check('an asked-for page the draft never showed is said', /This draft had no Monetization page/.test(run))
check('a greyed Submit rating is not a submitted one', !/if \(!b \|\| isDisabled\(b\)\) return 'button-gone'/.test(kit))
check('the old monetization step takes the choices and reads back',
  /function studioFinishMonetizeInPage\(opts\)/.test(BG_RAW) && /const nextBtn = await waitFind\(\[\/\^next\$\/i\], 4000\)/.test(BG_RAW) && /const monOn = \/\\bon\\b\/i\.test\(reads\)/.test(BG_RAW) && /out\.ok = monOn/.test(BG_RAW))
check('the old end screen never ticks without a read-back', !/click\(save\); await sleep\(1500\); out\.ok = true/.test(BG_RAW) && /SCOUT cannot read end screens back on this page/.test(BG_RAW))
check('no product is tagged by the first Add button on a page', !/function studioFinishTagProductInPage/.test(BG_RAW))
check('one Amazon delivery at a time', /if \(_sfBusy\) \{ sendResponse/.test(BG_RAW))
const EFR = code(read('lib/extension-frame.ts'))
check('a timeout is not taken for a missing SCOUT', /setTimeout\(\(\) => done\(true, null\), timeoutMs\)/.test(EFR),
  'the same job was sent to the next SCOUT id, and with two builds installed it ran twice')
const EF = code(read('lib/extension-frame.ts'))
const ef = EF.slice(EF.indexOf('export async function requestStudioFinish'), EF.indexOf('export async function requestStudioFinish') + 1400)
const webTimeout = Number((ef.match(/\n\s*(\d{5,}),\s*\n/) || [])[1] || 0)
check('the page waits longer than SCOUT does', bgTimeout > 0 && webTimeout > bgTimeout,
  `SCOUT ${bgTimeout}, page ${webTimeout}: otherwise the page reports a timeout over SCOUT's real answer`)

// ── the screens ──────────────────────────────────────────────────────────
const CP = code(read('app/(dashboard)/co-pilot/page.tsx'))
{
  // ── Co-Pilot's list: a video that went live leaves it ──────────────────
  const DR2 = read('app/api/youtube/drafts/route.ts')
  check('every video not yet public has its status re-read, not only ones with no description',
    /const suspects = drafts\.filter\(d => d\.youtubeVideoId && d\.status !== 'public'\)\.slice\(0, 1500\)/.test(DR2))
  check('a video that went public is dropped from the list and from the saved copy',
    /const current = trued\.filter\(\(v: ReturnType<typeof buildDraftVideo>\) => includePublished \|\| v\.status !== 'public'\)/.test(DR2)
    && /drafts: await enrichWithPushState\(supabase, user\.id, current\)/.test(DR2) && /await writeCache\(supabase, user\.id, cache\.uploads_playlist_id, updated/.test(DR2))
  check('YouTube\'s "no time" wins over an old one', /publishAt: m\.publishAt \?\? null,/.test(DR2))
}
{
  // ── Co-Pilot's product: the one the creator set wins, everywhere ───────
  const CPP = read('app/(dashboard)/co-pilot/page.tsx')
  check('the product can be set on every card, not only when the title has an ASIN',
    /<ProductConfirm\s+youtubeVideoId=\{video\.youtubeVideoId\}\s+detectedAsin=\{cardAsin\}\s+onFixed=/.test(CPP)
    && !/\{cardAsin && \(\s*<ProductConfirm/.test(CPP) && !/\{video\.detectedAsin && \(\s*<ProductConfirm/.test(CPP))
  check('every generator is sent the product the creator set',
    /const cardAsin = fixedAsin \?\? video\.detectedAsin \?\? null/.test(CPP) && /asin: cardAsin,/.test(CPP)
    && (CPP.match(/video\.detectedAsin/g) ?? []).length <= 2)
  const DR = read('app/api/youtube/drafts/route.ts')
  check('a product set earlier survives a reload',
    /detectedAsin: setAsinMap\[d\.youtubeVideoId\] \?\? d\.detectedAsin/.test(DR) && /\.not\('product_title', 'is', null\)/.test(DR))
  check('a video MVP has not synced can still be given its product',
    /if \(!rowId\) return NextResponse\.json\(\{ ok: true, asin, title, imageUrl, stored: false \}\)/.test(read('app/api/youtube/videos/set-product/route.ts')))
  check('the thumbnail already made for this product is offered before a new one',
    /const recalledThumb = useSavedProductImage\(effectiveAsin\)/.test(CPP) && /<SavedProductImage\s+saved=\{recalledThumb\.saved\}/.test(CPP)
    && /setThumbnailModel\('recalled'\)/.test(CPP) && /if \(thumbnailModel === 'recalled'\) \{ setSavedProductImage\('saved'\); return \}/.test(CPP))
}
{
  // ── Co-Pilot takes Liftoff's API steps, and nobody finishes in Studio ──
  const AP = read('app/api/youtube/apply/route.ts')
  const CPX = read('app/(dashboard)/co-pilot/page.tsx')
  const paidAt = AP.indexOf('await yt.setPaidPromotion(body.videoId, true)')
  const readAt = AP.indexOf('const rb = await yt.readDisclosures(body.videoId)')
  const statusAt = AP.indexOf('await yt.updateVideoStatus(body.videoId, {')
  check('the push sets paid promotion through the API and reads it back before any status call',
    paidAt > -1 && readAt > paidAt && statusAt > readAt)
  check('nothing is scheduled or made public unless paid promotion read back',
    /if \(goesOut && disclosures\.paidPromotion !== true\) \{/.test(AP)
    && /privacyStatus: heldBack \? undefined : body\.privacyStatus,/.test(AP) && /publishAt: heldBack \? null : body\.publishAt \?\? null,/.test(AP))
  check('AI use No rides on a status call that happens anyway, so a draft stays a draft',
    /if \(!sendingStatus\) return/.test(AP) && /\.\.\.\(disclosures\.asked \? \{ containsSyntheticMedia: false \} : \{\}\)/.test(AP))
  check('Co-Pilot asks for the disclosures on the push and on the step after SCOUT',
    (CPX.match(/disclosures: true,/g) ?? []).length === 1 && /disclosures: !studioDisclosuresConfirmed\(fin\),/.test(CPX))
  check('there is no Studio opt-in to tick', !/setFinishOptIn|setFinishDo/.test(CPX) && /const finishOptIn = true/.test(CPX))
  check('no by-hand checklist, one See in YouTube Studio button',
    /See in YouTube Studio/.test(CPX) && !/Or do it by hand|Do it by hand \(3 clicks\)|Retry finish in Studio/.test(CPX))
  check('the API\'s paid promotion answer counts for the schedule after SCOUT',
    /apiDisclosuresRef\.current\?\.paidPromotion === true/.test(CPX))
}
{
  // ── audit: what the Co-Pilot button and Retry say and do ───────────────
  const CPR = read('app/(dashboard)/co-pilot/page.tsx')
  check('Co-Pilot does not say Scheduled until the time is set',
    /const held = applied && \(willFinish \? statusOutcome !== 'set' : statusOutcome === 'held'\)/.test(CPR) && /Sent, NOT scheduled \(see below\)/.test(CPR))
  check('the outcome is only "set" when something set it',
    /if \(studioSetVisibility\(fin\)\) \{ setStatusOutcome\('set'\); return \}/.test(CPR)
    && /if \(res2\.ok && d2\.statusOk !== false\) setStatusOutcome\('set'\)/.test(CPR))
  check('Retry finishes the push it follows, with the time that push used',
    /pushedRef\.current = \{ publishAt, isDraft \}/.test(CPR) && /const publishAt = pushed \? pushed\.publishAt/.test(CPR)
    && /has passed\. Pick a new time and push again\./.test(CPR))
  check('a draft SCOUT stopped in before its Visibility page is not scheduled through the API',
    /if \(fin\?\.path === 'draft' && \(!vis \|\| vis\.notReached\)\) \{/.test(CPR)
    && CPR.indexOf("if (fin?.path === 'draft' && (!vis || vis.notReached)) {") > -1
    && CPR.indexOf("if (fin?.path === 'draft' && (!vis || vis.notReached)) {") < CPR.indexOf("const res2 = await fetch('/api/youtube/apply'"))
}
check('Co-Pilot retry also sets the time', /onClick=\{\(\) => void retryStudioFinish\(\)\}/.test(CP) && /await settleAfterStudio\(fin, publishAt, isDraft\)\s*\}/.test(CP))
const cpRun = CP.slice(CP.indexOf('async function runStudioFinish('), CP.indexOf('async function settleAfterStudio('))
check('Co-Pilot sends the creator\'s notify toggle', /notifySubscribers: proSettings\.notifySubscribers === true/.test(cpRun))
check('and never a plain false', !/notifySubscribers: false/.test(cpRun))
check('Co-Pilot keeps SCOUT\'s result as it came', /setFinishResult\(fin\)/.test(cpRun) && !/detail: dStep\.ok \?/.test(cpRun))
check('Co-Pilot no longer claims the bell was set', !/Subscriber bell/.test(CP))
const cpPush = CP.slice(CP.indexOf('const holdStatus = wantsFinish'), CP.indexOf('const holdStatus = wantsFinish') + 2500)
check('Co-Pilot holds the schedule until SCOUT has run', /publishAt: holdStatus \? null : publishAt/.test(cpPush))
const settle = CP.slice(CP.indexOf('async function settleAfterStudio('), CP.indexOf('async function settleAfterStudio(') + 4000)
check('and only sets it through the API once the disclosure read back',
  /studioDisclosuresConfirmed\(fin\)/.test(settle) && /if \(!confirmed\) \{[\s\S]*?return/.test(settle))
const LB = code(read('components/launch/LaunchBoard.tsx'))
const SF = code(read('lib/studio-finish.ts'))
check('Liftoff sends the batch toggle to Studio',
  /liftoffStudioRequest\(it, studioOpts, notifySubs\)/.test(LB) && /notifySubscribers,\s*visibility:/.test(SF))
check('Launch Batch stores the run as SCOUT reported it', /storeStudioRun\(fin, new Date\(\), liveRuns\[it\.id\] \?\? it\.studio_finish\)/.test(LB) && /studioFinish: run/.test(LB))
check('a Liftoff draft is only ever given its own time',
  /mode: 'schedule', publishAt: it\.publish_at/.test(SF))

// ── the helpers ──────────────────────────────────────────────────────────
const res = (steps: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  ({ ok: false, steps: steps as never, ...extra })
check('a run that stopped at the disclosure does not headline as done',
  !/^Done/.test(studioRunHeadline(res([{ step: 'details', ok: false, detail: 'x' }, { step: 'visibility', ok: false, notReached: true }]))))
check('a full run does', /^Done/.test(studioRunHeadline(res([{ step: 'details', ok: true }, { step: 'visibility', ok: true }], { ok: true }))))
check('not reached is its own tone', studioStepTone({ step: 'x', ok: false, notReached: true }) === 'idle'
  && studioStepTone({ step: 'x', ok: false }) === 'bad' && studioStepTone({ step: 'x', ok: false, skipped: true }) === 'note')
check('Visibility only counts as set on a draft that read it back',
  studioSetVisibility({ ok: true, path: 'draft', steps: [{ step: 'visibility', ok: true }] })
  && !studioSetVisibility({ ok: true, path: 'video', steps: [{ step: 'visibility', ok: true }] })
  && !studioSetVisibility({ ok: false, path: 'draft', steps: [{ step: 'visibility', ok: false }] }))
check('disclosures confirmed means the details step read back',
  studioDisclosuresConfirmed({ ok: false, steps: [{ step: 'details', ok: true }] })
  && !studioDisclosuresConfirmed({ ok: false, steps: [{ step: 'details', ok: false }] })
  && !studioDisclosuresConfirmed(null))
check('a draft with no time and no visibility is left alone', draftVisibility(null, 'draft').mode === 'keep')
check('a time schedules', draftVisibility('2030-01-01T09:00:00Z', 'draft').mode === 'schedule')
const stored = readStudioRun(JSON.parse(JSON.stringify(storeStudioRun(res([{ step: 'details', ok: true, detail: 'd', debug: { big: 'x'.repeat(5000) } }], { path: 'draft' })))))
check('a stored run round-trips without its debug map', !!stored && stored.steps[0].detail === 'd' && !('debug' in stored.steps[0]) && stored.path === 'draft')
check('anything else is refused', readStudioRun({ steps: 'no' }) === null && readStudioRun(null) === null)
check('options default to the creator\'s steps, and a stored false stays false',
  normalizeStudioOptions({}).adRating === true && normalizeStudioOptions({ adRating: false }).adRating === false)
check('a product link only from a real ASIN', productLinkFor('B0ABCDEFGH') === 'https://www.amazon.com/dp/B0ABCDEFGH' && productLinkFor('nope') === null)

// ── the SQL ──────────────────────────────────────────────────────────────
const SQL = read('supabase/migrations/367_launch_youtube_options.sql')
check('migration 367 can run twice', (SQL.match(/add column if not exists/g) || []).length === 5)

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
