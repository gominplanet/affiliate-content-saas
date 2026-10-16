// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/clip-factory/reel-job/ready — SCOUT's answer from the background
// (lib/reel-jobs). No session: SCOUT calls from Chrome's background, so the
// job's own one-time key is the proof, and it only works for that one job,
// for a few hours, and only to post its Reel to the creator's own Page.
//   { id, token, url }    the Group post is up: post the Reel linking to it
//   { id, token, state }  SCOUT's watch ended without a link: say why
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { expireIfDue, hashKey, MISSED_WORDS, reelLinkOk, runReelJob, type ReelJob } from '@/lib/reel-jobs'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({})) as { id?: string; token?: string; url?: string; state?: string }
  const id = String(b.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof b.token !== 'string' || b.token.length < 20) return NextResponse.json({ error: 'Which job?' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('facebook_reel_jobs').select('*').eq('id', id).maybeSingle()
  if (!row || row.token_hash !== hashKey(b.token)) return NextResponse.json({ error: 'Not this job.' }, { status: 403 })
  const job = await expireIfDue(admin, row as ReelJob)
  if (job.status === 'expired' || job.status === 'cancelled') return NextResponse.json({ ok: false, status: job.status })

  if (b.url) {
    const link = String(b.url).trim()
    if (!reelLinkOk(link)) {
      await admin.from('facebook_reel_jobs').update({ status: 'needs_you', note: 'SCOUT found a link that is not a Group post. Paste the post’s link in Clip Factory.', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'waiting')
      return NextResponse.json({ ok: false, status: 'needs_you' })
    }
    // SCOUT's answer posts only a job still waiting on it (never one the
    // creator already moved on by hand).
    const r = await runReelJob(admin, id, link, 'post', ['waiting', 'needs_you'])
    return NextResponse.json(r, { status: r.ok || r.already ? 200 : 502 })
  }
  const note = MISSED_WORDS[String(b.state || '')] || MISSED_WORDS.lost
  await admin.from('facebook_reel_jobs').update({ status: 'needs_you', note: `${note} Paste the Group post’s link in Clip Factory, or post the Reel linking to your Group.`, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'waiting')
  return NextResponse.json({ ok: true, status: 'needs_you' })
}
