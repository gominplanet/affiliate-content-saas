// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/instagram/dm-posts — the account's recent Instagram posts, each
//      saying what a keyword comment on it sends today, plus the last comments
//      MVP received on Instagram and Facebook and what happened to each.
// POST /api/instagram/dm-posts { mediaId, keyword, link, label? } — give one
//      existing post its own keyword and link (an ig_dm_campaigns row, the
//      same row a Reel published with Auto-DM gets). Turning one off is the
//      existing DELETE /api/instagram/dm-campaign?id=.
//
// WHY (Seb, 2026-10-09). Auto-DM only knew posts MVP had published. Most
// creators post from the Instagram app, and those comments were dropped. Labs,
// admin only, like the page.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { maybeDecrypt } from '@/lib/secrets'
import { normalizeTier } from '@/lib/tier'
import { listRecentMedia, ownsMedia } from '@/services/instagram'
import { fallbackDmLink, anyPostOn, type DmSettings } from '@/lib/ig-dm'
import { dmLogWords } from '@/lib/dm-log-words'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient() as Db
  const { data: integ } = await admin.from('integrations')
    .select('tier,instagram_user_id,instagram_access_token')
    .eq('user_id', user.id).maybeSingle()
  if (normalizeTier(integ?.tier) !== 'admin') return { error: NextResponse.json({ error: 'Labs is not open on this account.' }, { status: 403 }) }
  const token = maybeDecrypt(integ?.instagram_access_token as string | null | undefined) || null
  return { userId: user.id, admin, token, igUserId: (integ?.instagram_user_id as string | null) ?? null }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const { admin, userId, token, igUserId } = g

  const [{ data: settingsRow }, { data: campaigns }, { data: log }] = await Promise.all([
    admin.from('ig_dm_settings').select('*').eq('user_id', userId).maybeSingle(),
    admin.from('ig_dm_campaigns').select('id,ig_media_id,keyword,link,product_name,status').eq('user_id', userId),
    admin.from('ig_dm_sends').select('platform,status,error,keyword,link_sent,created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(25),
  ])
  const settings = (settingsRow ?? null) as DmSettings | null
  const fallback = await fallbackDmLink(admin, userId, settings)

  let media: Awaited<ReturnType<typeof listRecentMedia>>['media'] = []
  let mediaError: string | null = null
  if (token && igUserId) {
    const r = await listRecentMedia({ igUserId, accessToken: token, limit: 30 })
    media = r.media
    mediaError = r.error
  } else {
    mediaError = 'Instagram is not connected in MVP.'
  }

  // Which of these posts MVP published (they send their own product link).
  const ids = media.map((m) => m.id)
  const mvpIds = new Set<string>()
  if (ids.length) {
    const list = ids.join(',')
    const { data: posts } = await admin.from('blog_posts')
      .select('instagram_image_post_id,instagram_reel_id,instagram_story_id')
      .eq('user_id', userId)
      .or(`instagram_image_post_id.in.(${list}),instagram_reel_id.in.(${list}),instagram_story_id.in.(${list})`)
    for (const p of posts ?? []) {
      for (const k of ['instagram_image_post_id', 'instagram_reel_id', 'instagram_story_id']) if (p[k]) mvpIds.add(String(p[k]))
    }
  }
  const byMedia = new Map<string, { id: string; keyword: string; link: string; product_name: string | null; status: string }>()
  for (const c of campaigns ?? []) if (c.ig_media_id) byMedia.set(String(c.ig_media_id), c)

  const keyword = settings?.keyword || 'LINK'
  const posts = media.map((m) => {
    const c = byMedia.get(m.id)
    // WHAT A KEYWORD COMMENT SENDS, worked out the same way the webhook does,
    // so the list shows the result rather than the intention.
    const sends = c && c.status === 'active'
      ? { kind: 'own' as const, keyword: c.keyword, link: c.link }
      : mvpIds.has(m.id)
        ? { kind: 'mvp' as const, keyword, link: null }
        : anyPostOn(settings) && fallback
          ? { kind: 'backup' as const, keyword, link: fallback }
          : { kind: 'nothing' as const, keyword, link: null }
    return { ...m, campaign: c ?? null, sends }
  })

  return NextResponse.json({
    posts,
    mediaError,
    fallback,
    recent: (log ?? []).map((r: { platform?: string; status?: string; error?: string | null; keyword?: string | null; link_sent?: string | null; created_at?: string }) => ({
      platform: r.platform || 'instagram',
      at: r.created_at ?? null,
      ...dmLogWords(r),
    })),
  })
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const { admin, userId, token } = g
  const body = (await req.json().catch(() => ({}))) as { mediaId?: string; keyword?: string; link?: string; label?: string }
  const mediaId = String(body.mediaId ?? '').replace(/[^0-9]/g, '')
  const keyword = String(body.keyword ?? '').trim().split(/\s+/)[0].slice(0, 30)
  const link = String(body.link ?? '').trim()
  if (!mediaId) return NextResponse.json({ error: 'Pick a post first.' }, { status: 400 })
  if (!keyword) return NextResponse.json({ error: 'Add a keyword, for example LINK.' }, { status: 400 })
  if (!/^https?:\/\/\S+$/i.test(link)) return NextResponse.json({ error: 'Paste the full link, starting with https://' }, { status: 400 })
  if (!token) return NextResponse.json({ error: 'Instagram is not connected in MVP.' }, { status: 400 })
  // Only the account's own post: a media read with its own token proves it.
  if (!(await ownsMedia({ mediaId, accessToken: token }))) {
    return NextResponse.json({ error: 'Instagram says this post is not on your connected account.' }, { status: 403 })
  }
  const { data: existing } = await admin.from('ig_dm_campaigns').select('id,user_id').eq('ig_media_id', mediaId).maybeSingle()
  if (existing && existing.user_id !== userId) return NextResponse.json({ error: 'This post is set up on another MVP account.' }, { status: 409 })
  const row = {
    user_id: userId, ig_media_id: mediaId, keyword, link,
    product_name: String(body.label ?? '').trim().slice(0, 120) || null,
    status: 'active', error: null, updated_at: new Date().toISOString(),
  }
  const { error } = existing
    ? await admin.from('ig_dm_campaigns').update(row).eq('id', existing.id)
    : await admin.from('ig_dm_campaigns').insert(row)
  if (error) return NextResponse.json({ error: `Could not save: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true })
}
