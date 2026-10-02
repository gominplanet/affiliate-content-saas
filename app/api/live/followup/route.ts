// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/live/followup — Amazon Live follow-up (lib/live-followup.ts). Pro
// (lib/labs-preview.ts live_followup).
//
// GET                         the creator's follow-ups, newest first
// GET  ?id=                   one follow-up (without the transcript)
// POST { action: 'create', replayUrl, planId?, read }      read = what SCOUT found
// POST { action: 'transcribe', id }    pull the audio and transcribe it
// POST { action: 'match', id }         find each product's moment
// POST { action: 'frame', id, asin }   a still from the moment, and where the speaker is
// POST { action: 'clip', id, asin, cropX?, layout? }   cut that product's clip,
//                                      framed on the speaker (or where the creator set)
// POST { action: 'roundup', id }       the "everything I showed" post, as text
// POST { action: 'delete', id }
//
// Nothing here posts anywhere. Each step is its own request so none runs past
// the time limit, and each stores what happened, failure included.
// Needs migration 394.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { pickStream, wordsInWindow, composeRoundup, cropXForFace, type LiveMoment, type LiveProduct } from '@/lib/live-followup'
import { streamAudio, transcribeLive, matchMoments, renderLiveClip, liveFrame, findSpeaker } from '@/lib/live-followup-server'
import { resolveClipLinks } from '@/lib/reel-caption'
import { broadcastIdOf, parseLiveReplayHtml, vttToWordCues, type LiveReplayPage } from '@/lib/amazon-live-page'
import { fetchAmazonProduct } from '@/services/amazon'
import type { TranscriptCue } from '@/lib/shorts-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const COLS = 'id,plan_id,replay_url,title,stream_url,page_asins,duration_sec,audio_url,moments,missing,state,error,created_at,updated_at'
const missingTable = (m?: string) => /live_followups/.test(m || '') && /does not exist|could not find/i.test(m || '')

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('live_followup', intg?.tier)) return { error: NextResponse.json({ error: 'Live follow-up is part of Pro.', upgrade: true }, { status: 403 }) }
  return { userId: user.id as string, tier: (intg?.tier as string | null) ?? null }
}

export async function GET(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const { data, error } = await admin.from('live_followups').select(COLS).eq('id', id).eq('user_id', g.userId).maybeSingle()
    if (error) return NextResponse.json({ error: missingTable(error.message) ? 'Migration 394 has not been run.' : error.message, needsMigration: missingTable(error.message) ? 394 : undefined }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json({ followup: data })
  }
  const { data, error } = await admin.from('live_followups').select('id,title,state,error,moments,created_at').eq('user_id', g.userId).order('created_at', { ascending: false }).limit(20)
  if (error) return NextResponse.json({ error: missingTable(error.message) ? 'Migration 394 has not been run.' : error.message, needsMigration: missingTable(error.message) ? 394 : undefined, followups: [] })
  return NextResponse.json({ followups: data ?? [] })
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action || '')

  if (action === 'create') {
    const replayUrl = String(body.replayUrl || '').trim()
    if (!/^https:\/\/(www\.)?amazon\.com\/live\//i.test(replayUrl)) return NextResponse.json({ error: 'Paste the replay link from amazon.com/live.' }, { status: 400 })
    // THE BROADCAST, NAMED. Without its id the page cannot be read here, and
    // the stream would be whatever the request said it was: any https address,
    // fetched and transcribed by MVP's video service on MVP's account.
    const broadcastId = broadcastIdOf(replayUrl)
    if (!broadcastId) return NextResponse.json({ error: 'That link does not name a broadcast. Open the Live on amazon.com and copy the link from the address bar (it contains /live/broadcast/).' }, { status: 400 })
    const planId = typeof body.planId === 'string' && body.planId ? body.planId : null
    // 1. The replay page itself: its data names the stream, Amazon's captions
    //    and the products shown, with no login (lib/amazon-live-page).
    const page = await readReplayPage(replayUrl)
    // 2. What SCOUT read in the browser, when the page could not be read here.
    const read = (body.read || {}) as { streams?: unknown; asins?: unknown; title?: unknown; durationSec?: unknown }
    // Only Amazon's own video hosts, and only this broadcast's video.
    const amazonVideo = (x: string) => {
      try {
        const u = new URL(x)
        return u.protocol === 'https:' && /(?:^|\.)(?:cloudfront\.net|media-amazon\.com|amazon\.com|live-video\.net|amazonvideo\.com)$/i.test(u.hostname)
          && u.pathname.toLowerCase().includes(broadcastId)
      } catch { return false }
    }
    const scoutStreams = (Array.isArray(read.streams) ? read.streams : []).map(String).filter(amazonVideo).slice(0, 20)
    const stream = page.ok && page.data.streamUrl ? page.data.streamUrl : pickStream(scoutStreams)
    if (!stream) {
      return NextResponse.json({
        error: page.ok ? 'The replay page names no video for this Live. Is the replay finished processing on Amazon?' : `MVP could not read the replay page (${page.error}).`,
        tryScout: !body.read,
      }, { status: 422 })
    }
    const asins = page.ok && page.data.asins.length ? page.data.asins
      : (Array.isArray(read.asins) ? read.asins : []).map(String).filter((a) => /^[A-Z0-9]{10}$/.test(a)).slice(0, 60)
    // Amazon's own captions, when the replay has them: exact, free and
    // instant, so the transcription step is not needed.
    let cues: Array<{ start: number; end: number; text: string }> = []
    if (page.ok && page.data.captionUrl) {
      try {
        const r = await fetch(page.data.captionUrl, { signal: AbortSignal.timeout(15_000) })
        if (r.ok) cues = vttToWordCues(await r.text())
      } catch { /* the transcription step remains */ }
    }
    const { data, error } = await admin.from('live_followups').insert({
      user_id: g.userId, plan_id: planId, replay_url: replayUrl,
      title: ((page.ok && page.data.title) || String(read.title || '')).slice(0, 200) || null,
      stream_url: stream, streams: page.ok && page.data.streamUrl ? [page.data.streamUrl] : scoutStreams, page_asins: asins,
      duration_sec: (page.ok && page.data.durationSec) || (Number.isFinite(Number(read.durationSec)) ? Math.round(Number(read.durationSec)) : null),
      ...(cues.length ? { cues, state: 'transcribed' } : { state: 'read' }),
    }).select(COLS).single()
    if (error) return NextResponse.json({ error: missingTable(error.message) ? 'Migration 394 has not been run.' : error.message }, { status: 500 })
    return NextResponse.json({ followup: data, source: page.ok ? 'page' : 'scout', captions: cues.length ? 'amazon' : null, words: cues.length })
  }

  const id = String(body.id || '')
  const { data: row, error: rowErr } = await admin.from('live_followups').select('*').eq('id', id).eq('user_id', g.userId).maybeSingle()
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const save = async (patch: Record<string, unknown>) => {
    const { data } = await admin.from('live_followups').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select(COLS).single()
    return data
  }
  // A failure is stored on the row and returned, so the page shows the same
  // reason after a reload.
  const fail = async (error: string, status = 502) => NextResponse.json({ error, followup: await save({ error }) }, { status })

  if (action === 'delete') {
    await admin.from('live_followups').delete().eq('id', id).eq('user_id', g.userId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'transcribe') {
    const audio = await streamAudio(row.stream_url, g.userId)
    if (!audio.ok) return fail(audio.error)
    const t = await transcribeLive(audio.url, g.userId, g.tier)
    if (!t.ok) return fail(t.error)
    const last = t.cues[t.cues.length - 1]?.end ?? null
    const followup = await save({ audio_url: audio.url, cues: t.cues, duration_sec: audio.durationSec ?? row.duration_sec ?? (last ? Math.ceil(last) : null), state: 'transcribed', error: null })
    return NextResponse.json({ followup, words: t.cues.length })
  }

  if (action === 'match') {
    const cues = (Array.isArray(row.cues) ? row.cues : []) as TranscriptCue[]
    if (!cues.length) return NextResponse.json({ error: 'Transcribe the replay first.' }, { status: 409 })
    const { products, unnamed } = await productsFor(admin, g.userId, row.plan_id, row.page_asins ?? [])
    const m = await matchMoments(products, cues, row.duration_sec ?? null, g.userId, g.tier)
    if (!m.ok) return fail(m.error)
    // A product shown that MVP could not name cannot be looked for in speech:
    // it is listed with the ones not found, never dropped without a word.
    const missing = [...m.missing, ...unnamed.map((asin) => ({ asin, title: `${asin} (no product name found)` }))]
    // CLIPS AND FRAMING ALREADY MADE ARE KEPT. Finding the products again
    // replaced every moment, so each clip and every hand-set framing vanished
    // without a word. A product found at the same time keeps all of it; one
    // found at a new time keeps the framing (same Live, same set) but not the
    // clip, which was cut from the old window.
    const before = new Map(((Array.isArray(row.moments) ? row.moments : []) as LiveMoment[]).map((x) => [x.asin, x]))
    const merged = m.moments.map((mo) => {
      const old = before.get(mo.asin)
      if (!old) return mo
      const keepFrame = { cropX: old.cropX, framing: old.framing, layout: old.layout, frameUrl: old.frameUrl, frameAspect: old.frameAspect, frameNote: old.frameNote }
      return old.startSec === mo.startSec && old.endSec === mo.endSec
        ? { ...mo, ...keepFrame, clipUrl: old.clipUrl, clipError: old.clipError }
        : { ...mo, ...keepFrame }
    })
    const followup = await save({ moments: merged, missing, state: 'matched', error: null })
    return NextResponse.json({ followup })
  }

  // FRAMING. One still from the moment, and where the speaker is in it, so
  // the 9:16 window sits on them instead of the middle of the frame.
  const uid = g.userId as string
  const tier = g.tier
  async function autoFrame(mo: LiveMoment): Promise<LiveMoment> {
    const at = mo.startSec + Math.min(20, (mo.endSec - mo.startSec) * 0.3)
    const f = await liveFrame(row.stream_url, at, uid)
    if (!f.ok) return { ...mo, cropX: mo.cropX ?? 0.5, framing: 'centre', frameNote: f.error }
    const sp = await findSpeaker(f.url, uid, tier)
    const faceX = sp.ok ? sp.faceX : null
    return {
      ...mo, frameUrl: f.url, frameAspect: f.aspect,
      cropX: faceX == null ? 0.5 : cropXForFace(faceX, f.aspect),
      framing: faceX == null ? 'centre' : 'auto',
      layout: mo.layout ?? 'center',
      frameNote: sp.ok ? (faceX == null ? 'No face was clear in this frame, so the middle is used.' : null) : sp.error,
    }
  }

  if (action === 'frame' || action === 'clip') {
    const asin = String(body.asin || '').toUpperCase()
    const moments = (Array.isArray(row.moments) ? row.moments : []) as LiveMoment[]
    const i = moments.findIndex((x) => x.asin === asin)
    if (i < 0) return NextResponse.json({ error: 'That product has no moment in this replay.' }, { status: 404 })
    let mo = moments[i]
    // The creator's own framing wins; otherwise MVP finds the speaker once.
    const x = Number(body.cropX)
    if (Number.isFinite(x) && x >= 0 && x <= 1) mo = { ...mo, cropX: Math.round(x * 1000) / 1000, framing: 'manual' }
    if (body.layout === 'split' || body.layout === 'center') mo = { ...mo, layout: body.layout }
    if (action === 'frame' || mo.cropX == null || body.refind === true) {
      const keepManual = mo.framing === 'manual' && action === 'clip' && body.refind !== true
      const framed = await autoFrame(mo)
      mo = keepManual ? { ...framed, cropX: mo.cropX, framing: 'manual' } : framed
    }
    if (action === 'frame') {
      moments[i] = mo
      return NextResponse.json({ followup: await save({ moments }) })
    }
    const words = wordsInWindow((Array.isArray(row.cues) ? row.cues : []) as TranscriptCue[], mo.startSec, mo.endSec)
    const r = await renderLiveClip(row.stream_url, mo.startSec, mo.endSec, words, g.userId, { cropX: mo.cropX, layout: mo.layout })
    moments[i] = { ...mo, clipUrl: r.ok ? r.url : (mo.clipUrl ?? null), clipError: r.ok ? null : r.error }
    const followup = await save({ moments })
    return r.ok ? NextResponse.json({ followup, clipUrl: r.url }) : NextResponse.json({ error: r.error, followup }, { status: 502 })
  }

  if (action === 'roundup') {
    const moments = (Array.isArray(row.moments) ? row.moments : []) as LiveMoment[]
    const products: Array<{ asin: string; title: string }> = moments.length
      ? moments.map((m) => ({ asin: m.asin, title: m.title }))
      : (await productsFor(admin, g.userId, row.plan_id, row.page_asins ?? [])).products.map((p) => ({ asin: p.asin, title: p.title }))
    if (!products.length) return NextResponse.json({ error: 'No products to list yet.' }, { status: 409 })
    let disclosure = ''
    const items: Array<{ title: string; link: string | null }> = []
    for (const p of products) {
      const links = await resolveClipLinks(admin, g.userId, { product: p.asin, productName: p.title, channel: 'facebook' })
      disclosure = disclosure || links.disclosure
      items.push({ title: p.title, link: links.productLink })
    }
    const noLink = items.filter((x) => !x.link).map((x) => x.title)
    return NextResponse.json({ text: composeRoundup({ title: row.title, items, disclosure }), noLink })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}

/** What to look for: the products the replay page lists, in the order shown,
 *  then any in the show plan the page did not list. Each is named from the
 *  plan, the creator's storefront, videos and campaigns, then Amazon's page.
 *  Products no source could name come back as `unnamed`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function productsFor(admin: any, userId: string, planId: string | null, pageAsins: string[]): Promise<{ products: LiveProduct[]; unnamed: string[] }> {
  const plan = new Map<string, { title: string; plannedMin: number | null }>()
  if (planId) {
    const { data } = await admin.from('live_plans').select('plan').eq('id', planId).eq('user_id', userId).maybeSingle()
    for (const s of (Array.isArray(data?.plan?.segments) ? data.plan.segments : []) as Array<{ asin?: string; title?: string; startMin?: number }>) {
      const asin = String(s.asin || '').toUpperCase()
      if (/^[A-Z0-9]{10}$/.test(asin) && !plan.has(asin)) plan.set(asin, { title: String(s.title || ''), plannedMin: Number.isFinite(Number(s.startMin)) ? Number(s.startMin) : null })
    }
  }
  const order = [...new Set([...pageAsins.map((a) => a.toUpperCase()), ...plan.keys()])]
  const names = new Map<string, string>()
  for (const [a, p] of plan) if (p.title) names.set(a, p.title)
  const need = () => order.filter((a) => !names.get(a))
  const fill = (rows: Array<{ asin: string | null; title: string | null }> | null | undefined) => {
    for (const r of rows ?? []) { const a = String(r.asin || '').toUpperCase(); if (a && r.title && !names.get(a)) names.set(a, String(r.title)) }
  }
  if (need().length) fill((await admin.from('storefront_catalog').select('asin,title').eq('user_id', userId).in('asin', need())).data)
  if (need().length) fill((await admin.from('youtube_videos').select('asin,title').eq('user_id', userId).in('asin', need())).data)
  if (need().length) fill(((await admin.from('campaigns').select('asin,product_title').eq('user_id', userId).in('asin', need())).data ?? []).map((r: { asin: string; product_title: string | null }) => ({ asin: r.asin, title: r.product_title })))
  // Amazon's own product page, for what is still unnamed (a few at a time).
  const rest = need().slice(0, 30)
  for (let i = 0; i < rest.length; i += 6) {
    await Promise.all(rest.slice(i, i + 6).map(async (a) => {
      const p = await Promise.race([fetchAmazonProduct(a).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 9000))])
      if (p?.title) names.set(a, p.title)
    }))
  }
  const products: LiveProduct[] = []
  const unnamed: string[] = []
  for (const a of order) {
    const t = names.get(a)
    if (t) products.push({ asin: a, title: t, plannedMin: plan.get(a)?.plannedMin ?? null })
    else unnamed.push(a)
  }
  return { products, unnamed }
}

/** The replay page, read here. Amazon serves it without a login. */
async function readReplayPage(url: string): Promise<{ ok: true; data: LiveReplayPage } | { ok: false; error: string }> {
  const id = broadcastIdOf(url)
  if (!id) return { ok: false, error: 'that is not a broadcast link' }
  try {
    const r = await fetch(`https://www.amazon.com/live/broadcast/${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(20_000), cache: 'no-store',
    })
    if (!r.ok) return { ok: false, error: `Amazon answered ${r.status}` }
    const html = await r.text()
    if (/captcha|robot check/i.test(html.slice(0, 20000)) && !/VideoObject/.test(html)) return { ok: false, error: 'Amazon showed a robot check' }
    return { ok: true, data: parseLiveReplayHtml(html, id) }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 120) }
  }
}
