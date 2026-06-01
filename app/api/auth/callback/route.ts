import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

/**
 * Validate `next` is a same-origin internal path before using it in a redirect.
 *
 * Without this, `?next=//evil.com` slipped through: Next's URL parser tolerates
 * leading `//` as a protocol-relative URL, so we'd cheerfully send the user
 * off-site post-login carrying their Supabase session cookie. Same problem
 * with `\\` and other URL schemes.
 *
 * Rules: must start with a single `/`, must NOT start with `//` or `/\`, must
 * NOT contain a scheme (http:, javascript:, data:, mailto:, etc.). Anything
 * suspicious falls back to /dashboard.
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard'
  if (!raw.startsWith('/')) return '/dashboard'
  if (raw.startsWith('//')) return '/dashboard'
  if (raw.startsWith('/\\')) return '/dashboard'
  // Reject any scheme-looking content (e.g. `/something/javascript:alert()`).
  if (/^\/[^/]*:/.test(raw)) return '/dashboard'
  return raw
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  if (code) {
    const supabase = await createServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
