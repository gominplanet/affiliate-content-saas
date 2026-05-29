import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createHostingerService } from '@/services/hostinger'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { subscriptionId, vhostId, domain, adminEmail, adminPassword, adminUser, siteTitle } =
    await request.json()

  // Load saved Hostinger API key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: integration } = await sb
    .from('integrations')
    .select('hostinger_api_key')
    .eq('user_id', user.id)
    .single()

  if (!integration?.hostinger_api_key) {
    return NextResponse.json({ error: 'Hostinger API key not found. Please reconnect.' }, { status: 400 })
  }

  try {
    const hostinger = createHostingerService(integration.hostinger_api_key)
    const result = await hostinger.installWordPress(subscriptionId, vhostId, {
      adminEmail,
      adminPassword,
      adminUser,
      siteTitle,
    })

    // Store job info and wordpress details in integrations
    await sb.from('integrations').upsert(
      {
        user_id: user.id,
        wordpress_url: `https://${domain}`,
        wordpress_username: adminUser,
        wordpress_app_password: adminPassword,
        setup_status: 'wordpress_installing',
        setup_job_id: result.jobId,
        setup_subscription_id: subscriptionId,
      },
      { onConflict: 'user_id' },
    )

    return NextResponse.json({ jobId: result.jobId, status: result.status })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Installation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
