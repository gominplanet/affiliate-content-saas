// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/global-sync/deliver/result — the SCOUT extension reports the outcome
// of a storefront upload so the UI can show delivery status per market.
//   body: { targetId, ok, detail?, rawError?, deliveredUrl? }
// A failure is counted, and tried again later unless Amazon refused it.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { nextUploadTry, uploadFailureKind } from '@/lib/amazon-upload-errors'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    targetId?: string; ok?: boolean; detail?: string; deliveredUrl?: string
    /** Amazon's own id for the published listing. SCOUT has always sent this
     *  back and the server threw it away, which is why nothing could ever
     *  afterwards ask Amazon whether the listing is still there. */
    mediaAci?: string | null
    /** SCOUT found the listing already there and uploaded nothing. */
    duplicate?: boolean
    /** SCOUT's own words for a failure, before they were put in the
     *  creator's words. What decides whether it is tried again. */
    rawError?: string | null
  }
  const targetId = (body.targetId || '').trim()
  if (!targetId) return NextResponse.json({ error: 'targetId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // THE ID IS THE WHOLE POINT OF KEEPING IT. Uploaded is not live: Amazon
  // accepting a publish call is not the listing being on the storefront, and
  // until now the coverage grid could not tell those apart because the only
  // thing it had was "SCOUT finished". This id is what a later pass looks for.
  const aci = (body.mediaAci || '').toString().trim().slice(0, 120) || null
  // A DUPLICATE IS NOT AN UPLOAD. It is marked delivered (the listing is
  // there) but with no delivered_at, which is what the daily cap counts: a
  // re-run that skipped ten listings already up used to spend a whole day's
  // allowance for a country without uploading anything.
  const dup = body.ok === true && body.duplicate === true
  const patch: Record<string, unknown> = body.ok
    ? { state: 'delivered', delivered_at: dup ? null : new Date().toISOString(), media_aci: aci, detail: (body.detail || 'Uploaded to storefront').slice(0, 200), updated_at: new Date().toISOString() }
    : { state: 'failed', detail: (body.detail || 'Upload failed').slice(0, 200), updated_at: new Date().toISOString() }

  // A FAILURE COUNTS A TRY AND, unless Amazon refused it, says when the next
  // one is (migration 383). Before that SQL runs the columns are missing and
  // the failure is recorded exactly as before.
  let retry: { tries: number; nextTryAt: string | null } | null = null
  {
    const { data: cur, error: cErr } = await sb.from('global_sync_targets')
      .select('upload_tries').eq('id', targetId).eq('user_id', user.id).maybeSingle()
    if (!cErr && cur) {
      if (body.ok) Object.assign(patch, { next_try_at: null })
      else {
        const tries = Number(cur.upload_tries || 0) + 1
        const nextTryAt = nextUploadTry(uploadFailureKind(body.rawError || body.detail), tries)
        retry = { tries, nextTryAt }
        Object.assign(patch, { upload_tries: tries, next_try_at: nextTryAt })
      }
    }
  }

  const { data: wrote, error } = await sb.from('global_sync_targets').update(patch)
    .eq('id', targetId).eq('user_id', user.id).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // NOTHING MATCHED IS NOT RECORDED. A wrong or someone else's id used to
  // come back ok, and the listing was counted as saved when nothing was.
  if (!wrote || wrote.length === 0) return NextResponse.json({ error: 'No such listing to record.' }, { status: 404 })
  return NextResponse.json({ ok: true, ...(retry ? { tries: retry.tries, nextTryAt: retry.nextTryAt } : {}) })
}
