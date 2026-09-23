// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NOTIFY SUBSCRIBERS IS THE CREATOR'S TOGGLE, AND OFF MEANS OFF.
//
// The operator's words: "have it as an option. Toggle on meaning YES to
// notification, toggle off meaning NO to notification." And, before that,
// "especially if the button i tick is to NOT notify them", because ticking No
// did not stop it:
//
//   THE UPLOAD NEVER PASSED THE CHOICE ON. YouTube's `notifySubscribers`
//   defaults to TRUE on insert. uploadShort's URL never set it, so every video
//   MVP uploaded was marked to notify, whatever the toggle said.
//
//   THE STATUS CALL ONLY SAID NO WHEN TOLD EXACTLY `false`. Anything else,
//   including undefined, fell back to YouTube's default of yes.
//
//   LAUNCH BATCH HARD-CODED YES. `notifySubscribers: true` in plain code, and
//   no toggle anywhere on the screen.
//
// So the value is now a REQUIRED boolean on both YouTube calls (no caller can
// compile without deciding), always sent explicitly, and every route turns
// "not sent" into No. The toggles default to off on every screen.
//
// A first attempt at this fix removed the toggles and forced No everywhere,
// which was the wrong reading of the ask. This file pins the choice, not a
// constant: it fails if a toggle disappears, and it fails if the choice stops
// reaching YouTube.

import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

// ── the YouTube calls say the choice, every time ───────────────────────────
{
  const YT = live(read('services/youtube/index.ts'))
  const upSig = YT.slice(YT.indexOf('async uploadShort('), YT.indexOf('): Promise<{ id: string', YT.indexOf('async uploadShort(')))
  check('the upload REQUIRES a notify choice',
    /\bnotifySubscribers: boolean/.test(upSig) && !/notifySubscribers\?:/.test(upSig),
    'optional is how it went missing: omitted, YouTube notifies')
  check('and puts it in the upload URL, always',
    /upload\/youtube\/v3\/videos\?[^`]*&notifySubscribers=\$\{opts\.notifySubscribers === true \? 'true' : 'false'\}/.test(YT),
    'this URL never set it, so every upload was marked to notify')

  const stSig = YT.slice(YT.indexOf('async updateVideoStatus('), YT.indexOf('): Promise<void>', YT.indexOf('async updateVideoStatus(')))
  check('the status call REQUIRES a notify choice too',
    /\bnotifySubscribers: boolean/.test(stSig) && !/notifySubscribers\?:/.test(stSig), '')
  check('and always sends it',
    /notifySubscribers: args\.notifySubscribers === true \? 'true' : 'false'/.test(YT),
    'set only for an exact false, everything else fell back to YouTube\'s yes')
}

// ── every route turns "not sent" into No ───────────────────────────────────
{
  for (const f of ['app/api/youtube/apply/route.ts', 'app/api/youtube/upload-video/route.ts', 'app/api/youtube/upload-short/route.ts']) {
    check(`${f} passes the toggle as an explicit boolean`,
      /notifySubscribers: body\.notifySubscribers === true/.test(live(read(f))),
      'a page that did not send it must read as No, not as YouTube\'s default')
  }
}

// ── Launch Batch: its own toggle, off by default, actually sent ────────────
{
  const DRAIN = live(read('app/api/cron/launch-drain/route.ts'))
  check('Launch Batch no longer hard-codes yes',
    !/notifySubscribers: true/.test(DRAIN), 'every batch video rang the bell with no switch anywhere')
  const sends = DRAIN.match(/notifySubscribers: notifyByBatch\.get\(it\.batch_id\) === true/g) ?? []
  check('the upload and the scheduling call both send the batch\'s toggle',
    sends.length === 2, `${sends.length} of 2`)
  check('a missing column reads as No, and does not stop uploads',
    /const notifyByBatch = new Map<string, boolean>\(\)[\s\S]{0,500}?if \(!nbErr\)/.test(DRAIN), '')
  check('the column defaults to off',
    /notify_subscribers boolean not null default false/.test(read('supabase/migrations/366_launch_batch_notify.sql')), '')

  const BOARD = read('components/launch/LaunchBoard.tsx')
  check('the batch screen has the switch',
    /role="switch" aria-checked=\{notifySubs\}/.test(BOARD)
    && /onClick=\{\(\) => void patchBatch\(\{ notifySubscribers: !notifySubs \}\)\}/.test(BOARD), '')
  check('and it starts off', /const \[notifySubs, setNotifySubs\] = useState\(false\)/.test(BOARD), '')
  check('and is locked once launched',
    /disabled=\{!notifyAvailable \|\| scheduleLocked/.test(BOARD)
    && /its notification setting is locked in/.test(read('app/api/launch/batches/[id]/route.ts')),
    'the uploader may already have sent the old answer')
}

// ── the other screens keep their toggle, off by default ────────────────────
{
  const CP = read('app/(dashboard)/co-pilot/page.tsx')
  const LP = read('app/(dashboard)/launchpad/page.tsx')
  check('Co-Pilot keeps its Yes/No', /Notify subscribers when this goes public\?/.test(CP), '')
  check('and it defaults to No', /\n\s*notifySubscribers: false,\n/.test(CP), '')
  check('Launchpad keeps its toggle, off by default',
    /const \[notifySubs, setNotifySubs\] = useState\(false\)/.test(LP) && /setNotifySubs\(e\.target\.checked\)/.test(LP), '')
  check('and sends it on the upload as well as the status call',
    /privacyStatus: 'private',\s*\n[\s\S]{0,200}?notifySubscribers: notifySubs,/.test(LP),
    'two calls that could disagree about the same choice')
}

// ── SCOUT is told the choice explicitly ────────────────────────────────────
{
  const EF = read('lib/extension-frame.ts')
  check('Studio finish sends an explicit boolean',
    /MVP_STUDIO_FINISH', videoId, opts: \{ \.\.\.opts, notifySubscribers: opts\.notifySubscribers === true \}/.test(EF), '')
  check('so does the disclosure apply, where undefined would keep Studio\'s old setting',
    /MVP_YT_APPLY_DISCLOSURES', videoId, opts: \{ \.\.\.opts, notify: opts\.notify === true \}/.test(EF), '')
  check('and the disclosure inject',
    /MVP_YT_INJECT_DISCLOSURES', videoId, opts: \{ \.\.\.opts, notify: opts\.notify === true \}/.test(EF), '')
}

if (failures.length) {
  console.error(`\n❌ notify-choice: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ notify-choice: every screen has the toggle, off by default, and the choice reaches YouTube and SCOUT on every call')
