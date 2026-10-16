// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/clip-factory/reel-job — the Page Reel that posts itself once the Group
// post is up (lib/reel-jobs, migration 435). Signed in:
//   { action: 'create', clipUrl, caption, clipSeconds?, socialAccountId?,
//     sourceVideoId?, title?, groupUrl? } -> { id, token } for SCOUT
//   { action: 'status', id }               -> where it stands
//   { action: 'manual', id, link, how }    -> the creator pasted the link, or
//                                            chose to link to the Group
//   { action: 'cancel', id }
// SCOUT's answer goes to /reel-job/ready with the job's one-time key.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPublishContext } from '@/lib/agency-publish'
import { normalizeTier } from '@/lib/tier'
import { canUsePreview } from '@/lib/labs-preview'
import { expireIfDue, hashKey, newKey, reelLinkOk, runReelJob, type ReelJob } from '@/lib/reel-jobs'

export const runtime = 'nodejs'
export const maxDuration = 300

const PUBLIC_COLS = 'id,status,group_post_url,page_post_url,note,created_at,expires_at,group_url'

export async function POST(req: Request) {
  const pub = await getPublishContext(await createServerClient())
  if ('error' in pub) return pub.error
  const { user } = pub
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const str = (v: unknown, n = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
  const { data: integ } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('facebook_reels', normalizeTier(integ?.tier))) return NextResponse.json({ error: 'Facebook Reels is in Labs.' }, { status: 403 })

  if (b.action === 'create') {
    const clipUrl = str(b.clipUrl, 1000)
    if (!clipUrl || !/^https:\/\//i.test(clipUrl)) return NextResponse.json({ error: 'The clip has no web address to hand Facebook.' }, { status: 400 })
    const token = newKey()
    const secs = Number(b.clipSeconds)
    const { data, error } = await admin.from('facebook_reel_jobs').insert({
      user_id: user.id, social_account_id: str(b.socialAccountId, 80), clip_url: clipUrl,
      source_video_id: typeof b.sourceVideoId === 'string' && /^[0-9a-f-]{36}$/i.test(b.sourceVideoId) ? b.sourceVideoId : null,
      title: str(b.title, 200), group_url: str(b.groupUrl, 500), caption: String(b.caption || '').slice(0, 2200),
      clip_seconds: Number.isFinite(secs) && secs > 0 ? secs : null, token_hash: hashKey(token),
    }).select('id').single()
    if (error) return NextResponse.json({ ok: false, error: /facebook_reel_jobs|does not exist|schema cache/i.test(error.message) ? 'Posting the Reel in the background needs migration 435.' : error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id, token })
  }

  const id = str(b.id, 60)
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Which job?' }, { status: 400 })
  const { data: row } = await admin.from('facebook_reel_jobs').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'That Reel job is not yours or no longer kept.' }, { status: 404 })
  const job = await expireIfDue(admin, row as ReelJob)

  if (b.action === 'status') {
    const { data: fresh } = await admin.from('facebook_reel_jobs').select(PUBLIC_COLS).eq('id', id).eq('user_id', user.id).maybeSingle()
    return NextResponse.json({ ok: true, job: fresh ?? { id, status: job.status, note: job.note } })
  }
  if (b.action === 'cancel') {
    await admin.from('facebook_reel_jobs').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).in('status', ['waiting', 'needs_you', 'failed', 'expired'])
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'manual') {
    const how = b.how === 'group' ? 'group' : 'post'
    const link = how === 'group' ? (job.group_url || '') : String(b.link || '').trim()
    if (!reelLinkOk(link, job.group_url)) return NextResponse.json({ error: how === 'group' ? 'MVP does not have this Group’s address.' : 'That is not a Facebook Group post link. Click the time on your post and copy that address.' }, { status: 400 })
    const r = await runReelJob(admin, id, link, how)
    return NextResponse.json({ ...r }, { status: r.ok || r.already ? 200 : 502 })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
