// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /v/[code] — where a QR burned into a YouTube video sends a scan
// (migration 441, docs/qr-on-youtube-plan.md).
//
// Public, no session: it is scanned off a television by somebody who has
// never heard of MVP. Two small indexed reads and a 302, with the scan logged
// after the response so the visitor never waits on it.
//
// IT NEVER SENDS ANYONE TO AMAZON. Not as a fallback, not on an error, not
// when the code is unknown. /go/<code> is the Passport redirect and ends at
// Amazon with the creator's tag; this one ends at content the creator owns,
// and the entire compliance argument for putting a QR on a television rests
// on that difference. Every exit from this file goes through resolveCode or
// to MVP's own home page.
//
// IT KEEPS WORKING FOR EVER. No tier check and no subscription check: the
// video is on YouTube with our code burned into it whether or not the creator
// still pays, and a dead QR in somebody's published work is a promise broken
// in public.

import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCode, neverAmazon, CODE_RE } from '@/lib/video-codes'
import { parseUserAgent } from '@/lib/passport-links'
import { blogPostUrlForAsin } from '@/lib/pinterest-pin-dest-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Where a scan goes when there is nothing to resolve. MVP's own home page:
 *  the visitor did nothing wrong and deserves somewhere real, and this is the
 *  one place in this file that is allowed to be a guess. */
const APP_HOME = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io'

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code: raw } = await ctx.params
  const code = (raw || '').trim()
  if (!CODE_RE.test(code)) return NextResponse.redirect(APP_HOME, 302)

  try {
    const admin = createAdminClient()
    // select('*') rather than a named list, for the reason /go/[code] does it:
    // PostgREST rejects an entire read over one column it does not know, which
    // would mean every QR on every published video stops resolving the moment
    // this deploys ahead of a migration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (admin as any)
      .from('video_codes').select('*').eq('code', code).maybeSingle()
    if (!row) return NextResponse.redirect(APP_HOME, 302)

    const userId = row.user_id as string
    const asin = (row.asin as string | null) || ''
    // The two live lookups, together: the creator's own post for this product
    // if they have written one since the burn, and the handle their shop is on
    // now. Either failing leaves the stored fallback in place.
    const [postUrl, handle] = await Promise.all([
      asin ? blogPostUrlForAsin(admin, userId, asin).catch(() => null) : Promise.resolve(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any).from('link_pages').select('handle').eq('user_id', userId).eq('published', true)
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()
        .then((r: { data: { handle?: string } | null }) => r.data?.handle || null, () => null),
    ])

    const dest = resolveCode(row, { appUrl: APP_HOME, liveHandle: handle, livePostUrl: postUrl })
    // THE LAST GATE. resolveCode already refuses an Amazon destination; this
    // asks again on the way out, because the one thing that must never happen
    // here is worth two checks in different places.
    if (!dest || neverAmazon(dest.url)) return NextResponse.redirect(APP_HOME, 302)

    const ua = parseUserAgent(req.headers.get('user-agent'))
    const country = req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || null
    after(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from('video_code_scans').insert({
          code, user_id: userId, country, device: ua.device, browser: ua.browser, os: ua.os,
        })
      } catch { /* a scan we could not log is still a scan we served */ }
    })

    return NextResponse.redirect(dest.url, 302)
  } catch {
    return NextResponse.redirect(APP_HOME, 302)
  }
}
