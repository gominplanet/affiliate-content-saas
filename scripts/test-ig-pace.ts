// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// INSTAGRAM AT A HUMAN PACE (Seb, 2026-10-26: "could MVP posting
// automatically get flagged by instagram for automatic posting.. it happened
// to alejandro.. how do we get rid of this issue"). Pinned: Reels and feed
// posts at least 15 minutes apart per account (Stories left alone), the same
// caption not posted twice in a day, scheduled posts and batch Reels moved
// rather than failed, auto-DMs spaced and capped an hour with the rest sent
// later, and the public reply under a comment said a few ways.
import { readFileSync } from 'node:fs'
import { feedVerdict, captionKey, nextDmAt, publicReply, PUBLIC_REPLIES, IgTooSoonError, IG_FEED_GAP_MS, DM_GAP_MS, DM_HOURLY_CAP, scheduleSpreadMs, igDueNow, IG_SCHEDULE_SPREAD_MS } from '../lib/ig-pace'
import { dmLogWords } from '../lib/dm-log-words'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')
const now = Date.parse('2026-10-26T12:00:00Z')
const ago = (min: number) => new Date(now - min * 60_000).toISOString()

// Posts.
check('a post 10 minutes after the last one waits', (() => { const v = feedVerdict([{ caption: 'x', timestamp: ago(10) }], 'new', now); return !v.ok && 'tooSoon' in v })())
check('a post 20 minutes after goes', feedVerdict([{ caption: 'x', timestamp: ago(20) }], 'new', now).ok)
const cap = 'This cushion saved my back during long workdays at my desk.'
check('the same caption within a day is a repeat, hashtags, links and the DM line aside', (() => { const v = feedVerdict([{ caption: `${cap} #ad`, timestamp: ago(240) }], `${cap}!! #ergonomic\nComment LINK and I'll DM you the link. https://x.co/a`, now); return !v.ok && 'repeatAt' in v })())
check('a short caption is never judged a repeat', feedVerdict([{ caption: 'New!', timestamp: ago(240) }], 'New!', now).ok)
check('the caption key keeps only the words', captionKey('Hi THERE! #ad https://a.b/c') === 'hi there')
check('the wait is said in minutes, never as a failure of the post', /can go in about 9 minutes, or schedule it/.test(new IgTooSoonError(now - 6 * 60_000, now).message) && IG_FEED_GAP_MS === 15 * 60_000)

const IG = read('services/instagram.ts')
check('every Reel and feed post is held and checked in the one publish helper; Stories are not', /const feed = opts\.mediaType !== 'STORIES'/.test(IG) && /if \(feed\) await claimFeedSlot\(opts\.userId, opts\.accessToken, opts\.caption\)/.test(IG))
check('the hold is taken before anything is awaited, and let go when nothing went up', /if \(held && now - held < IG_FEED_GAP_MS\) throw new IgTooSoonError\(held, now\)\n  feedSlots\.set\(igUserId, now\)/.test(IG) && /if \(feed && !\(e instanceof Error && e\.name === 'PaidLabelUncertainError'\)\) feedSlots\.delete\(opts\.userId\)/.test(IG))
check('a scheduled Reel and Story are moved together, never split', /if \(e instanceof IgTooSoonError \|\| e instanceof IgRepeatError\) throw e/.test(read('lib/instagram-publish.ts')))
for (const [f, table] of [['app/api/cron/process-scheduled/route.ts', 'scheduled_posts'], ['app/api/cron/process-amazon-schedules/route.ts', 'amazon_scheduled_posts']] as const) {
  const s = read(f)
  check(`${table}: a post too soon is moved and says so, not failed`, /if \(err instanceof IgTooSoonError\)/.test(s) && new RegExp(`from\\('${table}'\\)\\.update\\(\\{\\s*status: 'pending', scheduled_at: at\\.toISOString\\(\\)`).test(s) && /Waiting: moved to/.test(s))
}
const BURN = read('app/api/cron/process-burn-jobs/route.ts')
check('a batch Reel is checked before its paid burn and moved, and moved again if it races', BURN.indexOf('await feedWaitUntil(igUserId, igToken)') > 0 && BURN.indexOf('await feedWaitUntil(igUserId, igToken)') < BURN.indexOf('overlayCaptionOnVideo(') && /if \(err instanceof IgTooSoonError\)/.test(BURN))

// DMs.
check('a DM goes 20 seconds or more after the last one', nextDmAt({ now, lastSentAt: now - 5000, sentInHour: [now - 5000], lastQueuedAt: null, jitterMs: 0 }) === now - 5000 + DM_GAP_MS)
check('a DM waits behind the ones already waiting', nextDmAt({ now, lastSentAt: null, sentInHour: [], lastQueuedAt: now + 60_000, jitterMs: 0 }) === now + 60_000 + DM_GAP_MS)
check('past the hour\'s cap, a DM waits for the hour to free up', (() => { const hour = Array.from({ length: DM_HOURLY_CAP }, (_, i) => now - 50 * 60_000 + i * 1000); return nextDmAt({ now, lastSentAt: hour[hour.length - 1], sentInHour: hour, lastQueuedAt: null, jitterMs: 0 }) === hour[0] + 3_600_000 })())
check('a quiet account sends at once', nextDmAt({ now, lastSentAt: null, sentInHour: [], lastQueuedAt: null, jitterMs: 0 }) === now)
const DM = read('lib/ig-dm.ts')
check('a DM that would go too soon waits its turn, and goes at once before migration 458', /if \(due != null && due > Date\.now\(\) \+ 1000\) \{\n    const \{ error: qErr \} = await sb\.from\('ig_dm_sends'\)\.update\(\{ status: 'queued'/.test(DM) && /if \(error\) return null/.test(DM))
check('a sent DM records when it went', /sent_at: new Date\(\)\.toISOString\(\)/.test(DM))
check('a waiting DM is claimed before it is sent, and never past Instagram\'s 7 days', /update\(\{ status: 'sending' \}\)\.eq\('id', r\.id\)\.eq\('status', 'queued'\)/.test(DM) && /Instagram takes a reply to a comment for 7 days/.test(DM))
check('the public reply is said a few ways, and MVP never answers its own', PUBLIC_REPLIES.length >= 4 && PUBLIC_REPLIES.includes(publicReply(0.99)) && /PUBLIC_REPLIES\.includes\(ev\.text\.trim\(\)\)/.test(DM) && /message: publicReply\(\)/.test(DM))
check('a waiting DM is said as waiting', dmLogWords({ status: 'queued' }).title === 'Waiting its turn')
const crons = (JSON.parse(read('vercel.json')).crons as Array<{ path: string; schedule: string }>)
check('the waiting DMs go every minute', crons.some((c) => c.path === '/api/cron/ig-dm-queue' && c.schedule === '* * * * *'))
const MIG = read('supabase/migrations/458_ig_dm_pace.sql')
check('migration 458 is safe to run twice', /add column if not exists sent_at timestamptz/.test(MIG) && /add column if not exists send_after timestamptz/.test(MIG) && !/drop |alter column/i.test(MIG))

// NEVER ON THE SAME MINUTE (Seb, 2026-10-26: "yes add time variation";
// Alejandro's posts went up at nearly the same time every day).
{
  const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  const spreads = ids.map(scheduleSpreadMs)
  check('each post gets its own 0 to 30 minute delay, never before the time picked', spreads.every((d) => d >= 0 && d < IG_SCHEDULE_SPREAD_MS) && IG_SCHEDULE_SPREAD_MS === 30 * 60_000)
  check('the delays are spread out, not bunched', new Set(spreads.map((d) => Math.floor(d / 60_000))).size >= 25)
  check('the delay is the same every run, so a post is never pushed later and later', ids.every((id) => scheduleSpreadMs(id) === scheduleSpreadMs(id)))
  const id = ids[7], set = '2026-10-26T09:00:00Z', d = scheduleSpreadMs(id)
  check('a post is due at its time plus its delay, not before', !igDueNow(id, set, Date.parse(set) + d - 1000) && igDueNow(id, set, Date.parse(set) + d))
  for (const f of ['app/api/cron/process-scheduled/route.ts', 'app/api/cron/process-amazon-schedules/route.ts']) {
    const s = read(f)
    check(`${f}: an Instagram post claimed before its delay goes back to waiting`, /platform === 'instagram' && !igDueNow\(String\(r\.id\)/.test(s) && /update\(\{ status: 'pending', claimed_at: null \}\)\.in\('id', early\.map/.test(s))
  }
  check('process-scheduled reads the time it needs', /retry_count,scheduled_at'\)/.test(read('app/api/cron/process-scheduled/route.ts')))
  check('a batch Reel waits for its delay too', /\.find\(\(r\) => igDueNow\(String\(r\.id\), r\.scheduled_at, Date\.now\(\)\)\)/.test(read('app/api/cron/process-burn-jobs/route.ts')))
  check('members are told where they schedule and see it', /IG_SPREAD_WORDS/.test(read('components/content/SocialPreviewModal.tsx')) && /, or up to 30 minutes after/.test(read('app/(dashboard)/content/page.tsx')))
}

if (fails.length) { console.error('ig-pace failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ ig-pace: Instagram posts spaced and never repeated, scheduled ones moved not failed, auto-DMs spaced and capped an hour')
