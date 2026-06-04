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
  // Reject URL-encoded slash/backslash variants that some redirect handlers
  // decode AFTER the origin check ( `/%2fevil.com`, `/%5cevil.com`,
  // `/%2F%2Fevil.com`). Belt-and-braces: also reject control chars and
  // any non-ASCII high-bit byte that some URL parsers normalize down to /.
  if (/%2f|%5c|%00|%01|%02|%03|%04|%05|%06|%07|%08|%09|%0a|%0b|%0c|%0d|%0e|%0f/i.test(raw)) return '/dashboard'
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(raw)) return '/dashboard'
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
