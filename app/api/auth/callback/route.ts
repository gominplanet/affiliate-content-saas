import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { reportRegistration } from '@/lib/meta-registration'
import { safeNextPath } from '@/lib/safe-next'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // SAME-ORIGIN PATHS ONLY, or a crafted link carries the fresh session
  // cookie off-site. lib/safe-next.ts holds the rules.
  const next = safeNextPath(searchParams.get('next')) ?? '/dashboard'

  if (code) {
    const supabase = await createServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // A trial registration completes HERE, when they come back through the
      // confirmation email, not on the page we send them to. Reporting it from
      // /onboarding produced zero events across the campaign's first two days
      // while the ad set optimized on exactly this event. See
      // lib/meta-registration.ts.
      //
      // Only a genuinely new account counts. Sign-in is password-based
      // (LoginForm uses signInWithPassword), so a code exchange is an email
      // confirmation rather than a login, but the age check means a future
      // magic-link or recovery flow through this route cannot re-report an old
      // account as a fresh registration. It errs towards under-counting, which
      // is the safe direction for the metric delivery is steered by.
      const user = data?.user
      const createdAt = user?.created_at ? Date.parse(user.created_at) : NaN
      const isNewAccount = Number.isFinite(createdAt) && Date.now() - createdAt < 24 * 60 * 60 * 1000
      // A TEAM INVITE IS NOT AN AD SIGNUP. Someone confirming their email on
      // the way to /agency/accept/ is joining another member's account; counted
      // as a creator registration, they inflated the number the ads optimise on.
      const joiningTeam = next.startsWith('/agency/accept/')
      if (user && isNewAccount && !joiningTeam) {
        // AWAITED, never after(). A serverless function can be frozen the
        // moment the response is returned, so an after() callback is dropped
        // mid-flight and the conversion is lost. app/api/stripe/webhook says
        // exactly this and awaits for exactly this reason, which is why
        // Purchase and InitiateCheckout have always arrived while every event
        // scheduled with after() has not: /onboarding reported zero
        // CompleteRegistrations in three days, and so did the first version of
        // this fix. The cost is a few hundred ms on a redirect the user is
        // already waiting through.
        const ok = await reportRegistration({
          userId: user.id,
          email: user.email,
          path: next.includes('for=amazon') ? 'amazon' : 'creator',
          source: 'email-confirmation',
        })
        if (!ok) console.error(`[auth/callback] CompleteRegistration NOT accepted by Meta for ${user.id}`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Carry `next` so signing in by hand still lands in the onboarding they
  // signed up for; LoginForm explains the failure and re-validates the path.
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed&next=${encodeURIComponent(next)}`)
}
