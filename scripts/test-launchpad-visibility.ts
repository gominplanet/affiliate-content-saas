// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE LAUNCHPAD SAYS WHAT THE VIDEO IS, NOT WHAT WAS ASKED FOR.
//
// Publishing from the Launchpad ran in this order:
//
//   1. upload-video          privacyStatus: 'private'
//   2. /api/youtube/apply    privacyStatus: 'public'   ← live here
//   3. requestStudioFinish   paid promotion + AI use   ← disclosed here
//
// YouTube's Data API cannot set paid promotion or the AI-use answer at all,
// which is the whole reason step 3 exists and drives real Studio controls
// through SCOUT. Running it AFTER step 2 meant an affiliate video went public
// and got its disclosure afterwards, if SCOUT was installed at all. Without
// SCOUT it went public and never got one. The Co-Pilot has always done the
// reverse: finish first, then flip, and keep it private when the disclosure
// cannot be confirmed. The Launchpad now does the same.
//
// The second half is what the creator was told. Step 2's result was read for
// `warnings` alone, so:
//
//   a 500 from apply       carries no warnings  → read as success
//   a rejected fetch       caught and discarded → read as success
//   statusOk: false        never looked at      → read as success
//
// and then, unconditionally: toast.success('Published to YouTube.'). The route
// returns statusOk precisely so a caller can tell a 200-with-warnings from a
// write that actually reached YouTube, and the Co-Pilot has used it for
// months. A creator who chose Public could be looking at a green tick over a
// private draft that nobody can see.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const PAGE = readFileSync('app/(dashboard)/launchpad/page.tsx', 'utf8')
const APPLY = readFileSync('app/api/youtube/apply/route.ts', 'utf8')
// Comment lines first, always. Every claim below describes a bug whose old
// shape is quoted in the comments that explain the fix, and a grep over the raw
// file flags that explanation as the bug itself.
const code = PAGE.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

// ── the route still reports what a caller needs ────────────────────────────
//
// Everything here rests on statusOk. If it ever stops being returned, these
// checks would keep passing against a page that can no longer tell.
{
  check('apply still returns statusOk', /statusOk = results\[1\]\.status === 'fulfilled'/.test(APPLY),
    'it is the only signal that separates a 200 with warnings from a write that reached YouTube')
  check('and ships it in the response', /statusOk,/.test(APPLY))
}

// ── the disclosure comes before the video does ─────────────────────────────
{
  const finishAt = code.indexOf('requestStudioFinish(')
  const publicAt = code.indexOf("privacyStatus: 'public'")
  check('both steps are still there', finishAt > -1 && publicAt > -1, `${finishAt} / ${publicAt}`)
  check('the Studio finish runs BEFORE the video goes public', finishAt < publicAt,
    'YouTube cannot set paid promotion through its API, so publishing first means publishing undisclosed')

  const metaAt = code.indexOf('thumbnailDataUri: thumbUrl')
  check('the metadata pass keeps the video private', metaAt > -1 && metaAt < publicAt,
    'that call used to carry privacyStatus public, which is what put step 2 ahead of step 3')
  check('and it says private explicitly', /thumbnailDataUri: thumbUrl[\s\S]{0,200}?privacyStatus: 'private'/.test(code),
    'leaving it out would inherit whatever the upload set, which is fine today and silent when it changes')
}

// ── a video that cannot be disclosed stays private ─────────────────────────
{
  check('going public is gated on the disclosure landing', /if \(detailsConfirmed\) \{/.test(code),
    'the point of the reorder is the gate; without it the order is just cosmetic')
  check('and skipping the details pass is not the same as failing it',
    /let detailsConfirmed = !finishDetails/.test(code),
    'a creator who unticked paid promotion asked for no check, and must still be able to publish')
  check('a SCOUT failure does not quietly unlock it',
    /catch \{[\s\S]{0,300}?detailsConfirmed = !finishDetails[\s\S]{0,200}?setStudioDone/.test(code),
    'a thrown requestStudioFinish must leave the gate where an unconfirmed result leaves it')
  check('and the creator is told why it stayed private', /Kept PRIVATE on purpose/.test(PAGE),
    'a video that silently did not publish is the same bug in the other direction')
}

// ── every failure of the finishing pass is read ────────────────────────────
{
  check('a non-2xx from apply is noticed', /if \(!ap\.ok\) applyWarnings\.push/.test(code),
    'a 500 carries no warnings array, so reading warnings alone read a crash as a clean run')
  check('statusOk is consulted', /aj\?\.statusOk !== false/.test(code),
    'a 200 with statusOk false means nothing reached YouTube')
  check('a thrown fetch is recorded, not swallowed',
    /catch \(e\) \{[\s\S]{0,300}?applyWarnings\.push\(e instanceof Error/.test(code),
    'the old catch had an empty body, so a dropped connection looked identical to success')
  check('the flip to public is checked the same way',
    /if \(gp\.ok && gj\?\.statusOk !== false\) visibility = 'public'/.test(code),
    'the second call can fail on its own, and that is exactly the case that leaves a private video')
}

// ── the screen reports the video, not the request ──────────────────────────
{
  check('what the video IS is tracked separately from what was asked',
    /visibility: 'public' \| 'private'; wanted: 'public' \| 'private'/.test(PAGE),
    'one field cannot say both, and the difference between them is the entire bug')
  check('the success toast is spent on a real publish',
    /if \(visibility === 'public'\) toast\.success\('Published to YouTube\.'\)/.test(code),
    'it used to fire on `privacy === \'public\'`, which is the request, not the result')
  check('and a private draft the creator wanted public reads as a warning',
    /still a PRIVATE draft/.test(PAGE),
    'a green tick over an invisible video is worse than an error')
  check('the Done line names the actual visibility',
    /publishResult\.visibility === 'public' \? 'Public on YouTube\.' : 'On YouTube as a private draft\.'/.test(code),
    'the toast is gone in seconds; the card is what stays')
  check('the warnings are held on screen too', /publishResult\.applyWarnings\.map/.test(code),
    'toast.warning disappears while they are still reading it')
  check('the Studio checklist stops asserting the rest is set',
    /publishResult\?\.metadataOk[\s\S]{0,200}?Everything else/.test(code),
    'it claimed title, description, tags, thumbnail and privacy had landed even when the pass that sets them had failed')
}

// ── a refused publish still leaves a way forward ───────────────────────────
//
// The Amazon step is gated on the YouTube step being resolved. These two used
// to be a toast and nothing else: the message was gone in seconds and the card
// still showed a Publish button, as though the click had not happened.
{
  check('an unapproved upload scope is held on screen',
    /setPublishError\(m\); toast\.error\(m[\s\S]{0,200}?reconnectRequired/.test(code)
      || /notEnabled[\s\S]{0,400}?setPublishError\(m\)/.test(code),
    'publishError is what reveals the "skip to Amazon" escape beside the failure')
  check('both messages say the video is safe', (PAGE.match(/Your video is safe/g) || []).length >= 4,
    'after a refusal the first question is whether the upload was lost')
  check('and that Amazon does not need this step',
    (PAGE.match(/Amazon does not need this step/g) || []).length >= 2,
    'the run is not over, and the screen has to say so')
}

// ── a resumed session does not lose the verdict ────────────────────────────
{
  check('the result is saved with the rest of the run', /studioDone, publishResult,/.test(code),
    'without it a reload shows a green Done over the private draft the warnings were explaining')
  check('and restored', /if \(s\.publishResult\) setPublishResult\(s\.publishResult\)/.test(code))
  check('a retry clears the previous verdict', /setPublishError\(null\); setPublishResult\(null\)/.test(code),
    'otherwise the last run\'s warnings render under the new attempt')
}

// ── the storefront run counts what it set out to do ───────────────────────
//
// The final line read `Uploaded to ${done} of ${results.length} storefronts`,
// where results is the rows SCOUT returned. A market that never reached the
// delivery queue produces no row, so it vanished from BOTH sides of the
// fraction: three stores that uploaded nothing reported "Uploaded to 0 of 0
// storefronts", as a success toast. And the wave that found an empty queue
// returned in silence, so there was nothing else on screen to contradict it.
{
  const STAGE = readFileSync('components/launchpad/StorefrontStage.tsx', 'utf8')
  const stage = STAGE.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  check('the denominator is the markets we were ready to upload to',
    /const attempted = readyTargets\.length/.test(stage) && /of \$\{attempted\} storefronts/.test(stage),
    'counting against the rows that came back hides every market that produced no row')
  check('and a short run is not reported as a success',
    /if \(landed === attempted && attempted > 0\) toast\.success\(line\)/.test(stage),
    'toast.success on a partial upload is the whole bug')
  check('a wave with an empty queue says so', /Nothing was queued for/.test(STAGE),
    'it used to return [] in silence, and silence looked exactly like nothing to do')
  check('the missing markets are named in the count', /never got as far as an upload/.test(STAGE),
    'a creator needs to know the difference between refused and never attempted')
}

if (failures.length) {
  console.error(`\n❌ launchpad-visibility: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ launchpad-visibility: the disclosure lands before the video goes public, and the screen reports the visibility the video actually has')
