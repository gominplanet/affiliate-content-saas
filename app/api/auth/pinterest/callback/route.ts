import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForToken, PinterestService } from '@/services/pinterest'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'

export async function GET(request: NextRequest) {
  // Must match the start route's redirect_uri byte-for-byte (Pinterest
  // exact-matches it again at token exchange). Strip trailing slash.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/connect-socials?pinterest_error=${encodeURIComponent(error || 'no_code')}`)
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  // Track which step failed so the surfaced error is actionable
  // (token exchange vs. boards fetch behave very differently in sandbox).
  let step = 'token_exchange'
  try {
    const redirectUri = `${appUrl}/api/auth/pinterest/callback`
    const tokens = await exchangeCodeForToken(code, redirectUri)

    step = 'get_boards'
    const pinterest = new PinterestService(tokens.access_token)
    const boards = await pinterest.getBoards()
    const defaultBoard = boards[0] ?? null

    step = 'save_token'
    // Encrypt secret tokens at rest (2026-06-02).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: saveErr } = await supabase.from('integrations').upsert(
      encryptIntegrationWrite({
        user_id: user.id,
        pinterest_access_token: tokens.access_token,
        pinterest_refresh_token: tokens.refresh_token,
        pinterest_board_id: defaultBoard?.id ?? null,
        pinterest_board_name: defaultBoard?.name ?? null,
        pinterest_boards_json: JSON.stringify(boards),
      }),
      { onConflict: 'user_id' },
    )
    // Don't report a false success — if the token didn't persist, the
    // pill would stay red with no explanation (exactly this bug class).
    if (saveErr) throw new Error(saveErr.message || 'token save failed')

    return NextResponse.redirect(`${appUrl}/connect-socials?pinterest_connected=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`[pinterest callback] ${step} failed:`, msg)
    const detail = encodeURIComponent(`${step}: ${msg}`.slice(0, 300))
    return NextResponse.redirect(`${appUrl}/connect-socials?pinterest_error=${detail}`)
  }
}
