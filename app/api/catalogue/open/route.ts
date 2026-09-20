// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/catalogue/open — the run this creator already has going, if any.
//
// WHY THIS EXISTS. The page used to know nothing until you pressed Find, so
// someone with a run already open would paste a single video, get "you already
// have a run open, press Start a different run", and find no such button on
// screen, because the button only appears once the page is holding a run. The
// instruction was correct and impossible to follow.
//
// Loading this on mount means the screen reflects what is actually happening
// before anybody presses anything, which is also just the right answer: a run
// left going in another tab yesterday should be visible when you come back.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** The states start/ treats as an open run. Kept identical on purpose: a screen
 *  that disagrees with the route about what counts as open is the same trap. */
const OPEN_STATES = ['queued', 'scanning']

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb.from('catalogue_runs')
    .select('id,domains,domain,state,created_at')
    .eq('user_id', user.id).in('state', OPEN_STATES)
    .order('created_at', { ascending: false }).limit(1)

  const run = Array.isArray(data) && data.length > 0 ? data[0] : null
  if (!run) return NextResponse.json({ ok: true, run: null })

  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      domains: Array.isArray(run.domains) && run.domains.length > 0
        ? run.domains
        : [run.domain].filter(Boolean),
      state: run.state,
      createdAt: run.created_at,
    },
  })
}
