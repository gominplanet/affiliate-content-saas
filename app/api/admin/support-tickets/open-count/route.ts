/**
 * GET /api/admin/support-tickets/open-count
 *
 * Tiny admin-only endpoint: how many support tickets are still OPEN (not yet
 * answered or closed). Powers the red "Support" alert in the dashboard topbar
 * so the founder sees at a glance when tickets need attention. Admin-gated;
 * counts across all users via the service-role client.
 *
 * Returns: { count }  (0 for non-admins is never returned — they get 403)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (admin as any)
    .from('support_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ count: count ?? 0 })
}
