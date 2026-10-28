// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BURNED VIDEOS GO AFTER 30 DAYS, UNLESS STILL SCHEDULED (Seb, 2026-10-28).
// Pinned: only the burner's own files are touched, only once 30 days old,
// never one a post still to go out points at, and nothing at all is deleted
// when a queue cannot be read. The job runs daily.
import { readFileSync } from 'node:fs'
import { isBurnedVideo, pathsIn, burnsToDelete, BURN_KEEP_DAYS, STILL_TO_POST } from '../lib/burn-retention'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')
const now = Date.parse('2026-12-01T12:00:00Z')
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString()

check('only the burner\'s own videos', isBurnedVideo('burned-1793210034614.mp4') && !isBurnedVideo('cta-1793210034614.mp4') && !isBurnedVideo('short-1.mp4') && !isBurnedVideo('burner-1.mp4') && !isBurnedVideo('trybe-intro-x.mp4') && !isBurnedVideo('caption-abc.png'))
check('the window is 30 days', BURN_KEEP_DAYS === 30)

const base = 'https://x.supabase.co/storage/v1/object/public/instagram-videos/'
const pending = [
  { id: 1, status: 'pending', video_url: `${base}u1/burned-200.mp4` },
  { id: 2, status: 'pending', options: { reel: { url: `${base}u1/burned-300.mp4?t=1` } } },
]
const keep = pathsIn(pending)
check('a link anywhere in a row still to go out counts', keep.has('u1/burned-200.mp4') && keep.has('u1/burned-300.mp4') && keep.size === 2)

const files = [
  { id: 'a', name: 'burned-100.mp4', created_at: daysAgo(31) },  // old, posted: goes
  { id: 'b', name: 'burned-200.mp4', created_at: daysAgo(45) },  // old, still scheduled: stays
  { id: 'c', name: 'burned-300.mp4', created_at: daysAgo(40) },  // old, still scheduled: stays
  { id: 'd', name: 'burned-400.mp4', created_at: daysAgo(29) },  // too new: stays
  { id: 'e', name: 'cta-500.mp4', created_at: daysAgo(90) },     // a Liftoff or YouTube CTA: never
  { id: 'f', name: 'short-600.mp4', created_at: daysAgo(90) },   // a Short: never
  { id: null, name: 'burned-700.mp4', created_at: daysAgo(90) }, // a folder, not a file
  { id: 'g', name: 'burned-800.mp4', created_at: null },         // no date: never on a guess
]
const gone = burnsToDelete('u1', files, keep, now)
check('old posted burns go; scheduled, new, other and undated files stay', gone.length === 1 && gone[0] === 'u1/burned-100.mp4')

check('every queue that holds posts still to go out is read', ['scheduled_posts', 'amazon_scheduled_posts', 'deal_scheduled_posts', 'ig_burn_jobs'].every((t) => STILL_TO_POST.some((q) => q.table === t && q.states.includes('pending') && q.states.includes('processing')))
  && ['facebook_reel_jobs', 'facebook_queue'].every((t) => STILL_TO_POST.some((q) => q.table === t && q.states.includes('waiting'))))

const R = read('app/api/cron/purge-burned-videos/route.ts')
check('a queue that cannot be read means nothing is deleted', /return NextResponse\.json\(\{ ok: false, deleted: 0, error: `Could not read \$\{q\.table\}/.test(R) && R.indexOf('Could not read ${q.table}') < R.indexOf('base.remove('))
check('only burned- files are listed, and a deleted video\'s link is cleared', /search: 'burned-'/.test(R) && /update\(\{ result_url: null \}\)\.in\('result_url', urls\)/.test(R))
check('it says what it did', /deleted, keptForSchedules: kept, failed, folders/.test(R))
const crons = (JSON.parse(read('vercel.json')).crons ?? []) as { path: string; schedule: string }[]
check('it runs daily', crons.some((c) => c.path === '/api/cron/purge-burned-videos' && /^\d+ \d+ \* \* \*$/.test(c.schedule)))
check('burns are saved under the name the clean-up looks for', /const prefix = req\.body\?\.kind === 'burn' \? 'burned' : 'cta'/.test(read('ingest-service/server.js'))
  && (read('lib/overlay-burn.ts').match(/kind: 'burn'/g) || []).length === 2 && /\.\.\.\(cta\.kind \? \{ kind: cta\.kind \} : \{\}\)/.test(read('lib/youtube-ingest.ts')))

if (fails.length) { console.error('FAIL burn retention:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('✅ burn-retention: burned videos go after 30 days, never one still scheduled')
