/**
 * POST /api/affiliate-links/save — persist a creator's affiliate link routing
 * settings (Geniuslink API keys, link mode, Bitly token, Pinterest link pref,
 * Amazon Associates tag) onto their `integrations` row.
 *
 * Why a server route instead of a client upsert: these columns live on
 * `integrations`, which holds secrets and has tight RLS, and the newer columns
 * (blog_social_link_mode, bitly_access_token, pinterest_link_pref) may not exist
 * yet on a DB that hasn't run the latest migrations. The old client-side upsert
 * bundled everything into ONE write, so a single missing column or an RLS gap
 * silently dropped the whole save — including the API keys. This route uses the
 * service-role client (bypasses RLS) and writes the core columns first, then each
 * newer column best-effort, so the keys always persist and an un-migrated column
 * just gets skipped instead of failing the lot.
 *
 * geniuslink_api_key / _secret, bitly_access_token and amazon_associates_tag are
 * NOT in INTEGRATION_SECRET_COLUMNS (they're stored plaintext), so no encryption
 * step is needed here.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toUserMessage } from '@/lib/friendly-error'
import { snapshotActiveBlogIdentity } from '@/lib/site-identity'
import { getOwnerUserId } from '@/lib/agency'

export const dynamic = 'force-dynamic'

const LINK_MODES = new Set(['direct', 'geniuslink', 'bitly'])
const PIN_PREFS = new Set(['auto', 'blog_post', 'youtube', 'homepage'])

/**
 * GET /api/affiliate-links/save — read the current affiliate link settings.
 *
 * Reads via the service-role client with select('*'), which returns whatever
 * columns exist and never errors on a missing one. The old client-side load
 * selected the newer columns by name in one query, so a single un-migrated
 * column made the whole read fail and every field rendered blank — which looked
 * exactly like "nothing saved" even when it had saved. This never has that
 * failure mode.
 */
export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Link settings live on the OWNER's row: generation (getLinkStyle) and the
    // Geniuslink connection test both read the owner, so a VA must read/write the
    // owner too — otherwise the VA's choice saves to a row nobody generates from.
    const ownerId = await getOwnerUserId(user.id)
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any).from('integrations').select('*').eq('user_id', ownerId).maybeSingle()
    const row = (data || {}) as Record<string, unknown>

    const modeRaw = String(row.blog_social_link_mode ?? '')
    const mode = LINK_MODES.has(modeRaw) ? modeRaw : (row.wrap_blog_geniuslink === true ? 'geniuslink' : 'direct')
    const pinRaw = String(row.pinterest_link_pref ?? '')

    return NextResponse.json({
      ok: true,
      geniuslinkKey: (row.geniuslink_api_key as string) ?? '',
      geniuslinkSecret: (row.geniuslink_api_secret as string) ?? '',
      blogSocialLinkMode: mode,
      bitlyToken: (row.bitly_access_token as string) ?? '',
      pinterestLinkPref: PIN_PREFS.has(pinRaw) ? pinRaw : 'auto',
      amazonTag: (row.amazon_associates_tag as string) ?? '',
    })
  } catch (err) {
    console.error('[affiliate-links GET]', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const b = await request.json().catch(() => ({})) as {
      geniuslinkKey?: string; geniuslinkSecret?: string; blogSocialLinkMode?: string
      bitlyToken?: string; pinterestLinkPref?: string; amazonTag?: string
    }
    const mode = LINK_MODES.has(String(b.blogSocialLinkMode)) ? String(b.blogSocialLinkMode) : 'direct'
    const pin = PIN_PREFS.has(String(b.pinterestLinkPref)) ? String(b.pinterestLinkPref) : 'auto'
    const trim = (v?: string) => (v || '').trim() || null

    // Write to the OWNER's row so generation (which reads getLinkStyle for the
    // owner) actually sees the choice — a VA saving to their own row was silently
    // ignored by the generator, which is exactly "connected but publishes bare URLs".
    const ownerId = await getOwnerUserId(user.id)
    const admin = createAdminClient()

    // ── Core columns — these always exist. If this fails, the save truly failed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: coreErr } = await (admin as any).from('integrations').upsert(
      {
        user_id: ownerId,
        geniuslink_api_key: trim(b.geniuslinkKey),
        geniuslink_api_secret: trim(b.geniuslinkSecret),
        amazon_associates_tag: trim(b.amazonTag),
        // Keep the legacy boolean in sync for any older reader.
        wrap_blog_geniuslink: mode === 'geniuslink',
      },
      { onConflict: 'user_id' },
    )
    if (coreErr) {
      console.error('[affiliate-links/save] core write failed', coreErr.message)
      return NextResponse.json({ error: toUserMessage(coreErr, 'Could not save your link settings. Please try again.') }, { status: 500 })
    }

    // ── Newer columns — each best-effort so a DB missing one still saves the rest.
    const extras: Record<string, string> = {
      blog_social_link_mode: mode,
      pinterest_link_pref: pin,
    }
    // bitly_access_token is nullable — set it explicitly (clears when blank).
    const bitly = trim(b.bitlyToken)
    const skipped: string[] = []
    for (const [col, val] of Object.entries(extras)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any).from('integrations').update({ [col]: val }).eq('user_id', ownerId)
      if (error) { skipped.push(col); console.warn(`[affiliate-links/save] ${col} skipped: ${error.message}`) }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: bitlyErr } = await (admin as any).from('integrations').update({ bitly_access_token: bitly }).eq('user_id', ownerId)
    if (bitlyErr) { skipped.push('bitly_access_token'); console.warn(`[affiliate-links/save] bitly skipped: ${bitlyErr.message}`) }

    // Capture the Amazon tag (and current brand) onto the ACTIVE site's row, so
    // this tag belongs to the site the user is on right now — per-site Associates
    // tags (migration 280). Best-effort: single-site users are a no-op.
    await snapshotActiveBlogIdentity(supabase, user.id)

    return NextResponse.json({ ok: true, skipped })
  } catch (err) {
    console.error('[affiliate-links/save]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't save your link settings just now. Please try again.") }, { status: 500 })
  }
}
