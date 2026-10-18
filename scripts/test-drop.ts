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
import { runSend, type SendJob, type SendItem } from '../lib/drop-places'
import { placeFits, readPlans, READY_PLACES, PLACE_INFO, EXTRA_PLACES, settingsFromLast, readSettings, settingsBody, setupMissing, nextFreeSlots, daysLabel, liftoffLabel, setupStartOn } from '../lib/drop-plan'
import { startDraftBatch, addDraftVideo } from '../lib/drop-run'
import { tiktokBlocker, emptyTikTok } from '../components/labs/DropTikTok'

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


  // ── every other place ──────────────────────────────────────────────────────
  check('each place fits its kind of video; a pin and a Facebook post ride on the blog post; clips need YouTube',
    placeFits('tiktok', 'vertical', false) && !placeFits('tiktok', 'long', true) && placeFits('clips', 'long', true) && !placeFits('clips', 'long', false)
    && placeFits('pin', 'long', true, true) && !placeFits('pin', 'long', true, false) && placeFits('amazon', 'vertical', false))
  check('a saved plan keeps only places that exist and fit', JSON.stringify(readPlans({ long: ['liftoff', 'tiktok', 'nope', 'clips'], vertical: ['trybe', 'blog', 'tiktok'] }))
    === JSON.stringify({ long: ['liftoff', 'clips'], vertical: ['trybe', 'tiktok'], settings: null }) && readPlans(null).long.includes('liftoff'))
  check('every place Drop offers has a handler or rides on one', EXTRA_PLACES.every((p) => READY_PLACES.has(p)) && EXTRA_PLACES.every((p) => !!PLACE_INFO[p]))

  const vItem: SendItem = { id: 'i7', file_name: 'band morning.mp4', source_url: 'https://x.supabase.co/storage/v1/object/public/instagram-videos/u1/drop-1.mp4', duration_seconds: 34, asin: 'B0BAND1234', title: null }
  const job = (place: string, payload: Record<string, unknown> = {}): SendJob => ({ id: 's1', place, state: 'sending', payload })
  const kit = (url: string) => url === '/api/clip-factory/publish-kit' ? ok({ ok: true, productLink: 'https://amzn.to/x', amazon: true, disclosure: '#ad', linkHub: null, blogUrl: null, videoUrl: null }) : undefined
  const caption = (url: string) => url === '/api/amazon/social-caption' ? ok({ ok: true, caption: 'This band tracks my sleep. #sleep #wellness #fitness #health #tech #gadgets #ad' }) : undefined
  {
    const { http, calls } = fakeHttp((url, method) => caption(url) ?? kit(url) ?? (url === '/api/tiktok/publish-burned' && method === 'POST' ? ok({ ok: true, publishId: 'pub-1' }) : undefined))
    const r = await runSend(job('tiktok', { privacyLevel: 'PUBLIC_TO_EVERYONE' }), vItem, null, { http, waitMs: 0 })
    const post = calls.find((c) => c.url === '/api/tiktok/publish-burned')
    check('TikTok: the creator’s privacy, switches off unless turned on, link in bio and not a link in the caption', post?.body.privacyLevel === 'PUBLIC_TO_EVERYONE'
      && post.body.disableComment === true && post.body.disableDuet === true && /link in bio/i.test(post.body.caption) && !/amzn\.to/.test(post.body.caption))
    check('TikTok: as many tags as TikTok rewards, and #ad once', (post?.body.caption.match(/#\w+/g) || []).length <= 6 && (post?.body.caption.match(/#ad\b/g) || []).length === 1)
    check('TikTok: sent is not posted; it is read back on the next pass', r.state === 'wanted' && r.payload?.publishId === 'pub-1' && typeof r.payload?.written === 'string')
    const back = fakeHttp((url) => url.startsWith('/api/tiktok/publish-burned/status') ? ok({ status: 'published', shareUrl: 'https://tiktok.com/@me/video/9' }) : undefined)
    const r2 = await runSend(job('tiktok', { privacyLevel: 'PUBLIC_TO_EVERYONE', publishId: 'pub-1' }), vItem, null, { http: back.http, waitMs: 0 })
    check('TikTok: done only when TikTok says it posted', r2.state === 'done' && r2.url === 'https://tiktok.com/@me/video/9' && !back.calls.some((c) => c.url === '/api/tiktok/publish-burned'))
    const inbox = fakeHttp((url) => url.startsWith('/api/tiktok/publish-burned/status') ? ok({ status: 'inbox' }) : undefined)
    check('TikTok: a video left in the TikTok inbox is the creator’s to post', (await runSend(job('tiktok', { privacyLevel: 'SELF_ONLY', publishId: 'p' }), vItem, null, { http: inbox.http, waitMs: 0 })).state === 'needs_you')
    const none = fakeHttp(() => undefined)
    check('TikTok: never posted without the creator choosing who can see it', (await runSend(job('tiktok'), vItem, null, { http: none.http, waitMs: 0 })).state === 'needs_you' && none.calls.length === 0)
  }
  check('TikTok choices: privacy picked, commercial content declared, branded content not private', !!tiktokBlocker(emptyTikTok(), { username: 'me', privacyLevelOptions: ['PUBLIC_TO_EVERYONE'] }, 30)
    && !!tiktokBlocker({ ...emptyTikTok(), privacyLevel: 'PUBLIC_TO_EVERYONE', commercial: true }, { username: 'me', privacyLevelOptions: ['PUBLIC_TO_EVERYONE'] }, 30)
    && !!tiktokBlocker({ ...emptyTikTok(), privacyLevel: 'SELF_ONLY', commercial: true, brandedPartnership: true }, { username: 'me', privacyLevelOptions: ['SELF_ONLY'] }, 30)
    && tiktokBlocker({ ...emptyTikTok(), privacyLevel: 'PUBLIC_TO_EVERYONE' }, { username: 'me', privacyLevelOptions: ['PUBLIC_TO_EVERYONE'] }, 30) === null
    && !!tiktokBlocker({ ...emptyTikTok(), privacyLevel: 'PUBLIC_TO_EVERYONE' }, null, 30))
  {
    const { http, calls } = fakeHttp((url) => caption(url) ?? kit(url) ?? (url === '/api/instagram/publish-burned' ? ok({ ok: true, published: true, mediaId: 'm1' }) : undefined))
    const r = await runSend(job('instagram'), vItem, null, { http })
    const post = calls.find((c) => c.url === '/api/instagram/publish-burned')
    check('Instagram: a Reel with link in bio and #ad, done from Meta’s answer', r.state === 'done' && /link in bio/i.test(post?.body.caption) && /#ad/.test(post?.body.caption)
      && (post?.body.caption.match(/#\w+/g) || []).length <= 5 && (post?.body.caption.match(/#ad\b/g) || []).length === 1)
  }
  {
    const { http } = fakeHttp((url) => caption(url) ?? kit(url) ?? (url === '/api/youtube/upload-short' ? { ok: false, status: 429, json: { error: 'quota', quotaExceeded: true } } : undefined))
    check('Shorts: YouTube’s used up allowance is said, and left for the creator to try again', (await runSend(job('shorts'), vItem, null, { http })).state === 'needs_you')
    const okShort = fakeHttp((url) => caption(url) ?? kit(url) ?? (url === '/api/youtube/upload-short' ? ok({ ok: true, videoId: 'yt1', url: 'https://youtu.be/yt1' }) : undefined))
    const r = await runSend(job('shorts', { title: 'My band test' }), vItem, null, { http: okShort.http })
    const up = okShort.calls.find((c) => c.url === '/api/youtube/upload-short')
    check('Shorts: the creator’s title, the product link in the description', r.state === 'done' && up?.body.title === 'My band test' && /amzn\.to/.test(up?.body.description))
  }
  {
    const { http, calls } = fakeHttp((url) => caption(url) ?? kit(url) ?? (url === '/api/clip-factory/facebook-reel' ? ok({ ok: true, page: 'Seb Reviews', kind: 'reel', url: 'https://fb.com/r/1' }) : undefined))
    const r = await runSend(job('facebook'), vItem, null, { http })
    check('Facebook: a Reel on the Page with the link first, and which Page it went to', r.state === 'done' && /Seb Reviews/.test(r.detail || '')
      && /^.*amzn\.to/.test(calls.find((c) => c.url === '/api/clip-factory/facebook-reel')?.body.description || ''))
  }
  {
    const { http } = fakeHttp((url) => caption(url))
    const pins: unknown[] = []
    const r = await runSend(job('pinterest'), vItem, null, { http, videoPin: async (b) => { pins.push(b); return { ok: true, pinId: 'p1', board: 'Gadgets' } } })
    check('Pinterest: a video pin through the helper that waits out Pinterest', r.state === 'done' && /Gadgets/.test(r.detail || '') && pins.length === 1)
  }
  {
    // Amazon for a vertical video: its own Liftoff batch, Amazon only.
    const first = fakeHttp((url, method) => url === '/api/launch/batches' && method === 'POST' ? ok({ ok: true, id: 'b-am' }) : url === '/api/launch/batches/b-am/items' ? ok({ ok: true, id: 'li-am' }) : undefined)
    const r1 = await runSend(job('amazon'), vItem, null, { http: first.http, timezone: 'UTC' })
    const patch = first.calls.find((c) => c.url === '/api/launch/batches/b-am' && c.method === 'PATCH')
    check('Amazon (vertical): an Amazon only Liftoff batch with no CTA, the house look and the US store', patch?.body.sendToYouTube === false && patch.body.ctaChosen === true && patch.body.cta === null
      && patch.body.thumbnailChosen === true && JSON.stringify(patch.body.markets) === '["amazon.com"]' && r1.state === 'wanted' && r1.payload?.batchId === 'b-am'
      && first.calls.some((c) => c.url === '/api/launch/items/li-am' && c.body.product === 'B0BAND1234'))
    const second = fakeHttp((url) => url === '/api/launch/batches/b-am' ? ok({ ok: true, batch: { state: 'draft' }, launchBlocker: null, items: [{ id: 'li-am', state: 'prepared' }] }) : undefined)
    const r2 = await runSend(job('amazon', { batchId: 'b-am', launchItemId: 'li-am' }), vItem, null, { http: second.http })
    check('Amazon (vertical): launched once Liftoff prepared it', r2.state === 'wanted' && second.calls.some((c) => c.url === '/api/launch/batches/b-am/launch'))
    const third = fakeHttp((url) => url === '/api/launch/batches/b-am' ? ok({ ok: true, batch: { state: 'launched' }, launchBlocker: null, items: [{ id: 'li-am', state: 'amazon_only', amazon: [{ domain: 'amazon.com', state: 'delivered', detail: null }] }] }) : undefined)
    check('Amazon (vertical): done only when Amazon has it', (await runSend(job('amazon', { batchId: 'b-am', launchItemId: 'li-am' }), vItem, null, { http: third.http })).state === 'done')
    const noAsin = fakeHttp(() => undefined)
    check('Amazon (vertical): no product, no batch', (await runSend(job('amazon'), { ...vItem, asin: null }, null, { http: noAsin.http })).state === 'needs_you' && noAsin.calls.length === 0)
  }
  {
    const longItem: SendItem = { ...vItem, file_name: 'mixer.mp4' }
    const wait = fakeHttp(() => undefined)
    check('Clips: nothing until YouTube has the video', (await runSend(job('clips'), longItem, { state: 'prepared' }, { http: wait.http })).state === 'wanted' && wait.calls.length === 0)
    const limit = fakeHttp((url) => url === '/api/youtube/shorts/plan' ? { ok: false, status: 429, json: { error: 'limit', limitReached: true } } : undefined)
    check('Clips: a used up Find Moments allowance is the creator’s, said plainly', (await runSend(job('clips'), longItem, { state: 'scheduled', video_id: 'v1' }, { http: limit.http })).state === 'needs_you')
    let rendered = 0
    const make = fakeHttp((url) => {
      if (url.startsWith('/api/youtube/shorts?')) return ok({ ok: true, shorts: [] })
      if (url === '/api/youtube/shorts/plan') return ok({ ok: true, shorts: [{ id: 'c1', status: 'suggested' }, { id: 'c2', status: 'suggested' }, { id: 'c3', status: 'suggested' }, { id: 'c4', status: 'suggested' }] })
      if (url === '/api/youtube/shorts/render') { rendered++; return ok({ ok: true, short: { status: 'rendered' } }) }
      return undefined
    })
    const r = await runSend(job('clips'), longItem, { state: 'scheduled', video_id: 'v1' }, { http: make.http })
    check('Clips: three moments found and three rendered, from the YouTube video', r.state === 'done' && rendered === 3 && /3 clips ready/.test(r.detail || '') && r.url === '/clip-factory?video=v1'
      && make.calls.find((c) => c.url === '/api/youtube/shorts/plan')?.body.count === 3)
  }
  {
    // A vertical-only drop has no Liftoff batch, and its places still run.
    const send = { id: 's9', place: 'instagram', state: 'wanted', payload: {}, updated_at: new Date().toISOString() }
    const vdrop = { ok: true, available: true, drops: [{ id: 'd9', state: 'launched', note: null, batch_id: null, items: [{ ...vItem, to_blog: false, blog_state: 'off', launch_item_id: null, to_trybe: false, trybe_state: 'off', sends: [send] }] }] }
    const { http, calls } = fakeHttp((url, _m, b) => {
      if (url === '/api/drop' && !b) return ok(vdrop)
      if (b?.action === 'send_claim') return ok({ ok: true, claimed: true })
      return caption(url) ?? kit(url) ?? (url === '/api/instagram/publish-burned' ? ok({ ok: true, published: true, mediaId: 'm9' }) : undefined)
    })
    const r = await dropSteps(http)
    const done = calls.find((c) => c.body?.action === 'send_done')
    check('a drop with no Liftoff batch still sends its places, claimed first, the result recorded', r.sent === 1 && done?.body.state === 'done' && done.body.sendId === 's9'
      && calls.findIndex((c) => c.body?.action === 'send_claim') < calls.findIndex((c) => c.url === '/api/instagram/publish-burned'))
  }
  {
    // The pin and the Facebook post go out with the blog post as its socials.
    const pin = { id: 'sp', place: 'pin', state: 'wanted', payload: {} }
    const grp = { id: 'sg', place: 'group', state: 'wanted', payload: {} }
    const item = { id: 'i1', to_blog: true, blog_state: 'wanted', launch_item_id: 'li1', to_trybe: false, trybe_state: 'off', sends: [pin, grp] }
    const { http, calls } = fakeHttp((url, _m, b) => {
      if (url === '/api/drop' && !b) return ok(drop('launched', [item]))
      if (url === '/api/launch/batches/b1') return ok({ ok: true, batch: { state: 'launched' }, launchBlocker: null, items: [{ id: 'li1', state: 'scheduled', video_id: 'vid-1', publish_at: '2030-01-01T15:00:00Z', title: 'Mixer review' }] })
      if (b?.action === 'blog_claim' || b?.action === 'send_claim') return ok({ ok: true, claimed: true })
      if (url === '/api/blog/schedule-publish') return ok({ ok: true, postId: 'post-1', wordpressUrl: 'https://blog/x', skippedPlatforms: ['facebook'] })
      return undefined
    })
    await dropSteps(http)
    const sp = calls.find((c) => c.url === '/api/blog/schedule-publish')
    const doneOf = (id: string) => calls.find((c) => c.body?.action === 'send_done' && c.body.sendId === id)?.body
    check('the pin and the Facebook post are the blog post’s socials', JSON.stringify(sp?.body.socials.map((x: { platform: string }) => x.platform)) === '["pinterest","facebook"]' && !!sp && sp.body.socials.every((x: { bodyText: string }) => !!x.bodyText))
    check('a social the blog route skipped is said, not shown as done', doneOf('sp')?.state === 'done' && doneOf('sg')?.state === 'failed' && /not connected/.test(doneOf('sg')?.detail))
  }

  // ── the one page: set up once, then upload, upload, upload ─────────────────
  {
    const st = settingsFromLast(last)
    check('the setup starts from the last batch: CTA, look, times, channel, playlist, notify, Amazon', st.ctaChosen && (st.cta as { image: string }).image === 'x' && st.thumbnailChosen
      && JSON.stringify(st.dailySlots) === '["09:00","18:00"]' && st.channelId === 'UC123' && st.playlistId === 'PL1' && st.notifySubscribers && st.amazon && st.sendToYouTube)
    check('the Studio steps keep only the four Drop shows, on unless turned off', JSON.stringify(st.studioOptions) === JSON.stringify({ disclosures: true, monetize: true, adRating: true, endScreen: true }))
    const blank = settingsFromLast(null)
    check('with no batch yet, nothing is picked for the creator but a time', !blank.ctaChosen && blank.cta === null && !blank.thumbnailChosen && blank.channelId === null && JSON.stringify(blank.dailySlots) === '["09:00"]')
    check('a saved setup is cleaned: a CTA not chosen is dropped, unknown keys and bad times go', readSettings(null) === null
      && readSettings({ ctaChosen: false, cta: { x: 1 }, dailySlots: ['18:00', 'nonsense'], studioOptions: { monetize: false, evil: 'x' } })!.cta === null
      && JSON.stringify(readSettings({ dailySlots: ['18:00', 'nonsense'] })!.dailySlots) === '["18:00"]'
      && readSettings({ studioOptions: { monetize: false, evil: 'x' } })!.studioOptions.monetize === false
      && !('evil' in readSettings({ studioOptions: { evil: 'x' } })!.studioOptions))
    check('a saved plan carries its setup', readPlans({ long: ['liftoff'], vertical: [], settings: { ctaChosen: true, cta: null, dailySlots: ['10:00'] } }).settings?.ctaChosen === true)
    const body = settingsBody(st, 'America/Toronto', '2026-10-18')
    check('the setup goes through Liftoff’s own batch PATCH', body.ctaChosen === true && body.thumbnailChosen === true && JSON.stringify(body.dailySlots) === '["09:00","18:00"]'
      && JSON.stringify(body.markets) === '["amazon.com"]' && body.playlistId === 'PL1' && body.notifySubscribers === true && body.timezone === 'America/Toronto' && body.startOn === '2026-10-18')
    const open = settingsBody(blank, 'UTC', '2026-10-18')
    check('a choice the setup never made stays open for Liftoff', !('ctaChosen' in open) && !('cta' in open) && !('thumbnailChosen' in open))
    check('Amazon off means no store', JSON.stringify(settingsBody({ ...st, amazon: false }, 'UTC', '2026-10-18').markets) === '[]')
    check('what the setup still needs is named', setupMissing(null)[0] === 'your setup' && setupMissing(st).length === 0
      && JSON.stringify(setupMissing(blank)) === JSON.stringify(['your CTA', 'your thumbnail look', 'your YouTube channel'])
      && setupMissing({ ...st, sendToYouTube: false, amazon: false }).some((x) => /YouTube or Amazon/.test(x)))
  }
  {
    // 08:00 in Toronto. 09:00 is too close; 18:00 today is the first free time.
    const now = new Date('2026-10-17T12:00:00Z')
    const two = nextFreeSlots(2, ['09:00', '18:00'], 'America/Toronto', [], now)
    check('each video gets the next free time on the pattern, past the lead time', JSON.stringify(two.map((x) => `${x.date} ${x.time}`)) === '["2026-10-17 18:00","2026-10-18 09:00"]'
      && two[0].at === Date.parse('2026-10-17T22:00:00Z'))
    const after = nextFreeSlots(2, ['09:00', '18:00'], 'America/Toronto', [Date.parse('2026-10-17T22:00:00Z')], now)
    check('a time one of your videos already has is skipped, so a new drop follows on', JSON.stringify(after.map((x) => `${x.date} ${x.time}`)) === '["2026-10-18 09:00","2026-10-18 18:00"]')
    check('no times, no slots', nextFreeSlots(3, [], 'UTC', [], now).length === 0 && nextFreeSlots(0, ['09:00'], 'UTC', [], now).length === 0)
    // Saturday 17 October. Monday, Wednesday and Friday only.
    const mwf = nextFreeSlots(3, ['09:00'], 'America/Toronto', [], now, 90, { days: [1, 3, 5] })
    check('only the creator’s days', JSON.stringify(mwf.map((x) => x.date)) === '["2026-10-19","2026-10-21","2026-10-23"]')
    const later = nextFreeSlots(2, ['09:00'], 'America/Toronto', [], now, 90, { notBefore: '2026-11-03' })
    check('nothing before the creator’s first day', JSON.stringify(later.map((x) => x.date)) === '["2026-11-03","2026-11-04"]')
    check('the batch starts on the not-before day when it is later', setupStartOn({ dailySlots: ['09:00'], notBefore: '2026-11-03' }, 'America/Toronto', now) === '2026-11-03'
      && setupStartOn({ dailySlots: ['09:00'], notBefore: null }, 'America/Toronto', now) === '2026-10-18')
    check('days are cleaned and said in words', JSON.stringify(readSettings({ days: [5, 1, 1, 9, 'x'] })!.days) === '[1,5]' && readSettings({ days: [] })!.days.length === 7
      && readSettings({ notBefore: 'soon' })!.notBefore === null && readSettings({ notBefore: '2026-11-03' })!.notBefore === '2026-11-03'
      && daysLabel([1, 2, 3, 4, 5]) === 'weekdays' && daysLabel([1, 3, 5]) === 'Mon, Wed and Fri' && daysLabel([0, 1, 2, 3, 4, 5, 6]) === 'every day' && daysLabel([0]) === 'Sun only')
    check('the long videos’ place is named for the setup', liftoffLabel({ sendToYouTube: true, amazon: true }) === undefined && liftoffLabel({ sendToYouTube: true, amazon: false }) === 'YouTube' && liftoffLabel({ sendToYouTube: false, amazon: true }) === 'Amazon')
  }
  {
    const { http, calls } = fakeHttp((url, method) => url === '/api/launch/batches' && method === 'POST' ? ok({ ok: true, id: 'b-d' }) : undefined)
    const r = await startDraftBatch({ dropId: 'd-draft', name: 'Drop Sat', settings: settingsFromLast(last), timezone: 'America/Toronto', startOn: '2026-10-18' }, http)
    check('the drop’s batch is made from the setup at the first long video: made, set, channel confirmed, kept on the draft',
      r.batchId === 'b-d' && r.problems.length === 0 && JSON.stringify(calls.map((c) => `${c.method} ${c.url}`)) === JSON.stringify([
        'POST /api/launch/batches', 'PATCH /api/launch/batches/b-d', 'POST /api/launch/batches/b-d/channel', 'POST /api/drop',
      ]) && calls[1].body.ctaChosen === true && calls[2].body.channelId === 'UC123' && calls[3].body.action === 'link' && calls[3].body.keepDraft === true && calls[3].body.batchId === 'b-d')
    const refused = fakeHttp((url, method) => url === '/api/launch/batches' && method === 'POST' ? { ok: false, status: 403, json: { error: 'Liftoff is on Pro' } } : undefined)
    const r2 = await startDraftBatch({ dropId: 'd', name: 'x', settings: settingsFromLast(last), timezone: 'UTC', startOn: '2026-10-18' }, refused.http)
    check('a batch Liftoff refused is said in its words, and nothing else is tried', r2.batchId === null && /Liftoff is on Pro/.test(r2.problems[0]) && refused.calls.length === 1)
    const add = fakeHttp((url) => url === '/api/launch/batches/b-d/items' ? ok({ ok: true, id: 'li-9' }) : undefined)
    const v = await addDraftVideo('b-d', { itemId: 'i9', sourceUrl: 'https://x/u1/a.mp4', fileName: 'mixer review.mp4', title: '', asin: 'B0MIXER123', durationSeconds: 600 }, add.http)
    check('each long video goes into Liftoff as it is uploaded, with its product, and the drop keeps its Liftoff row',
      v.launchItemId === 'li-9' && v.problem === null && add.calls[0].body.titleSource === 'filename' && add.calls[0].body.title === 'mixer review'
      && add.calls[1].url === '/api/launch/items/li-9' && add.calls[1].body.product === 'B0MIXER123' && add.calls[2].body.action === 'draft_item' && add.calls[2].body.launchItemId === 'li-9')
    const draftList = { ok: true, available: true, drops: [{ id: 'dd', state: 'draft', note: null, batch_id: 'b-d', items: [{ id: 'i9', to_blog: true, blog_state: 'off', launch_item_id: 'li-9', to_trybe: false, trybe_state: 'off', sends: [] }] }] }
    const steps = fakeHttp((url, _m, b) => url === '/api/drop' && !b ? ok(draftList) : undefined)
    await dropSteps(steps.http)
    check('a drop still being set up is never launched or sent by the steps', steps.calls.length === 1)
  }
  {
    const route3 = read('app/api/drop/route.ts')
    check('the drop being set up is kept apart from the board, and comes back on its own', /\.neq\('state', 'draft'\)/.test(route3) && /eq\('state', 'draft'\)[\s\S]{0,200}maybeSingle\(\)/.test(route3))
    check('Launch turns each video’s choices into its places, once', /action === 'draft_launch'/.test(route3) && /onConflict: 'drop_item_id,place', ignoreDuplicates: true/.test(route3)
      && /\.eq\('state', 'draft'\)\s*\n?\s*if \(dErr\)/.test(route3))
    check('a video added to the drop must be one of the creator’s own uploads', /action === 'draft_add'[\s\S]{0,500}instagram-videos\/\$\{g\.userId\}\//.test(route3))
    check('the times already taken are read for the next free one', /planned_publish_at', 'publish_at'/.test(route3) && /busy,/.test(route3))
    check('the product check is behind the Drop switch and says when Amazon did not show it', /canUsePreview\('drop', intg\?\.tier\)/.test(read('app/api/drop/product/route.ts'))
      && /Amazon did not show this product just now/.test(read('app/api/drop/product/route.ts')) && /Could not check/.test(read('components/labs/DropProduct.tsx')))
    const setup = read('components/labs/DropSetup.tsx')
    const b2pre = () => read('components/labs/DropBoard.tsx')
    check('YouTube, Amazon or both is three plain choices, not a tick box', /'YouTube only'/.test(setup) && /'Amazon only'/.test(setup) && !/Also the US Amazon store/.test(setup))
    check('the setup sets the days and a first day, and each video follows them', /Nothing before/.test(setup) && /aria-label="Days videos go public"/.test(setup)
      && /\{ days: st\.days, notBefore: st\.notBefore \}/.test(b2pre()))
    check('the setup uses Liftoff’s own CTA, thumbnail and time pickers', /<CtaPicker /.test(setup) && /<ThumbnailPicker /.test(setup) && /<SlotEditor /.test(setup) && /\/api\/youtube\/playlists/.test(setup))
    const b2 = read('components/labs/DropBoard.tsx')
    check('each long video’s card has Liftoff’s own editor and its own time', /<ItemRowEditor /.test(b2) && /<ScheduleRow /.test(b2) && /<DropProduct /.test(b2))
    check('each video is given the next free time, not the batch pattern', /nextFreeSlots\(1, st\.dailySlots, timezone, takenTimes\(\)/.test(b2) && /schedule: \{ date: slot\.date, time: slot\.time \}/.test(b2))
    check('Launch waits for Liftoff and says so, and never launches an unsaved time', /Launch when ready/.test(b2) && /has a time you have not set/.test(b2) && /Save your setup first/.test(b2))
    check('the page only restores the drop on its first read', /const first = !restored\.current/.test(b2))
    check('a Liftoff video no card shows is taken out before Launch, or nothing launches', /const strays = \(draftBatch\?\.items \?\? \[\]\)\.filter\(\(i\) => !keep\.has\(i\.id\)\)/.test(b2) && /Nothing was launched\./.test(b2))
    const sql438 = read('supabase/migrations/438_drop_draft.sql')
    check('migration 438 is safe to run twice', /add column if not exists wish jsonb/.test(sql438) && /create index if not exists drops_draft_idx/.test(sql438))
  }

  // ── wiring for the places ──────────────────────────────────────────────────
  const route2 = read('app/api/drop/route.ts')
  check('a place is claimed from waiting, and its result written only from sending', /\.eq\('state', 'wanted'\)\.select\(SEND_COLS\)/.test(route2) && /send_done[\s\S]{0,900}\.eq\('state', 'sending'\)/.test(route2))
  check('each place keeps the creator’s own words and choices, plain values only', /function sendPayload\(/.test(route2) && /typeof v === 'boolean' \|\| \(typeof v === 'number'/.test(route2))
  const board = read('components/labs/DropBoard.tsx')
  check('the page reads TikTok’s account settings as the posting screen opens, and the real connections', /\/api\/blog\/tiktok-post\/creator-info/.test(board) && /\/api\/social\/connected/.test(board))
  check('only on TRYBE is never posted elsewhere anyway', /Only on TRYBE and also set to post on/.test(board))
  check('SCOUT’s background tab runs every place too', /dropSteps\(browserHttp, \(t\) => say\(`Drop: \$\{t\}`\), undefined, \{ videoPin/.test(read('components/launch/LiftoffRunner.tsx')))
  const sql437 = read('supabase/migrations/437_drop_places.sql')
  check('migration 437 makes drop_sends and drop_plans, safe to run twice', /create table if not exists public\.drop_sends/.test(sql437) && /create table if not exists public\.drop_plans/.test(sql437) && /unique \(drop_item_id, place\)/.test(sql437))

  if (failures.length) { console.error('❌ drop guard failed:\n  - ' + failures.join('\n  - ')); process.exit(1) }
  console.log('✓ drop guard passed')
})()
