// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Facebook posts wait for the Group (Seb, 2026-10-13: scheduled and auto-pilot
// Facebook posts "queue for the Group"). With a Group saved, nothing MVP posts
// while the creator is away goes on the Page with the link; it waits in the
// queue, and every screen says waiting, never posted and never failed.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { QUEUED_NOTE, isQueuedNote, queuedWords, QUEUE_PREFIX } from '../lib/facebook-queue-words'
import { queueOutcome, queueDetail } from '../lib/amazon-queue'
import { queueForGroup } from '../lib/facebook-queue'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

check('a queued note is recognised and shown without its marker', isQueuedNote(QUEUED_NOTE) && !queuedWords(QUEUED_NOTE).includes(QUEUE_PREFIX) && /Facebook queue/.test(queuedWords(QUEUED_NOTE)))
check('an Amazon design in the queue reads as queued, not posted', queueOutcome({ status: 'completed', note: QUEUED_NOTE }) === 'queued' && queueOutcome({ status: 'completed', note: 'link swapped' }) === 'sent-note')
check('its note is shown without the marker', !(queueDetail({ status: 'completed', note: QUEUED_NOTE })?.text || '').includes(QUEUE_PREFIX))

// A stand-in database: no Group saved, then a Group saved, then no table.
function fakeAdmin(groups: unknown[], tableMissing = false) {
  const inserted: unknown[] = []
  const q = (table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: self, eq: self,
      maybeSingle: async () => table === 'brand_profiles' ? { data: { facebook_groups: groups } } : tableMissing ? { data: null, error: { message: 'relation "public.facebook_queue" does not exist' } } : { data: null, error: null },
      insert: (row: unknown) => { inserted.push(row); return { select: () => ({ single: async () => tableMissing ? { data: null, error: { message: 'relation "public.facebook_queue" does not exist' } } : { data: { id: 'q-1' }, error: null } }) } },
    })
    return chain
  }
  return { admin: { from: q }, inserted }
}
const base = { userId: 'u1', source: 'scheduled' as const, sourceId: 'p1', title: 'T', body: 'Body with link', link: 'https://amzn.to/x', imageUrl: null }
void (async () => {
  const group = [{ name: 'Kitchen deals', url: 'https://www.facebook.com/groups/kitchendeals/' }]
  const off = await queueForGroup(fakeAdmin(group).admin, { ...base, tier: 'amazon' })
  check('a creator without Facebook set up the Group way is never queued', !off.queued)
  const noGroup = await queueForGroup(fakeAdmin([]).admin, { ...base, tier: 'admin' })
  check('no Group saved: posted on the Page as before', !noGroup.queued && noGroup.why === 'no-group')
  const f = fakeAdmin(group)
  const yes = await queueForGroup(f.admin, { ...base, tier: 'admin' })
  check('a Group saved: queued, not posted', yes.queued && f.inserted.length === 1)
  const missing = await queueForGroup(fakeAdmin(group, true).admin, { ...base, tier: 'admin' })
  check('before migration 426, posted on the Page as before, and said why', !missing.queued && missing.why === 'no-table')

  const sched = read('app/api/cron/process-scheduled/route.ts')
  check('a scheduled review is queued before any Page post', sched.indexOf("source: 'scheduled'") > 0 && sched.indexOf("source: 'scheduled'") < sched.indexOf('const fb = createFacebookService(fbPageToken, fbPageId)') && /if \(q\.queued\) return \{ note: QUEUED_NOTE \}/.test(sched))
  const deal = read('lib/deal-social-publish.ts')
  check('a deal post is queued before any Page post', deal.indexOf('queueForGroup(') > 0 && deal.indexOf('queueForGroup(') < deal.indexOf('const fb = createFacebookService(acct.accessToken, acct.externalId)') && /queued: true, note: queuedWords\(QUEUED_NOTE\)/.test(deal))
  check('a scheduled deal post is named as one', /queueSource: requireLiveDeal \? 'deal_scheduled' : 'deal'/.test(read('lib/deal-quick-post.ts')) && /out\.results\.some\(\(r\) => r\.queued\) \? QUEUED_NOTE/.test(read('app/api/cron/process-deal-schedules/route.ts')))
  const amz = read('lib/amazon-social-publish.ts')
  check('an Amazon design is queued before any Page post', amz.indexOf('queueForGroup(') > 0 && amz.indexOf('queueForGroup(') < amz.indexOf('const fb = createFacebookService(intRow.facebook_page_access_token'))
  check('a scheduled Amazon design in the queue has no address and says so', /if \(out\.queued\) \{ externalId = ''; externalUrl = null; note = \[QUEUED_NOTE/.test(read('app/api/cron/process-amazon-schedules/route.ts')))
  check('the Amazon route answers queued, with no post address', /if \(res\.queued\) \{\s*\n\s*return NextResponse\.json\(\{ ok: true, queued: true/.test(read('app/api/amazon/fb/route.ts')))

  const content = read('app/(dashboard)/content/page.tsx')
  check('the schedule shows "In your Facebook queue", not Published', /label: 'In your Facebook queue'/.test(content) && /item\.status === 'completed' && isQueuedNote\(item\.error_message\)/.test(content))
  check('the deal and partner windows do not count a queued post as posted', /filter\(\(r\) => r\.ok && !r\.queued\)/.test(read('components/deal/QuickPostModal.tsx')) && /filter\(\(r\) => r\.ok && !r\.queued\)/.test(read('components/social/PartnerQuickPostModal.tsx')))
  check('the Amazon screens say queued', /in your Facebook queue/.test(read('components/amazon/PostToAll.tsx')) && /In your Facebook queue, not posted yet/.test(read('components/amazon/PostComposer.tsx')) && /posted\.queued/.test(read('components/labs/TikTokSocialPanel.tsx')))

  const q = read('components/meta/FacebookQueue.tsx')
  check('Meta Hub shows the queue', /<FacebookQueue groups=\{s\.groups\}/.test(read('app/(dashboard)/meta/page.tsx')))
  check('Send fills the Group, waits for Post, then posts on the Page pointing to it', /requestFacebookGroupPrefill\(g\.url, it\.body/.test(q) && /getFacebookGroupPostStatus\(res\.watchId\)/.test(q) && /\/api\/blog\/facebook-group-teaser/.test(q))
  check('a post is marked sent only once its Group post is up', /mark\(it\.id, \{ action: 'sent', groupPostUrl: link/.test(q) && /Sent needs the Group post it went to/.test(read('app/api/facebook/queue/route.ts')))
  check('a Page post that failed stays on screen with a retry', /Your Group post is up, but the Page post did not go out/.test(q) && /Try the Page post again/.test(q))
  check('the migration is safe to run twice', /create table if not exists public\.facebook_queue/.test(read('supabase/migrations/426_facebook_queue.sql')) && /drop policy if exists/.test(read('supabase/migrations/426_facebook_queue.sql')))

  if (failed) { console.error(`\n${failed} Facebook queue check(s) failed`); process.exit(1) }
  console.log('\nALL PASS')
})()
