// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LAUNCHPAD DELIVERS WHAT ITS OWN PAGE PROMISES, AND SAYS SO WHEN IT CANNOT.
//
// The paywall card sold "a dub per non-English market". The hero said the video
// goes to every geo "dubbed for non-English markets". The surface reached four
// storefronts, all English, with dubbing switched off, and a code comment three
// hundred lines down said so plainly. A creator paid for Pro, read the promise,
// and got no dub anywhere, because nothing connected the sentence to the
// capability.
//
// Two classes of clause here, and the second is the one that matters more.
//
//   THE CAPABILITY. All nine markets are reachable and dubbing is on.
//
//   THE HONESTY. A dub that fails must not be delivered as English audio under
//   a translated title and recorded as success. That failure is invisible from
//   every angle: the URL looks the same, the state says localized, the run says
//   uploaded. The only way anyone finds out is a French shopper pressing play.
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

const PAGE_RAW = read('app/(dashboard)/launchpad/page.tsx')
const PAGE = live(PAGE_RAW)
const GEOCHECK = live(read('app/api/launchpad/geo-check/route.ts'))
const QUEUE = live(read('app/api/global-sync/deliver/queue/route.ts'))
const STAGE = live(read('components/launchpad/StorefrontStage.tsx'))
const START = live(read('app/api/global-sync/start/route.ts'))

// ── the promise and the capability are the same thing ───────────────────────
{
  // Read from the RAW page: this is about copy a creator reads, and the copy
  // lives in JSX strings, not in code the comment-stripper keeps.
  const promisesDub = /dub(bed)? (?:per|for) non-English|dubbed for non-English/i.test(PAGE_RAW)
  const dubbingOn = /allowDubbing(?!=\{false\})/.test(PAGE) && !/allowDubbing=\{false\}/.test(PAGE)
  check('if the page promises a dub, the surface can dub',
    !promisesDub || dubbingOn,
    'the paywall card and the hero both sold dubbing while allowDubbing was false')

  check('and it no longer filters its markets down to English',
    !/filter\(isEnglishMarket\)/.test(PAGE),
    'that intersection is what made the promise false')
}

// ── every market the product sells in is reachable ──────────────────────────
{
  // This used to read geo-check's own market table and compare it, domain by
  // domain, against lib/markets. Two lists that must not drift, and the guard
  // was the only thing stopping them.
  //
  // The second list is gone. geo-check derives from MARKETS, so the drift it
  // guarded against can no longer be expressed, and the ids it used to carry
  // (the Keepa domain ids) live in lib/markets where the coverage drain reads
  // them too. The claim is unchanged, so the clauses follow the claim: what
  // matters now is that nothing re-types the table.
  check('geo-check derives its market list from lib/markets',
    /const GEOS = MARKETS\.map\(/.test(GEOCHECK),
    'a typed list is a second copy, and a market added to lib/markets would silently not be offered')
  check('and takes the Keepa ids from there too',
    /keepa: m\.keepa/.test(GEOCHECK) && /keepa: number \| null/.test(live(read('lib/markets.ts'))),
    'the ids lived only in this route, which is how the coverage drain nearly made a third copy')
  check('so it reaches every market, including the ones that need a dub',
    !/\bdomain: 'amazon\./.test(GEOCHECK),
    `${MARKETS.filter((m) => m.needsTranslation).map((m) => m.domain).join(', ')} — a hand-typed domain here means the table came back`)

  // Derivation is only worth anything if lib/markets actually carries what
  // geo-check needs off each row. A market added without a host or a keepa
  // field would derive into a row this route cannot research.
  for (const m of MARKETS) {
    check(`lib/markets gives ${m.domain} a host`, !!m.host && m.host.includes('amazon'),
      'the AU browser check and the cache key are both the host')
    check(`and a Keepa id or an explicit null for ${m.domain}`,
      m.keepa === null || (typeof m.keepa === 'number' && m.keepa > 0),
      'undefined would read as "no Keepa domain" and quietly route a researchable market to the browser')
  }
}

// ── reachable is not the same as researched on every run ────────────────────
//
// Each non-US marketplace is one Keepa lookup. Checking all nine every time
// spends five on an answer most runs never read, which is the kind of cost that
// survives for months because it appears on no screen. So the list above is
// what geo-check CAN research; scope decides what it does.
{
  check('geo-check takes a scope',
    /const scope = body\.scope === 'all'/.test(GEOCHECK))
  check('and defaults to the cheapest answer',
    /body\.scope === 'international' \? 'international' : 'english'/.test(GEOCHECK),
    'a caller that forgets the parameter should cost the least, not the most')
  check('the market list is filtered by it before any lookup',
    GEOCHECK.indexOf('const inScope = GEOS.filter') < GEOCHECK.indexOf('fetchKeepaBrandInfo([asin], g.keepa)')
    && /inScope\.map\(async \(g\)/.test(GEOCHECK),
    'filtering the RESULTS would still have paid for every lookup')
  check("'international' is the five alone, not all nine",
    /scope === 'all' \? true : scope === 'english' \? isEnglish : !isEnglish/.test(GEOCHECK),
    'opting in must not re-pay for the four already answered')
  check('and the second pass can reuse the brand and title',
    /if \(canKeepa && !brand && !title\)/.test(GEOCHECK),
    'otherwise opting in costs six lookups to learn five things')

  // The opt-in has to exist and has to say what it buys, or the markets are
  // reachable in a sense nobody can act on.
  check('the page offers the international check',
    /checkInternationalGeos/.test(PAGE) && /scope: 'international'/.test(PAGE))
  check('and names the markets and what they get',
    /Germany, France, Spain, Italy and Japan are not checked by default/.test(PAGE_RAW),
    '"international" alone does not tell a creator whether their store is in it')

  // ONE SCOUT pass, used by both. A second copy is a second place for the
  // local-ASIN search to quietly not happen, and shipping the US ASIN to
  // amazon.de points at nothing.
  check('both passes share one SCOUT routine',
    /async function runScoutGeoPass/.test(PAGE)
    && (PAGE.match(/runScoutGeoPass\(/g) ?? []).length >= 3,
    'declared once and called by the English pass and the international one')
  check('the international results are appended, not substituted',
    /have\.has\(g\.domain\)/.test(PAGE),
    'the English rows already carry SCOUT statuses this response knows nothing about')

  // ── AND THE STAGE HAS TO NOTICE ───────────────────────────────────────────
  //
  // Appending to the parent's list achieved nothing for months. The stage
  // narrowed the market list inside load(), whose only dependency is
  // presetVideoId, under a comment asserting that allowedDomains was "computed
  // once before this stage mounts". True while Launchpad only offered the
  // English stores; false from the moment the check became a button. So the
  // creator pressed it, the card hid itself because the request had succeeded,
  // the parent's list grew to nine, and the stage went on showing four. The
  // feature appeared to do nothing at all.
  check('the stage keeps the full market list and narrows it separately',
    /const \[allMarkets, setAllMarkets\]/.test(STAGE)
    && /if \(Array\.isArray\(mr\?\.markets\)\) setAllMarkets\(mr\.markets\)/.test(STAGE),
    'narrowing inside the fetch freezes the list at whatever was known on mount')
  check('and re-narrows when the caller allows more markets',
    /\}, \[allMarkets, allowedKey, defaultKey\]\)/.test(STAGE),
    'a prop that changes after mount and is read only at mount is a prop nobody can change')
  check('the dependency is a value, not an array identity',
    /const allowedKey = \(allowedDomains \?\? \[\]\)\.join\(','\)/.test(STAGE),
    'the parent rebuilds these arrays every render, so comparing by identity re-runs forever')
  check('a market is ticked by default only the first time it appears',
    /const offered = useRef<Set<string>>/.test(STAGE)
    && /!offered\.current\.has\(m\.domain\)/.test(STAGE),
    're-deriving the whole selection would untick nothing and re-tick everything the creator had turned off')

  // THE RESULT, not just the request. The card disappeared on success, so a
  // check that came back "not sold in any of the five" was indistinguishable
  // from one that never ran.
  check('the check says what it found, including nothing',
    /intlState === 'done' && \(\(\) =>/.test(PAGE)
    && /Amazon does not sell this[\s\S]{0,80}product in any of them/.test(PAGE_RAW),
    'the button vanishing is not a result, and zero is the answer that most needs saying')
  check('and the five are derived from lib/markets',
    /const INTL_DOMAINS = new Set\(MARKETS\.filter\(m => m\.needsTranslation\)/.test(PAGE),
    'a typed list here disagrees with lib/markets the first time a market is added')
}

// ── a dub that failed is never passed off as one that worked ────────────────
{
  check('the dub response is read',
    /const dr = await fetch\('\/api\/global-sync\/dub'/.test(STAGE)
    && /dubFailures\.push/.test(STAGE),
    'it was fire-and-forget under a catch whose comment said it falls back to the master and told nobody')

  check('and a failure names the market',
    /unresolved\.map\(d => d\.domain\)/.test(STAGE))

  // ── A DROPPED CONNECTION IS NOT A FAILED DUB ─────────────────────────────
  //
  // The dub route runs up to 300 seconds and the browser holds that request
  // open the whole time. When it drops, the server carries on, finishes, and
  // writes the dubbed file to the target, while this client has already
  // recorded a failure and moved on. Germany's run reported "1 never got as far
  // as an upload" and the diagnostic taken minutes later read
  // `amazon.de: localized · Dubbed`. The dub was there the whole time.
  // ── ALREADY UPLOADED IS NOT A FAILURE ────────────────────────────────────
  //
  // The queue excludes anything already delivered, correctly. The client
  // counted it among the markets it set out to upload, found nothing in the
  // queue for it, and reported "Not uploaded: amazon.it (it never reached the
  // upload queue)" about a listing that was already live. Re-running to finish
  // one market told the creator the market that had worked was broken.
  check('a market already on its storefront is not counted as one to upload',
    /const already = live\.filter\(t => readyDomains\.has\(t\.domain\) && t\.state === 'delivered'\)/.test(STAGE)
    && /const readyTargets = live\.filter\(t => readyDomains\.has\(t\.domain\) && t\.state !== 'delivered'\)/.test(STAGE),
    'the queue is right to withhold it, so counting it as attempted turns success into a reported failure')
  check('and a run with nothing left to do says so',
    /Nothing left to upload/.test(read('components/launchpad/StorefrontStage.tsx')),
    '"Uploaded to 0 of 0 storefronts" reads like a failure')
  check('the summary counts them apart from the attempt',
    /already uploaded before this run/.test(read('components/launchpad/StorefrontStage.tsx')),
    'folding them into the attempt flatters the number; leaving them out entirely hides that they are there')

  check('a dub whose request died is re-checked against the target',
    /const DUB_RECHECKS/.test(STAGE)
    && /let unresolved = \[\.\.\.dubFailures\]/.test(STAGE)
    && /rows\.find\(t => t\.domain === f\.domain\)\?\.videoUrl/.test(STAGE),
    'the server is the one that knows whether the dub landed, not this connection')
  check('and only the ones that really failed are warned about',
    /if \(unresolved\.length > 0\) \{[\s\S]{0,200}?The dub did not finish for/.test(STAGE),
    'warning about a dub that succeeded sends the creator to stop a run that is fine')
  check('a target the server marked failed stops the waiting',
    /\?\.state !== 'failed'/.test(STAGE),
    'a real failure must not sit through every re-check round before it is reported')
  check('and a card stops claiming a failure that resolved',
    /for \(const l of landed\) delete next\[l\.domain\]/.test(STAGE),
    'a stale failure sitting on a market that just uploaded is its own lie')

  // BEFORE the upload. Afterwards the video is on the storefront and the
  // creator's only clue is watching it themselves.
  const warnAt = STAGE.indexOf('will get your ENGLISH audio')
  const dubbedWaveAt = STAGE.indexOf("deliverWave(dubDomains")
  check('the warning lands before the dubbed markets upload',
    warnAt > -1 && dubbedWaveAt > -1 && warnAt < dubbedWaveAt,
    'after the upload it is a post-mortem, not a choice')

  check('the warning says what the store will actually receive',
    /ENGLISH audio under a translated title/.test(STAGE),
    '"the dub failed" does not tell a creator that the video still went out')
}

// ── the title is approved BEFORE it is translated five times ────────────────
//
// The master title was read off the video server side with no way to influence
// it, so the first time a creator saw the wording that would carry their
// listing in five countries was after it had been translated into all five,
// when changing a word meant redoing the lot.
{
  check('the English title is shown and editable before the run',
    /const \[masterTitle, setMasterTitle\] = useState\(''\)/.test(STAGE)
    && /Title for the English stores/.test(read('components/launchpad/StorefrontStage.tsx')),
    'a field the server fills and never shows is a decision made for the creator')
  check('and it is what gets sent',
    /masterTitle: masterTitle\.trim\(\) \|\| undefined/.test(STAGE),
    'showing an editable box whose value nothing reads is worse than not showing one')
  check('the server prefers the sent title over the video’s',
    /const sentTitle = \(body\.masterTitle \|\| ''\)\.trim\(\)/.test(START)
    && /const masterTitle = sentTitle \|\|/.test(START),
    'the edit has to win, or the box is decoration')
  // PERSISTED. The localize runs after the response goes out and the recovery
  // cron may be the one that finishes it, reading the video row rather than
  // this request. Without the write, a job the cron finishes translates the OLD
  // wording and nothing says so.
  check('and writes it back so a cron-finished job uses it too',
    /update\(\{ generated_title: sentTitle \}\)/.test(START),
    'the recovery cron reads the video, not the request that started the job')
  check('an empty title stops the run',
    /Write the English title first/.test(read('components/launchpad/StorefrontStage.tsx')),
    'an empty master means untitled listings in every country')
  // NEVER OVER AN EDIT IN PROGRESS.
  check('reloading the video does not overwrite what they typed',
    /if \(!titleTouched\.current\) setMasterTitle\(t\)/.test(STAGE),
    'a field that resets itself mid-sentence is unusable')
}

// ── one run belongs to one video and one product ───────────────────────────
//
// The page mirrors its whole state to one localStorage key and restores it on
// mount, which is right for resuming. It was also in force in the middle of a
// SECOND run: upload another video and the ASIN, thumbnail, master, geo results
// and per-market ASINs all stayed, so the new video showed the old thumbnail
// and the geo check researched the old product. The only escape was a Start
// over button nobody has reason to press after a successful upload.
{
  check('a newly uploaded video clears the last one’s work',
    /function startFreshRunFor/.test(PAGE)
    && /startFreshRunFor\(url, title, sourceUrl, dur\)/.test(PAGE),
    'the upload handler set four fields and left the other fifteen describing the previous video')
  const freshBody = PAGE.slice(PAGE.indexOf('function startFreshRunFor'), PAGE.indexOf('function onAsinChanged'))
  check('the fresh-run body was found', freshBody.length > 200 && freshBody.length < 4000, `${freshBody.length} chars`)
  for (const [what, re] of [
    ['the product', /setAsin\(''\)/],
    ['the thumbnail', /setThumbUrl\(null\)/],
    ['the master', /setMasterId\(null\)/],
    ['the geo results', /setGeoCheck\(null\)/],
    ['the per-market ASINs', /setMarketAsins\(\{\}\)/],
    ['the storefront job', /removeItem\('mvp_storefront_job_v1'\)/],
  ] as const) {
    // SCOPED TO THIS FUNCTION'S BODY. The first version sliced as far as
    // startOver, which now has onAsinChanged in between setting the same
    // fields, so deleting the whole block from startFreshRunFor still passed.
    check(`and clears ${what}`, re.test(freshBody),
      'left behind, it describes the previous video while sitting under the new one')
  }
  // A RE-RENDER IS NOT A NEW VIDEO. Same URL back means the creator redid the
  // CTA burn, and throwing away their thumbnail for that is its own bug.
  check('re-rendering the same video keeps its work',
    /const isSameVideo = renderedUrl === url/.test(PAGE)
    && /if \(isSameVideo\)/.test(PAGE),
    'clearing on every render would punish anyone who redid their CTA')

  // THE PRODUCT, separately. Geo results are answers about ONE ASIN.
  check('changing the product clears what was researched about the old one',
    /function onAsinChanged/.test(PAGE) && /onAsinChanged\(e\.target\.value\)/.test(PAGE),
    '"Product found" ticks that are about a different product are worse than none')
  check('but not on every keystroke of a pasted link',
    /if \(!was \|\| !now \|\| was === now\) return/.test(PAGE),
    'the field takes a full Amazon URL, so mid-paste it is briefly not an ASIN at all')

  // AND THE STAGE HAS TO FOLLOW IT. useState(presetAsin) is an initial value.
  check('the storefront stage follows a corrected ASIN',
    /\}, \[presetAsin\]\)/.test(STAGE)
    && /if \(!next \|\| asinTouched\.current\) return/.test(STAGE),
    'it tagged the previous product and printed the old code under "set in the step above"')
}

// ── two upload buttons, and they do not mean the same thing ─────────────────
//
// The copy panel belongs to the sync JOB, whose id is restored from
// localStorage on mount, so it routinely describes an earlier run. Its button
// said "Upload to all storefronts" while the checkboxes above said something
// else, and both sat on screen at once with nothing to tell them apart.
// Pressed with a restored job, "all storefronts" uploaded to one country from
// a previous session.
{
  // UNDER THE HEADING, which is the part a creator reads before pressing
  // anything. The first version of this clause looked for the identifier
  // anywhere in the file, and `jobCountries.join` also appears in the mismatch
  // warning below, so deleting the subtitle left the clause satisfied by a
  // sentence that only shows up when something is already wrong.
  check('the copy panel names the markets it is about',
    /const jobCountries = targets\.map/.test(STAGE)
    && /Localized copy<\/h2>[\s\S]{0,160}?\{jobCountries\.join/.test(STAGE),
    'unnamed, it reads as being about whatever is ticked above')
  check('and its button no longer claims "all storefronts"',
    !/Upload to all storefronts/.test(STAGE),
    '"all" is a promise about the ticks, which this button has nothing to do with')
  // ── THE DELIVERY RUNS ON THE JOB, NOT ON A SNAPSHOT ──────────────────────
  //
  // deliverAll closed over the `targets` state from the render in which the
  // button was clicked, and uploadAll calls it after awaiting a localize that
  // replaces them. With an earlier job restored from localStorage, clicking
  // "Upload to 2 stores" ran the whole delivery against the OLD job's markets:
  // the preflight checked them, nothing was queued for them under the new job
  // id, no dub ran because the old market needed none, and the run ended on
  // "Uploaded to 0 of 1 storefronts" while the two markets on screen were never
  // touched. Third stale-state bug in this component; the rule is that a job id
  // is a fact and a state variable is a snapshot.
  check('the delivery reads the job’s markets at the time it runs',
    /const live: Target\[\] = Array\.isArray\(jr\?\.targets\) \? jr\.targets : \[\]/.test(STAGE)
    && /runPreflight\(live\.map/.test(STAGE)
    && /const readyTargets = live\.filter/.test(STAGE),
    'the state is whatever was on screen when the button was pressed, which is not the job being delivered')
  check('and never falls back to the snapshot mid-run',
    !/^\s*(?:const|await|return).*[^a-zA-Z]targets\.(map|filter)\(/m.test(
      STAGE.slice(STAGE.indexOf('async function deliverAll'), STAGE.indexOf('async function refreshTargets'))),
    'one surviving read of the state is all it takes to deliver to last week’s country')

  // ── A CARD SAYS WHAT IS HAPPENING TO IT, NOT TO THE RUN ──────────────────
  //
  // `delivering && not finished` labelled every card "Uploading…" from the
  // first click, so a market sitting in the dub queue, and a market that was
  // not in the run at all, both claimed to be uploading. Two storefronts said
  // it through a run that never sent them a byte.
  check('only the markets actually in the wave say uploading',
    /const \[wave, setWave\]/.test(STAGE)
    && /const uploading = !finished && wave\.has\(t\.domain\)/.test(STAGE)
    && /setWave\(new Set\(items\.map/.test(STAGE),
    'a card claiming to upload while nothing is being sent is the failure that looks exactly like success')
  check('a market being dubbed says so',
    /const isDubbing = !finished && dubbing === t\.domain/.test(STAGE)
    && /Dubbing into \{t\.lang/.test(STAGE))
  check('and one waiting its turn is not called uploading',
    /const queued = delivering && !finished && !uploading && !isDubbing/.test(STAGE)
    && /Waiting for its dub/.test(read('components/launchpad/StorefrontStage.tsx')),
    'a creator reading "uploading" believes their storefront already has the video')
  check('the wave is cleared when the run ends',
    (STAGE.match(/setWave\(new Set\(\)\)/g) ?? []).length >= 2,
    'a wave left set leaves cards spinning after the run finished')

  check('a job that no longer matches the ticks says so',
    /const jobMatchesTicks = targets\.length === chosen\.size/.test(STAGE)
    && /\{!jobMatchesTicks && \(/.test(STAGE)
    && /This copy is from an earlier run/.test(read('components/launchpad/StorefrontStage.tsx')),
    'a silent mismatch between two upload buttons is how a creator uploads to the wrong country')
}

// ── the queue says what each market is about to receive ─────────────────────
{
  check('the queue reports whether a market needed a dub',
    /needsDub: !!r\.dub/.test(QUEUE))
  check('and whether it actually has one',
    /dubbed: !!r\.video_url/.test(QUEUE))
  check('and flags the case where it wanted one and is not getting it',
    /audioIsMasterFallback: !!r\.dub && !r\.video_url/.test(QUEUE),
    'the master fallback is correct for English and for skip-dub, and a silent failure for everything else; they are identical from the URL')

  // The state name promises less than it looks like it promises.
  check('the queue still serves the fallback rather than withholding it',
    !/\.filter\([^)]*audioIsMasterFallback/.test(QUEUE),
    'refusing to serve it would break the English geos and the deliberate skip-dub path both')
}

// ── a market that cannot be delivered is named, not dropped ─────────────────
{
  check('the queue returns what it skipped',
    /const skipped = items/.test(QUEUE)
    // In the response body, by name. Matched without the closing brace that
    // used to follow it, because adding a field after it broke this check
    // while the behaviour was untouched.
    && /NextResponse\.json\(\{[\s\S]{0,300}?\bskipped\b/.test(QUEUE),
    'it used to .filter() them away, so a partial drop left no trace')
  check('with a reason per market',
    /reason: !i\.title/.test(QUEUE))
  check('and the caller surfaces the gap',
    /Not uploaded: \$\{lines\}/.test(STAGE),
    'the empty-queue toast only catches a wave where NOTHING came back; four of five reads as complete')

  // ── A MARKET THE QUEUE CANNOT SEE AT ALL ──────────────────────────────────
  //
  // Everything above starts from state 'localized', so a target that never got
  // there is not skipped, it is absent, and the only thing the caller could say
  // was "it never reached the upload queue" — a fact about the queue, not about
  // what went wrong. A German dub stopped part-way, its target sat in
  // 'dubbing', the run reported "1 never got as far as an upload" and the card
  // stayed blank: a tick, no note, and a Generate dub button, indistinguishable
  // from a market nobody had picked.
  check('a target that never reached localized is named too',
    /function stalledReason/.test(QUEUE) && /not\('state', 'in', '\("localized","delivered"\)'\)/.test(QUEUE),
    'absent from the query means absent from the report, and the market is then silent on screen')
  check('and the reason names something to act on',
    /the dub started and did not finish/.test(read('app/api/global-sync/deliver/queue/route.ts'))
    && /have not been translated yet/.test(read('app/api/global-sync/deliver/queue/route.ts')),
    '"not localized" tells a creator only that it is not here')
  // SCOPED. Unscoped this would sweep every unfinished target the creator has
  // ever had, and the coverage board calls it that way.
  check('the extra read only happens for one job',
    /if \(jobId\) \{[\s\S]{0,400}?stalledReason/.test(QUEUE),
    'the board reads this queue unscoped and would drag in every old job')
}

// ── the reason lands on the card, not only in a toast ───────────────────────
{
  check('the run records what it did per market',
    /const \[outcome, setOutcome\] = useState<Record<string, string>>/.test(STAGE),
    'a toast is gone in sixteen seconds and the market it named goes back to looking untouched')
  check('a skipped market is recorded',
    /for \(const d of missing\) next\[d\] = `Not uploaded\. \$\{String\(why\.get\(d\)/.test(STAGE))
  check('and so is a dub that never came back',
    (STAGE.match(/setOutcome\(prev => \(\{ \.\.\.prev, \[t\.domain\]: `The dub did not finish/g) ?? []).length >= 2,
    'the aborted-fetch case is the one the server never gets to record, so the card is the only place it can be said')
  // RENDERED WHATEVER THE STATE. The thumbnail note is about a market that DID
  // upload, and hiding notes on success is how English text lands on a German
  // listing with nothing on screen to say so.
  check('the card shows it, delivered or not',
    /\{outcome\[t\.domain\] && \(/.test(STAGE)
    && /\{outcome\[t\.domain\]\}/.test(read('components/launchpad/StorefrontStage.tsx')),
    'held in state and never rendered is the same as not held at all')

  // THE THUMBNAIL HAS THE SAME FAILURE SHAPE AS THE AUDIO. A non-English store
  // falling back to the branded image ships English hook text on a German
  // listing, the upload succeeds, and nothing disagrees.
  check('the queue says when a store is getting the English-text image',
    /thumbnailIsTextFallback/.test(QUEUE)
    && /!!mkt\?\.needsTranslation && !cleanThumb && !!textThumb/.test(QUEUE),
    'the silent fallback is the same class of bug as the English audio under a translated title')
  check('and the creator is told before it goes up',
    /const textFallbacks = items\.filter/.test(STAGE)
    && /ENGLISH text on it/.test(read('components/launchpad/StorefrontStage.tsx')),
    'after the upload it is a post-mortem, not a choice')
  check('and a new run clears the last one’s notes',
    /setOutcome\(\{\}\)/.test(STAGE),
    'a stale failure sitting on a market that just succeeded is its own lie')
}

// ── the switch still works, and Storefront Sync still has everything ────────
//
// Inherited from scripts/test-launchpad-english-only, which this file replaces.
// That guard pinned the opposite product decision: Launchpad English-only with
// dubbing off. The decision is reversed, so those clauses are gone, but the
// half about the machinery being intact was always the more valuable half and
// it survives unchanged. "We kept the code" is easy to believe and easy to be
// wrong about after the next tidy-up.
//
// The switch itself stays too. It is off nowhere today, and that is exactly why
// it would rot: a prop with one caller and no test quietly stops working.
{
  check('the stage takes dubbing as a prop defaulting to on',
    /allowDubbing = true/.test(STAGE),
    'Storefront Sync passes nothing and must keep dubbing')
  check('no dub is queued when the switch is off',
    /const needDub = allowDubbing \?/.test(STAGE))
  check('and a market that slipped through gets the English master',
    /!allowDubbing \|\| skipDub\.has/.test(STAGE),
    'rather than sitting in a dub queue nothing can start')
  for (const [what, re] of [
    ['the voice card', /\{allowDubbing && voice\?\.enabled &&/],
    ['the skip-dub checkbox', /\{allowDubbing && t\.dub && t\.state !== 'delivered'/],
    ['the dub player', /\{allowDubbing && t\.dub && !skipDub\.has\(t\.domain\) && t\.videoUrl/],
    ['the generate-dub button', /\{allowDubbing && t\.dub && !skipDub\.has\(t\.domain\) && !t\.videoUrl/],
  ] as const) {
    check(`${what} is behind the switch`, re.test(STAGE))
  }

  check('all nine markets still exist', MARKETS.length === 9, `${MARKETS.length} markets`)
  const SYNC = read('app/(dashboard)/global-sync/page.tsx')
  // STOREFRONT SYNC IS THE COVERAGE BOARD NOW. It used to render the stage with
  // no props, which was how it reached all nine markets with dubbing on. The
  // board reaches them a different way: it offers every market the API returns,
  // and that list is derived from lib/markets rather than typed anywhere. The
  // claim being protected is unchanged, so the check follows the claim.
  check('Storefront Sync reaches every market',
    /<CoverageBoard \/>/.test(SYNC),
    'the board lists whatever /api/coverage/markets returns, which is MARKETS itself')
  check('and that list is never typed out by hand',
    /MARKETS\.map\(/.test(read('app/api/coverage/markets/route.ts')),
    'a typed list drifts from lib/markets the first time a market is added')
  check('Launchpad still asks the stage to dub',
    /allowDubbing/.test(read('app/(dashboard)/launchpad/page.tsx')),
    'the stage is still the one-video path, and it must not quietly stop dubbing')
  check('the dub route still exists',
    (() => { try { return read('app/api/global-sync/dub/route.ts').length > 0 } catch { return false } })())
  check('voice cloning and credits still exist',
    (() => { try { return read('lib/dub-credits.ts').length > 0 && read('lib/tts.ts').length > 0 } catch { return false } })())
  check('the stage can still dub when asked', /async function dubOne/.test(STAGE))
}

// ── the Studio link is the unscoped one, everywhere ─────────────────────────
//
// Launchpad was the only surface building studio.youtube.com/channel/<cid>/
// video/<vid>/edit. A comment justified it: a bare /video/<id>/edit supposedly
// opens under whatever channel Studio is on and throws a generic error. Tested
// against the live account, it is the other way round. The scoped URL is what
// threw "Oops, something went wrong"; the bare one opens the video and switches
// channel by itself.
//
// Swept across the app rather than pinned to Launchpad, because the plausible
// story is what put it there and the same story will occur to the next reader.
{
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === '.next') continue
      const full = `${dir}/${e}`
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.tsx?$/.test(full)) continue
      if (/studio\.youtube\.com\/channel\//.test(live(read(full)))) offenders.push(full)
    }
  }
  walk('app'); walk('components'); walk('lib')
  check('no Studio link is scoped to a channel id',
    offenders.length === 0,
    `${offenders.join(', ')} — a channel that does not own the video answers with a blank error page, and the bare form resolves the owner itself`)
}

// ── house style on the sentences a creator reads ────────────────────────────
{
  const strings = [...PAGE_RAW.matchAll(/(?:description|subtitle)="([^"]{40,})"/g)].map((m) => m[1])
  check('the page copy was found', strings.length > 0, `${strings.length} strings`)
  for (const s of strings) {
    check('no dash punctuation in the page copy',
      !/[—–]/.test(s) && !/\S \- \S/.test(s), s.slice(0, 110))
  }
}

if (failures.length) {
  console.error(`\n❌ launchpad-geos: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ launchpad-geos: every market the product sells in is reachable, and a dub that failed is never passed off as one that worked')
