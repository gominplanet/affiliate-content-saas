// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A post for a video that is not public yet is a wait, not an error: the
// queue answers with the code and go-live time before anything is queued,
// and the Generate button shows it in amber with a way to schedule the post
// for after the video, never a red Retry that can only fail again.

import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const enq = read('app/api/blog/enqueue/route.ts')
const btn = read('components/content/GenerateButton.tsx')
const gen = read('app/api/blog/generate/route.ts')

check('the queue asks before queuing and answers with the code and time', /code: 'video_not_public', goesLiveAt: np\.goesLiveAt/.test(enq) && enq.indexOf('videosNotPublic(') < enq.indexOf('checkGenerationLimit('))
check('the queue keeps the same exception as the writer (a post after the video)', /at >= Date\.parse\(np\.goesLiveAt\)/.test(enq) && /new Date\(scheduledForIso\)\.getTime\(\) >= new Date\(np\.goesLiveAt\)\.getTime\(\)/.test(gen))
check('the button reads the code as waiting, not as an error', /data\.code === 'video_not_public'/.test(btn) && /setStatus\('notLive'\)/.test(btn))
check('waiting is amber with the go-live time, and no Retry', (() => { const i = btn.indexOf("if (status === 'notLive')"); const j = btn.indexOf("if (status === 'error')"); const block = btn.slice(i, j); return i > 0 && j > i && /Waiting for the video/.test(block) && !/Retry →/.test(block) })())
check('the post can be written now and published after the video', /generate\(\{ scheduleAt: new Date\(liveMs \+ 10 \* 60_000\)\.toISOString\(\) \}\)/.test(btn) && /scheduleMode: 'wp-native', scheduledFor: opts\.scheduleAt/.test(btn))

const page = read('app/(dashboard)/content/page.tsx')
check('the Content list leaves out videos that are not live yet, unless they already have a post', /return !\(Number\.isFinite\(at\) && at > now\) \|\| withPost\.has\(String\(v\.id\)\)/.test(page) && /setVideos\(live as typeof vids\)/.test(page))

if (failures.length) {
  console.error('❌ not-live post guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ not-live post guard passed')
