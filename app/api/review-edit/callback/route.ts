/**
 * POST /api/review-edit/callback
 *
 * Where MVP's video server reports a review edit it made (lib/review-edit-
 * server startMaking). Only an edit MVP started can land here: the request
 * carries the video server's secret, and the job token is signed and names
 * the video and its owner. Body: { job, ok, outputs?, seconds?, inserts?,
 * zooms?, error? }.
 */
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { readRenderJob } from '@/lib/render-job'
import { finishMaking, moveQueue, editDb } from '@/lib/review-edit-server'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const secret = process.env.YOUTUBE_INGEST_SECRET || ''
  if (!secret || request.headers.get('x-ingest-secret') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const job = readRenderJob(String(body.job || ''))
  if (!job || !job.shortId.startsWith('edit-')) return NextResponse.json({ error: 'bad job' }, { status: 400 })
  const db = editDb()
  const found = await finishMaking(db, job.shortId.slice('edit-'.length), job.userId, body)
  // The server is free: the next video in line starts now, not at the next tick.
  after(async () => { try { await moveQueue(db, { readBudget: 0 }) } catch { /* the cron picks it up */ } })
  return NextResponse.json({ ok: found })
}
