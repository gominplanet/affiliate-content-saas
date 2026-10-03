// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/facebook/setup  where the creator's Facebook setup stands: the Page,
//                           their answer about Meta's link limit, how many
//                           outside-link posts MVP put on the Page in the last
//                           30 days, and the Groups saved for Fill with SCOUT.
// POST /api/facebook/setup  { linkLimit, allowance }  the link-limit answer
//                           { group: { name, url } }  save a Group
//                           { removeGroup: url }      forget a Group
//
// One page for the whole setup (app/(dashboard)/facebook-setup): "Your Page
// gets the content. Your Group gets the links."

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSocialAccount } from '@/lib/social-accounts'
import { isFacebookGroupLink } from '@/lib/facebook-group-link'
import {
  facebookSetupEnabled, readLinkBudget, cleanAnswer, ALLOWANCE_CHOICES, LINK_WINDOW_DAYS,
} from '@/lib/facebook-link-budget'

export const dynamic = 'force-dynamic'

type Group = { name: string; url: string }

function cleanGroups(raw: unknown): Group[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((g) => g && typeof g === 'object' && typeof (g as Group).url === 'string')
    .map((g) => ({ name: String((g as Group).name || '').slice(0, 80), url: String((g as Group).url).trim() }))
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
    .select('tier,facebook_page_id,facebook_page_access_token,facebook_page_name').eq('user_id', user.id).maybeSingle()
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
    linkLimit: budget.answer,
    allowance: budget.allowance,
    used: budget.used,
    left: budget.left,
    counted: budget.counted,
    enforced: budget.enforced,
    windowDays: LINK_WINDOW_DAYS,
    groups: cleanGroups((brand as { facebook_groups?: unknown } | null)?.facebook_groups),
  })
}

export async function POST(req: Request) {
  const g = await gate()
  if ('res' in g) return g.res
  const { user, admin } = g
  const body = await req.json().catch(() => ({})) as { linkLimit?: unknown; allowance?: unknown; group?: { name?: unknown; url?: unknown }; removeGroup?: unknown }

  if (body.linkLimit !== undefined) {
    const answer = cleanAnswer(body.linkLimit)
    if (!answer) return NextResponse.json({ error: 'Choose one of the answers.' }, { status: 400 })
    const n = Number(body.allowance)
    const allowance = answer === 'limited' && (ALLOWANCE_CHOICES as readonly number[]).includes(n) ? n : null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from('integrations').update({ facebook_link_limit: answer, facebook_link_allowance: allowance }).eq('user_id', user.id)
    if (error) {
      return NextResponse.json({ error: /facebook_link/.test(error.message || '') ? 'The database is missing migration 400, so the answer could not be saved.' : `Could not save: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  if (body.group || body.removeGroup) {
    const { data: brand } = await admin.from('brand_profiles').select('user_id,facebook_groups').eq('user_id', user.id).maybeSingle()
    if (!brand) return NextResponse.json({ error: 'Set up your Brand Profile first, then add the Group here.' }, { status: 409 })
    let groups = cleanGroups((brand as { facebook_groups?: unknown }).facebook_groups)
    if (body.removeGroup) {
      const gone = groupUrl(String(body.removeGroup)) ?? String(body.removeGroup)
      groups = groups.filter((x) => (groupUrl(x.url) ?? x.url) !== gone)
    } else {
      const url = groupUrl(String(body.group?.url || ''))
      if (!url) return NextResponse.json({ error: 'That is not a Facebook Group link. It looks like facebook.com/groups/your-group.' }, { status: 400 })
      const name = String(body.group?.name || '').trim().slice(0, 80) || 'My Group'
      if (groups.some((x) => (groupUrl(x.url) ?? x.url) === url)) return NextResponse.json({ ok: true, already: true })
      groups = [...groups, { name, url }].slice(0, 10)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from('brand_profiles').update({ facebook_groups: groups }).eq('user_id', user.id)
    if (error) return NextResponse.json({ error: `Could not save the Group: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true, groups })
  }

  return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
}
