// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/global-sync/deliver/result — the SCOUT extension reports the outcome
// of a storefront upload so the UI can show delivery status per market.
//   body: { targetId, ok, detail?, deliveredUrl? }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

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
  const patch = body.ok
    ? { state: 'delivered', delivered_at: dup ? null : new Date().toISOString(), media_aci: aci, detail: (body.detail || 'Uploaded to storefront').slice(0, 200), updated_at: new Date().toISOString() }
    : { state: 'failed', detail: (body.detail || 'Upload failed').slice(0, 200), updated_at: new Date().toISOString() }

  const { data: wrote, error } = await sb.from('global_sync_targets').update(patch)
    .eq('id', targetId).eq('user_id', user.id).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // NOTHING MATCHED IS NOT RECORDED. A wrong or someone else's id used to
  // come back ok, and the listing was counted as saved when nothing was.
  if (!wrote || wrote.length === 0) return NextResponse.json({ error: 'No such listing to record.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
