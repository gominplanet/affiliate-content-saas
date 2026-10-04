import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createFacebookService } from '@/services/facebook'
import { normalizeTier } from '@/lib/tier'
import { resolveSocialAccounts } from '@/lib/social-accounts'
import { metaEnabledForUser } from '@/lib/feature-flags'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { isFacebookGroupLink } from '@/lib/facebook-group-link'

export const maxDuration = 30

// SHARE THE GROUP POST ON THE PAGE.
//
// After the creator presses Post on a Group post SCOUT filled, MVP offers a
// short Page post that points at it. The link MUST be the creator's Facebook
// Group (ideally the exact post): that is the whole point, since a link to a
// Facebook property does not leave Facebook. Anything else is refused here,
// so this route can never become a second way to post outside links.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!(await metaEnabledForUser(supabase, user))) return NextResponse.json({ error: 'Facebook publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

    const body = await request.json() as { message?: string; link?: string; socialAccountId?: string }
    const message = String(body.message || '').trim().slice(0, 5000)
    const link = String(body.link || '').trim()
    if (!message) return NextResponse.json({ error: 'Write a line or two for the Page post first.' }, { status: 400 })
    if (!isFacebookGroupLink(link)) return NextResponse.json({ error: 'The link has to be your Facebook Group or a post in it (facebook.com/groups/…).' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('facebook_page_id,facebook_page_access_token,facebook_page_name,tier')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = decryptIntegrationRow(intRow as any)
    const tier = normalizeTier(integration?.tier)
    const isPro = ['pro', 'admin'].includes(tier)
    const accounts = await resolveSocialAccounts(supabase, user.id, 'facebook', {
      socialAccountIds: body.socialAccountId ? [body.socialAccountId] : [],
      allowSelection: isPro,
      limit: 1,
      legacy: {
        externalId: integration?.facebook_page_id,
        accessToken: integration?.facebook_page_access_token,
        displayName: integration?.facebook_page_name,
      },
    })
    const acct = accounts[0]
    if (!acct) return NextResponse.json({ error: 'No Facebook Page is connected. Connect one in Integrations.' }, { status: 400 })

    // THE LINK GOES IN THE TEXT, never as Facebook's link attachment. Given a
    // Group post as the attachment, Facebook treats it as a share of that post
    // and refuses it from a Page ("the post that you're sharing couldn't be
    // loaded", subcode 1609008). Written in the text it is a plain link that
    // opens the Group post, the same way the Page Reel's "Get it here" does.
    const text = message.includes(link) ? message : `${message}\n\n${link}`
    const r = await createFacebookService(acct.accessToken, acct.externalId).postText({ message: text })
    return NextResponse.json({ ok: true, id: r.id, page: acct.displayName, link })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Facebook post failed' }, { status: 502 })
  }
}
