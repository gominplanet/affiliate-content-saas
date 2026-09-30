// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE "NOT TESTED" LINE, TAKEN OFF POSTS MADE FROM THE CREATOR'S OWN VIDEO.
//
// Every post carries one line saying how it was made (lib/post-provenance).
// A post only counted as "from my own video" when its transcript could be
// read, so a video with no usable captions got the research-only line: "We
// have not tested this product ourselves", under the creator's own embedded
// video. A creator found it on every post. New posts are right
// (lib/experience-source, own-video); this corrects the ones already live.
//
// WHAT IT CHANGES. Only that paragraph, and only on a post MVP made from one
// of the creator's videos (blog_posts.video_id). It is replaced with the
// own-video line, and any second copy of the line in the same post is removed.
// Nothing else in the post is touched.
//
// HOW. The post's raw block HTML, read from its own site (credsForPost),
// checked to be the same post first (checkSamePost: WordPress numbers repeat
// across a creator's sites), edited, saved back. A post that could not be
// read or saved is left as it was and rotated to the back of the queue, so it
// cannot hold the others up.

import { createWordPressService } from '@/services/wordpress'
import { credsForPost, checkSamePost } from '@/lib/post-site'
import { provenanceText } from '@/lib/post-provenance'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** Posts corrected per run. Small: this edits other people's live posts. */
export const FIX_PER_RUN = 12

const NOT_TESTED = /not tested (?:this|these) products? ourselves/i
// A provenance paragraph, with its block markers when it has them.
const BLOCK = /(?:<!-- wp:paragraph \{[^}]*"className":"mvp-provenance"[^]*?-->\s*)?<p[^>]*class="mvp-provenance"[^>]*>[\s\S]*?<\/p>(?:\s*<!-- \/wp:paragraph -->)?/g
// The same line written before it had a class (older posts).
const BARE = /(?:<!-- wp:paragraph[^>]*-->\s*)?<p[^>]*>\s*How this review was made:[^<]*?not tested this product ourselves\.?\s*<\/p>(?:\s*<!-- \/wp:paragraph -->)?/g

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The corrected post, or null when there is nothing to correct. Pure. */
export function fixProvenanceHtml(html: string, line: string): { html: string; removedCopies: number } | null {
  if (!html || !NOT_TESTED.test(html)) return null
  const found = [...(html.match(BLOCK) ?? []), ...(html.match(BARE) ?? [])]
  const wrong = found.filter((b) => NOT_TESTED.test(b))
  if (wrong.length === 0) return null
  const block = `<!-- wp:paragraph {"className":"mvp-provenance","style":{"typography":{"fontSize":"13px"}}} -->\n<p class="mvp-provenance" style="font-size:13px;color:#6b6b70">${esc(line)}</p>\n<!-- /wp:paragraph -->`
  let first = true
  let removed = 0
  const swap = (m: string) => {
    if (first) { first = false; return block }
    removed++
    return ''
  }
  // Every provenance line in the post: the first becomes the right one, the
  // rest (duplicates, whichever wording) go.
  let out = html.replace(BLOCK, swap)
  out = out.replace(BARE, swap)
  return { html: out.replace(/\n{3,}/g, '\n\n'), removedCopies: removed }
}

export type ProvenanceFixReport = { fixed: number; checked: number; failed: Array<{ postId: string; reason: string }> }

export async function fixProvenanceLines(sb: Sb, max = FIX_PER_RUN): Promise<ProvenanceFixReport> {
  const out: ProvenanceFixReport = { fixed: 0, checked: 0, failed: [] }
  const { data: rows } = await sb.from('blog_posts')
    .select('id,user_id,content,wordpress_post_id,wordpress_url,wordpress_site_id')
    .not('video_id', 'is', null).not('wordpress_post_id', 'is', null)
    .ilike('content', '%not tested this product ourselves%')
    .order('updated_at', { ascending: true }).limit(max)
  const posts = (rows ?? []) as Array<{ id: string; user_id: string; content: string | null; wordpress_post_id: number; wordpress_url: string | null; wordpress_site_id: string | null }>
  const authors = new Map<string, string | null>()
  const touch = (id: string) => sb.from('blog_posts').update({ updated_at: new Date().toISOString() }).eq('id', id)

  for (const p of posts) {
    out.checked++
    try {
      if (!authors.has(p.user_id)) {
        const { data: b } = await sb.from('brand_profiles').select('author_name').eq('user_id', p.user_id).maybeSingle()
        authors.set(p.user_id, (b?.author_name as string | null) ?? null)
      }
      const line = provenanceText('own-video', authors.get(p.user_id))
      const site = await credsForPost(sb, p.user_id, p)
      if (!site) { out.failed.push({ postId: p.id, reason: 'no site credentials' }); await touch(p.id); continue }
      const wp = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
      const same = await checkSamePost(wp, p.wordpress_post_id, p.wordpress_url)
      if (!same.ok) { out.failed.push({ postId: p.id, reason: same.error }); await touch(p.id); continue }
      const raw = await wp.readRawPost(p.wordpress_post_id)
      // Our copy is corrected either way, so the post leaves the queue; the
      // live one only when it could be read.
      const ours = fixProvenanceHtml(String(p.content || ''), line)
      if (!raw.ok) { out.failed.push({ postId: p.id, reason: raw.reason }); await touch(p.id); continue }
      const live = fixProvenanceHtml(raw.content, line)
      if (live) await wp.updatePost(p.wordpress_post_id, { content: live.html })
      await sb.from('blog_posts').update({ content: ours ? ours.html : p.content, updated_at: new Date().toISOString() }).eq('id', p.id)
      out.fixed++
    } catch (e) {
      out.failed.push({ postId: p.id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
      await touch(p.id)
    }
  }
  return out
}
