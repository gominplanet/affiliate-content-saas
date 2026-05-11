import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForToken, PinterestService } from '@/services/pinterest'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/setup?pinterest_error=${error || 'no_code'}`)
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  try {
    const redirectUri = `${appUrl}/api/auth/pinterest/callback`
    const tokens = await exchangeCodeForToken(code, redirectUri)

    const pinterest = new PinterestService(tokens.access_token)
    const boards = await pinterest.getBoards()
    const defaultBoard = boards[0] ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').upsert(
      {
        user_id: user.id,
        pinterest_access_token: tokens.access_token,
        pinterest_refresh_token: tokens.refresh_token,
        pinterest_board_id: defaultBoard?.id ?? null,
        pinterest_board_name: defaultBoard?.name ?? null,
        pinterest_boards_json: JSON.stringify(boards),
      },
      { onConflict: 'user_id' },
    )

    return NextResponse.redirect(`${appUrl}/setup?pinterest_connected=1`)
  } catch (err) {
    return NextResponse.redirect(`${appUrl}/setup?pinterest_error=callback_failed`)
  }
}
