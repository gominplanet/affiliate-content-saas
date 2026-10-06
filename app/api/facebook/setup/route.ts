// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/facebook/setup  where the creator's Facebook setup stands: the Page,
//                           their Meta One plan, how many outside-link posts
//                           MVP put on the Page since the allowance last reset,
//                           and the Groups saved for Fill with SCOUT.
// POST /api/facebook/setup  { plan, renewsDay }      the Meta One plan, and
//                                                    the day a paid plan renews
//                           { group: { name, url } }  save a Group
//                           { removeGroup: url }      forget a Group
//
// One page for the whole setup (app/(dashboard)/meta): "Your Page
// gets the content. Your Group gets the links."

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSocialAccount } from '@/lib/social-accounts'
import { isFacebookGroupLink } from '@/lib/facebook-group-link'
import { cleanNicheGroup, type NicheGroup } from '@/lib/facebook-niche'
import { facebookSetupEnabled, readLinkBudget, cleanPlan, META_PLANS } from '@/lib/facebook-link-budget'

export const dynamic = 'force-dynamic'

type Group = NicheGroup

function cleanGroups(raw: unknown): Group[] {
  if (!Array.isArray(raw)) return []
  return raw.map(cleanNicheGroup).filter((g): g is Group => !!g)
}

/** A Group link in its plain form: https://www.facebook.com/groups/<slug>/ */
function groupUrl(raw: string): string | null {
  const s = String(raw || '').trim()
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  if (!isFacebookGroupLink(withScheme.replace(/^http:/i, 'https:'))) return null
  const u = new URL(withScheme.replace(/^http:/i, 'https:'))
  const slug = u.pathname.split('/')[2]
  return slug ? `https://www.facebook.com/groups/${slug}/` : null
}

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (admin as any).from('integrations')
    .select('tier,facebook_page_id,facebook_page_access_token,facebook_page_name,instagram_access_token,instagram_user_id,instagram_username').eq('user_id', user.id).maybeSingle()
  if (!facebookSetupEnabled(integ?.tier)) return { res: NextResponse.json({ ok: true, on: false }) }
  return { user, supabase, admin, integ }
}

export async function GET() {
  const g = await gate()
  if ('res' in g) return g.res
  const { user, supabase, admin, integ } = g
  let page: { id: string; name: string | null } | null = null
  try {
    const acct = await resolveSocialAccount(supabase, user.id, 'facebook', {
      socialAccountId: null, allowSelection: false,
      legacy: { externalId: integ?.facebook_page_id ?? undefined, accessToken: integ?.facebook_page_access_token ?? undefined, displayName: integ?.facebook_page_name ?? null },
    })
    if (acct) page = { id: acct.externalId, name: acct.displayName ?? null }
  } catch { page = null }
  const budget = await readLinkBudget(user.id, page?.id ?? null)
  const { data: brand } = await admin.from('brand_profiles').select('facebook_groups').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({
    ok: true, on: true,
    page,
    plan: budget.plan,
    renewsDay: budget.renewsDay,
    allowance: budget.allowance,
    used: budget.used,
    left: budget.left,
    resetsAt: budget.resetsAt,
    counted: budget.counted,
    enforced: budget.enforced,
    groups: cleanGroups((brand as { facebook_groups?: unknown } | null)?.facebook_groups),
    instagram: { connected: !!(integ?.instagram_access_token && integ?.instagram_user_id), username: integ?.instagram_username ?? null },
  })
}

export async function POST(req: Request) {
  const g = await gate()
  if ('res' in g) return g.res
  const { user, admin } = g
  const body = await req.json().catch(() => ({})) as { plan?: unknown; renewsDay?: unknown; group?: { name?: unknown; url?: unknown; niche?: unknown; keywords?: unknown }; removeGroup?: unknown; updateGroup?: { url?: unknown; niche?: unknown; keywords?: unknown; name?: unknown } }

  if (body.plan !== undefined) {
    const plan = META_PLANS.some((p) => p.plan === body.plan) ? cleanPlan(body.plan) : null
    if (!plan) return NextResponse.json({ error: 'Choose one of the answers.' }, { status: 400 })
    const renews = META_PLANS.find((p) => p.plan === plan)?.renews === true
    const d = Math.floor(Number(body.renewsDay))
    const renewsDay = renews && d >= 1 && d <= 31 ? d : null
    // The day a paid plan renews is its own column (migration 401), written
    // apart so a database with only migration 400 still keeps the plan.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from('integrations').update({ facebook_link_limit: plan, facebook_link_allowance: null }).eq('user_id', user.id)
    if (error) {
      return NextResponse.json({ error: /facebook_link/.test(error.message || '') ? 'The database is missing migration 400, so the answer could not be saved.' : `Could not save: ${error.message}` }, { status: 500 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dayErr } = await (admin as any).from('integrations').update({ facebook_link_renews_day: renewsDay }).eq('user_id', user.id)
    if (dayErr && renewsDay != null) {
      return NextResponse.json({ ok: true, warning: 'Your plan is saved, but the renewal day needs migration 401, so MVP counts from the 1st for now.' })
    }
    return NextResponse.json({ ok: true })
  }

  if (body.group || body.removeGroup || body.updateGroup) {
    const { data: brand } = await admin.from('brand_profiles').select('user_id,facebook_groups').eq('user_id', user.id).maybeSingle()
    if (!brand) return NextResponse.json({ error: 'Set up your Brand Profile first, then add the Group here.' }, { status: 409 })
    let groups = cleanGroups((brand as { facebook_groups?: unknown }).facebook_groups)
    const txt = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
    if (body.updateGroup) {
      // A Group's niche and the words that describe it.
      const target = groupUrl(String(body.updateGroup.url || '')) ?? String(body.updateGroup.url || '')
      groups = groups.map((x) => (groupUrl(x.url) ?? x.url) === target
        ? { ...x, niche: txt(body.updateGroup!.niche, 40), keywords: txt(body.updateGroup!.keywords, 300), name: txt(body.updateGroup!.name, 80) || x.name }
        : x)
    } else if (body.removeGroup) {
      const gone = groupUrl(String(body.removeGroup)) ?? String(body.removeGroup)
      groups = groups.filter((x) => (groupUrl(x.url) ?? x.url) !== gone)
    } else {
      const url = groupUrl(String(body.group?.url || ''))
      if (!url) return NextResponse.json({ error: 'That is not a Facebook Group link. It looks like facebook.com/groups/your-group.' }, { status: 400 })
      const name = String(body.group?.name || '').trim().slice(0, 80) || 'My Group'
      if (groups.some((x) => (groupUrl(x.url) ?? x.url) === url)) return NextResponse.json({ ok: true, already: true })
      groups = [...groups, { name, url, niche: txt(body.group?.niche, 40), keywords: txt(body.group?.keywords, 300) }].slice(0, 10)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from('brand_profiles').update({ facebook_groups: groups }).eq('user_id', user.id)
    if (error) return NextResponse.json({ error: `Could not save the Group: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true, groups })
  }

  return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
}
