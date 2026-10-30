// GET /api/auth/google-drive — connect Google Drive for the review editor
// (lib/google-drive). Asks only for drive.file (the files the creator picks
// in Google's picker, nothing else) and their email address. Comes back
// through the YouTube callback, the address already registered with Google,
// marked as a Drive connect in the one-time state.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { startOAuthState, callbackHostRedirect } from '@/lib/oauth-state'
import { canUsePreview } from '@/lib/labs-preview'
import { DRIVE_SCOPES } from '@/lib/google-drive'

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) return NextResponse.json({ error: 'Google sign-in is not set up.' }, { status: 500 })
  const redirectUri = `${appUrl}/api/auth/youtube/callback`
  const hostHop = callbackHostRedirect(req, redirectUri)
  if (hostHop) return NextResponse.redirect(hostHop)
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('review_edit', intg?.tier)) return NextResponse.redirect(`${appUrl}/review-editor`)
  const state = await startOAuthState('youtube', user.id, redirectUri, { drive: true, rt: '/review-editor' })
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', DRIVE_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  // No include_granted_scopes: a Drive connect asks for Drive alone, never
  // re-merging the YouTube grant (see app/api/auth/youtube/route.ts).
  url.searchParams.set('prompt', 'select_account consent')
  url.searchParams.set('state', state)
  return NextResponse.redirect(url.toString())
}
