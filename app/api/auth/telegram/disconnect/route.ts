/**
 * POST /api/auth/telegram/disconnect
 *
 * Clears telegram_channel_id + telegram_channel_title on the user's
 * integrations row. The shared bot keeps running — disconnect just
 * means "stop posting reviews to this user's channel."
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('integrations')
      .update({ telegram_channel_id: null, telegram_channel_title: null })
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
