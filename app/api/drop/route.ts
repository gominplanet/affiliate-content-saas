// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/drop — the creator's recent drops, each video's wishes and
//                  results, and the last Liftoff batch whose choices a new
//                  drop copies.
// POST /api/drop — { action } — make a drop, link it to the Liftoff batch it
//                  built, move its state, and record each blog and TRYBE result.
//
// Drop (Labs, admin while it is tested; lib/drop-plan). This route only keeps
// the record. The work goes through the routes that already do it: Liftoff's
// batch routes, /api/blog/schedule-publish, and SCOUT for TRYBE. Each result
// is written after that route or SCOUT answered, never before.
//
// CLAIMED, NOT RACED. The Drop page and SCOUT's background tab can both look
// at the same drop. A blog post or a TRYBE send starts only for the caller
// whose claim moved the row out of its waiting state, so neither is done twice.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { DROP_MAX, EXTRA_PLACES, placeFits, type LastBatch } from '@/lib/drop-plan'

export const runtime = 'nodejs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

const DROP_STATES = ['building', 'preparing', 'needs_you', 'launched', 'done', 'failed'] as const
const TRYBE_DONE = ['in_review', 'sent_unconfirmed', 'failed'] as const
const missing = (m?: string) => /drops|drop_items/.test(m || '') && /does not exist|could not find|schema cache/i.test(m || '')
const NEEDS_SQL = 'Drop needs migration 436 in the database first.'
const PLACES_SQL = 'TikTok, Instagram, Shorts, pins, Group posts, clips and saved plans need migration 437 in the database first.'
const missingPlaces = (m?: string) => /drop_sends|drop_plans/.test(m || '') && /does not exist|could not find|schema cache/i.test(m || '')
const SEND_COLS = 'id,drop_item_id,drop_id,place,state,detail,url,ref_id,payload,at,updated_at'
/** The places a drop_sends row may name (lib/drop-plan PLACES). */
const SEND_PLACES = new Set<string>(EXTRA_PLACES)
const SEND_DONE = ['done', 'failed', 'needs_you'] as const
/** A blog post or TRYBE send quiet this long stopped with the page that ran
 *  it (lib/drop-plan STALE_MS). */
const STALE_MS = 20 * 60_000

const DROP_COLS = 'id,name,state,note,batch_id,settings_from,launched_at,created_at,updated_at'
const ITEM_COLS = 'id,drop_id,position,file_name,source_url,mime_type,size_bytes,duration_seconds,width,height,kind,asin,title,to_liftoff,to_blog,to_trybe,launch_item_id,'
  + 'blog_state,blog_detail,blog_post_id,blog_url,blog_at,trybe_state,trybe_brand_id,trybe_brand_name,trybe_program_id,trybe_angle_id,trybe_product_ids,trybe_exclusive,trybe_notes,'
  + 'trybe_submission_id,trybe_detail,trybe_steps,trybe_at,updated_at'

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: intg } = await (supabase as Sb).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('drop', intg?.tier)) return { error: NextResponse.json({ error: 'Drop is still being tested.' }, { status: 403 }) }
  return { userId: user.id as string, sb: supabase as Sb }
}

/** The last Liftoff batch the creator actually launched: its choices are the
 *  ones they stood behind. Read with the creator's own session. */
async function lastLaunched(sb: Sb, userId: string): Promise<(LastBatch & { created_at: string }) | null> {
  const base = 'id,name,created_at,cta,cta_chosen,thumbnail,thumbnail_chosen,markets,daily_slots,timezone'
  const { data } = await sb.from('launch_batches').select(base).eq('user_id', userId)
    .in('state', ['launching', 'launched']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  // The later columns one at a time: a database without one still copies the rest.
  const extra: Record<string, unknown> = {}
  for (const col of ['notify_subscribers', 'playlist_id', 'studio_options', 'send_to_youtube', 'youtube_channel_id']) {
    const { data: r, error } = await sb.from('launch_batches').select(col).eq('id', data.id).maybeSingle()
    if (!error && r) extra[col] = r[col]
  }
  return { ...data, ...extra }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const admin = createAdminClient() as Sb
  const { data: drops, error } = await admin.from('drops').select(DROP_COLS).eq('user_id', g.userId)
    .order('created_at', { ascending: false }).limit(8)
  const available = !error
  if (error && !missing(error.message)) return NextResponse.json({ error: error.message }, { status: 500 })
  let items: Array<Record<string, unknown>> = []
  const ids = (drops ?? []).map((d: { id: string }) => d.id)
  if (ids.length) {
    const { data: rows, error: iErr } = await admin.from('drop_items').select(ITEM_COLS).in('drop_id', ids).order('position', { ascending: true })
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })
    items = rows ?? []
  }
  // Every other place each video goes (migration 437), on its own read: a
  // database without it still shows the drops, and says the places need it.
  let sends: Array<Record<string, unknown>> = []
  let placesAvailable = true
  if (ids.length) {
    const { data: srows, error: sErr } = await admin.from('drop_sends').select(SEND_COLS).in('drop_id', ids)
    if (sErr) placesAvailable = false
    else sends = srows ?? []
  } else {
    const { error: sErr } = await admin.from('drop_sends').select('id').limit(1)
    if (sErr) placesAvailable = false
  }
  const { data: planRow, error: pErr } = await admin.from('drop_plans').select('plans').eq('user_id', g.userId).maybeSingle()
  if (pErr) placesAvailable = false
  const last = await lastLaunched(g.sb, g.userId)
  // A blog post needs a site to go to; said before Launch, not after.
  const { data: site } = await admin.from('wordpress_sites').select('id').eq('user_id', g.userId).limit(1).maybeSingle()
  return NextResponse.json({
    ok: true,
    available,
    needs: available ? null : NEEDS_SQL,
    last,
    hasBlogSite: !!site,
    max: DROP_MAX,
    placesAvailable,
    placesNeed: placesAvailable ? null : PLACES_SQL,
    plans: (planRow?.plans as Record<string, unknown> | undefined) ?? null,
    drops: (drops ?? []).map((d: { id: string }) => ({
      ...d,
      items: items.filter((i) => i.drop_id === d.id).map((i) => ({ ...i, sends: sends.filter((x) => x.drop_item_id === i.id) })),
    })),
  })
}

interface NewItem {
  fileName?: string; sourceUrl?: string; mimeType?: string; sizeBytes?: number; durationSeconds?: number; width?: number; height?: number
  kind?: string; asin?: string; title?: string; toLiftoff?: boolean; toBlog?: boolean; toTrybe?: boolean
  /** Every other place this video goes (lib/drop-plan EXTRA_PLACES). */
  places?: string[]
  trybe?: { brandId?: string; brandName?: string; programId?: string | null; angleId?: string | null; productIds?: string[]; exclusive?: boolean; notes?: string }
}

const s = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null
const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null)

/** The TRYBE choice for one video, as columns. */
function trybeCols(t: NewItem['trybe'] | undefined) {
  return {
    trybe_brand_id: s(t?.brandId, 80), trybe_brand_name: s(t?.brandName, 120),
    trybe_program_id: s(t?.programId, 120), trybe_angle_id: s(t?.angleId, 80),
    trybe_product_ids: Array.isArray(t?.productIds) ? t!.productIds.map((x) => String(x).slice(0, 80)).slice(0, 10) : [],
    trybe_exclusive: t?.exclusive === true, trybe_notes: s(t?.notes, 2000),
  }
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const admin = createAdminClient() as Sb
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action || '')
  const now = new Date().toISOString()
  const fail = (e: { message?: string } | null, status = 500) =>
    NextResponse.json({ error: missing(e?.message) ? NEEDS_SQL : (e?.message || 'Not saved.') }, { status: missing(e?.message) ? 503 : status })

  // ── a new drop ────────────────────────────────────────────────────────────
  if (action === 'create') {
    const list = (Array.isArray(body.items) ? body.items : []) as NewItem[]
    if (list.length === 0) return NextResponse.json({ error: 'Add a video first.' }, { status: 400 })
    if (list.length > DROP_MAX) return NextResponse.json({ error: `A drop holds ${DROP_MAX} videos.` }, { status: 400 })
    // THIS CREATOR'S OWN FILES in this project's storage, the same rule
    // Liftoff holds a video to: the drop hands these to YouTube, Amazon and
    // TRYBE with nobody watching.
    const own = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/instagram-videos/${g.userId}/`
    const bad = list.find((i) => !String(i.sourceUrl || '').startsWith(own))
    if (bad) return NextResponse.json({ error: `${bad.fileName || 'A video'} is not one of your uploads in MVP. Add it again.` }, { status: 400 })
    const { data: drop, error } = await admin.from('drops').insert({
      user_id: g.userId, name: s(body.name, 120) || 'Drop', state: 'building',
    }).select('id').single()
    if (error || !drop) return fail(error)
    const rows = list.map((i, position) => {
      const kind = i.kind === 'vertical' ? 'vertical' : 'long'
      const toLiftoff = kind === 'long' && i.toLiftoff === true
      // The blog writes from the YouTube video, so it only follows Liftoff.
      const toBlog = toLiftoff && i.toBlog === true
      const toTrybe = i.toTrybe === true && !!s(i.trybe?.brandId, 80)
      return {
        drop_id: drop.id, user_id: g.userId, position,
        file_name: s(i.fileName, 240), source_url: s(i.sourceUrl, 1000), mime_type: s(i.mimeType, 80),
        size_bytes: n(i.sizeBytes), duration_seconds: n(i.durationSeconds), width: n(i.width), height: n(i.height), kind,
        asin: s(i.asin, 300), title: s(i.title, 200),
        to_liftoff: toLiftoff, to_blog: toBlog, to_trybe: toTrybe,
        blog_state: toBlog ? 'wanted' : 'off', trybe_state: toTrybe ? 'wanted' : 'off',
        ...trybeCols(toTrybe ? i.trybe : undefined),
      }
    })
    const { data: made, error: iErr } = await admin.from('drop_items').insert(rows).select('id,position')
    if (iErr) {
      await admin.from('drops').delete().eq('id', drop.id)
      return fail(iErr)
    }
    // THE OTHER PLACES, one row each, only where the place fits the video
    // (a clip is cut from a long video, a TikTok is a vertical one).
    const sendRows: Array<Record<string, unknown>> = []
    for (const m of (made ?? []) as Array<{ id: string; position: number }>) {
      const it = list[m.position]
      const kind = rows[m.position].kind as 'long' | 'vertical'
      const toLiftoff = rows[m.position].to_liftoff
      for (const place of new Set((Array.isArray(it?.places) ? it.places : []).map(String))) {
        if (!SEND_PLACES.has(place) || !placeFits(place, kind, toLiftoff)) continue
        sendRows.push({ drop_item_id: m.id, drop_id: drop.id, user_id: g.userId, place, state: 'wanted' })
      }
    }
    let placesSaved = true
    if (sendRows.length) {
      const { error: sErr } = await admin.from('drop_sends').insert(sendRows)
      if (sErr) placesSaved = false
    }
    // Nothing for Liftoff: the drop has no batch to build.
    if (!rows.some((r) => r.to_liftoff)) await admin.from('drops').update({ state: 'launched', launched_at: now, updated_at: now }).eq('id', drop.id)
    // SAID, NOT DROPPED: places asked for that could not be kept.
    return NextResponse.json({ ok: true, id: drop.id, items: made ?? [], places: sendRows.length, placesSaved,
      ...(placesSaved ? {} : { placesError: PLACES_SQL }) })
  }

  // Everything below acts on one of this creator's drops or videos.
  const dropId = s(body.dropId, 60)
  const itemId = s(body.itemId, 60)

  if (action === 'link') {
    if (!dropId) return NextResponse.json({ error: 'No drop.' }, { status: 400 })
    const state = DROP_STATES.includes(body.state as typeof DROP_STATES[number]) ? body.state : 'preparing'
    const { error } = await admin.from('drops').update({
      batch_id: s(body.batchId, 60), settings_from: s(body.settingsFrom, 60), state, note: s(body.note, 1000), updated_at: now,
    }).eq('id', dropId).eq('user_id', g.userId)
    if (error) return fail(error)
    for (const l of (Array.isArray(body.links) ? body.links : []) as Array<{ id?: string; launchItemId?: string }>) {
      if (!l?.id || !l.launchItemId) continue
      await admin.from('drop_items').update({ launch_item_id: l.launchItemId, updated_at: now }).eq('id', l.id).eq('user_id', g.userId)
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'state') {
    if (!dropId || !DROP_STATES.includes(body.state as typeof DROP_STATES[number])) return NextResponse.json({ error: 'No drop or state.' }, { status: 400 })
    const patch: Record<string, unknown> = { state: body.state, note: s(body.note, 1000), updated_at: now }
    if (body.state === 'launched') patch.launched_at = now
    const { error } = await admin.from('drops').update(patch).eq('id', dropId).eq('user_id', g.userId)
    return error ? fail(error) : NextResponse.json({ ok: true })
  }

  if (action === 'plans_save') {
    const plans = (body.plans && typeof body.plans === 'object') ? body.plans as Record<string, unknown> : null
    if (!plans) return NextResponse.json({ error: 'No plan.' }, { status: 400 })
    const clean: Record<string, string[]> = {}
    for (const kind of ['long', 'vertical']) {
      const list = Array.isArray(plans[kind]) ? (plans[kind] as unknown[]).map(String) : []
      clean[kind] = [...new Set(list)].filter((x) => x === 'liftoff' || x === 'blog' || x === 'trybe' || SEND_PLACES.has(x)).slice(0, 20)
    }
    const { error } = await admin.from('drop_plans').upsert({ user_id: g.userId, plans: clean, updated_at: now }, { onConflict: 'user_id' })
    if (error) return NextResponse.json({ error: missingPlaces(error.message) ? PLACES_SQL : error.message }, { status: missingPlaces(error.message) ? 503 : 500 })
    return NextResponse.json({ ok: true, plans: clean })
  }

  // ── one other place for one video: claimed, progress, result ─────────────
  const sendId = s(body.sendId, 60)
  if (action === 'send_claim' || action === 'send_step' || action === 'send_done' || action === 'send_again') {
    if (!sendId) return NextResponse.json({ error: 'No place.' }, { status: 400 })
    const sendFail = (e: { message?: string }) => NextResponse.json({ error: missingPlaces(e.message) ? PLACES_SQL : e.message }, { status: missingPlaces(e.message) ? 503 : 500 })
    const row = () => admin.from('drop_sends').update({ updated_at: now }).eq('id', sendId).eq('user_id', g.userId)
    if (action === 'send_claim') {
      // `again`: one that stopped with its page, quiet past STALE_MS.
      let { data, error } = await admin.from('drop_sends').update({ state: 'sending', detail: null, updated_at: now })
        .eq('id', sendId).eq('user_id', g.userId).eq('state', 'wanted').select(SEND_COLS)
      if (!error && (data ?? []).length === 0 && body.again === true) {
        ({ data, error } = await admin.from('drop_sends').update({ state: 'sending', detail: null, updated_at: now })
          .eq('id', sendId).eq('user_id', g.userId).eq('state', 'sending').lt('updated_at', new Date(Date.now() - STALE_MS).toISOString()).select(SEND_COLS))
      }
      if (error) return sendFail(error)
      return NextResponse.json({ ok: true, claimed: (data ?? []).length === 1, send: (data ?? [])[0] ?? null })
    }
    if (action === 'send_step') {
      await row().update({ detail: s(body.detail, 300), updated_at: now }).eq('state', 'sending')
      return NextResponse.json({ ok: true })
    }
    if (action === 'send_done') {
      const state = SEND_DONE.includes(body.state as typeof SEND_DONE[number]) ? body.state : 'failed'
      const patch: Record<string, unknown> = { state, detail: s(body.detail, 600), url: s(body.url, 1000), ref_id: s(body.refId, 200), at: now, updated_at: now }
      if (body.payload && typeof body.payload === 'object') patch.payload = body.payload
      // Back to waiting: a step that needs YouTube first, or a later pass.
      if (body.state === 'wanted') patch.state = 'wanted'
      const { error } = await admin.from('drop_sends').update(patch).eq('id', sendId).eq('user_id', g.userId).eq('state', 'sending')
      return error ? sendFail(error) : NextResponse.json({ ok: true })
    }
    // send_again: a place that failed or needs the creator goes back in line,
    // and a finished drop opens again so a pass looks at it.
    const { data, error } = await admin.from('drop_sends').update({ state: 'wanted', detail: null, updated_at: now })
      .eq('id', sendId).eq('user_id', g.userId).in('state', ['failed', 'needs_you']).select('id,drop_id')
    if (error) return sendFail(error)
    const r = (data ?? [])[0] as { drop_id?: string } | undefined
    if (r?.drop_id) await admin.from('drops').update({ state: 'launched', updated_at: now }).eq('id', r.drop_id).eq('user_id', g.userId).eq('state', 'done')
    return NextResponse.json({ ok: true, queued: !!r })
  }

  if (action === 'delete') {
    if (!dropId) return NextResponse.json({ error: 'No drop.' }, { status: 400 })
    // The record only. The Liftoff batch, the blog posts and anything sent to
    // TRYBE stay where they went.
    const { error } = await admin.from('drops').delete().eq('id', dropId).eq('user_id', g.userId)
    return error ? fail(error) : NextResponse.json({ ok: true })
  }

  if (!itemId) return NextResponse.json({ error: 'No video.' }, { status: 400 })

  // ── the blog post: claimed, then its result ───────────────────────────────
  if (action === 'blog_claim') {
    const { data, error } = await admin.from('drop_items').update({ blog_state: 'writing', blog_detail: null, updated_at: now })
      .eq('id', itemId).eq('user_id', g.userId).eq('to_blog', true).eq('blog_state', 'wanted').select('id')
    if (error) return fail(error)
    return NextResponse.json({ ok: true, claimed: (data ?? []).length === 1 })
  }
  if (action === 'blog_again') {
    // Back in line for the next pass: a post that failed, or one whose page
    // closed before the answer came and has been quiet long enough that
    // nobody is still writing it.
    const back = () => admin.from('drop_items').update({ blog_state: 'wanted', blog_detail: null, updated_at: now })
      .eq('id', itemId).eq('user_id', g.userId).eq('to_blog', true)
    let { data, error } = await back().eq('blog_state', 'failed').select('id,drop_id')
    if (!error && (data ?? []).length === 0) ({ data, error } = await back().eq('blog_state', 'writing').lt('updated_at', new Date(Date.now() - STALE_MS).toISOString()).select('id,drop_id'))
    if (error) return fail(error)
    const row = (data ?? [])[0] as { drop_id?: string } | undefined
    // A finished drop opens again, or no pass would look at it.
    if (row?.drop_id) await admin.from('drops').update({ state: 'launched', updated_at: now }).eq('id', row.drop_id).eq('user_id', g.userId).eq('state', 'done')
    return NextResponse.json({ ok: true, queued: !!row })
  }
  if (action === 'blog_done') {
    const ok = body.ok === true
    const { error } = await admin.from('drop_items').update({
      blog_state: ok ? 'scheduled' : 'failed', blog_detail: s(body.detail, 600),
      blog_post_id: ok ? s(body.postId, 60) : null, blog_url: ok ? s(body.url, 600) : null, blog_at: ok ? s(body.at, 40) : null, updated_at: now,
    }).eq('id', itemId).eq('user_id', g.userId).eq('blog_state', 'writing')
    return error ? fail(error) : NextResponse.json({ ok: true })
  }

  // ── TRYBE: chosen, claimed, progress, result ──────────────────────────────
  if (action === 'trybe_set') {
    // The brand and choices for a vertical video, before or after the drop.
    const t = body.trybe as NewItem['trybe']
    if (!s(t?.brandId, 80)) return NextResponse.json({ error: 'Pick a brand.' }, { status: 400 })
    const { error } = await admin.from('drop_items').update({ to_trybe: true, ...trybeCols(t), updated_at: now })
      .eq('id', itemId).eq('user_id', g.userId).in('trybe_state', ['off', 'wanted', 'failed'])
    if (error) return fail(error)
    await admin.from('drop_items').update({ trybe_state: 'wanted' }).eq('id', itemId).eq('user_id', g.userId).eq('trybe_state', 'off')
    return NextResponse.json({ ok: true })
  }
  if (action === 'trybe_claim') {
    // A send that stopped with the page, or one TRYBE took without listing
    // it yet, goes again only when the creator says so.
    const from = body.again === true ? ['wanted', 'failed', 'sent_unconfirmed'] : ['wanted', 'failed']
    const claim = () => admin.from('drop_items').update({ trybe_state: 'sending', trybe_detail: 'Starting', trybe_steps: [], trybe_at: now, updated_at: now })
      .eq('id', itemId).eq('user_id', g.userId).eq('to_trybe', true)
    let { data, error } = await claim().in('trybe_state', from).select(ITEM_COLS)
    if (!error && (data ?? []).length === 0 && body.again === true) {
      ({ data, error } = await claim().eq('trybe_state', 'sending').lt('updated_at', new Date(Date.now() - STALE_MS).toISOString()).select(ITEM_COLS))
    }
    if (error) return fail(error)
    return NextResponse.json({ ok: true, claimed: (data ?? []).length === 1, item: (data ?? [])[0] ?? null })
  }
  if (action === 'trybe_step') {
    await admin.from('drop_items').update({ trybe_detail: s(body.detail, 300), updated_at: now })
      .eq('id', itemId).eq('user_id', g.userId).eq('trybe_state', 'sending')
    return NextResponse.json({ ok: true })
  }
  if (action === 'trybe_done') {
    const state = TRYBE_DONE.includes(body.state as typeof TRYBE_DONE[number]) ? body.state : 'failed'
    const steps = (Array.isArray(body.steps) ? body.steps : []).map((x) => String(x).slice(0, 300)).slice(-60)
    const { error } = await admin.from('drop_items').update({
      trybe_state: state, trybe_submission_id: s(body.submissionId, 80), trybe_detail: s(body.detail, 600), trybe_steps: steps, trybe_at: now, updated_at: now,
    }).eq('id', itemId).eq('user_id', g.userId).eq('trybe_state', 'sending')
    return error ? fail(error) : NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
