// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/tools/title-audit/live — the titles as they are on the creator's sites.
//
// GET   every post's live title read from WordPress and set against MVP's
//       record of it. Lists the posts where they differ, and the posts whose
//       number on the site now names a different post, with which title the
//       post's own address supports.
// POST  { postId, use: 'mvp' }                   put MVP's title back on the site
//       { postId, use: 'site', title }            keep the site's title, and record it in MVP
//       { action: 'keep-record', keepId }         one post, two records: keep this record on the
//                                                 post; the others are unlinked and kept as drafts
//       { action: 'match-address', postId }       give the post an address made from its title,
//                                                 with a 301 from the old one
//
// WHY. The scan beside this compares MVP's copy of a title with MVP's copy of
// the body, so it cannot see a title that was changed on the site: a title fix
// written to the wrong blog left MVP's record right and the live post wrong (a
// Beard Club trimmer review titled for a Beatbot pool robot). This reads the
// sites themselves.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { listSites } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { hostOf, slugOfUrl, samePost, sameTitle, titleFitsSlug, credsForPost, checkSamePost } from '@/lib/post-site'
import { shortSlug } from '@/lib/short-slug'
import { applyWpRedirects } from '@/lib/wp-redirects'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface Row { id: string; title: string | null; wordpress_url: string | null; wordpress_post_id: number | null; wordpress_site_id: string | null }

async function owner() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  return { ownerId: (auth as { ownerId: string }).ownerId }
}

export async function GET() {
  const o = await owner()
  if ('error' in o) return o.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const rows: Row[] = []
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await admin.from('blog_posts')
      .select('id,title,wordpress_url,wordpress_post_id,wordpress_site_id')
      .eq('user_id', o.ownerId).not('wordpress_post_id', 'is', null).not('wordpress_url', 'is', null)
      .order('id').range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }

  // ONE POST, TWO RECORDS. Two videos' records pointing at the same post on
  // the same site: every fix run from either record writes its own body into
  // that one post, so it ends up with one video's title and the other's text
  // (a Jikasho phone-holder title over a baskets review). Listed so they can
  // be separated; nothing is changed here.
  const shareKey = (r: Row) => `${hostOf(r.wordpress_url)}#${r.wordpress_post_id}`
  const sharing = new Map<string, Row[]>()
  for (const r of rows) sharing.set(shareKey(r), [...(sharing.get(shareKey(r)) ?? []), r])
  const sharedGroups = [...sharing.values()].filter((g) => g.length > 1)
  const liveTitleOf = new Map<string, string>()

  const sites = await listSites(admin, o.ownerId)
  const byHost = new Map<string, Row[]>()
  const unconnected: string[] = []
  for (const r of rows) {
    const h = hostOf(r.wordpress_url)
    if (!h) continue
    if (!sites.some((s) => hostOf(s.url) === h)) { if (!unconnected.includes(h)) unconnected.push(h); continue }
    byHost.set(h, [...(byHost.get(h) ?? []), r])
  }

  const differs: Array<{ postId: string; url: string; mvpTitle: string; liveTitle: string; suggest: 'mvp' | 'site' | null; why: string }> = []
  const misfiled: Array<{ postId: string; url: string; mvpTitle: string; numberNowNames: string }> = []
  const offTopic: Array<{ postId: string; url: string; title: string; editUrl: string }> = []
  let checked = 0, missing = 0
  const unread: string[] = []
  const started = Date.now()
  for (const [host, list] of byHost) {
    const site = sites.find((s) => hostOf(s.url) === host)!
    const wp = createWordPressService(site.url, site.username, site.appPassword, site.apiToken || undefined)
    for (let i = 0; i < list.length; i += 100) {
      if (Date.now() - started > 100_000) { unread.push(`${host} (ran out of time after ${checked} posts; run it again)`); break }
      const part = list.slice(i, i + 100)
      const live = await wp.getPostsBrief(part.map((r) => r.wordpress_post_id as number))
      if (!live) { unread.push(host); break }
      for (const r of part) {
        const w = live.get(r.wordpress_post_id as number)
        if (!w) { missing++; continue }
        liveTitleOf.set(r.id, w.title)
        checked++
        if (!samePost(r.wordpress_url, w)) {
          misfiled.push({ postId: r.id, url: r.wordpress_url as string, mvpTitle: r.title || '', numberNowNames: w.link || w.slug })
          continue
        }
        if (!r.title) continue
        if (sameTitle(r.title, w.title)) {
          // Same title in both places, but is it the post its address says it
          // is? The address is made from the first title and never changes, so
          // a title sharing no word with it is content about something else:
          // a baskets review at a car-phone-holder address, linking the holder.
          const slug = slugOfUrl(r.wordpress_url) || w.slug
          if (slug.replace(/-\d+$/, '').split('-').filter((x) => x.length >= 3).length >= 2 && titleFitsSlug(w.title, slug) === 0) {
            offTopic.push({ postId: r.id, url: r.wordpress_url as string, title: w.title, editUrl: `${site.url.replace(/\/$/, '')}/wp-admin/post.php?post=${r.wordpress_post_id}&action=edit` })
          }
          continue
        }
        const slug = slugOfUrl(r.wordpress_url) || w.slug
        const fm = titleFitsSlug(r.title, slug), fs = titleFitsSlug(w.title, slug)
        const suggest = fm > fs + 0.2 ? 'mvp' : fs > fm + 0.2 ? 'site' : null
        const why = suggest === 'mvp' && fs === 0
          ? 'The title on your site shares no words with this post\'s address, so it most likely belongs to another post.'
          : suggest === 'mvp' ? 'MVP\'s title matches this post\'s address better.'
          : suggest === 'site' ? 'The title on your site matches this post\'s address better; it may be an edit you made there.'
          : 'Both fit the post\'s address about as well; pick the one you want.'
        differs.push({ postId: r.id, url: r.wordpress_url as string, mvpTitle: r.title, liveTitle: w.title, suggest, why })
      }
    }
  }
  // Which record's title is the one on the site, so the page can say which
  // record the post actually holds.
  const shared = sharedGroups.map((g) => {
    const liveTitle = g.map((r) => liveTitleOf.get(r.id)).find(Boolean) ?? null
    return {
      url: g[0].wordpress_url as string, liveTitle,
      records: g.map((r) => ({ postId: r.id, title: r.title, onSite: !!(liveTitle && r.title && sameTitle(r.title, liveTitle)) })),
    }
  })
  // The likeliest wrong titles first.
  differs.sort((a, b) => (a.suggest === 'mvp' ? 0 : 1) - (b.suggest === 'mvp' ? 0 : 1))
  return NextResponse.json({ checked, missing, differs, misfiled, offTopic, shared, unread, unconnected })
}

export async function POST(request: Request) {
  const o = await owner()
  if ('error' in o) return o.error
  const body = await request.json().catch(() => ({})) as { postId?: string; use?: string; title?: string; action?: string; keepId?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  // ONE POST, TWO RECORDS: keep this record on the post. Every other record
  // pointing at the same post on the same site is unlinked from it and kept
  // in MVP as a draft (its text is not lost), so no fix run from it can
  // write into this post again. Nothing on the site changes.
  if (body.action === 'keep-record') {
    const { data: keep } = await admin.from('blog_posts')
      .select('id,title,wordpress_url,wordpress_post_id,wordpress_site_id')
      .eq('user_id', o.ownerId).eq('id', String(body.keepId || '')).maybeSingle() as { data: Row | null }
    if (!keep?.wordpress_post_id || !keep.wordpress_url) return NextResponse.json({ error: 'That record is not linked to a post.' }, { status: 404 })
    const { data: same } = await admin.from('blog_posts')
      .select('id,title,wordpress_url,wordpress_post_id,wordpress_site_id')
      .eq('user_id', o.ownerId).eq('wordpress_post_id', keep.wordpress_post_id).neq('id', keep.id) as { data: Row[] | null }
    const others = (same ?? []).filter((r) => hostOf(r.wordpress_url) === hostOf(keep.wordpress_url))
    if (!others.length) return NextResponse.json({ ok: true, unlinked: 0 })
    const ids = others.map((r) => r.id)
    const { error } = await admin.from('blog_posts')
      .update({ wordpress_post_id: null, wordpress_url: null, status: 'draft' })
      .eq('user_id', o.ownerId).in('id', ids)
    if (error) return NextResponse.json({ error: `Nothing was changed: ${error.message}` }, { status: 500 })
    // Google's answer about the post belongs to the record kept.
    await admin.from('post_seo').delete().in('post_id', ids).then(() => {}, () => {})
    return NextResponse.json({ ok: true, unlinked: ids.length, titles: others.map((r) => r.title || 'Untitled') })
  }
  const { data: post } = await admin.from('blog_posts')
    .select('id,title,wordpress_url,wordpress_post_id,wordpress_site_id')
    .eq('user_id', o.ownerId).eq('id', String(body.postId || '')).maybeSingle() as { data: Row | null }
  if (!post) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })

  // A POST ABOUT SOMETHING OTHER THAN ITS ADDRESS: give it an address made
  // from its title. The old address gets a 301 to the new one, so links and
  // Google's history carry over. Checked against what the site now says.
  if (body.action === 'match-address') {
    if (!post.wordpress_post_id || !post.wordpress_url || !post.title) return NextResponse.json({ error: 'This post has no title or address in MVP.' }, { status: 400 })
    const creds = await credsForPost(admin, o.ownerId, post)
    if (!creds) return NextResponse.json({ error: 'The site this post is on is not connected, so nothing was changed.' }, { status: 400 })
    const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token || undefined)
    const same = await checkSamePost(wp, post.wordpress_post_id, post.wordpress_url)
    if (!same.ok) return NextResponse.json({ error: same.error }, { status: 409 })
    const slug = shortSlug(post.title, 60)
    if (slug.length < 5) return NextResponse.json({ error: 'The title is too short to make an address from.' }, { status: 400 })
    if (slug === (slugOfUrl(post.wordpress_url) || '').replace(/\/$/, '')) return NextResponse.json({ ok: true, url: post.wordpress_url, unchanged: true })
    try {
      await wp.updatePost(post.wordpress_post_id, { slug })
    } catch (e) {
      return NextResponse.json({ error: `WordPress refused the change: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
    }
    const after = await wp.getPostsBrief([post.wordpress_post_id])
    const now = after?.get(post.wordpress_post_id)
    if (!now?.link) return NextResponse.json({ error: 'WordPress took the change but MVP could not read the new address back. Open the post to check it.' }, { status: 502 })
    const oldUrl = post.wordpress_url
    if (now.link.replace(/\/$/, '') === oldUrl.replace(/\/$/, '')) return NextResponse.json({ error: 'WordPress kept the old address.' }, { status: 502 })
    await admin.from('blog_posts').update({ wordpress_url: now.link, slug: now.slug || slug }).eq('id', post.id)
    // WordPress itself sends an old post address to the new one; the MVP
    // plugin's store makes it a 301 even where that is switched off.
    const r = await applyWpRedirects(creds, [{ from: oldUrl, to: now.link }]).catch(() => ({ ok: false as const }))
    return NextResponse.json({ ok: true, url: now.link, oldUrl, redirect: r.ok ? 'plugin' : 'wordpress' })
  }

  if (body.use === 'site') {
    const t = String(body.title || '').replace(/<[^>]+>/g, '').trim().slice(0, 200)
    if (t.length < 5) return NextResponse.json({ error: 'No title to keep.' }, { status: 400 })
    const { error } = await admin.from('blog_posts').update({ title: t }).eq('id', post.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, title: t })
  }
  if (body.use !== 'mvp') return NextResponse.json({ error: 'Unknown choice.' }, { status: 400 })
  if (!post.wordpress_post_id || !post.title) return NextResponse.json({ error: 'MVP has no title for this post to put back.' }, { status: 400 })
  const creds = await credsForPost(admin, o.ownerId, post)
  if (!creds) return NextResponse.json({ error: 'The site this post is on is not connected, so nothing was changed.' }, { status: 400 })
  const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token || undefined)
  const same = await checkSamePost(wp, post.wordpress_post_id, post.wordpress_url)
  if (!same.ok) return NextResponse.json({ error: same.error }, { status: 409 })
  try {
    await wp.updatePost(post.wordpress_post_id, { title: post.title })
  } catch (e) {
    return NextResponse.json({ error: `WordPress refused the change: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
  // Confirmed from what the site now says, not assumed from the save.
  const after = await wp.getPostsBrief([post.wordpress_post_id])
  const now = after?.get(post.wordpress_post_id)?.title ?? null
  if (now === null) return NextResponse.json({ ok: true, title: post.title, verified: false })
  if (!sameTitle(now, post.title)) return NextResponse.json({ error: `WordPress accepted the change but still shows "${now}".` }, { status: 502 })
  return NextResponse.json({ ok: true, title: post.title, verified: true })
}
