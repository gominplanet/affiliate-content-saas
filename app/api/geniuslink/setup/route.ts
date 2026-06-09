/**
 * POST /api/geniuslink/setup
 *
 * One-shot setup endpoint for the per-user Geniuslink grouping rules:
 *
 *   1. MVP-YOUTUBE group   — for the YouTube Co-Pilot description path.
 *      Stored on integrations.geniuslink_youtube_group_id.
 *
 *   2. Per-site domain group — one per connected WordPress site, named
 *      after its hostname (e.g. "gominreviews.com"). Stored on
 *      wordpress_sites.geniuslink_group_id.
 *
 * For each required group the endpoint:
 *   - First looks for an existing group by name (case-insensitive exact).
 *     If found → cache the ID and report "matched-existing".
 *   - If not found, tries to auto-create the group via the Geniuslink API.
 *     On success → cache + report "auto-created".
 *   - On all-attempts failure → report "needs-manual-create" with the
 *     exact group name + a copy-paste link the user can click to create
 *     it themselves in their Geniuslink dashboard. The next generation
 *     (or another setup-run) will match the manually-created group and
 *     cache it automatically.
 *
 * Returns a structured report the UI can render as a checklist so the
 * user sees exactly what's in place vs what they still need to create.
 *
 * Idempotent: re-running when everything's already cached is a fast no-op
 * (one .select() per site + the integrations row, no Geniuslink calls).
 *
 * GET version: read-only status snapshot (same shape, no writes).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createGeniuslinkService } from '@/services/geniuslink'
import { listSites } from '@/lib/wordpress-sites'
import { groupNameForSiteUrl, YOUTUBE_COPILOT_GROUP_NAME } from '@/lib/geniuslink-group'
import { getOwnerUserId } from '@/lib/agency'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface TargetReport {
  /** Logical target. */
  kind: 'youtube' | 'site'
  /** The group name we tried to resolve. */
  groupName: string
  /** Friendly label for the UI. */
  label: string
  /** Optional WP site ID (when kind === 'site'). */
  siteId?: string
  /** Where we landed. */
  status: 'cached' | 'matched-existing' | 'auto-created' | 'needs-manual-create' | 'error'
  /** Resolved group ID (when we have one). */
  groupId?: number
  /** Human explanation for the UI. */
  detail: string
}

interface SetupResponse {
  ok: boolean
  hasCredentials: boolean
  manualCreateUrl: string
  targets: TargetReport[]
  /** Per-attempt diagnostics from createGroup() when at least one target
   *  fell through to "needs-manual-create". Empty otherwise. */
  attemptLog?: string[]
}

const GENIUSLINK_DASHBOARD = 'https://my.geni.us/groups'

async function build(write: boolean): Promise<SetupResponse> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, hasCredentials: false, manualCreateUrl: GENIUSLINK_DASHBOARD, targets: [] }
  }
  // 2026-06-09 Phase 2 (VA): Geniuslink wiring is per-workspace — VAs
  // setting up groups operate on the owner's integrations + sites.
  const ownerId = await getOwnerUserId(user.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase
    .from('integrations')
    .select('geniuslink_api_key, geniuslink_api_secret, geniuslink_youtube_group_id')
    .eq('user_id', ownerId)
    .maybeSingle() as unknown as { data: { geniuslink_api_key: string | null; geniuslink_api_secret: string | null; geniuslink_youtube_group_id: number | null } | null }

  const apiKey = intRow?.geniuslink_api_key ?? null
  const apiSecret = intRow?.geniuslink_api_secret ?? null
  const sites = await listSites(supabase, ownerId)

  // Build the target list before doing any work — used by both the
  // "no credentials" early return AND the resolve loop.
  const targets: TargetReport[] = []
  // 1) MVP-YOUTUBE (per-user, single instance).
  targets.push({
    kind: 'youtube',
    groupName: YOUTUBE_COPILOT_GROUP_NAME,
    label: 'YouTube Co-Pilot link tracking',
    status: 'error',
    detail: '',
  })
  // 2) One target per connected WP site.
  for (const s of sites) {
    const name = groupNameForSiteUrl(s.url)
    if (!name) continue
    targets.push({
      kind: 'site',
      groupName: name,
      label: `Blog: ${s.label || name}`,
      siteId: s.id,
      status: 'error',
      detail: '',
    })
  }

  if (!apiKey || !apiSecret) {
    targets.forEach(t => { t.status = 'error'; t.detail = 'Geniuslink API key/secret not connected.' })
    return { ok: false, hasCredentials: false, manualCreateUrl: GENIUSLINK_DASHBOARD, targets }
  }

  // Honor the cached YouTube ID before listing anything (fast path on re-run).
  const cachedYt = intRow?.geniuslink_youtube_group_id
  if (cachedYt) {
    const t = targets.find(x => x.kind === 'youtube')!
    t.status = 'cached'
    t.groupId = cachedYt
    t.detail = `Already cached (group ID ${cachedYt}).`
  }

  // Same for per-site IDs.
  if (sites.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await supabase
      .from('wordpress_sites')
      .select('id, geniuslink_group_id')
      .in('id', sites.map(s => s.id)) as unknown as { data: Array<{ id: string; geniuslink_group_id: number | null }> | null }
    const byId = new Map((rows ?? []).map(r => [r.id, r.geniuslink_group_id] as const))
    for (const t of targets) {
      if (t.kind !== 'site' || !t.siteId) continue
      const cached = byId.get(t.siteId) ?? null
      if (cached) {
        t.status = 'cached'
        t.groupId = cached
        t.detail = `Already cached (group ID ${cached}).`
      }
    }
  }

  // If everything is already cached, we can short-circuit.
  if (targets.every(t => t.status === 'cached')) {
    return { ok: true, hasCredentials: true, manualCreateUrl: GENIUSLINK_DASHBOARD, targets }
  }

  // For uncached targets, list groups ONCE and match against the list.
  const svc = createGeniuslinkService(apiKey, apiSecret)
  let allGroups: Array<{ Id: number; Name: string; Enabled: number }> = []
  try {
    allGroups = await svc.listGroups()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    targets.filter(t => t.status === 'error').forEach(t => {
      t.detail = `Could not list groups on your Geniuslink account: ${msg}`
    })
    return { ok: false, hasCredentials: true, manualCreateUrl: GENIUSLINK_DASHBOARD, targets }
  }

  const byNameLc = new Map(allGroups.map(g => [g.Name.trim().toLowerCase(), g.Id] as const))
  const attemptLog: string[] = []

  for (const t of targets) {
    if (t.status === 'cached') continue
    // Try name match first.
    const existing = byNameLc.get(t.groupName.trim().toLowerCase())
    if (existing) {
      t.status = 'matched-existing'
      t.groupId = existing
      t.detail = `Found an existing group named "${t.groupName}" on your account — caching now.`
      if (write) await persistGroupId(supabase, t, existing)
      continue
    }

    // No existing match → auto-create attempt.
    if (!write) {
      t.status = 'needs-manual-create'
      t.detail = `No group named "${t.groupName}" exists yet. Run setup to attempt auto-create, or create it manually in your Geniuslink dashboard.`
      continue
    }
    const created = await svc.createGroup(t.groupName)
    if (created) {
      t.status = 'auto-created'
      t.groupId = created
      t.detail = `Auto-created group "${t.groupName}" on your Geniuslink account.`
      await persistGroupId(supabase, t, created)
    } else {
      t.status = 'needs-manual-create'
      t.detail =
        `Couldn't auto-create the group (Geniuslink's API rejected every endpoint shape we know). ` +
        `Please create a group named EXACTLY "${t.groupName}" in your Geniuslink dashboard (link below). ` +
        `MVP will match it by name on the next generation.`
      attemptLog.push(`${t.groupName}: see Vercel logs for the per-shape failure report`)
    }
  }

  return {
    ok: targets.every(t => t.status !== 'error' && t.status !== 'needs-manual-create'),
    hasCredentials: true,
    manualCreateUrl: GENIUSLINK_DASHBOARD,
    targets,
    attemptLog: attemptLog.length ? attemptLog : undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function persistGroupId(supabase: any, target: TargetReport, groupId: number): Promise<void> {
  try {
    if (target.kind === 'youtube') {
      // Resolve owner again — persistGroupId doesn't carry the build()
      // closure. Still cheap: getOwnerUserId returns input directly when
      // no agency membership exists.
      const callerId = (await supabase.auth.getUser()).data.user!.id
      const ownerId = await getOwnerUserId(callerId)
      await supabase
        .from('integrations')
        .update({ geniuslink_youtube_group_id: groupId })
        .eq('user_id', ownerId)
    } else if (target.kind === 'site' && target.siteId) {
      await supabase
        .from('wordpress_sites')
        .update({ geniuslink_group_id: groupId })
        .eq('id', target.siteId)
    }
  } catch (err) {
    console.error('[geniuslink/setup] cache write failed:', err)
  }
}

export async function GET() {
  return NextResponse.json(await build(false))
}

export async function POST() {
  return NextResponse.json(await build(true))
}
