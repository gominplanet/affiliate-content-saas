// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE > Create > Upload videos (components/labs/TrybeUpload; Seb,
// 2026-10-18: "upload your video directly to trybe in this page as well..
// what the DROP feature does but directly here").
//
// The send itself is Drop's: same storage, same record, same SCOUT upload.
// What this file guards is that it stayed Drop's, and that the shortcut taken
// to put it on the TRYBE page cannot damage a drop the creator is setting up
// on the Drop page.
import { readFileSync, existsSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => {
  if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`)
}
const read = (f: string) => readFileSync(f, 'utf8')
const U = read('components/labs/TrybeUpload.tsx')
const O = read('components/labs/TrybeOutreach.tsx')

// ── It is on the page, where Seb asked for it ────────────────────────────────
check('the component exists', existsSync('components/labs/TrybeUpload.tsx'))
check('Upload videos is a tab in Create, beside Make videos',
  /\{ id: 'upload', label: 'Upload videos', icon: UploadCloud, group: 'create'/.test(O))
check('the tab is a real tab, not a label with nothing behind it',
  /type Tab = [^\n]*'upload'/.test(O) && /\{tab === 'upload' && <TrybeUpload \/>\}/.test(O))
check('it sits under Make videos rather than after This week',
  O.indexOf("id: 'upload'") > O.indexOf("id: 'create', label: 'Make videos'")
  && O.indexOf("id: 'upload'") < O.indexOf("id: 'week'"))

// ── ONE IMPLEMENTATION OF SENDING TO TRYBE ───────────────────────────────────
// Drop already does this. A second copy would drift, and the one that drifts
// is the one nobody is watching.
check('the send is Drop’s own, through SCOUT', /sendDropToTrybe\(/.test(U)
  && /from '@\/lib\/drop-run'/.test(U) && /api: requestTrybeApi, put: requestTrybePutFile/.test(U))
check('the brand, program, angle and products are Drop’s own picker',
  /DropTrybePicker/.test(U) && /from '@\/components\/labs\/DropTrybePicker'/.test(U))
check('TRYBE’s own upload API is not reimplemented here',
  !/upload-url|\/submissions|backend\/api\/creator\/v2\/submissions/.test(U))

// ── IT MUST NOT TOUCH THE DROP PAGE'S DRAFT ──────────────────────────────────
// /api/drop draft_launch deletes every video in the draft that the caller did
// not send it. If this page launched the shared draft, a creator part way
// through setting up a drop over there would lose those videos without being
// asked. `create` makes its own drop from these videos alone.
check('it makes its own drop', /action: 'create'/.test(U))
check('it never starts or launches the shared draft',
  !/draft_start|draft_launch|draft_add|draft_item|draft_remove/.test(U))
check('nothing in it goes to Liftoff or the blog, so a drop made here is TRYBE only',
  /toLiftoff: false, toBlog: false, toTrybe: true/.test(U) && /places: \[\]/.test(U))

// ── WHAT FAILURE LOOKS LIKE ──────────────────────────────────────────────────
// A post that "used Passport" while holding a geni.us link, a garment check
// whose silence looked like a pass: this codebase keeps shipping screens that
// report the plan instead of the result. Each stage here is its own sentence.
const STAGES = ['uploading', 'ready', 'sending', 'in_review', 'sent_unconfirmed', 'failed']
check('every stage is drawn, so none of them is silent', STAGES.every((st) => U.includes(`v.stage === '${st}'`)),
  STAGES.filter((st) => !U.includes(`v.stage === '${st}'`)))
check('a video is in review only once TRYBE said so',
  /res\.state === 'in_review'[\s\S]{0,200}stage: 'in_review'/.test(U))
check('TRYBE taking it is not the same card as the brand having it',
  /sent_unconfirmed[\s\S]{0,260}not in your [^\n]*submissions yet/.test(U))
check('a failed card never has an empty reason', /v\.note \|\| 'It did not go, and MVP did not record why\.'/.test(U))
check('no answer at all from the send is a failure, not a success',
  /if \(!res\) \{\s*\n\s*mark\([^\n]*stage: 'failed'/.test(U))
check('a send that throws still lands on the card', /catch \(e\) \{[\s\S]{0,160}stage: 'failed'/.test(U))
check('the three outcomes are told apart by colour as well as words',
  /#15803D/.test(U) && /#B45309/.test(U) && /#B91C1C/.test(U))

// ── Nothing goes without a brand ─────────────────────────────────────────────
check('a video with no brand picked is not sent', /stage === 'ready' && v\.url && !choiceBlocker\(v\.choice\)/.test(U))
check('and the page says how many are still waiting on one', /still \{waiting === 1 \? 'needs' : 'need'\} a brand/.test(U))
// The rule itself is Drop's, imported rather than copied: a second copy of
// "is this video ready for TRYBE" is a second answer waiting to disagree.
const P = read('components/labs/DropTrybePicker.tsx')
check('the readiness rule is imported from Drop, not written again here',
  /import DropTrybePicker, \{ emptyChoice, choiceBlocker/.test(U) && !/function choiceBlocker/.test(U))
check('and that rule still asks for a brand, and for a product when the brand wants one',
  /if \(!c\?\.brandId\) return 'Pick the TRYBE brand'/.test(P) && /if \(c\.needsProduct && c\.productIds\.length === 0\)/.test(P))

// ── The upload ───────────────────────────────────────────────────────────────
// /api/drop refuses any file that is not this creator's own upload in MVP's
// storage, so the path has to carry their user id.
check('videos go to this creator’s own storage path', /\$\{user\.id\}\/trybe-\$\{crypto\.randomUUID\(\)\}/.test(U))
check('a file over the limit says so instead of failing in the upload',
  /BULK_VIDEO_MAX_BYTES/.test(U) && /is over the \$\{mb\(BULK_VIDEO_MAX_BYTES\)\} limit/.test(U))
check('a sign-in that ran out mid upload is said in words a creator can act on',
  /saysExpired\(msg\)/.test(U) && /Refresh the page and add it again/.test(U))
check('SCOUT missing is said, and the videos are kept rather than refused',
  /needs SCOUT \{SCOUT_TRYBE_SUBMIT_MIN_VERSION\}/.test(U) && /they stay until SCOUT is ready/.test(U))
check('a video that is not vertical is pointed out, not blocked',
  /not a vertical video, which is what TRYBE brands ask for/.test(U) && !/if \(!v\.vertical\) return/.test(U))

// ── House style ──────────────────────────────────────────────────────────────
const copy = (U.match(/"[^"]{12,}"|>[^<>{}\n]{12,}</g) ?? []).join(' ')
check('no dashes in anything a creator reads', !/[–—]| - /.test(copy), (copy.match(/[–—]| - /g) ?? []).slice(0, 3))
check('no year typed into the copy', !/\b20\d\d\b/.test(copy))

if (fails.length) {
  console.error(`\n❌ trybe-upload: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trybe-upload: Upload videos sends through Drop’s own send, makes its own drop, and every card says where its video actually got to')
