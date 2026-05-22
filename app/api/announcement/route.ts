/**
 * GET /api/announcement
 *
 * Returns the current active dashboard announcement (or null). Any logged-in
 * user can read it. Reads via the service-role client so it works without an
 * RLS read policy; resilient — returns null on any error (e.g. before the
 * migration runs) so the banner simply doesn't render.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: true, announcement: null })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data } = await admin
      .from('announcements')
      .select('id,title,body,cta_label,cta_href,variant')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({ ok: true, announcement: data ?? null })
  } catch {
    return NextResponse.json({ ok: true, announcement: null })
  }
}
