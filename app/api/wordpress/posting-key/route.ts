/**
 * POST /api/wordpress/posting-key
 *
 * Persists a manually-pasted "Posting Key" (the body-auth proxy secret
 * minted by mvpaffiliate-platform v1.0.26+) to wordpress_sites.api_token.
 *
 * Needed when MVP can't auto-fetch the key from /affiliateos/v1/status —
 * which happens on hosts that strip the Authorization header on POSTs
 * (SiteGround, Hostinger LiteSpeed, some shared Apache configs). The
 * user copies the key from their wp-admin admin notice and pastes it
 * here; from then on, lib/wp-proxy.ts uses the body-auth /proxy endpoint
 * for every write, sidestepping the broken Authorization header.
 *
 * Body: { siteId: string, postingKey: string }
 *
 * The siteId is optional — when omitted we update the user's default
 * site (matches getWordPressCredentials(... null)). This makes the
 * single-site case trivially scriptable.
 *
 * Validation:
 *   - Key must be a 64-char hex string (32 bytes — plugin's wp_generate_password
 *     output, bin2hex(random_bytes(32))). Reject anything else early so
 *     typos surface before they hit /proxy.
 *   - Trim whitespace + lowercase before validation; users often paste with
 *     trailing newline or accidental space.
 *   - On match, write to api_token. The next post attempt will use it.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { maybeEncrypt } from '@/lib/secrets'

const HEX64 = /^[a-f0-9]{64}$/

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { siteId?: string; postingKey?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const raw = (body.postingKey || '').trim().toLowerCase()
  if (!raw) {
    return NextResponse.json({ error: 'Posting Key is required.' }, { status: 400 })
  }
  if (!HEX64.test(raw)) {
    return NextResponse.json({
      error: 'That doesn\'t look like a Posting Key. It should be 64 lowercase hex characters (a-f, 0-9). Copy it again from wp-admin → MVP Affiliate Posting Key notice.',
    }, { status: 400 })
  }

  // Find the target site. If siteId given → exact match scoped to this user.
  // Otherwise → user's primary site (first one).
  let siteRow: { id: string } | null = null
  if (body.siteId) {
    const { data } = await supabase
      .from('wordpress_sites')
      .select('id')
      .eq('user_id', user.id)
      .eq('id', body.siteId)
      .maybeSingle()
    siteRow = data
  } else {
    const { data } = await supabase
      .from('wordpress_sites')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    siteRow = data
  }

  if (!siteRow) {
    return NextResponse.json({
      error: 'No WordPress site found for this account. Connect a site first, then come back here.',
    }, { status: 404 })
  }

  // Encrypt at rest (2026-06-02 secrets rollout). Reads go through
  // maybeDecrypt() in rowToSite/getDefaultSite, so this is transparent
  // to downstream code.
  const { error: updateErr } = await supabase
    .from('wordpress_sites')
    .update({ api_token: maybeEncrypt(raw) })
    .eq('id', siteRow.id)
    .eq('user_id', user.id) // belt + suspenders — RLS would also enforce this

  if (updateErr) {
    return NextResponse.json({
      error: 'Failed to save the Posting Key — please try again.',
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, siteId: siteRow.id })
}
