import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// Meta calls this when a user requests data deletion for Threads
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const userId = body.user_id as string | undefined

    if (userId) {
      const supabase = await createServerClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('integrations').update({
        threads_access_token: null,
        threads_user_id: null,
      }).eq('threads_user_id', userId)
    }
  } catch { /* best-effort */ }

  return NextResponse.json({ success: true })
}

export async function GET() {
  return NextResponse.json({ success: true })
}
