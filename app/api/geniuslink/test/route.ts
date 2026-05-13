import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createGeniuslinkService } from '@/services/geniuslink'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('geniuslink_api_key,geniuslink_api_secret')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.geniuslink_api_key) {
    return NextResponse.json({ error: 'No Geniuslink credentials saved' })
  }

  try {
    const genius = createGeniuslinkService(
      intRow.geniuslink_api_key as string,
      intRow.geniuslink_api_secret as string,
    )
    const shortUrl = await genius.createAsinLink('B08N5WRWNW', 'Test — Hydro Flask')
    return NextResponse.json({ ok: true, shortUrl })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
