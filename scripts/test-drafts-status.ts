// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Live videos must never be listed under Co-Pilot's "Needs metadata".
//
// The bug this pins: Studio keeps a video's scheduling record after it goes
// out at its time, SCOUT read "has a schedule" before "is public", and every
// video ever published on a schedule was saved as private. The sync rewrote
// the saved list every fifteen minutes, and the drafts route only re-checked
// the first 200, so on a real channel they stayed.

import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }

const BG = readFileSync('extension/background.js', 'utf8')
const SYNC = readFileSync('app/api/youtube/drafts/scout-sync/route.ts', 'utf8')
const DRAFTS = readFileSync('app/api/youtube/drafts/route.ts', 'utf8')

check('SCOUT: public wins over an old schedule',
  /const isScheduled = !isPublic && \(ahead \|\| visStr\.indexOf\('SCHEDULED'\) >= 0\)/.test(BG)
  && /if \(isPublic\) status = 'public'/.test(BG),
  'a video published on a schedule was saved as private')
check('SCOUT: only a time still ahead is sent as a schedule',
  /const ahead = !!scheduledSecs && scheduledSecs \* 1000 > Date\.now\(\)/.test(BG)
  && /const publishAt = scheduledSecs && isScheduled \?/.test(BG))
check('the sync never takes a confirmed public video back to private',
  /if \(status !== 'public' && knownPublic\.has\(id\) && !future\) status = 'public'/.test(SYNC),
  'older SCOUT versions would keep undoing the drafts route\'s own check')
check('the sync reads a passed schedule as published',
  /if \(status === 'private' && Number\.isFinite\(at\) && !future\) status = 'public'/.test(SYNC)
  && /publishAt: future \?/.test(SYNC))
check('the drafts route re-checks every non-public video, not the first 200',
  /d\.status !== 'public'\)\.slice\(0, 1500\)/.test(DRAFTS) && !/!== 'public'\)\.slice\(0, 200\)/.test(DRAFTS))
check('and saves what it corrected, so the next load does not ask again',
  /const changed = new Map\(trued\.filter/.test(DRAFTS) && /await writeCache\(supabase, user\.id, cache\.uploads_playlist_id, updated/.test(DRAFTS))

if (failures.length) {
  console.error(`\n❌ drafts-status: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ drafts-status: a live video is public however it was scheduled, and stays public in the saved list')
