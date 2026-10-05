// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ALREADY POSTED THIS PRODUCT? (Seb, 2026-10-05: recall what MVP made.)
//
// LTK, Levanta, Walmart and Wayward posts are one a day and cost about $0.50
// each, and none of the four checked whether the same product already had a
// post. Each post is now stamped with a key for what it is about (the LTK link,
// the ASIN, the Walmart item), and a second post for the same key is handed
// back before anything is written. The creator can still ask for a new one
// ("again"); fetchUnlessMade on the page asks them first.

import { NextResponse } from 'next/server'

export type Partner = 'ltk' | 'levanta' | 'walmart' | 'wayward'

/** What a partner post is about, as a stable key, or null. Pure. */
export function partnerKey(partner: Partner, raw: string | null | undefined): string | null {
  let v = String(raw || '').trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v)
      v = `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`
    } catch { /* keep as typed */ }
  }
  v = v.toLowerCase().slice(0, 200)
  return `${partner}:${v}`
}

/** The deal_meta to stamp on the post's row. Pure. */
export function partnerMeta(partner: Partner, key: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return key ? { kind: partner, key, ...extra } : { kind: partner, ...extra }
}

/**
 * A 409 handing back the earlier post for this key, or null to go ahead.
 * `legacyItemId` also matches Walmart posts stamped before keys existed.
 */
export async function partnerAlreadyMade(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, userId: string, key: string | null, again: unknown, legacyItemId?: string | null,
): Promise<NextResponse | null> {
  if (again === true || !key) return null
  try {
    const find = async (col: string, val: string) => {
      const { data } = await db.from('blog_posts').select('id, title, wordpress_url, created_at')
        .eq('user_id', userId).eq(col, val).not('wordpress_url', 'is', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      return data as { id: string; title: string | null; wordpress_url: string } | null
    }
    const hit = (await find('deal_meta->>key', key)) || (legacyItemId ? await find('deal_meta->>itemId', legacyItemId) : null)
    if (!hit) return null
    const title = (hit.title || 'your earlier post').slice(0, 140)
    return NextResponse.json({
      ok: false, alreadyMade: true, url: hit.wordpress_url, title, postId: hit.id,
      error: `You already have a post for this product: "${title}". Nothing new was written.`,
    }, { status: 409 })
  } catch { return null } // a lookup hiccup never blocks a post
}
