// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// META'S LIMIT ON OUTSIDE LINKS FROM A FACEBOOK PAGE.
//
// Meta limits Pages to 2 posts a month that carry an outside link (Meta One
// plans raise it to 8, 20 or unlimited). Creators report that past the limit
// the post still goes up with its link as plain text nobody can tap: a post
// that looks fine and earns nothing. MVP put an outside link on the Page from
// blog shares, every deal post, Amazon designs and auto-pilot, and never
// counted.
//
// META'S OWN RULES (facebook.com/help/1929252614431792, read 2026-10-03):
//   - 2 posts or comments with a link a month on a Page, for free; Meta One
//     Essential 2, Advanced 8, Expert 20, Max unlimited.
//   - it resets on the 1st of each month, or with a Meta One plan on the day
//     the plan renews; unused links do not carry over.
//   - links to Facebook, Instagram, WhatsApp and Threads do not count, nor do
//     extra links in the comments of a post that already has one. A link in
//     the first comment of a post without one DOES count.
//   - it "may not apply to all Pages", and what happens past it is not said.
//
// So every Page post MVP makes asks here first:
//   - does it carry an outside link?
//   - how many has MVP already posted to this Page since the last reset?
//   - and which Meta One plan is the creator on, by their own answer?
// A post that would go past the limit is stopped, with words that say why
// and what to do, instead of going up with a dead link.
//
// WHAT MVP CAN SEE: only the posts MVP made. Posts the creator puts up by hand
// are invisible to us, and every count says so.
//
// MVP posts no Page comments, so only posts are counted here.

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier, tierAllowsSocial } from '@/lib/tier'
import { canUsePreview } from '@/lib/labs-preview'

// SWITCHED OFF (Seb, 2026-10-03: "we shouldn't even think about the two link
// limit"). Facebook in Social Push now posts the affiliate link in the
// creator's Group and only a Facebook link on the Page, so the limit never
// comes into it there. Nothing is held back anywhere while this is false;
// MVP still quietly records link posts, so the count is there if it is ever
// wanted again.
export const LINK_GUARD_ON = false

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

/** The creator's answer in Facebook setup: their Meta One plan, or that
 *  Facebook does not limit their Page at all. */
export type MetaPlan = 'free' | 'essential' | 'advanced' | 'expert' | 'max' | 'not_limited'

export const META_PLANS: Array<{ plan: MetaPlan; label: string; allowance: number | null; renews: boolean }> = [
  { plan: 'free', label: 'No Meta One (or not sure)', allowance: 2, renews: false },
  { plan: 'essential', label: 'Meta One Essential', allowance: 2, renews: true },
  { plan: 'advanced', label: 'Meta One Advanced', allowance: 8, renews: true },
  { plan: 'expert', label: 'Meta One Expert', allowance: 20, renews: true },
  { plan: 'max', label: 'Meta One Max', allowance: null, renews: true },
  { plan: 'not_limited', label: 'Facebook does not limit my Page', allowance: null, renews: false },
]

/** Links a month for a plan that has not been answered: Meta's free default. */
export const DEFAULT_ALLOWANCE = 2

/** A stored answer, read whichever way it was saved (the first version kept
 *  'limited' with an allowance, 'unsure' and 'unlimited'). Pure. */
export function cleanPlan(v: unknown, storedAllowance?: number | null): MetaPlan | null {
  if (META_PLANS.some((p) => p.plan === v)) return v as MetaPlan
  if (v === 'unsure') return 'free'
  if (v === 'unlimited') return 'not_limited'
  if (v === 'limited') return storedAllowance === 20 ? 'expert' : storedAllowance === 8 ? 'advanced' : 'free'
  return null
}

/** The allowance for a plan; never-answered is Meta's free 2. Pure. */
export function allowanceFor(plan: MetaPlan | null): number | null {
  if (!plan) return DEFAULT_ALLOWANCE
  // undefined (an unknown plan) falls back; null (Max, not limited) is kept.
  const found = META_PLANS.find((p) => p.plan === plan)
  return found ? found.allowance : DEFAULT_ALLOWANCE
}

/** Does this answer stop posts past the limit. Never-answered only counts: it
 *  would otherwise start refusing posts a creator never agreed to, and Meta
 *  says the limit may not apply to every Page. Pure. */
export function planEnforces(plan: MetaPlan | null): boolean {
  return plan === 'free' || plan === 'essential' || plan === 'advanced' || plan === 'expert'
}

function lastDayOf(y: number, m: number): number { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate() }

/** When the current allowance started, and when it next resets: the 1st of
 *  the month, or the plan's renewal day (a 31st renews on a short month's
 *  last day). UTC, since Meta does not say which time zone. Pure. */
export function linkWindow(plan: MetaPlan | null, renewsDay: number | null | undefined, now: Date = new Date()): { since: Date; resets: Date } {
  const renews = !!plan && META_PLANS.find((p) => p.plan === plan)?.renews && typeof renewsDay === 'number' && renewsDay >= 1 && renewsDay <= 31
  const day = renews ? (renewsDay as number) : 1
  const y = now.getUTCFullYear(), m = now.getUTCMonth()
  const at = (yy: number, mm: number) => {
    const ny = yy + Math.floor(mm / 12), nm = ((mm % 12) + 12) % 12
    return new Date(Date.UTC(ny, nm, Math.min(day, lastDayOf(ny, nm))))
  }
  let since = at(y, m)
  if (since.getTime() > now.getTime()) since = at(y, m - 1)
  const resets = at(since.getUTCFullYear(), since.getUTCMonth() + 1)
  return { since, resets }
}

export type LinkBudget = {
  /** The guard stops posts past the limit (the creator named a limited plan). */
  enforced: boolean
  plan: MetaPlan | null
  renewsDay: number | null
  /** Links in this window; null when the Page is not limited. */
  allowance: number | null
  /** Outside-link posts MVP made to this Page since the last reset. */
  used: number
  left: number | null
  /** When the allowance resets (ISO). */
  resetsAt: string
  /** False when the count could not be read (no migration 400 yet). */
  counted: boolean
}

/** Where this creator's Page stands. Never throws. */
export async function readLinkBudget(userId: string, pageId: string | null | undefined): Promise<LinkBudget> {
  const admin = createAdminClient()
  let plan: MetaPlan | null = null
  let renewsDay: number | null = null
  let tier: unknown = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any).from('integrations').select('tier,facebook_link_limit,facebook_link_allowance,facebook_link_renews_day').eq('user_id', userId).maybeSingle()
    plan = cleanPlan(data?.facebook_link_limit, typeof data?.facebook_link_allowance === 'number' ? data.facebook_link_allowance : null)
    renewsDay = typeof data?.facebook_link_renews_day === 'number' ? data.facebook_link_renews_day : null
    tier = data?.tier
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (admin as any).from('integrations').select('tier,facebook_link_limit,facebook_link_allowance').eq('user_id', userId).maybeSingle()
      plan = cleanPlan(data?.facebook_link_limit, typeof data?.facebook_link_allowance === 'number' ? data.facebook_link_allowance : null)
      tier = data?.tier
    } catch {
      try { const { data } = await admin.from('integrations').select('tier').eq('user_id', userId).maybeSingle(); tier = data?.tier } catch { /* not enforced */ }
    }
  }
  const allowance = allowanceFor(plan)
  const win = linkWindow(plan, renewsDay)
  let used = 0
  let counted = false
  if (pageId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count, error } = await (admin as any).from('facebook_link_posts').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('page_id', String(pageId)).gte('created_at', win.since.toISOString())
      if (!error) { used = count ?? 0; counted = true }
    } catch { /* no migration 400: counted stays false */ }
  }
  const enforced = LINK_GUARD_ON && counted && facebookSetupEnabled(tier) && planEnforces(plan) && allowance != null
  return { enforced, plan, renewsDay, allowance, used, left: allowance == null ? null : Math.max(0, allowance - used), resetsAt: win.resets.toISOString(), counted }
}

/** The sentence a creator reads when a post is stopped. Pure. MVP does not
 *  claim what Facebook does past the limit: Meta does not say. */
export function linkLimitRefusal(b: Pick<LinkBudget, 'allowance' | 'used' | 'resetsAt'>, page?: string | null): string {
  const where = page ? `"${page}"` : 'Your Page'
  const when = new Date(b.resetsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${where} has used its ${b.allowance} link posts for this month (counting the ones MVP posted), and Facebook allows no more until ${when}. MVP held this post so its link is not wasted. Post it in your Group instead, or post it without the link. If you pay for Meta One or your Page has no limit, set that in Facebook Setup.`
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
