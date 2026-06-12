import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/middleware'
import { isPathBlockedForVa } from '@/lib/agency-routes'

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
  // AI Product Finder — public endpoint hit from the JS widget that runs in
  // customer-blog visitors' browsers. CORS preflight (OPTIONS) must reach the
  // route handler too, which is why it's allowlisted here.
  '/api/blog/product-finder',
  // Agency accept page — invitee may not yet have an account, but they need
  // to land on the page to sign in / sign up. Page-level auth check does the
  // rest.
  '/agency/accept',
  '/pricing', '/privacy', '/terms',
  // Public product tour — the marketing twin of the in-app /pro-tour page.
  '/tour',
]

function isPublicRoot(pathname: string) {
  return pathname === '/'
}

function isPublic(pathname: string) {
  return publicPaths.some((p) => pathname.startsWith(p))
}

export async function middleware(request: NextRequest) {
  // Internal service calls — the generation-job worker invoking
  // /api/blog/generate on its own deployment — carry the x-mvp-service
  // header instead of a session cookie. Middleware must NOT bounce them to
  // the /login HTML page (discovered on the queue's first production run:
  // every job died on 307 → /login). This is a routing bypass only, not an
  // auth grant: the route handler compares the header against CRON_SECRET
  // and falls back to normal cookie auth (→ 401 JSON) on mismatch, so a
  // forged header buys an attacker nothing they couldn't get by calling
  // the API without cookies.
  if (request.nextUrl.pathname.startsWith('/api/') && request.headers.has('x-mvp-service')) {
    return NextResponse.next()
  }

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

  // ── Virtual Assistant guard ─────────────────────────────────────────────
  // VAs (agency_members) can never access owner-only surfaces (branding,
  // integrations / setup, WP customization, billing, the VA management
  // page itself, API keys). Bounce them to /dashboard with a flash code
  // so the dashboard can show "this page is owner-only" if it wants.
  //
  // We check BLOCKED_FOR_VAS first (cheap string match) before hitting the
  // DB — the vast majority of requests aren't to blocked paths so we don't
  // want a per-request VA-status lookup. Only when the path matches do we
  // resolve agency context.
  if (session && isPathBlockedForVa(pathname)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('agency_members')
      .select('owner_user_id')
      .eq('member_user_id', session.user.id)
      .is('revoked_at', null)
      .maybeSingle()
    if (data?.owner_user_id) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      url.searchParams.set('blocked', pathname.split('/')[1] || 'page')
      return NextResponse.redirect(url)
    }
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|zip|ico|webmanifest|txt|xml|json)$).*)'],
}
