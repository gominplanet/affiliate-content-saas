/**
 * GET  /api/geniuslink/groups  — list the user's Geniuslink groups.
 * POST /api/geniuslink/groups  { name } — create a new group.
 *
 * Read-only visibility + creation of the Geniuslink groups MVP routes links
 * into (per-blog, MVP-YOUTUBE, per social platform). Geniuslink's API has no
 * rename/delete, so this exposes exactly what it supports. Creds come from the
 * user's own connected Geniuslink account (integrations.geniuslink_api_*).
 */
import { NextResponse } from 'next/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { createServerClient } from '@/lib/supabase/server'
import { createGeniuslinkService } from '@/services/geniuslink'
import { sanitizeGeniuslinkGroupName } from '@/lib/geniuslink-group'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'

async function creds(): Promise<{ key: string; secret: string } | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: raw } = await supabase
    .from('integrations')
    .select('geniuslink_api_key,geniuslink_api_secret')
    .eq('user_id', user.id).maybeSingle()
  // DECRYPT. Both columns are encrypted at rest and this endpoint sent the
  // ciphertext to Geniuslink as the key, which answers 401. The sibling
  // /api/geniuslink/test DOES decrypt, so one settings screen reported
  // "Working — 14 groups" from the test button and "401 Unauthorized" from the
  // group list at the same moment. A creator reported exactly that pair.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = decryptIntegrationRow(raw as any)
  const key = (data?.geniuslink_api_key || '').trim()
  const secret = (data?.geniuslink_api_secret || '').trim()
  if (!key || !secret) return null
  return { key, secret }
}

export async function GET() {
  try {
    const c = await creds()
    if (!c) return NextResponse.json({ error: 'Connect Geniuslink first (Brand → Affiliate links).', connected: false }, { status: 400 })
    const svc = createGeniuslinkService(c.key, c.secret)
    const groups = await svc.listGroups()
    return NextResponse.json({
      connected: true,
      groups: groups
        .map((g) => ({ id: g.Id, name: g.Name, enabled: g.Enabled === 1 }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (err) {
    console.error('[geniuslink/groups GET]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't load your Geniuslink groups just now. Please try again in a moment.") }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const c = await creds()
    if (!c) return NextResponse.json({ error: 'Connect Geniuslink first (Brand → Affiliate links).' }, { status: 400 })
    const body = await request.json().catch(() => ({})) as { name?: string }
    const name = sanitizeGeniuslinkGroupName(body.name)
    if (!name) return NextResponse.json({ error: 'Enter a group name (letters, numbers, hyphens; up to 20 characters).' }, { status: 400 })

    const svc = createGeniuslinkService(c.key, c.secret)
    // Reuse an existing group of the same name rather than erroring/duplicating.
    const id = await svc.getOrCreateGroupId(name)
    if (!id) return NextResponse.json({ error: 'Geniuslink didn’t accept that group name. Try a shorter, simpler name.' }, { status: 502 })
    return NextResponse.json({ ok: true, group: { id, name } })
  } catch (err) {
    console.error('[geniuslink/groups POST]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't create that group just now. Please try again in a moment.") }, { status: 500 })
  }
}
