// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/idea-list/scan  { url }
//   Read an Amazon idea-list URL and return its products (first page — ~20 —
//   for a pasted URL; the SCOUT extension captures the full list separately).
//   Paid tiers only. No writes, no AI — this just parses the list.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { fetchIdeaList } from '@/lib/amazon-idea-list'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const maxDuration = 40

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier === 'trial') return NextResponse.json({ error: 'Turning idea lists into posts is a paid feature.' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { url?: string }
    const url = (body.url || '').trim()
    if (!url) return NextResponse.json({ error: 'Paste your Amazon idea-list link.' }, { status: 400 })

    const parsed = await fetchIdeaList(url)
    return NextResponse.json({
      ok: true,
      title: parsed.title,
      declaredCount: parsed.declaredCount,
      items: parsed.items,
      partial: parsed.partial,
    })
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err, 'Could not read that list. Double-check the link, or use the SCOUT extension.') }, { status: 400 })
  }
}
