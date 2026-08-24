import { NextResponse, type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/middleware'
import { isPathBlockedForVa } from '@/lib/agency-routes'

const publicPaths = [
  '/login', '/signup', '/reset-password',
  // Passport Links geo-redirect — public by definition (anyone clicking a link).
  // The short domain (mvpl.ink) rewrites /<code> → /go/<code> in middleware below;
  // this also keeps the app-domain fallback (mvpaffiliate.io/go/<code>) public.
  '/go',
  '/api/auth', '/api/proxy-image', '/api/cron', '/api/wp-version', '/api/campaigns/ingest',
  // Plugin/theme zip downloads — served as octet-stream so Safari doesn't
  // auto-unzip them (which leaves users with the inner .php). The underlying
  // static /public/*.zip is public, so keep the download route public too.
  '/api/download',
  // Stripe webhook — Stripe POSTs with no session cookie, so without this the
  // middleware 307-redirects every event to /login and Stripe (which never
  // follows redirects) marks the delivery failed → paid customers never get
  // upgraded. The route enforces its own auth via constructEvent signature
  // verification, exactly like the newsletter webhooks below.
  '/api/stripe/webhook',
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
  // Instagram webhook — Meta hits it with no session for the verification
  // handshake (GET hub.challenge) + signed comment events (POST). Without this
  // the middleware 307-redirects to /login and Meta's verification fails / the
  // subscription gets disabled. The route enforces its own auth: the verify
  // token on GET + X-Hub-Signature-256 (INSTAGRAM_APP_SECRET) on POST.
  '/api/instagram/webhook',
  // Facebook Page webhook — Meta hits it unauthenticated for the verification
  // handshake (GET hub.challenge) + signed comment events (POST). Same reasons
  // as the Instagram webhook; auth is the verify token on GET +
  // X-Hub-Signature-256 (FACEBOOK_APP_SECRET) on POST.
  '/api/facebook/webhook',
  // Broadcast unsubscribe — hit from an operator-broadcast email in the user's
  // inbox (no session). Authenticates via a signed token (lib/broadcast-token);
  // also serves RFC 8058 one-click POST from Gmail/Apple Mail.
  '/api/email/unsubscribe',
  // AI Product Finder — public endpoint hit from the JS widget that runs in
  // customer-blog visitors' browsers. CORS preflight (OPTIONS) must reach the
  // route handler too, which is why it's allowlisted here.
  '/api/blog/product-finder',
  // "Work with brands" inbox — public POST hit by the WP blog's brand-contact
  // form (cross-origin, no session). Enforces its OWN auth: HMAC + honeypot +
  // hCaptcha. CORS preflight (OPTIONS) must reach the handler too. Note the
  // isPublic() segment-boundary match below keeps this from also whitelisting
  // the AUTHENTICATED inbox at /api/brand-inquiries (plural).
  '/api/brand-inquiry',
  // Agency accept page — invitee may not yet have an account, but they need
  // to land on the page to sign in / sign up. Page-level auth check does the
  // rest.
  '/agency/accept',
  // Public link-in-bio / "Shop Grid" storefront at /shop/<handle>. This is the
  // whole point of the feature: a page tapped from an Instagram/TikTok bio by
  // logged-out visitors. Without this, middleware 307s every public hit to
  // /login (creators saw their bio link land on the MVP login page). The page
  // renders server-side with the service-role client and shows only PUBLISHED
  // pages, so there's nothing session-gated to protect.
  '/shop',
  '/pricing', '/privacy', '/terms',
  // Public product tour — the marketing twin of the in-app /pro-tour page.
  '/tour',
  // Public affiliate-program recruitment page. Logged-out creators must be able
  // to read it + click through to Rewardful signup — without this it 307s to
  // /login.
  '/affiliates',
]

function isPublicRoot(pathname: string) {
  return pathname === '/'
}

function isPublic(pathname: string) {
  // Match on segment boundaries — an entry matches the exact path or a deeper
  // sub-path (…/x), never a longer sibling that merely shares the prefix. This
  // keeps '/api/brand-inquiry' (public form POST) from also whitelisting
  // '/api/brand-inquiries' (the authenticated owner inbox).
  return publicPaths.some((p) => pathname === p || pathname.startsWith(p + '/'))
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

  // ── Passport Links short domain (mvpl.ink) ──────────────────────────────
  // On the branded short domain, a bare /<code> IS a geo-redirect link. Rewrite
  // it to the public /go/<code> route BEFORE the auth check below (which would
  // otherwise bounce the logged-out clicker to /login). Done here rather than in
  // next.config so it's guaranteed to run before the session gate. No DB/session
  // work for these hits.
  {
    const host = (request.headers.get('host') || '').toLowerCase().split(':')[0]
    const passportHost = (process.env.PASSPORT_LINK_HOST || 'mvpl.ink').toLowerCase()
    if (host === passportHost || host === `www.${passportHost}`) {
      const seg = request.nextUrl.pathname.replace(/^\/+/, '').split('/')[0]
      if (seg && seg !== 'go' && /^[A-Za-z0-9]{1,32}$/.test(seg)) {
        const url = request.nextUrl.clone()
        url.pathname = `/go/${seg}`
        return NextResponse.rewrite(url)
      }
      // Bare domain or a non-code path → send to the main site.
      return NextResponse.redirect('https://www.mvpaffiliate.io')
    }
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

  // ── Labs early-access gate — RETIRED 2026-07-08 ─────────────────────────
  // The shared-password (LABS_PASSWORD → labs_unlocked cookie) gate only ever
  // guarded /ltk + /api/ltk. MVP x LTK graduated out of Labs into Create (all
  // paid tiers, enforced per-route via tierAllowsFinders), so this gate now
  // protects nothing and is removed. Levanta/PartnerBoost/AMZ Finder graduated
  // earlier. The lib/labs-access + /labs-unlock infra stays dormant for any
  // future invite-only tool. Social Launch Kit (the last Labs item) is gated by
  // tier at its sidebar entry + API (canUseLabs), not by this password.

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
