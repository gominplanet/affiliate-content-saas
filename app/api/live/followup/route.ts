// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/live/followup — Amazon Live follow-up (lib/live-followup.ts). LABS,
// admin only while it is tested (lib/labs-preview.ts live_followup).
//
// GET                         the creator's follow-ups, newest first
// GET  ?id=                   one follow-up (without the transcript)
// POST { action: 'create', replayUrl, planId?, read }      read = what SCOUT found
// POST { action: 'transcribe', id }    pull the audio and transcribe it
// POST { action: 'match', id }         find each product's moment
// POST { action: 'clip', id, asin }    cut that product's clip
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
import { pickStream, wordsInWindow, composeRoundup, type LiveMoment, type LiveProduct } from '@/lib/live-followup'
import { streamAudio, transcribeLive, matchMoments, renderLiveClip } from '@/lib/live-followup-server'
import { resolveClipLinks } from '@/lib/reel-caption'
import type { TranscriptCue } from '@/lib/shorts-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const COLS = 'id,plan_id,replay_url,title,stream_url,page_asins,duration_sec,moments,missing,state,error,created_at,updated_at'
const missingTable = (m?: string) => /live_followups/.test(m || '') && /does not exist|could not find/i.test(m || '')

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('live_followup', intg?.tier)) return { error: NextResponse.json({ error: 'Live follow-up is still being tested.' }, { status: 403 }) }
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
    const read = (body.read || {}) as { streams?: unknown; asins?: unknown; title?: unknown; durationSec?: unknown }
    const streams = (Array.isArray(read.streams) ? read.streams : []).map(String).filter((s) => /^https:\/\//i.test(s)).slice(0, 20)
    const stream = pickStream(streams)
    if (!stream) return NextResponse.json({ error: 'SCOUT found no video stream on that page.' }, { status: 422 })
    const planId = typeof body.planId === 'string' && body.planId ? body.planId : null
    const { data, error } = await admin.from('live_followups').insert({
      user_id: g.userId, plan_id: planId, replay_url: replayUrl, title: String(read.title || '').slice(0, 200) || null,
      stream_url: stream, streams, page_asins: (Array.isArray(read.asins) ? read.asins : []).map(String).filter((a) => /^[A-Z0-9]{10}$/.test(a)).slice(0, 60),
      duration_sec: Number.isFinite(Number(read.durationSec)) ? Math.round(Number(read.durationSec)) : null, state: 'read',
    }).select(COLS).single()
    if (error) return NextResponse.json({ error: missingTable(error.message) ? 'Migration 394 has not been run.' : error.message }, { status: 500 })
    return NextResponse.json({ followup: data })
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
    const products = await productsFor(admin, g.userId, row.plan_id, row.page_asins ?? [])
    const m = await matchMoments(products, cues, row.duration_sec ?? null, g.userId, g.tier)
    if (!m.ok) return fail(m.error)
    const followup = await save({ moments: m.moments, missing: m.missing, state: 'matched', error: null })
    return NextResponse.json({ followup })
  }

  if (action === 'clip') {
    const asin = String(body.asin || '').toUpperCase()
    const moments = (Array.isArray(row.moments) ? row.moments : []) as LiveMoment[]
    const i = moments.findIndex((x) => x.asin === asin)
    if (i < 0) return NextResponse.json({ error: 'That product has no moment in this replay.' }, { status: 404 })
    const mo = moments[i]
    const words = wordsInWindow((Array.isArray(row.cues) ? row.cues : []) as TranscriptCue[], mo.startSec, mo.endSec)
    const r = await renderLiveClip(row.stream_url, mo.startSec, mo.endSec, words, g.userId)
    moments[i] = { ...mo, clipUrl: r.ok ? r.url : (mo.clipUrl ?? null), clipError: r.ok ? null : r.error }
    const followup = await save({ moments })
    return r.ok ? NextResponse.json({ followup, clipUrl: r.url }) : NextResponse.json({ error: r.error, followup }, { status: 502 })
  }

  if (action === 'roundup') {
    const moments = (Array.isArray(row.moments) ? row.moments : []) as LiveMoment[]
    const products: Array<{ asin: string; title: string }> = moments.length
      ? moments.map((m) => ({ asin: m.asin, title: m.title }))
      : (await productsFor(admin, g.userId, row.plan_id, row.page_asins ?? [])).map((p) => ({ asin: p.asin, title: p.title }))
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

/** What to look for: the show plan's products in order, then anything else
 *  the replay page listed, named from the creator's storefront where known. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function productsFor(admin: any, userId: string, planId: string | null, pageAsins: string[]): Promise<LiveProduct[]> {
  const out: LiveProduct[] = []
  const seen = new Set<string>()
  if (planId) {
    const { data } = await admin.from('live_plans').select('plan').eq('id', planId).eq('user_id', userId).maybeSingle()
    const segs = Array.isArray(data?.plan?.segments) ? data.plan.segments : []
    for (const s of segs as Array<{ asin?: string; title?: string; startMin?: number }>) {
      const asin = String(s.asin || '').toUpperCase()
      if (!/^[A-Z0-9]{10}$/.test(asin) || seen.has(asin)) continue
      seen.add(asin)
      out.push({ asin, title: String(s.title || asin), plannedMin: Number.isFinite(Number(s.startMin)) ? Number(s.startMin) : null })
    }
  }
  const extra = pageAsins.filter((a) => !seen.has(a))
  if (extra.length) {
    const { data } = await admin.from('storefront_catalog').select('asin,title').eq('user_id', userId).in('asin', extra)
    const titles = new Map(((data ?? []) as Array<{ asin: string; title: string | null }>).map((r) => [r.asin, r.title]))
    // A product the page listed but the storefront cannot name cannot be
    // found in speech either, so it is left out rather than guessed at.
    for (const a of extra) {
      const t = titles.get(a)
      if (t) out.push({ asin: a, title: t })
    }
  }
  return out
}
