// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// This deployment's own absolute base URL, for the workers that call back into
// their own routes.
//
// ONE COPY. It lived inside lib/generation-job-runner, and the launch-batch
// worker needed the same three lines. Two copies of "where am I" is the kind of
// duplication that stays correct right up until one deployment sets
// NEXT_PUBLIC_APP_URL and the other worker keeps calling a preview URL.

/** The absolute origin this deployment answers on, with no trailing slash. */
export function resolveSelfBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

/**
 * POST to one of our own routes in service mode, following redirect chains by
 * hand.
 *
 * NEVER AUTO-FOLLOW. NEXT_PUBLIC_APP_URL is the non-www canonical and the
 * domain layer 30x-redirects non-www to www. fetch's auto-follow DOWNGRADES a
 * POST to GET on a 301 or 302, which lands on a route with no GET handler and
 * comes back 405. That cost a production afternoon once already, and the
 * redirect can stack with trailing-slash normalization, so one manual hop was
 * not enough either.
 */
export async function postToSelf(opts: {
  path: string
  userId: string
  body: unknown
  timeoutMs: number
}): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET not set, so there is no way to make the internal service call')

  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-mvp-service': secret,
      'x-mvp-service-user': opts.userId,
    },
    body: JSON.stringify(opts.body ?? {}),
    redirect: 'manual',
  }

  // ONE BUDGET FOR THE WHOLE THING, hops included. Made once outside the loop
  // on purpose: a fresh timeout per hop would let a redirect chain spend the
  // full budget five times over, and this call already sits inside a cron
  // route with a hard ceiling of its own.
  const deadline = AbortSignal.timeout(opts.timeoutMs)

  let url = `${resolveSelfBaseUrl()}${opts.path}`
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { ...init, signal: deadline })
    if (res.status < 300 || res.status >= 400) return res
    const next = res.headers.get('location')
    if (!next) return res
    url = next.startsWith('http') ? next : `${resolveSelfBaseUrl()}${next}`
  }
  throw new Error(`the internal call to ${opts.path} is stuck in a redirect loop`)
}
