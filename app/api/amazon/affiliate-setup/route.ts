// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET/POST /api/amazon/affiliate-setup — the Amazon Influencer's affiliate IDs:
// their Amazon Associates tag and (better) their Geniuslink credentials, which
// every pin / post / link routes through. Lives on its own so the hyper-focused
// Amazon tier never has to hunt through the full setup wizard.
//
//   GET  → { amazonTag, geniuslinkKey, geniuslinkSet }  (secret never returned)
//   POST → { amazonTag?, geniuslinkKey?, geniuslinkSecret? }
//          amazonTag / geniuslinkKey always saved; geniuslinkSecret only when a
//          new value is sent (blank keeps the stored one).
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: raw } = await supabase
    .from('integrations')
    .select('amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret')
    .eq('user_id', user.id).maybeSingle()
  const row = decryptIntegrationRow(raw) as {
    amazon_associates_tag?: string | null
    geniuslink_api_key?: string | null
    geniuslink_api_secret?: string | null
  } | null

  return NextResponse.json({
    amazonTag: row?.amazon_associates_tag || '',
    geniuslinkKey: row?.geniuslink_api_key || '',
    geniuslinkSet: !!(row?.geniuslink_api_key && row?.geniuslink_api_secret),
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    amazonTag?: string; geniuslinkKey?: string; geniuslinkSecret?: string
  }
  const amazonTag = (body.amazonTag || '').trim().slice(0, 60)
  const geniuslinkKey = (body.geniuslinkKey || '').trim().slice(0, 200)
  const geniuslinkSecret = (body.geniuslinkSecret || '').trim().slice(0, 400)

  // Only touch the columns we intend to. Secret is left as-is unless a new one
  // is supplied, so the modal can keep it masked.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {
    user_id: user.id,
    amazon_associates_tag: amazonTag || null,
    geniuslink_api_key: geniuslinkKey || null,
  }
  if (geniuslinkSecret) patch.geniuslink_api_secret = geniuslinkSecret
  // Clearing the key clears the secret too (an orphan secret is useless).
  if (!geniuslinkKey) patch.geniuslink_api_secret = null

  const { error } = await supabase.from('integrations').upsert(patch, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, amazonTag, geniuslinkKey })
}
