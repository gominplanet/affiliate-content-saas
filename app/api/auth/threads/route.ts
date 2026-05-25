import { NextResponse } from 'next/server'
import { metaEnabled } from '@/lib/feature-flags'

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  if (!metaEnabled()) {
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&meta_disabled=1`)
  }
  const redirectUri = `${appUrl}/api/auth/threads/callback`

  const params = new URLSearchParams({
    client_id: process.env.THREADS_APP_ID!,
    redirect_uri: redirectUri,
    scope: 'threads_basic,threads_content_publish',
    response_type: 'code',
  })

  return NextResponse.redirect(`https://threads.net/oauth/authorize?${params}`)
}
