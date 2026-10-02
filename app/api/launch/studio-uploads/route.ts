// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/launch/studio-uploads  the creator's Liftoff videos waiting for
//                                  SCOUT to upload them through YouTube Studio.
// POST /api/launch/studio-uploads  { itemId, claim: true }  SCOUT is starting one.
//                                  { itemId, result }       how it went.
//
// See lib/studio-upload for why. The server never uploads these rows; the
// drain picks each one up again once it has the id SCOUT reports here, and
// goes on as for any other upload (read back, time, thumbnail, playlist,
// pinned comment, Amazon).
//
// ONE UPLOAD PER VIDEO. A row is claimed on the try count it was read with,
// so two tabs cannot both start it, and the id is written only where there is
// none, so a late report can never replace a video already recorded.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeStudioOptions, storeStudioRun } from '@/lib/studio-finish'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'
import { ytFetch } from '@/lib/youtube-quota'
import {
  usesStudioUpload, isStudioRunning, cleanVideoId, studioUploadFailureText, studioDid, studioStoppedAt,
  DRAFT_REASON_PREFIX, STUDIO_DRAFT_SAVING, STUDIO_DRAFT_FAILED,
  STUDIO_UPLOAD_RUNNING, STUDIO_UPLOAD_DONE, STUDIO_UPLOAD_CLAIM_MS, STUDIO_UPLOAD_TRIES,
} from '@/lib/studio-upload'

export const runtime = 'nodejs'
export const maxDuration = 60

type Row = {
  id: string; batch_id: string; title: string | null; description: string | null; tags: string | null
  rendered_url: string | null; planned_publish_at: string | null; publish_tries: number | null
  reason: string | null; updated_at: string | null; youtube_video_id: string | null; state: string
  thumbnail_url?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gate(): Promise<{ user: { id: string }; sb: any } | NextResponse> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: integ } = await sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!usesStudioUpload(integ?.tier)) return NextResponse.json({ ok: true, on: false, items: [] })
  return { user, sb }
}

export async function GET() {
  const g = await gate()
  if (g instanceof NextResponse) return g
  const { user, sb } = g
  const { data: rows, error } = await sb.from('launch_items')
    .select('id,batch_id,title,description,tags,rendered_url,thumbnail_url,planned_publish_at,publish_tries,reason,updated_at,youtube_video_id,state')
    .eq('user_id', user.id).eq('state', 'prepared').is('youtube_video_id', null)
    .not('planned_publish_at', 'is', null).not('rendered_url', 'is', null)
    .order('planned_publish_at', { ascending: true }).limit(20)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  const now = Date.now()
  const waiting = ((rows ?? []) as Row[]).filter((r) => {
    if (!/^https:\/\//i.test(String(r.rendered_url || '')) || !String(r.title || '').trim()) return false
    // Claimed by a SCOUT that is still within its time.
    if (isStudioRunning(r.reason) && r.updated_at && now - new Date(r.updated_at).getTime() < STUDIO_UPLOAD_CLAIM_MS) return false
    // A channel at its own daily limit is asked again hourly.
    if (/own daily upload limit/.test(String(r.reason || '')) && r.updated_at && now - new Date(r.updated_at).getTime() < 3_600_000) return false
    return true
  })
  // DRAFTS SCOUT LEFT UNSAVED. YouTube's API cannot take a video out of
  // Studio's draft state: only Save in Studio does, so a run that ended as a
  // draft is saved by SCOUT too, scheduled if its time is still ahead and
  // private if it has gone. A draft being saved now is left alone for 15
  // minutes; one SCOUT could not save is left for the creator.
  const DRAFT_COLS = 'id,batch_id,title,description,tags,rendered_url,thumbnail_url,planned_publish_at,publish_tries,reason,updated_at,youtube_video_id,state'
  const draftQ = (prefix: string) => sb.from('launch_items').select(DRAFT_COLS)
    .eq('user_id', user.id).eq('state', 'blocked').not('youtube_video_id', 'is', null).not('planned_publish_at', 'is', null)
    .like('reason', `${prefix}%`).order('planned_publish_at', { ascending: true }).limit(10)
  const [{ data: d1 }, { data: d2 }] = await Promise.all([draftQ(DRAFT_REASON_PREFIX), draftQ(STUDIO_DRAFT_SAVING)])
  const drafts = ([...(d1 ?? []), ...(d2 ?? [])] as Row[]).filter((r) =>
    !String(r.reason || '').startsWith(STUDIO_DRAFT_SAVING) || !r.updated_at || now - new Date(r.updated_at).getTime() > 15 * 60_000)
  waiting.push(...drafts)
  if (waiting.length === 0) return NextResponse.json({ ok: true, on: true, items: [] })

  const batchIds = [...new Set(waiting.map((r) => r.batch_id))]
  type B = { id: string; youtube_channel_id: string | null; notify_subscribers: boolean | null; studio_options: unknown; send_to_youtube: boolean | null; playlist_id?: string | null }
  const { data: batches } = await sb.from('launch_batches')
    .select('id,youtube_channel_id,notify_subscribers,studio_options,send_to_youtube').in('id', batchIds)
  const byBatch = new Map<string, B>()
  for (const b of (batches ?? []) as B[]) byBatch.set(b.id, b)
  // Each batch's playlist, read on its own (migration 367), and its NAME,
  // which is what Studio's list shows: one 1-unit read per batch.
  const playlistName = new Map<string, string>()
  {
    const { data: pb } = await sb.from('launch_batches').select('id,playlist_id').in('id', batchIds)
    const want = ((pb ?? []) as Array<{ id: string; playlist_id: string | null }>).filter((b) => !!b.playlist_id)
    for (const b of want) {
      try {
        const token = await getChannelOAuthToken(sb, user.id, String(byBatch.get(b.id)?.youtube_channel_id || '').trim() || null)
        if (!token) continue
        const r = await ytFetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(String(b.playlist_id))}`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 })
        const d = await r.json().catch(() => null)
        const t = String(d?.items?.[0]?.snippet?.title || '').trim()
        if (t) playlistName.set(b.id, t)
      } catch { /* MVP adds it instead */ }
    }
  }
  // WHICH VIDEOS THE CREATOR AGREED TO SEND NOW (migration 365), the same
  // rule as the drain: due and agreed goes Public, due and not agreed stays
  // Private for a new time, and anything still ahead is Scheduled.
  const agreedNow = new Set<string>()
  {
    const { data: nowRows, error: nowErr } = await sb.from('launch_items').select('id').in('id', waiting.map((r) => r.id)).eq('publish_now', true)
    if (!nowErr) for (const r of (nowRows ?? []) as Array<{ id: string }>) agreedNow.add(r.id)
  }
  // A batch with no confirmed channel uploads to the creator's default one.
  const { data: def } = await sb.from('youtube_channels').select('channel_id')
    .eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at', { ascending: true }).limit(1)
  const fallbackChannel = String((def ?? [])[0]?.channel_id || '').trim() || null

  const items = waiting.flatMap((r) => {
    const b = byBatch.get(r.batch_id)
    if (!b || b.send_to_youtube === false) return []
    const channelId = String(b.youtube_channel_id || '').trim() || fallbackChannel
    if (!channelId) return []
    const opts = normalizeStudioOptions(b.studio_options)
    const name = (String(r.title || 'video').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'video') + '.mp4'
    const at = new Date(String(r.planned_publish_at)).getTime()
    // SCOUT saves Private instead if the time has gone by the time it gets
    // to Visibility (a long upload), and MVP then asks for a new time.
    const due = at <= now
    const visibility = !due ? { mode: 'schedule' as const, publishAt: new Date(at).toISOString() }
      : agreedNow.has(r.id) ? { mode: 'public' as const }
      : { mode: 'private' as const }
    return [{
      itemId: r.id,
      draft: r.state === 'blocked' && !!r.youtube_video_id,
      videoId: r.youtube_video_id,
      tags: String(r.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      thumbnailUrl: /^https:\/\//i.test(String(r.thumbnail_url || '')) ? String(r.thumbnail_url) : null,
      playlist: playlistName.get(r.batch_id) ?? null,
      visibility,
      channelId,
      fileUrl: String(r.rendered_url),
      fileName: name,
      title: String(r.title || '').trim().slice(0, 100),
      description: String(r.description || '').slice(0, 4900),
      tries: Number(r.publish_tries ?? 0),
      lastReason: r.reason,
      want: {
        details: opts.disclosures,
        notifySubscribers: b.notify_subscribers === true,
        // THE SAME PAGES A PERSON WOULD ANSWER, in the same window: a fresh
        // upload's Ad suitability page can hold Next until it is answered.
        monetize: opts.monetize, selfCert: opts.monetize && opts.adRating, endScreen: opts.endScreen, tagProduct: false,
      },
    }]
  })
  return NextResponse.json({ ok: true, on: true, items })
}

export async function POST(req: Request) {
  const g = await gate()
  if (g instanceof NextResponse) return g
  const { user, sb } = g
  const body = await req.json().catch(() => ({})) as {
    itemId?: string; claim?: boolean
    draftResult?: { saved?: boolean; visibility?: string; publishAt?: string | null; error?: string; steps?: Array<{ step?: string; ok?: boolean; detail?: string; skipped?: boolean }> }
    result?: {
      ok?: boolean; videoId?: string; saved?: boolean; error?: string; detail?: string
      steps?: Array<{ step?: string; ok?: boolean; detail?: string; skipped?: boolean }>
      did?: { text?: boolean | null; tags?: boolean | null; thumbnail?: boolean | null; playlist?: boolean | null; visibility?: string | null; publishAt?: string | null } | null
    }
  }
  const itemId = String(body.itemId || '')
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return NextResponse.json({ ok: false, error: 'Which video?' }, { status: 400 })
  const { data: row } = await sb.from('launch_items')
    .select('id,batch_id,title,description,tags,rendered_url,planned_publish_at,publish_tries,reason,updated_at,youtube_video_id,state')
    .eq('id', itemId).eq('user_id', user.id).maybeSingle() as { data: Row | null }
  if (!row) return NextResponse.json({ ok: false, error: 'That video is not in your Liftoff.' }, { status: 404 })
  const stamp = new Date().toISOString()
  const tries = Number(row.publish_tries ?? 0)

  // ── CLAIM ─────────────────────────────────────────────────────────────────
  // ── A DRAFT FOR SCOUT TO SAVE ─────────────────────────────────────────────
  if (body.claim && row.state === 'blocked' && row.youtube_video_id) {
    const was = String(row.reason || '')
    if (!was.startsWith(DRAFT_REASON_PREFIX) && !was.startsWith(STUDIO_DRAFT_SAVING)) return NextResponse.json({ ok: false, error: 'It is not a draft waiting to be saved.' }, { status: 409 })
    const { data: took } = await sb.from('launch_items').update({
      reason: `${STUDIO_DRAFT_SAVING} ${was.startsWith(DRAFT_REASON_PREFIX) ? was : ''}`.trim().slice(0, 600),
      updated_at: stamp,
    }).eq('id', row.id).eq('state', 'blocked').eq('reason', was).select('id')
    return NextResponse.json({ ok: !!took && took.length > 0 })
  }
  if (body.draftResult && row.state === 'blocked' && row.youtube_video_id && String(row.reason || '').startsWith(STUDIO_DRAFT_SAVING)) {
    const dr = body.draftResult
    const visibility = dr.visibility === 'schedule' || dr.visibility === 'public' || dr.visibility === 'private' ? dr.visibility : null
    if (dr.saved === true && visibility) {
      // SAVED IN STUDIO: the drain carries on (it reads YouTube back first).
      const { data: prev } = await sb.from('launch_items').select('studio_upload').eq('id', row.id).maybeSingle()
      const kept = (prev?.studio_upload && typeof prev.studio_upload === 'object') ? prev.studio_upload : {}
      await sb.from('launch_items').update({
        studio_upload: { ...kept, visibility, publishAt: visibility === 'schedule' ? (dr.publishAt ?? null) : null, draftSavedAt: stamp },
      }).eq('id', row.id)
      await sb.from('launch_items').update({ state: 'prepared', reason: STUDIO_UPLOAD_DONE, publish_tries: 0, updated_at: stamp })
        .eq('id', row.id).eq('state', 'blocked')
      return NextResponse.json({ ok: true, state: 'prepared' })
    }
    const why = studioStoppedAt(Array.isArray(dr.steps) ? dr.steps.filter((x) => x && typeof x.step === 'string').map((x) => ({ step: String(x.step), ok: x.ok === true, skipped: x.skipped === true, detail: String(x.detail || '') })) : [])
    await sb.from('launch_items').update({
      reason: `${STUDIO_DRAFT_FAILED} ${why || dr.error || 'SCOUT gave no reason.'} Open it in Studio, press Edit draft, and save it on the Visibility page.`.slice(0, 600),
      updated_at: stamp,
    }).eq('id', row.id)
    return NextResponse.json({ ok: true, state: 'blocked' })
  }

  if (body.claim) {
    if (row.state !== 'prepared' || row.youtube_video_id) return NextResponse.json({ ok: false, error: 'It is not waiting for an upload any more.' }, { status: 409 })
    if (tries >= STUDIO_UPLOAD_TRIES) {
      // THE LAST REAL ERROR SURVIVES THE GIVING UP, as in the drain.
      const said = String(row.reason || '').trim()
      await sb.from('launch_items').update({
        state: 'blocked',
        reason: `SCOUT could not upload this through YouTube Studio after ${tries} tries.${said && !isStudioRunning(said) ? ` The last thing it said: ${said}` : ''} Check YouTube Studio for a copy before pressing Try again.`.slice(0, 400),
        updated_at: stamp,
      }).eq('id', row.id).eq('state', 'prepared').is('youtube_video_id', null)
      return NextResponse.json({ ok: false, error: 'out-of-tries' }, { status: 409 })
    }
    const q = sb.from('launch_items').update({
      publish_tries: tries + 1,
      reason: `${STUDIO_UPLOAD_RUNNING} Try ${tries + 1} of ${STUDIO_UPLOAD_TRIES}.`,
      updated_at: stamp,
    }).eq('id', row.id).eq('state', 'prepared').is('youtube_video_id', null)
    const { data: took } = await (row.publish_tries == null ? q.is('publish_tries', null) : q.eq('publish_tries', tries)).select('id')
    if (!took || took.length === 0) return NextResponse.json({ ok: false, error: 'Another SCOUT took it first.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  }

  // ── RESULT ────────────────────────────────────────────────────────────────
  const r = body.result
  if (!r || typeof r !== 'object') return NextResponse.json({ ok: false, error: 'No result.' }, { status: 400 })
  const videoId = cleanVideoId(r.videoId)
  if (videoId) {
    // Only where none is recorded: a report that arrives late must not
    // replace a video already on the row.
    const { data: kept, error: idErr } = await sb.from('launch_items').update({
      youtube_video_id: videoId,
      // The upload is done, so its try is handed back for the steps after it.
      publish_tries: Math.max(0, tries - 1),
      reason: STUDIO_UPLOAD_DONE,
      updated_at: stamp,
    }).eq('id', row.id).is('youtube_video_id', null).select('id')
    if (idErr) return NextResponse.json({ ok: false, error: idErr.message }, { status: 500 })
    if (!kept || kept.length === 0) {
      const same = row.youtube_video_id === videoId
      return NextResponse.json({ ok: same, error: same ? undefined : `This video already has a different YouTube id on record (${row.youtube_video_id}). The copy SCOUT just uploaded (${videoId}) is a second one: delete it in Studio.` })
    }

    // WHAT SCOUT SET AND READ BACK, kept for the drain (migration 399), which
    // skips each of these after its own 1-unit read and does the rest. Its
    // own write, so a database without the column loses only the saving:
    // the drain then does every step through the API, as before.
    const did = studioDid(r.did, r.saved === true)
    // WHAT SCOUT SAW, STEP BY STEP, kept with it: a run that stops part way
    // must say where, not only that it stopped.
    const seen = (Array.isArray(r.steps) ? r.steps : []).filter((x) => x && typeof x.step === 'string')
      .map((x) => ({ step: String(x.step), ok: x.ok === true, skipped: x.skipped === true, detail: String(x.detail || '').slice(0, 200) }))
      .slice(0, 30)
    await sb.from('launch_items').update({ studio_upload: { ...did, videoId, at: stamp, steps: seen } }).eq('id', row.id)
    const stoppedAt = studioStoppedAt(seen)
    // THE STUDIO PASS IS THIS RUN. SCOUT answered every Studio page in the
    // upload itself, so it is recorded as the video's Studio run and the
    // board does not send Studio to the front a second time for it.
    try {
      const run = storeStudioRun({ ok: r.ok === true && r.saved === true, path: 'draft', error: r.saved === true ? undefined : (r.error ?? 'not-saved'), steps: (Array.isArray(r.steps) ? r.steps : []).filter((x) => x && typeof x.step === 'string').map((x) => ({ step: String(x.step), ok: x.ok === true, skipped: x.skipped === true, detail: String(x.detail || '') })) }, new Date(), null)
      await sb.from('launch_items').update({ studio_finish: run }).eq('id', row.id)
    } catch { /* a missing column only loses the record */ }

    // THE WORDS AND TAGS, THROUGH THE API ONLY WHEN SCOUT MISSED THEM (about
    // 50 units). The description carries the affiliate link: if Studio did
    // not keep it AND this fails, nothing goes out.
    const wantTags = String(row.tags || '').split(',').map((t) => t.trim()).filter(Boolean)
    const textOk = did.text === true
    let metaError: string | null = null
    if (!textOk || (wantTags.length > 0 && did.tags !== true)) {
      try {
        const { data: b } = await sb.from('launch_batches').select('youtube_channel_id').eq('id', row.batch_id).maybeSingle()
        const token = await getChannelOAuthToken(sb, user.id, String(b?.youtube_channel_id || '').trim() || null)
        if (!token) throw new Error('the channel is not connected for publishing')
        await new YouTubeOAuthService(token).updateVideoMetadata(videoId, {
          title: String(row.title || '').trim().slice(0, 100),
          description: String(row.description || '').slice(0, 4900),
          tags: wantTags,
        })
      } catch (e) {
        metaError = (e instanceof Error ? e.message : String(e)).slice(0, 200)
      }
    }

    if (r.saved !== true || (!textOk && metaError)) {
      await sb.from('launch_items').update({
        state: 'blocked',
        reason: (r.saved !== true
          ? `On your channel (${videoId}) as a draft in Studio: SCOUT uploaded it but could not save it, twice. ${stoppedAt || (r.detail ? `SCOUT said: ${r.detail}.` : 'SCOUT gave no reason.')} SCOUT tries once more by itself in a few minutes. If it stays a draft, open it in Studio, press Edit draft and save it on the Visibility page.`
          : `On your channel (${videoId}), but Studio did not keep its title and description and MVP could not set them (${metaError}). Check them in Studio, then press Try again.`
        ).slice(0, 600),
        updated_at: stamp,
      }).eq('id', row.id)
      return NextResponse.json({ ok: true, videoId, held: true, metaError })
    }
    return NextResponse.json({ ok: true, videoId, metaError })
  }

  // No video: say why on the row. The drain does not touch it; the next SCOUT
  // run offers it again until it is out of tries.
  const why = studioUploadFailureText(r.error, r.detail)
  const wrong = r.error === 'wrong-channel'
  await sb.from('launch_items').update({
    // A wrong channel is not fixed by trying again, so it stops at once.
    ...(wrong || tries >= STUDIO_UPLOAD_TRIES ? { state: 'blocked' } : {}),
    // Busy is not an attempt.
    ...(r.error === 'busy' ? { publish_tries: Math.max(0, tries - 1) } : {}),
    reason: why.slice(0, 400),
    updated_at: stamp,
  }).eq('id', row.id).eq('state', 'prepared').is('youtube_video_id', null)
  return NextResponse.json({ ok: true, recorded: why })
}
