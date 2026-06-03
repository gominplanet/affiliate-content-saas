/**
 * GET /api/v1/me
 *
 * Returns the authenticated caller's identity + tier + monthly quotas.
 * The hello-world of the API surface — confirms a Bearer token is wired
 * correctly and shows the rate-limit / quota context the rest of the API
 * operates under.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiKey, apiAuthErrorResponse } from '@/lib/api-keys'
import { createAdminClient } from '@/lib/supabase/admin'
import { TIERS, normalizeTier } from '@/lib/tier'

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req)
  if (!auth.ok) {
    const { status, body } = apiAuthErrorResponse(auth.error)
    return NextResponse.json(body, { status })
  }

  const admin = createAdminClient()
  // Tier comes from integrations; email comes from auth.users (the canonical
  // source — integrations doesn't store email).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await admin
    .from('integrations')
    .select('tier')
    .eq('user_id', auth.caller.userId)
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userRow } = await admin.auth.admin.getUserById(auth.caller.userId)

  const tier = normalizeTier(integ?.tier)
  const limits = TIERS[tier]

  return NextResponse.json({
    user: {
      id: auth.caller.userId,
      email: userRow?.user?.email ?? null,
      tier,
    },
    limits: {
      blogPostsPerMonth: limits.postsPerMonth ?? null,
      thumbnailsPerMonth: limits.thumbnailsPerMonth ?? null,
      scriptsPerMonth: limits.scriptsPerMonth ?? null,
      assistantMessagesPerMonth: limits.assistantMessagesPerMonth ?? null,
      allowedSocials: (limits.socials as readonly string[]) ?? [],
    },
  })
}
