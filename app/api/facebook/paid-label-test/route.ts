// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/facebook/paid-label-test — team only. Does Facebook accept the
// "Paid partnership" label on a Page post MVP makes (Seb, 2026-10-29: "yes
// run the test")? Facebook's label comes from tagging the paying brand's
// Page (sponsor_id); for an Amazon affiliate post that is Amazon. On the
// team member's own connected Page this makes a HIDDEN post (published=false,
// which followers never see) with Amazon tagged, reads back what Facebook
// kept, and deletes it; then the same with is_paid_partnership and no brand.
// Every step comes back with Facebook's own words, so a refusal is never
// mistaken for a pass. Nothing is left on the Page.
//
// Body: { partnerPageId?: string } to use a Page id the member found
// themselves (Page Transparency on Amazon's Page) instead of the lookup.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { maybeDecrypt } from '@/lib/secrets'
import { normalizeTier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FB = 'https://graph.facebook.com/v22.0'
/** Tried when the lookup by name is refused; confirmed by reading its name. */
const AMAZON_PAGE_GUESS = '9465008123'

type Step = { step: string; ok: boolean; said: string }

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    return { ok: res.ok && !data.error, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: { error: { message: e instanceof Error ? e.message : 'no answer' } } }
  }
}
const said = (d: Record<string, unknown>) => {
  const e = d.error as { message?: string; code?: number; error_subcode?: number } | undefined
  return e ? `${e.message ?? 'Facebook refused'}${e.code != null ? ` (code ${e.code}${e.error_subcode ? `, ${e.error_subcode}` : ''})` : ''}` : JSON.stringify(d).slice(0, 300)
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() // eslint-disable-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (admin as any).from('integrations').select('tier,facebook_page_id,facebook_page_name,facebook_page_access_token').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(integ?.tier) !== 'admin') return NextResponse.json({ error: 'Team only.' }, { status: 403 })
  const pageId = String(integ?.facebook_page_id || '')
  const token = maybeDecrypt(integ?.facebook_page_access_token) || ''
  if (!pageId || !token) return NextResponse.json({ error: 'Connect a Facebook Page in Connect Socials first.' }, { status: 400 })
  const body = await request.json().catch(() => ({})) as { partnerPageId?: string }
  const steps: Step[] = []
  const t = encodeURIComponent(token)

  // 1. Amazon's Page.
  let partner = /^\d{5,20}$/.test(String(body.partnerPageId || '').trim()) ? String(body.partnerPageId).trim() : ''
  let partnerName: string | null = null
  if (partner) {
    const r = await call(`${FB}/${partner}?fields=id,name&access_token=${t}`)
    partnerName = r.ok ? String(r.data.name ?? '') || null : null
    steps.push({ step: `The partner Page you gave (${partner})`, ok: true, said: partnerName ? `Facebook says it is "${partnerName}".` : `Facebook did not say its name: ${said(r.data)}` })
  } else {
    const byName = await call(`${FB}/amazon?fields=id,name&access_token=${t}`)
    if (byName.ok && byName.data.id) {
      partner = String(byName.data.id); partnerName = String(byName.data.name ?? '') || null
      steps.push({ step: 'Find Amazon\'s Page', ok: true, said: `Found "${partnerName}" (${partner}).` })
    } else {
      const guess = await call(`${FB}/${AMAZON_PAGE_GUESS}?fields=id,name&access_token=${t}`)
      if (guess.ok && /amazon/i.test(String(guess.data.name ?? ''))) {
        partner = AMAZON_PAGE_GUESS; partnerName = String(guess.data.name)
        steps.push({ step: 'Find Amazon\'s Page', ok: true, said: `Looking up by name was refused (${said(byName.data)}), but ${AMAZON_PAGE_GUESS} is "${partnerName}".` })
      } else {
        steps.push({ step: 'Find Amazon\'s Page', ok: false, said: `Facebook would not look it up: ${said(byName.data)}. Paste Amazon's Page ID (on Amazon's Facebook Page, Page Transparency, See all) and run the test again.` })
      }
    }
  }

  // 2 and 3. Hidden posts, each read back and deleted.
  const tryPost = async (label: string, extra: Record<string, string>, canReadBack: boolean) => {
    const form = new URLSearchParams({ message: 'MVP test: checking whether Facebook keeps the Paid partnership label on a post MVP makes. Hidden, and deleted straight away.', published: 'false', access_token: token, ...extra })
    const made = await call(`${FB}/${pageId}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() })
    const postId = String(made.data.id ?? '')
    if (!made.ok || !postId) { steps.push({ step: `${label}: make the hidden post`, ok: false, said: `Facebook refused: ${said(made.data)}` }); return false }
    steps.push({ step: `${label}: make the hidden post`, ok: true, said: `Facebook accepted it (post ${postId}).` })
    let kept = false
    try {
      if (!canReadBack) {
        steps.push({ step: `${label}: read it back`, ok: false, said: 'Facebook took the post, but no field says whether a label with no brand is on, so this does not show that it works.' })
        return false
      }
      const back = await call(`${FB}/${postId}?fields=id,is_published,sponsor_tags{id,name}&access_token=${t}`)
      const tags = ((back.data.sponsor_tags as { data?: { id?: string; name?: string }[] } | undefined)?.data ?? [])
      kept = tags.length > 0
      steps.push({ step: `${label}: read it back`, ok: kept, said: back.ok ? (kept ? `The post carries the partner tag: ${tags.map((x) => x.name || x.id).join(', ')}. That is what shows "Paid partnership".` : 'Facebook made the post but kept no partner tag, so it would show no label.') : `Facebook did not say: ${said(back.data)}` })
    } finally {
      const del = await call(`${FB}/${postId}?access_token=${t}`, { method: 'DELETE' })
      steps.push({ step: `${label}: delete the hidden post`, ok: del.ok, said: del.ok ? 'Deleted.' : `NOT deleted, please remove it from your Page: ${said(del.data)}` })
    }
    return kept
  }
  const withAmazon = partner ? await tryPost(`With ${partnerName || 'the partner'} tagged`, { sponsor_id: partner, direct_share_status: '0' }, true) : false
  await tryPost('With the label and no brand', { is_paid_partnership: 'true' }, false)

  const verdict = withAmazon
    ? `Facebook keeps the label when ${partnerName || 'the partner'} is tagged, so MVP can add it to Facebook posts.`
    : partner
      ? `Facebook did not keep ${partnerName || 'the partner'} as the partner, so MVP cannot add the label on Facebook this way. See Facebook's words above. The label has to be added by hand in Facebook for now; the #ad and store disclosure stay in every post.`
      : 'MVP could not find Amazon\'s Page, so the main test did not run. Paste Amazon\'s Page ID and run it again.'
  return NextResponse.json({ ok: true, page: integ?.facebook_page_name ?? pageId, verdict, steps })
}
