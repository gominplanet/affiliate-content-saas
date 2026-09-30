// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// STORE LOGOS IN THE PICTURES OF POSTS ALREADY PUBLISHED.
//
// Amazon sometimes answered MVP's product photo fetch with a blocked page whose
// share image is Amazon's logo. MVP took that as the product, and drew the
// article's pictures from it: one post had the logo itself in the article and
// an AI picture of the logo next to it. New posts are protected
// (lib/image-guard). This finds the ones already live.
//
// EVERY PICTURE IN THE POST, not only the first. The first is the hero, and on
// that post the hero was fine; the logos were further down.
//
// HOW IT JUDGES. A picture on Amazon's image servers that is not a product
// photo (the logo, site graphics) is a finding on its address alone. Every
// other picture is shown to the vision check in lib/logo-scan, with its rules:
// a picture that could not be opened, or an answer that could not be read, is
// recorded as unchecked, never as clean.
//
// WHAT IT KEEPS. Per post, when it was looked at (blog_posts.logo_checked_at),
// and per picture, only the findings and the unchecked ones
// (post_logo_findings, migration 390). A post whose pictures are replaced is
// cleared and looked at again.

import { isRetailerSiteImage } from '@/lib/image-guard'
import { LOGO_SCAN_PROMPT, readLogoReply, type LogoFinding } from '@/lib/logo-scan'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { recordAnthropicUsage } from '@/lib/ai-usage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Anthropic = any

export const LOGO_SCAN_MODEL = 'claude-haiku-4-5-20251001'
/** Pictures looked at per post. An article has three to five. */
export const MAX_IMAGES_PER_POST = 8
/** Pictures looked at per background run. */
export const SWEEP_IMAGES_PER_RUN = 30
/** Anything bigger than this is not an article picture and is not worth the tokens. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024

export const AMAZON_SITE_GRAPHIC = 'Amazon site graphic, not a product photo'
export const MIGRATION_MISSING = 'Migration 390 has not been run, so nothing can be recorded yet.'

/** The pictures worth looking at in a post, in order, once each. Pure. */
export function postImageUrls(html: string | null | undefined): string[] {
  const out: string[] = []
  for (const m of String(html || '').matchAll(/<img\b[^>]*?\ssrc=["']([^"']+)["']/gi)) {
    const url = m[1].trim()
    if (!/^https?:\/\//i.test(url)) continue
    // The creator's own video frame, an avatar or an emoji: nothing MVP drew.
    if (/ytimg\.com|youtube\.com|gravatar\.com|s\.w\.org\/images\/core\/emoji/i.test(url)) continue
    if (/\.svg(?:[?#]|$)/i.test(url)) continue
    // An Amazon product photo is the product, as Amazon serves it.
    if (/(^|\.)(media-amazon|ssl-images-amazon|images-amazon)\.com\//i.test(url.replace(/^https?:\/\//i, '')) && !isRetailerSiteImage(url)) continue
    if (!out.includes(url)) out.push(url)
  }
  return out.slice(0, MAX_IMAGES_PER_POST)
}

type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string } }

/** Fetch a picture as an image block for the vision check, or why it could not be. */
export async function imageBlock(url: string): Promise<{ ok: true; block: ImageBlock } | { ok: false; reason: string }> {
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 20_000, headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return { ok: false, reason: `the image could not be fetched (${res.status})` }
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (!/^image\//.test(ct)) return { ok: false, reason: `that URL returned ${ct || 'no content type'} rather than an image` }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: 'the image is too large to check' }
    const media_type = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : ct.includes('gif') ? 'image/gif' : 'image/jpeg'
    return { ok: true, block: { type: 'image', source: { type: 'base64', media_type, data: buf.toString('base64') } } }
  } catch (e) {
    return { ok: false, reason: (e instanceof Error ? e.message : 'the image could not be fetched').slice(0, 160) }
  }
}

/** One picture's verdict. */
export async function checkImage(anthropic: Anthropic, url: string, usage: { userId: string; tier: string | null; feature: string }): Promise<LogoFinding> {
  if (isRetailerSiteImage(url)) return { verdict: 'found', marks: [AMAZON_SITE_GRAPHIC] }
  const img = await imageBlock(url)
  if (!img.ok) return { verdict: 'unreadable', marks: [], reason: img.reason }
  try {
    const msg = await anthropic.messages.create({
      model: LOGO_SCAN_MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: [img.block, { type: 'text', text: LOGO_SCAN_PROMPT }] }],
    })
    recordAnthropicUsage(msg, { userId: usage.userId, tier: usage.tier, feature: usage.feature, model: LOGO_SCAN_MODEL })
    return readLogoReply(((msg.content?.[0] as { text?: string } | undefined)?.text ?? '').trim())
  } catch (e) {
    return { verdict: 'unreadable', marks: [], reason: (e instanceof Error ? e.message : 'the check failed').slice(0, 160) }
  }
}

export type PostScan = { postId: string; images: number; found: number; unreadable: number; error?: string }

/** Look at every picture in one post and record the result. */
export async function scanPost(sb: Sb, anthropic: Anthropic, post: { id: string; user_id: string; content: string | null }, usage: { tier: string | null; feature: string }): Promise<PostScan> {
  const urls = postImageUrls(post.content)
  const rows: Array<{ post_id: string; user_id: string; image_url: string; verdict: string; marks: string[]; reason: string | null; checked_at: string }> = []
  const at = new Date().toISOString()
  for (const url of urls) {
    const f = await checkImage(anthropic, url, { userId: post.user_id, ...usage })
    if (f.verdict === 'clean') continue
    rows.push({ post_id: post.id, user_id: post.user_id, image_url: url, verdict: f.verdict, marks: f.marks, reason: f.reason ?? null, checked_at: at })
  }
  const out: PostScan = { postId: post.id, images: urls.length, found: rows.filter((r) => r.verdict === 'found').length, unreadable: rows.filter((r) => r.verdict === 'unreadable').length }
  const del = await sb.from('post_logo_findings').delete().eq('post_id', post.id)
  if (del.error) return { ...out, error: /post_logo_findings/.test(String(del.error.message)) ? MIGRATION_MISSING : String(del.error.message) }
  if (rows.length) {
    const ins = await sb.from('post_logo_findings').insert(rows)
    if (ins.error) return { ...out, error: String(ins.error.message) }
  }
  const upd = await sb.from('blog_posts').update({ logo_checked_at: at }).eq('id', post.id)
  if (upd.error) return { ...out, error: /logo_checked_at/.test(String(upd.error.message)) ? MIGRATION_MISSING : String(upd.error.message) }
  return out
}

/** A post whose pictures were replaced: forget what was found, look again. */
export async function forgetLogoScan(sb: Sb, postId: string): Promise<void> {
  try { await sb.from('post_logo_findings').delete().eq('post_id', postId) } catch { /* table not there yet */ }
  try { await sb.from('blog_posts').update({ logo_checked_at: null }).eq('id', postId) } catch { /* column not there yet */ }
}

export type LogoSweepReport = { posts: number; images: number; found: number; unreadable: number; left: number | null; error?: string }

/** The background run: newest unchecked published posts first, a few pictures a run. */
export async function sweepPostLogos(sb: Sb, anthropic: Anthropic, opts: { maxImages?: number; deadline?: number } = {}): Promise<LogoSweepReport> {
  const maxImages = opts.maxImages ?? SWEEP_IMAGES_PER_RUN
  const deadline = opts.deadline ?? Date.now() + 200_000
  const out: LogoSweepReport = { posts: 0, images: 0, found: 0, unreadable: 0, left: null }
  const { data, error, count } = await sb.from('blog_posts')
    .select('id,user_id,content', { count: 'exact' })
    .is('logo_checked_at', null).not('wordpress_post_id', 'is', null)
    .order('created_at', { ascending: false }).limit(20)
  if (error) return { ...out, error: /logo_checked_at/.test(String(error.message)) ? MIGRATION_MISSING : String(error.message) }
  out.left = count ?? null
  for (const p of (data ?? []) as Array<{ id: string; user_id: string; content: string | null }>) {
    if (Date.now() > deadline) break
    const n = postImageUrls(p.content).length
    if (out.posts > 0 && out.images + n > maxImages) break
    const r = await scanPost(sb, anthropic, p, { tier: null, feature: 'post_logo_sweep' })
    if (r.error) return { ...out, error: r.error }
    out.posts++; out.images += r.images; out.found += r.found; out.unreadable += r.unreadable
  }
  if (out.left !== null) out.left = Math.max(0, out.left - out.posts)
  return out
}
