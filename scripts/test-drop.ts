// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drop (Labs, Seb 2026-10-17: "start phase one behind labs"): finished videos
// in, one Launch out. Long videos through a Liftoff batch with the creator's
// last Liftoff choices, a blog post after each video, vertical videos to a
// TRYBE brand through SCOUT. Holds the rules and the steps, with a pretend
// MVP, so a drop can never report the plan as the result.

import { readFileSync } from 'node:fs'
import {
  dropKind, defaultDest, copiedSettings, planWords, firstDay, startFor, nextForBatch, blogTimeFor, blogReady,
  placeLines, dropHeadline, isStale, STALE_MS, type LastBatch, type DropItemRow,
} from '../lib/drop-plan'
import { buildLiftoff, dropSteps, sendDropToTrybe, type Http, type HttpAnswer } from '../lib/drop-run'
import type { SendDeps, TrybeCall } from '../lib/trybe-submit'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const last: LastBatch = {
  id: 'b-last', name: 'Oct 10', cta: { image: 'x' }, cta_chosen: true, thumbnail: null, thumbnail_chosen: true,
  markets: ['amazon.com'], daily_slots: ['18:00', '09:00', '09:00'], timezone: 'America/Toronto',
  notify_subscribers: true, playlist_id: 'PL1', studio_options: { tags: true }, send_to_youtube: true, youtube_channel_id: 'UC123',
}

/** A pretend MVP: answers by URL and method, and records each call. */
function fakeHttp(answer: (url: string, method: string, body: any) => HttpAnswer | undefined) {
  const calls: Array<{ url: string; method: string; body: any }> = []
  const http: Http = async (url, init) => {
    const method = init?.method || 'GET'
    calls.push({ url, method, body: init?.body })
    return answer(url, method, init?.body) ?? { ok: true, status: 200, json: { ok: true } }
  }
  return { http, calls }
}
const ok = (json: Record<string, unknown>): HttpAnswer => ({ ok: true, status: 200, json })

void (async () => {
  // ── the rules ──────────────────────────────────────────────────────────────
  check('a tall frame is vertical, a wide or unread one is long', dropKind(1080, 1920) === 'vertical' && dropKind(1920, 1080) === 'long' && dropKind(0, 0) === 'long')
  check('long goes to Liftoff and the blog, vertical to TRYBE', JSON.stringify(defaultDest('long', true)) === JSON.stringify({ liftoff: true, blog: true, trybe: false })
    && defaultDest('long', false).blog === false && defaultDest('vertical', true).trybe && !defaultDest('vertical', true).liftoff)

  const body = copiedSettings(last, 'America/Toronto', '2026-10-18')
  check('the last batch’s choices are copied through Liftoff’s own PATCH', body.ctaChosen === true && (body.cta as { image: string }).image === 'x'
    && body.thumbnailChosen === true && body.thumbnail === null && JSON.stringify(body.dailySlots) === '["09:00","18:00"]'
    && body.playlistId === 'PL1' && body.notifySubscribers === true && body.sendToYouTube === true && body.startOn === '2026-10-18' && body.timezone === 'America/Toronto')
  const open = copiedSettings({ ...last, cta_chosen: false, thumbnail_chosen: null }, 'UTC', '2026-10-18')
  check('a choice never made stays open for Liftoff to ask', !('ctaChosen' in open) && !('cta' in open) && !('thumbnailChosen' in open))
  check('the plan names what is copied and what Liftoff will ask', planWords(last).missing.length === 0 && planWords(last).lines.some((l) => /09:00 and 18:00/.test(l))
    && planWords(null).missing.includes('your CTA') && planWords({ ...last, youtube_channel_id: null }).missing.includes('your YouTube channel'))

  // 08:00 in Toronto with a 09:00 first time: too close, tomorrow. 06:00: today.
  check('the first day is today only while the first time is well ahead', firstDay(['09:00'], 'America/Toronto', new Date('2026-10-17T12:00:00Z')).startOn === '2026-10-18'
    && firstDay(['09:00'], 'America/Toronto', new Date('2026-10-17T10:00:00Z')).startOn === '2026-10-17'
    && firstDay([], 'UTC', new Date('2026-10-17T10:00:00Z')).startOn === '2026-10-18')
  check('today and tomorrow are the creator’s own days', startFor('today', ['09:00'], 'America/Toronto', new Date('2026-10-18T02:00:00Z')).startOn === '2026-10-17'
    && startFor('tomorrow', ['09:00'], 'America/Toronto', new Date('2026-10-18T02:00:00Z')).startOn === '2026-10-18')

  check('launch only when Liftoff has no reason left', nextForBatch('draft', null) === 'launch' && nextForBatch('draft', '2 videos are still being prepared. This finishes on its own.') === 'wait'
    && nextForBatch('draft', 'Confirm your YouTube channel') === 'needs_you' && nextForBatch('launched', null) === 'launched')
  const now = new Date('2026-10-17T12:00:00Z')
  check('the blog goes live ten minutes after the video is public', blogTimeFor('2026-10-18T13:00:00Z', now) === '2026-10-18T13:10:00.000Z'
    && blogTimeFor('2026-10-16T13:00:00Z', now) === '2026-10-17T12:10:00.000Z' && blogTimeFor(null, now) === null)
  check('a blog post waits for the video row and a time YouTube confirmed', blogReady({ video_id: 'v', publish_at: 'x', state: 'scheduled' })
    && !blogReady({ video_id: null, publish_at: 'x', state: 'scheduled' }) && !blogReady({ video_id: 'v', publish_at: null, state: 'prepared' }))

  // ── the board says the result, never the plan ──────────────────────────────
  const row = (o: Partial<DropItemRow> = {}): DropItemRow => ({ id: 'i1', kind: 'long', to_liftoff: true, to_blog: true, to_trybe: false, launch_item_id: 'li1',
    blog_state: 'wanted', blog_detail: null, blog_url: null, blog_at: null, trybe_state: 'off', trybe_brand_name: null, trybe_detail: null, updated_at: new Date().toISOString(), ...o })
  const blocked = placeLines(row(), { state: 'blocked', reason: 'YouTube would not take this video after 3 tries' }, { dropState: 'launched' })
  check('a video YouTube refused is red with its reason', blocked[0].place === 'YouTube' && blocked[0].tone === 'bad' && /3 tries/.test(blocked[0].text))
  check('a blog post not written yet is waiting, not done', blocked.find((l) => l.place === 'Blog')!.tone === 'idle')
  const live = placeLines(row({ blog_state: 'scheduled', blog_at: '2026-10-18T13:10:00Z' }), { state: 'scheduled', publish_at: '2026-10-18T13:00:00Z', amazon: [{ domain: 'amazon.com', state: 'delivered', detail: null }] }, { dropState: 'launched' })
  check('scheduled, on Amazon and a scheduled post are green', live.every((l) => l.tone === 'good') && live.length === 3)
  const waiting = placeLines(row(), { state: 'prepared' }, { dropState: 'needs_you' })[0]
  check('prepared but not launched is never green', waiting.tone === 'warn' && placeLines(row(), { state: 'prepared' }, { dropState: 'preparing' })[0].tone === 'busy'
    && placeLines(row(), { state: 'prepared', planned_publish_at: 'x' }, { dropState: 'launched' })[0].tone !== 'good')
  const notAdded = placeLines(row(), null, { dropState: 'preparing' })
  check('a video Liftoff never got says so', notAdded[0].tone === 'warn' && /not added/.test(notAdded[0].text))
  const stale = new Date(Date.now() - STALE_MS - 60_000).toISOString()
  check('a post stopped with its page reads as stopped, not as being written', isStale(stale)
    && placeLines(row({ blog_state: 'writing', updated_at: stale }), { state: 'scheduled' }, { dropState: 'launched' }).find((l) => l.place === 'Blog')!.tone === 'warn')
  const tr = (s: string) => placeLines(row({ kind: 'vertical', to_liftoff: false, to_blog: false, to_trybe: true, trybe_state: s, trybe_brand_name: 'Acme' }), null, { dropState: 'launched' })[0]
  check('TRYBE: in review only when TRYBE listed it; taken but unlisted is a warning', tr('in_review').tone === 'good' && tr('sent_unconfirmed').tone === 'warn' && tr('failed').tone === 'bad' && tr('wanted').tone === 'idle')
  check('a video sent nowhere says so', /Not sent anywhere/.test(placeLines(row({ to_liftoff: false, to_blog: false }), null, { dropState: 'launched' })[0].text))
  check('the headline is counted from the lines', dropHeadline({ state: 'launched', note: null }, [blocked]).tone === 'bad' && dropHeadline({ state: 'launched', note: null }, [live]).tone === 'good'
    && dropHeadline({ state: 'needs_you', note: 'Confirm your YouTube channel' }, []).text === 'Confirm your YouTube channel')

  // ── building the Liftoff batch ─────────────────────────────────────────────
  {
    const { http, calls } = fakeHttp((url, method) => {
      if (url === '/api/launch/batches' && method === 'POST') return ok({ ok: true, id: 'b-new' })
      if (url === '/api/launch/batches/b-new/items') return ok({ ok: true, id: `li-${calls.filter((c) => c.url.endsWith('/items')).length}` })
      return undefined
    })
    const r = await buildLiftoff({ dropId: 'd1', name: 'Drop Sat', timezone: 'America/Toronto', startOn: '2026-10-18', last, videos: [
      { id: 'i1', sourceUrl: 'https://x/storage/a.mp4', fileName: 'mixer B0ABCDEFGH.mp4', title: '', asin: 'B0ABCDEFGH', durationSeconds: 300 },
      { id: 'i2', sourceUrl: 'https://x/storage/b.mp4', fileName: 'kettle.mp4', title: 'My kettle review', asin: '', durationSeconds: 200 },
    ] }, http)
    const order = calls.map((c) => `${c.method} ${c.url}`)
    check('the batch is made, given the last choices, filled in order, and its channel confirmed', JSON.stringify(order) === JSON.stringify([
      'POST /api/launch/batches', 'PATCH /api/launch/batches/b-new', 'POST /api/launch/batches/b-new/items', 'PATCH /api/launch/items/li-1',
      'POST /api/launch/batches/b-new/items', 'POST /api/launch/batches/b-new/channel', 'POST /api/drop']))
    check('a file name is a placeholder Liftoff replaces; a typed title is the creator’s', calls[2].body.titleSource === 'filename' && calls[2].body.title === 'mixer B0ABCDEFGH' && calls[4].body.titleSource === 'creator')
    check('the product goes through Liftoff’s own item PATCH', calls[3].body.product === 'B0ABCDEFGH')
    check('the channel is the one confirmed last time', calls[5].body.channelId === 'UC123')
    const link = calls[6].body
    check('the drop records its batch, each video’s Liftoff row and what is missing', link.action === 'link' && link.batchId === 'b-new' && link.settingsFrom === 'b-last'
      && link.links.length === 2 && link.state === 'preparing' && /kettle\.mp4 has no product/.test(link.note) && r.problems.length === 1)
  }
  {
    const { http, calls } = fakeHttp((url, method) => (url === '/api/launch/batches' && method === 'POST' ? { ok: false, status: 403, json: { error: 'Bulk Amazon upload is part of the Amazon and Pro plans.' } } : undefined))
    const r = await buildLiftoff({ dropId: 'd1', name: 'x', timezone: 'UTC', startOn: '2026-10-18', last: null, videos: [{ id: 'i1', sourceUrl: 's', fileName: 'a.mp4', title: '', asin: 'B0', durationSeconds: 1 }] }, http)
    check('a batch Liftoff refused ends the drop as failed, with Liftoff’s words', r.state === 'failed' && calls[1].body.state === 'failed' && /Amazon and Pro/.test(calls[1].body.note))
  }

  // ── launching when prepared, then the blog post ────────────────────────────
  function drop(state: string, items: unknown[] = []): Record<string, unknown> {
    return { ok: true, available: true, drops: [{ id: 'd1', state, note: null, batch_id: 'b1', items }] }
  }
  {
    const { http, calls } = fakeHttp((url) => {
      if (url === '/api/drop') return ok(drop('preparing'))
      if (url === '/api/launch/batches/b1') return ok({ ok: true, batch: { state: 'draft' }, launchBlocker: null, items: [{ id: 'li1', state: 'prepared' }] })
      return undefined
    })
    const r = await dropSteps(http)
    check('a prepared drop launches through Liftoff’s own route', calls.some((c) => c.url === '/api/launch/batches/b1/launch' && c.method === 'POST')
      && calls.some((c) => c.body?.action === 'state' && c.body.state === 'launched') && r.launched === 1 && r.more)
  }
  {
    const { http, calls } = fakeHttp((url) => {
      if (url === '/api/drop') return ok(drop('preparing'))
      if (url === '/api/launch/batches/b1') return ok({ ok: true, batch: { state: 'draft' }, launchBlocker: '1 video is still being prepared. This finishes on its own.', items: [{ id: 'li1', state: 'rendering' }] })
      return undefined
    })
    const r = await dropSteps(http)
    check('a drop still preparing waits and comes back', !calls.some((c) => c.url.endsWith('/launch')) && r.more && /d1:preparing/.test(r.signature))
  }
  {
    const { http, calls } = fakeHttp((url) => {
      if (url === '/api/drop') return ok(drop('preparing'))
      if (url === '/api/launch/batches/b1') return ok({ ok: true, batch: { state: 'draft' }, launchBlocker: 'Confirm your YouTube channel: check the channel these will upload to.', items: [{ id: 'li1', state: 'prepared' }] })
      return undefined
    })
    await dropSteps(http)
    const st = calls.find((c) => c.body?.action === 'state')
    check('a choice only the creator can make is written on the drop in Liftoff’s words', st?.body.state === 'needs_you' && /Confirm your YouTube channel/.test(st.body.note) && !calls.some((c) => c.url.endsWith('/launch')))
  }
  {
    const item = { id: 'i1', to_blog: true, blog_state: 'wanted', launch_item_id: 'li1', to_trybe: false, trybe_state: 'off' }
    const { http, calls } = fakeHttp((url, _m, b) => {
      if (url === '/api/drop' && !b) return ok(drop('launched', [item]))
      if (url === '/api/launch/batches/b1') return ok({ ok: true, batch: { state: 'launched' }, launchBlocker: null, items: [{ id: 'li1', state: 'scheduled', video_id: 'vid-1', publish_at: '2030-01-01T15:00:00Z', title: 'Mixer' }] })
      if (b?.action === 'blog_claim') return ok({ ok: true, claimed: true })
      if (url === '/api/blog/schedule-publish') return ok({ ok: true, postId: 'post-1', wordpressUrl: 'https://blog/x' })
      return undefined
    })
    const r = await dropSteps(http)
    const sp = calls.find((c) => c.url === '/api/blog/schedule-publish')
    const done = calls.find((c) => c.body?.action === 'blog_done')
    check('the blog post is claimed, written from the video row, and set for ten minutes after it is public', !!sp && sp.body.videoId === 'vid-1' && sp.body.scheduledFor === '2030-01-01T15:10:00.000Z'
      && sp.body.scheduleMode === 'wp-native' && Array.isArray(sp.body.socials) && sp.body.socials.length === 0
      && calls.findIndex((c) => c.body?.action === 'blog_claim') < calls.indexOf(sp))
    check('the post is recorded as scheduled only from the blog’s answer', done?.body.ok === true && done.body.postId === 'post-1' && done.body.url === 'https://blog/x' && r.blogs === 1)
  }
  {
    const item = { id: 'i1', to_blog: true, blog_state: 'wanted', launch_item_id: 'li1', to_trybe: false, trybe_state: 'off' }
    const { http, calls } = fakeHttp((url, _m, b) => {
      if (url === '/api/drop' && !b) return ok(drop('launched', [item]))
      if (url === '/api/launch/batches/b1') return ok({ ok: true, batch: { state: 'launched' }, launchBlocker: null, items: [{ id: 'li1', state: 'scheduled', video_id: 'vid-1', publish_at: '2030-01-01T15:00:00Z' }] })
      if (b?.action === 'blog_claim') return ok({ ok: true, claimed: false })
      return undefined
    })
    await dropSteps(http)
    check('a post another tab claimed is not written twice', !calls.some((c) => c.url === '/api/blog/schedule-publish'))
  }
  {
    const item = { id: 'i1', to_blog: true, blog_state: 'wanted', launch_item_id: 'li1', to_trybe: false, trybe_state: 'off' }
    const { http, calls } = fakeHttp((url, _m, b) => {
      if (url === '/api/drop' && !b) return ok(drop('launched', [item]))
      if (url === '/api/launch/batches/b1') return ok({ ok: true, batch: { state: 'launched' }, launchBlocker: null, items: [{ id: 'li1', state: 'blocked', reason: 'no' }] })
      if (b?.action === 'blog_claim') return ok({ ok: true, claimed: true })
      return undefined
    })
    await dropSteps(http)
    const done = calls.find((c) => c.body?.action === 'blog_done')
    check('no post for a video YouTube never took, and it says why', done?.body.ok === false && /did not reach YouTube/.test(done.body.detail) && !calls.some((c) => c.url === '/api/blog/schedule-publish'))
  }
  {
    const { http, calls } = fakeHttp((url) => (url === '/api/drop' ? { ok: false, status: 403, json: { error: 'Drop is still being tested.' } } : undefined))
    const r = await dropSteps(http)
    check('an account without Drop does nothing and asks nothing back', calls.length === 1 && !r.more && r.signature === '')
  }

  // ── TRYBE through SCOUT ────────────────────────────────────────────────────
  {
    const tItem = { id: 'i9', source_url: 'https://x/storage/v.mp4', file_name: 'v.mp4', mime_type: 'video/mp4', size_bytes: 5_000_000,
      trybe_brand_id: 'brand-1234', trybe_program_id: 'prog-1', trybe_angle_id: null, trybe_product_ids: ['p1'], trybe_exclusive: false, trybe_notes: '' }
    const api: SendDeps['api'] = async (method, path): Promise<TrybeCall> => {
      if (path.endsWith('/upload-url')) return { ok: true, status: 200, json: { data: { upload: { uploadUrl: 'https://s3/put', submissionId: 'sub-123456', publicUrl: 'https://cdn/v.mp4' } } } }
      if (path.endsWith('/submissions')) return { ok: true, status: 200, json: { data: [{ id: 'sub-123456', status: 'PENDING_REVIEW' }] } }
      return { ok: true, status: 200, json: { success: true } }
    }
    const put: SendDeps['put'] = async () => ({ ok: true, status: 200, etag: null })
    const notMine = fakeHttp((_u, _m, b) => (b?.action === 'trybe_claim' ? ok({ ok: true, claimed: false }) : undefined))
    check('a video another tab is sending is left to it', (await sendDropToTrybe(tItem, notMine.http, { api, put, waitMs: 0 })) === null && !notMine.calls.some((c) => c.body?.action === 'trybe_done'))
    const mine = fakeHttp((_u, _m, b) => (b?.action === 'trybe_claim' ? ok({ ok: true, claimed: true }) : undefined))
    const res = await sendDropToTrybe(tItem, mine.http, { api, put, waitMs: 0 })
    const done = mine.calls.find((c) => c.body?.action === 'trybe_done')
    check('a send is recorded as in review only when TRYBE lists it', res?.state === 'in_review' && done?.body.state === 'in_review' && done.body.submissionId === 'sub-123456')
  }

  // ── wiring ─────────────────────────────────────────────────────────────────
  const route = read('app/api/drop/route.ts')
  check('the Drop routes are behind its Labs switch', /canUsePreview\('drop', intg\?\.tier\)/.test(route) && /drop: 'admin'/.test(read('lib/labs-preview.ts')))
  check('only this creator’s own uploads can be dropped', /instagram-videos\/\$\{g\.userId\}\//.test(route))
  check('a blog post and a TRYBE send are claimed before they run', /eq\('blog_state', 'wanted'\)/.test(route) && /in\('trybe_state', from\)/.test(route))
  check('results are written only from a send that was claimed', /\.eq\('blog_state', 'writing'\)\s*\n?\s*return/.test(route) || /blog_done[\s\S]{0,600}\.eq\('blog_state', 'writing'\)/.test(route))
  const nav = read('components/layout/DashboardShellV2.tsx')
  check('Drop is in Labs, admin only', /href: '\/drop'[^\n]*gate: isAdmin/.test(nav))
  check('the page is behind its switch', /canUsePreview\('drop', tier\)/.test(read('app/(dashboard)/drop/page.tsx')))
  check('SCOUT’s background tab runs the drop steps', /await dropSteps\(browserHttp/.test(read('components/launch/LiftoffRunner.tsx')))
  check('the board is drawn from the results', /placeLines\(it, li,/.test(read('components/labs/DropResults.tsx')))
  check('Liftoff opens the batch a drop links to', /get\('batch'\)/.test(read('components/launch/LaunchBoard.tsx')))
  const sql = read('supabase/migrations/436_drops.sql')
  check('migration 436 makes both tables, safe to run twice', /create table if not exists public\.drops/.test(sql) && /create table if not exists public\.drop_items/.test(sql)
    && /drop policy if exists "own drops"/.test(sql) && /enable row level security/.test(sql))

  if (failures.length) { console.error('❌ drop guard failed:\n  - ' + failures.join('\n  - ')); process.exit(1) }
  console.log('✓ drop guard passed')
})()
