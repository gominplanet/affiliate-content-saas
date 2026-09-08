import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createHostingerService } from '@/services/hostinger'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { apiKey } = await request.json()
  if (!apiKey) return NextResponse.json({ error: 'API key required' }, { status: 400 })

  try {
    const hostinger = createHostingerService(apiKey)
    const subscriptions = await hostinger.getSubscriptions()

    if (subscriptions.length === 0) {
      return NextResponse.json({ error: 'No hosting subscriptions found on this account.' }, { status: 404 })
    }

    // Fetch vhosts for each subscription
    const withVhosts = await Promise.all(
      subscriptions.map(async (sub) => {
        const vhosts = await hostinger.getVhosts(sub.id)
        return { ...sub, vhosts }
      }),
    )

    // Save the API key to integrations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // The Hostinger key controls the owner's hosting account, so it is
    // encrypted at rest like every other credential in this row. THE ERROR IS
    // READ too: a silent failure here means the connect screen says it worked
    // and the next step cannot find a key.
    const { error: saveErr } = await supabase.from('integrations').upsert(
      encryptIntegrationWrite({ user_id: user.id, hostinger_api_key: apiKey }),
      { onConflict: 'user_id' },
    )
    if (saveErr) {
      console.error('[hostinger/subscriptions] could not save the API key:', saveErr.message)
      return NextResponse.json({ error: 'Connected to Hostinger, but we could not save the key. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ subscriptions: withVhosts })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to connect'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
