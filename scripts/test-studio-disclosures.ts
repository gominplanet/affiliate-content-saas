// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE STUDIO SETTINGS ARE SET ON THE PATH THAT WORKS, AND CHECKED AFTERWARDS.
//
// Paid promotion, the altered-content answer, monetization and the ad-suitability
// rating cannot be set through YouTube's Data API at all. SCOUT does it by
// merging the fields into Studio's OWN outgoing save, which carries YouTube's
// BotGuard attestation. A hand-rolled replay of the same request gets a 200 and
// is silently dropped, which is the trap this whole area exists inside.
//
// Two failures were behind "MVP could not confirm these, check them yourself":
//
//   THE WRONG MECHANISM. Launchpad called requestStudioFinish, which finds and
//   clicks controls across Studio's panels. The Co-Pilot has always used the
//   injection path. Two mechanisms for one job, and the more fragile one was on
//   the surface being sold as one-click.
//
//   NO VERIFICATION. Injection could only report whether OUR request went out,
//   never whether YouTube kept the fields, so every run ended ambiguous. It is
//   read back from Studio now, and the read is tri-state: a value that could not
//   be read is null, never false, because "we could not check" and "it did not
//   save" send a creator to do opposite things.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const HOOK = live(read('extension/yt-hook.js'))
// RAW, not comment-stripped. background.js is ~9,800 lines and carries regex
// literals that the block-comment stripper mis-pairs, which swallowed whole
// functions and failed three clauses against code that was plainly there. The
// strings matched below are distinctive code, not prose, so there is nothing
// for comments to false-positive on.
const BG = read('extension/background.js')
const FRAME = live(read('lib/extension-frame.ts'))
const LAUNCHPAD = live(read('app/(dashboard)/launchpad/page.tsx'))

// ── one mechanism, and it is the signed one ─────────────────────────────────
{
  check('Launchpad uses the signed-save injection',
    /requestYtInjectDisclosures\(/.test(LAUNCHPAD),
    'the clicking path is the fragile one and this surface is sold as one-click')
  check('and no longer drives Studio by clicking panels',
    !/requestStudioFinish\(/.test(LAUNCHPAD),
    'two mechanisms for one job is how the weaker one survives on the surface that matters')

  check('the altered-content question is ANSWERED, not left blank',
    /aiDisclosure: finishDetails/.test(LAUNCHPAD) && /hasAlteredContent: false/.test(LAUNCHPAD),
    'answered No and never answered are different states; only the second leaves the video flagged')
}

// ── the injection can actually reach the request ────────────────────────────
{
  check('the hook handles a Request-object fetch',
    /input instanceof Request/.test(HOOK) && /input\.clone\(\)\.text\(\)/.test(HOOK),
    'fetch(new Request(url, {body})) puts the body on the Request and leaves init undefined, and that shape used to skip injection in silence')
  check('and still handles the plain string body',
    /typeof body === 'string'/.test(HOOK))
  check('injection stays gated on the video id',
    /b\.encryptedVideoId !== inj\.videoId/.test(HOOK),
    'without this a save for an unrelated video could be rewritten')
}

// ── the settings are read back, and an unread value is not a false one ──────
{
  check('the hook harvests Studio\'s reported state',
    /window\.__mvpYtState = Object\.assign/.test(HOOK))
  check('matched on field names rather than an endpoint path',
    /const SNIFF = /.test(HOOK) && /hasPaidProductPlacement/.test(HOOK),
    'YouTube renames these endpoints; the field names are what survive')
  check('and a read for another video is discarded',
    /st\.videoId && st\.videoId !== wantId/.test(BG),
    'state harvested for a different video proves nothing about this one')

  check('the verify reloads the editor rather than trusting the save',
    /VERIFY BY READING IT BACK/.test(BG) && /__mvpYtState/.test(BG),
    'the save result only says our request went out')

  // TRI-STATE, everywhere. This is the clause that matters most: collapsing
  // "could not read" into false would tell a creator a setting failed when it
  // very likely saved, and send them to fix something that is not broken.
  check('an unreadable field is null, not false',
    /state\.paidPromotion === undefined \? null/.test(BG)
    && /state\.monetize === undefined \? null/.test(BG),
    'undefined means we did not see it, which is not the same as off')
  check('the altered-content answer keeps all three states',
    /yes\(state\.alteredContent\) \? true : no\(state\.alteredContent\) \? false : null/.test(BG),
    'YES, NO and never-answered are three different things to YouTube')
  check('the bridge types say so too',
    /paidPromotion: boolean \| null/.test(FRAME) && /alteredContent: boolean \| null/.test(FRAME))
  check('and the caller treats null as "not checked" rather than failed',
    /v \? v\.paidPromotion === true : fin\.ok/.test(LAUNCHPAD),
    'with no read-back it falls back to the save result instead of reporting a failure')
}

// ── the outcome reaches the screen ──────────────────────────────────────────
{
  check('a confirmed run says confirmed',
    /Studio confirmed: paid promotion/.test(LAUNCHPAD))
  check('and a read-back that disagrees is its own message',
    /fin\.verifyFailed/.test(LAUNCHPAD) && /did not stick/.test(LAUNCHPAD),
    'distinct from "could not set", which is what the creator used to get for every outcome')
  check('the bridge carries the verify outcome',
    /verifyFailed\?: boolean/.test(FRAME) && /verified\?: YtDisclosureVerified \| null/.test(FRAME))

  // The flow now saves, reloads and reads. The old 60s budget would have cut
  // that off and reported a timeout on a run that was working.
  // Scoped to THIS function. `120000` appears eight times in the file, so an
  // unanchored match passed with the budget cut back to sixty seconds.
  const injectFn = FRAME.slice(FRAME.indexOf('export async function requestYtInjectDisclosures'))
    .slice(0, 1800)
  check('the inject function was found', injectFn.includes('MVP_YT_INJECT_DISCLOSURES'), `${injectFn.length} chars`)
  check('the timeout allows for the reload',
    /\n\s*120000,/.test(injectFn),
    'the flow now saves, reloads and reads back; sixty seconds would time out a run that is working')
}

// ── the extension has to be rebuilt for any of this to exist ────────────────
//
// SCOUT ships as a packaged extension. A change to extension/ reaches nobody
// until the version moves, so the two must not drift.
{
  const manifest = JSON.parse(read('extension/manifest.json')) as { version?: string }
  const versionFile = read('lib/scout-version.ts')
  const declared = /SCOUT_LATEST_VERSION = '([^']+)'/.exec(versionFile)?.[1]
  check('the manifest and the app agree on the SCOUT version',
    !!declared && declared === manifest.version,
    `manifest ${manifest.version} vs app ${declared} — a mismatch means Chrome never pulls the build`)
}

if (failures.length) {
  console.error(`\n❌ studio-disclosures: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ studio-disclosures: set on the signed path, read back afterwards, and an unread field is never reported as off')
