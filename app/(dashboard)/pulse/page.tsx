// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /pulse, Hashtag insights: ADMIN ONLY (Seb, 2026-10-20: "I don't think users
// would ever need this. I think admin should be running this if we need it").
// Members still get everything it learns: every caption picks its hashtags
// from the same data (lib/hashtag-engine), with nothing to open or press.
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import PulseView from './PulseView'

export const dynamic = 'force-dynamic'

export default async function PulsePage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (createAdminClient() as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') redirect('/dashboard')
  return <PulseView />
}
