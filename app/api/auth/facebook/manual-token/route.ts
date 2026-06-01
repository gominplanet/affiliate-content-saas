import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { syncFacebookAccounts } from '@/lib/social-accounts'

const GRAPH = 'https://graph.facebook.com/v19.0'

// Accepts a Page Access Token directly (from Graph API Explorer)
// and saves it — skips OAuth entirely
export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageAccessToken } = await request.json()
  if (!pageAccessToken) return NextResponse.json({ error: 'pageAccessToken required' }, { status: 400 })

  // Verify token and get page info
  const res = await fetch(`${GRAPH}/me?access_token=${pageAccessToken}&fields=id,name`)
  if (!res.ok) {
    const body = await res.json()
    return NextResponse.json({ error: body.error?.message || 'Invalid token' }, { status: 400 })
  }
  const page = await res.json() as { id: string; name: string }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('integrations').upsert(
    {
      user_id: user.id,
      facebook_page_id: page.id,
      facebook_page_name: page.name,
      facebook_page_access_token: pageAccessToken,
      facebook_pages_json: JSON.stringify([{ id: page.id, name: page.name, access_token: pageAccessToken }]),
    },
    { onConflict: 'user_id' },
  )

  // Mirror into social_accounts (single page from a pasted token).
  try {
    await syncFacebookAccounts(supabase, user.id, [{ id: page.id, name: page.name, access_token: pageAccessToken }], page.id)
  } catch (e) {
    console.warn('[facebook/manual-token] syncFacebookAccounts failed:', e)
  }

  return NextResponse.json({ ok: true, page })
}
