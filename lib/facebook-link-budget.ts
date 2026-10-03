// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// META'S LIMIT ON OUTSIDE LINKS FROM A FACEBOOK PAGE.
//
// Meta limits many Pages to about 2 posts a month that carry an outside link
// (Meta One tiers raise it to 8, 20 or unlimited). Past the limit the post
// still goes up, but the link shows as plain text nobody can tap: a post that
// looks fine and earns nothing. MVP put an outside link on the Page from blog
// shares, every deal post, Amazon designs and auto-pilot, and never counted.
//
// So every Page post MVP makes asks here first:
//   - does it carry an outside link (links to Facebook, Instagram, WhatsApp,
//     Threads and Messenger do not count)?
//   - how many has MVP already posted to this Page in the last 30 days?
//   - and is the creator's Page limited, by their own answer in Facebook setup?
// A post that would go past the limit is stopped, with words that say why
// and what to do, instead of going up with a dead link.
//
// WHAT MVP CAN SEE: only the posts MVP made. Posts the creator puts up by hand
// are invisible to us, and every count says so.
//
// The last 30 days, not the calendar month: Meta has not said which it uses,
// and a rolling window is never looser than either.

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier, tierAllowsSocial } from '@/lib/tier'
import { canUsePreview } from '@/lib/labs-preview'

export type LinkLimitAnswer = 'limited' | 'unlimited' | 'unsure'

export const LINK_WINDOW_DAYS = 30
/** Links a month on a limited Page that has not said otherwise. */
export const DEFAULT_ALLOWANCE = 2
/** The allowances Meta's tiers are reported to give. */
export const ALLOWANCE_CHOICES = [2, 8, 20] as const

/** Is Facebook setup (the page and the link guard) on for this creator. One
 *  switch: admin while tested, then every plan that posts to Facebook. */
export function facebookSetupEnabled(rawTier: unknown): boolean {
  return canUsePreview('facebook_setup', rawTier) && tierAllowsSocial(normalizeTier(rawTier), 'facebook')
}

const META_HOSTS = /(^|\.)(facebook\.com|fb\.com|fb\.me|fb\.watch|m\.me|messenger\.com|instagram\.com|instagr\.am|whatsapp\.com|wa\.me|threads\.net|threads\.com|meta\.com)$/i

function hostOf(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return u.hostname.toLowerCase()
  } catch { return null }
}

/** The outside links in a post: its link field and every address in its
 *  text, leaving out Meta's own apps. Pure. */
export function outsideLinks(text: string | null | undefined, link?: string | null): string[] {
  const found: string[] = []
  if (link) found.push(String(link))
  const body = String(text || '')
  const re = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+|\b(?:amzn\.to|amzn\.eu|a\.co|geni\.us|mvpl\.ink|bit\.ly|tinyurl\.com|linktr\.ee)\/[^\s<>"')\]]+/gi
  for (const m of body.match(re) ?? []) found.push(m.replace(/[.,!?;:]+$/, ''))
  const out: string[] = []
  for (const f of found) {
    const h = hostOf(f)
    if (!h || META_HOSTS.test(h)) continue
    if (!out.includes(f)) out.push(f)
  }
  return out
}

export type LinkBudget = {
  /** The guard stops posts past the limit (the creator said limited or not sure). */
  enforced: boolean
  answer: LinkLimitAnswer | null
  /** Links in the window; null when the Page is not limited. */
  allowance: number | null
  /** Outside-link posts MVP made to this Page in the window. */
  used: number
  left: number | null
  /** False when the count could not be read (no migration 400 yet). */
  counted: boolean
}

/** The allowance for an answer. Pure. */
export function allowanceFor(answer: LinkLimitAnswer | null, stored: number | null | undefined): number | null {
  if (answer === 'unlimited') return null
  if (answer === 'limited' && typeof stored === 'number' && stored > 0) return stored
  return DEFAULT_ALLOWANCE
}

/** Does this answer stop posts past the limit. Never-answered only counts:
 *  it would otherwise start refusing posts a creator never agreed to. Pure. */
export function answerEnforces(answer: LinkLimitAnswer | null): boolean {
  return answer === 'limited' || answer === 'unsure'
}

export function cleanAnswer(v: unknown): LinkLimitAnswer | null {
  return v === 'limited' || v === 'unlimited' || v === 'unsure' ? v : null
}

/** Where this creator's Page stands. Never throws. */
export async function readLinkBudget(userId: string, pageId: string | null | undefined): Promise<LinkBudget> {
  const admin = createAdminClient()
  let answer: LinkLimitAnswer | null = null
  let stored: number | null = null
  let tier: unknown = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any).from('integrations').select('tier,facebook_link_limit,facebook_link_allowance').eq('user_id', userId).maybeSingle()
    answer = cleanAnswer(data?.facebook_link_limit)
    stored = typeof data?.facebook_link_allowance === 'number' ? data.facebook_link_allowance : null
    tier = data?.tier
  } catch {
    try {
      const { data } = await admin.from('integrations').select('tier').eq('user_id', userId).maybeSingle()
      tier = data?.tier
    } catch { /* tier unknown: not enforced */ }
  }
  const allowance = allowanceFor(answer, stored)
  let used = 0
  let counted = false
  if (pageId) {
    try {
      const since = new Date(Date.now() - LINK_WINDOW_DAYS * 86_400_000).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count, error } = await (admin as any).from('facebook_link_posts').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('page_id', String(pageId)).gte('created_at', since)
      if (!error) { used = count ?? 0; counted = true }
    } catch { /* no migration 400: counted stays false */ }
  }
  const enforced = counted && facebookSetupEnabled(tier) && answerEnforces(answer) && allowance != null
  return { enforced, answer, allowance, used, left: allowance == null ? null : Math.max(0, allowance - used), counted }
}

/** The sentence a creator reads when a post is stopped. Pure. */
export function linkLimitRefusal(b: Pick<LinkBudget, 'allowance' | 'used'>, page?: string | null): string {
  const where = page ? `"${page}"` : 'Your Page'
  return `${where} has used its ${b.allowance} outside-link posts for the last ${LINK_WINDOW_DAYS} days (counting the ones MVP posted). Facebook would show this post's link as plain text nobody can tap, so MVP did not post it. Post it in your Group instead, or post it without the link. If your Page has no link limit, change that in Facebook setup.`
}

export type PageLinkCheck =
  | { ok: true; counts: boolean; budget: LinkBudget }
  | { ok: false; code: 'fb_link_limit'; error: string; budget: LinkBudget }

/** Ask before a Page post. counts: the post carries an outside link and is
 *  recorded once it is up. Never throws. */
export async function checkPageLinkPost(opts: { userId: string; pageId: string | null | undefined; pageName?: string | null; text?: string | null; link?: string | null }): Promise<PageLinkCheck> {
  const counts = outsideLinks(opts.text, opts.link).length > 0
  const budget = await readLinkBudget(opts.userId, opts.pageId)
  if (counts && budget.enforced && budget.left != null && budget.left <= 0) {
    return { ok: false, code: 'fb_link_limit', error: linkLimitRefusal(budget, opts.pageName), budget }
  }
  return { ok: true, counts, budget }
}

/** Record a Page post that carried an outside link. Never throws. */
export async function recordPageLinkPost(opts: { userId: string; pageId: string | null | undefined; postId?: string | null; source: string }): Promise<void> {
  if (!opts.pageId) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (createAdminClient() as any).from('facebook_link_posts').insert({
      user_id: opts.userId, page_id: String(opts.pageId), post_id: opts.postId ? String(opts.postId).slice(0, 120) : null, source: opts.source.slice(0, 40),
    })
  } catch { /* no migration 400: nothing kept */ }
}
