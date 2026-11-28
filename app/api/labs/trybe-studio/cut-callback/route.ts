/**
 * POST /api/labs/trybe-studio/cut-callback
 *
 * Where MVP's video server reports a long talking take it cut into its hooks,
 * bodies and CTAs (ingest-service /cut-video; lib/voice-split CutJob). Only a
 * cut MVP started lands here: the request carries the video server's secret,
 * and the job token is signed and names the cut and its owner. The one
 * recording is deleted once cut, or once the cut failed (the creator adds it
 * again). Body: { job, ok, cuts?: [{ id, url, seconds, bytes }], error? }.
 */
import { NextResponse } from 'next/server'
import { readRenderJob } from '@/lib/render-job'
import { createAdminClient } from '@/lib/supabase/admin'
import { cutDone, type CutJob } from '@/lib/voice-split'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const secret = process.env.YOUTUBE_INGEST_SECRET || ''
  if (!secret || request.headers.get('x-ingest-secret') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const job = readRenderJob(String(body.job || ''))
  if (!job || !job.shortId.startsWith('cut-')) return NextResponse.json({ error: 'bad job' }, { status: 400 })
  const id = job.shortId.slice('cut-'.length)
  // trybe_directory_meta is newer than the generated database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const key = `studiocut:${id}`
  const { data: hit } = await db.from('trybe_directory_meta').select('value').eq('key', key).maybeSingle()
  const was = (hit?.value ?? null) as CutJob | null
  if (!was || was.userId !== job.userId) return NextResponse.json({ ok: false, error: 'unknown cut' }, { status: 404 })
  const now = new Date().toISOString()
  const next = cutDone(was, body, now)
  await db.from('trybe_directory_meta').upsert({ key, value: next, updated_at: now })
  if (was.own && was.own.startsWith(`${job.userId}/source-edit-`)) await db.storage.from('instagram-videos').remove([was.own]).catch(() => null)
  return NextResponse.json({ ok: true, state: next.state })
}
