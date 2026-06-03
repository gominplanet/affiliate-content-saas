import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/middleware'

const publicPaths = [
  '/login', '/signup', '/reset-password',
  '/api/auth', '/api/proxy-image', '/api/cron', '/api/wp-version', '/api/campaigns/ingest',
  // Newsletter public surfaces — these are hit by the WP blog form, by Resend's
  // webhook, and by anonymous click-through links in delivered emails. Each
  // route enforces its OWN auth (HMAC for /subscribe, Svix sig for the webhook,
  // bearer token for /confirm + /unsubscribe). Without whitelisting them
  // middleware redirects every public hit (including CORS preflight) to
  // /login, which silently breaks the WP signup form + open/bounce tracking.
  '/api/newsletter/subscribe',
  '/api/newsletter/confirm',
  '/api/newsletter/unsubscribe',
  '/api/newsletter/resend-webhook',
  '/pricing', '/privacy', '/terms',
]

function isPublicRoot(pathname: string) {
  return pathname === '/'
}

function isPublic(pathname: string) {
  return publicPaths.some((p) => pathname.startsWith(p))
}

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request)
  const { data: { session } } = await supabase.auth.getSession()

  const { pathname } = request.nextUrl

  if (!session && !isPublic(pathname) && !isPublicRoot(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (session && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|zip|ico|webmanifest|txt|xml|json)$).*)'],
}
