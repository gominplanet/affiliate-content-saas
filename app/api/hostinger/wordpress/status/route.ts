import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createHostingerService } from '@/services/hostinger'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: integration } = await sb
    .from('integrations')
    .select('hostinger_api_key, setup_job_id, setup_subscription_id, setup_status, wordpress_url')
    .eq('user_id', user.id)
    .single()

  if (!integration?.setup_job_id) {
    return NextResponse.json({ status: 'no_job' })
  }

  if (integration.setup_status === 'wordpress_ready') {
    return NextResponse.json({ status: 'completed', wordpressUrl: integration.wordpress_url })
  }

  try {
    const hostinger = createHostingerService(integration.hostinger_api_key!)
    const result = await hostinger.getInstallStatus(
      integration.setup_subscription_id!,
      integration.setup_job_id,
    )

    if (result.status === 'completed') {
      await sb.from('integrations').upsert(
        { user_id: user.id, setup_status: 'wordpress_ready' },
        { onConflict: 'user_id' },
      )
    }

    return NextResponse.json({ status: result.status, wordpressUrl: integration.wordpress_url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Status check failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
