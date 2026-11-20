// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A scheduled post's socials are queued where the post is written.
//
// Support, 2026-11-20: "When we schedule a blog post and select the option to
// share it on social media, the blog post goes live as scheduled, but nothing
// gets posted to our social accounts." Their queue: 60 scheduled posts with all
// seven socials to October 9, then six weeks of scheduled posts with no row at
// all, not even the draft-flip parent. schedule-publish wrote the rows after an
// internal generate call that runs up to its 290 second budget; when it ran
// out, generate still saved the post (so it went live) and the rows were lost.

import { readFileSync } from 'node:fs'
import { cascadeChildRows, queueCascade, CASCADE_SOCIALS } from '../lib/schedule-cascade'
import { scheduleTooFar, MAX_SCHEDULE_DAYS, type SocialScheduleEntry } from '../lib/schedule-types'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const AT = '2026-11-27T20:30:00.000Z'
const all: SocialScheduleEntry[] = CASCADE_SOCIALS.map((platform) => ({ platform, bodyText: 'Aberlite Touch 2 review' }))
const base = { userId: 'u1', blogPostId: 'p1', scheduledFor: AT, tier: 'pro' as const, connected: new Set<string>(CASCADE_SOCIALS), alreadyQueued: new Set<string>(), allowedAccounts: new Set<string>(), parentId: 'parent1' }

// 1. Which rows (pure)
{
  const { rows, skipped } = cascadeChildRows({ ...base, socials: all })
  check('all seven socials queue, five minutes after the post, under the parent', rows.length === 7 && skipped.length === 0 && rows.every((r) => r.scheduled_at === '2026-11-27T20:35:00.000Z' && r.parent_id === 'parent1' && r.status === 'pending' && r.kind === 'social'))
  const r2 = cascadeChildRows({ ...base, socials: all, alreadyQueued: new Set(['facebook', 'threads']) })
  check('a platform already queued for the post is never queued twice', r2.rows.length === 5 && !r2.rows.some((r) => r.platform === 'facebook' || r.platform === 'threads'))
  const r3 = cascadeChildRows({ ...base, socials: all, connected: new Set(['twitter', 'bluesky']) })
  check('an unconnected channel is skipped and named', r3.rows.map((r) => r.platform).join(',') === 'twitter,bluesky' && r3.skipped.length === 5)
  const r4 = cascadeChildRows({ ...base, socials: [{ platform: 'linkedin', bodyText: '  ' }, { platform: 'linkedin', bodyText: 'again' }, { platform: 'tiktok' as never, bodyText: 'x' }] })
  check('an empty caption is skipped, a repeat and an unknown platform are ignored', r4.rows.length === 0 && r4.skipped.join(',') === 'linkedin')
  const r5 = cascadeChildRows({ ...base, socials: [{ platform: 'facebook', bodyText: 'x', offsetMinutes: 30, includeAffiliateCta: true, socialAccountId: 'a1' }, { platform: 'threads', bodyText: 'y', socialAccountId: 'a2' }], allowedAccounts: new Set(['a1|facebook']) })
  check('a chosen offset, the Facebook link option and an allowed account carry over; an unknown account does not', r5.rows[0].scheduled_at === '2026-11-27T21:00:00.000Z' && r5.rows[0].options?.includeAffiliateCta === true && r5.rows[0].social_account_id === 'a1' && r5.rows[1].social_account_id === null && !('options' in r5.rows[1]))
}

// 2. Queued once, whoever gets there first (a fake database)
type Row = Record<string, unknown>
function fakeDb(opts: { failParent?: string; failChildren?: string } = {}) {
  const tables: Record<string, Row[]> = { scheduled_posts: [], blog_posts: [{ id: 'p1', user_id: 'u1' }], integrations: [{ user_id: 'u1', tier: 'pro', facebook_page_id: 'x', threads_access_token: 'x', twitter_access_token: 'x', linkedin_access_token: 'x', bluesky_handle: 'x', telegram_chat_id: 'x', pinterest_access_token: 'x' }], social_accounts: CASCADE_SOCIALS.map((platform) => ({ user_id: 'u1', platform })) }
  let n = 0
  const from = (t: string) => {
    let filters: Array<[string, unknown]> = []
    let pendingInsert: Row[] | null = null
    let pendingUpdate: Row | null = null
    const rows = () => (tables[t] || []).filter((r) => filters.every(([k, v]) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v))
    const run = () => {
      if (pendingInsert) {
        const fail = t === 'scheduled_posts' && (pendingInsert.some((r) => r.platform == null) ? opts.failParent : opts.failChildren)
        if (fail) return { data: null, error: { message: fail } }
        const made = pendingInsert.map((r) => ({ id: `r${++n}`, ...r }))
        tables[t].push(...made)
        return { data: made, error: null }
      }
      if (pendingUpdate) { for (const r of rows()) Object.assign(r, pendingUpdate); return { data: null, error: null } }
      return { data: rows(), error: null }
    }
    const q: Record<string, unknown> = {
      select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q }, in: (k: string, v: unknown[]) => { filters.push([k, v]); return q },
      insert: (r: Row | Row[]) => { pendingInsert = Array.isArray(r) ? r : [r]; return q },
      update: (r: Row) => { pendingUpdate = r; return q },
      single: async () => { const x = run(); return { data: Array.isArray(x.data) ? x.data[0] ?? null : x.data, error: x.error } },
      maybeSingle: async () => { const x = run(); return { data: Array.isArray(x.data) ? x.data[0] ?? null : x.data, error: x.error } },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    }
    filters = []
    return q
  }
  return { tables, db: { from } }
}

void (async () => {
  {
    const { tables, db } = fakeDb()
    const input = { userId: 'u1', blogPostId: 'p1', scheduleMode: 'draft-flip' as const, scheduledFor: AT, title: 'Aberlite Touch 2 review', socials: all }
    const first = await queueCascade(db, input)    // inside generate
    const second = await queueCascade(db, input)   // schedule-publish's backup
    const rows = tables.scheduled_posts
    check('generate queues the parent and the seven socials', !first.error && !!first.parentScheduleId && first.childScheduleIds.length === 7)
    check('the second call queues nothing new and returns the same rows', rows.length === 8 && second.parentScheduleId === first.parentScheduleId && second.childScheduleIds.sort().join() === first.childScheduleIds.sort().join())
    check('the parent publishes at the scheduled time; the socials point at it', rows.filter((r) => r.platform == null).length === 1 && rows.find((r) => r.platform == null)!.scheduled_at === AT && rows.filter((r) => r.platform).every((r) => r.parent_id === first.parentScheduleId))
    check('the ticked platforms are kept on the post', Array.isArray(tables.blog_posts[0].scheduled_social_platforms) && (tables.blog_posts[0].scheduled_social_platforms as string[]).length === 7)
  }
  {
    const { tables, db } = fakeDb()
    await queueCascade(db, { userId: 'u1', blogPostId: 'p1', scheduleMode: 'wp-native', scheduledFor: AT, title: 't', socials: all })
    check('wp-native writes no parent, only the socials', tables.scheduled_posts.length === 7 && tables.scheduled_posts.every((r) => r.platform && r.parent_id === null))
  }
  {
    const { db } = fakeDb({ failChildren: 'permission denied' })
    const r = await queueCascade(db, { userId: 'u1', blogPostId: 'p1', scheduleMode: 'draft-flip', scheduledFor: AT, title: 't', socials: all })
    check('a refused write is said, never a quiet success', r.error === 'Social pushes failed to queue: permission denied')
  }
  {
    const { tables, db } = fakeDb({ failParent: 'column "kind" does not exist' })
    const r = await queueCascade(db, { userId: 'u1', blogPostId: 'p1', scheduleMode: 'draft-flip', scheduledFor: AT, title: 't', socials: all })
    check('before migration 103 the parent is reported missing and the socials still queue', r.parentMissingColumn && !r.error && tables.scheduled_posts.length === 7)
  }

  // 3. A date years out is a typo
  const now = Date.parse('2026-11-20T12:00:00Z')
  check('3032 is too far; next month and 365 days out are not', scheduleTooFar(Date.parse('3032-01-31T20:30:00Z'), now) && !scheduleTooFar(Date.parse('2026-12-20T12:00:00Z'), now) && !scheduleTooFar(now + 365 * 86_400_000, now) && MAX_SCHEDULE_DAYS === 366)

  // 4. Wired in
  const GEN = read('app/api/blog/generate/route.ts')
  const SP = read('app/api/blog/schedule-publish/route.ts')
  check('generate queues the cascade after saving the post, and answers with it', /cascade = await queueCascade\(createAdminClient\(\), \{ userId: ownerId, blogPostId: savedPost\.id as string/.test(GEN) && /\n    cascade,\n  \}\)\n\}/.test(GEN))
  check('a held draft queues nothing', /body\.queueCascade === true && savedPost\?\.id && isScheduled && !heldForReview/.test(GEN))
  check('schedule-publish asks for it and backs it up with the same function', /queueCascade: true,/.test(SP) && /const cascade = await queueCascade\(supabase/.test(SP))
  check('a failed cascade still says so to the creator', /Blog generated, but \$\{cascade\.error\}/.test(SP))
  for (const [f, re] of [
    ['app/api/blog/schedule-publish/route.ts', /scheduleTooFar\(whenMs\)/],
    ['app/api/blog/schedule-edit/route.ts', /scheduleTooFar\(newBaseMs\)/],
    ['app/api/blog/schedule-cascade-only/route.ts', /scheduleTooFar\(whenMs\)/],
    ['components/content/ScheduleModal.tsx', /scheduleTooFar\(whenMs\)/],
    ['components/content/ScheduleEditModal.tsx', /scheduleTooFar\(new Date\(iso\)\.getTime\(\)\)/],
    ['components/content/BulkScheduleVideosModal.tsx', /scheduleTooFar\(startMs\)/],
  ] as Array<[string, RegExp]>) check(`${f} refuses a date more than a year out`, re.test(read(f)))
  check('no dashes in the new words', !/[–—]/.test(read('lib/schedule-types.ts').split('MAX_SCHEDULE_DAYS')[1] || ''))

  if (failures.length) {
    console.error(`test-schedule-cascade: ${failures.length} failed`)
    for (const f of failures) console.error(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log('test-schedule-cascade: all checks passed')
})()
