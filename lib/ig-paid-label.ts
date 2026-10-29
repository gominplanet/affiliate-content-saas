// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// INSTAGRAM'S "PAID PARTNERSHIP" LABEL, ON EVERY POST MVP MAKES (Seb,
// 2026-10-29, Alejandro: "I'm adding the branded content on all my post
// manually after MVP post them. Is that something can be toggled ON with
// MVP?"). Instagram lets an app switch the label on at publish time
// (is_paid_partnership), but only through the Instagram API with Facebook
// Login; MVP connects Instagram with Instagram Login, where the setting does
// not exist.
//
// So when the Instagram account is linked to a Facebook Page the member has
// connected in MVP, the post goes out through that Page's connection with the
// label on. Everything else about the post is the same (lib containerParams).
// When it cannot (no Page, no link, a Facebook connection made before MVP
// asked for Instagram, the member turned it off, Instagram refused the
// label), the post goes out the usual way, unlabelled, and the reason is kept
// on the account (social_accounts.extra.paid_label_log) so the settings card
// says what happened to each post. A post is never lost or sent twice over
// the label: the usual way is taken only when Instagram refused before
// anything was published.
//
// THE SIMPLE WAY FIRST (Seb, 2026-10-29: "i want MVP to toggle on the label
// when posting to instagram.. simple no?"). Meta's reference says the switch
// is for Facebook Login only, but nothing is lost by sending it on the usual
// Instagram post: when Instagram takes it, that is the whole feature, with no
// Facebook at all. When Instagram refuses it, the post is sent again at once
// without it (nothing was created), the refusal is kept on the account for a
// week, and the Facebook Page route below is used instead.
//
// TRIED, AND INSTAGRAM IGNORES IT (Seb, 2026-10-29: "it did post it but did
// not show the label"). Instagram took a direct post with the switch on and
// showed no label, as Meta's reference says. DIRECT_SWITCH_WORKS is false,
// so the direct way is no longer sent: the label comes only through a linked
// Facebook Page, and a post without one says so.
//
// Labs first: team accounts only until Seb opens it (PAID_LABEL_FOR_MEMBERS).

import { normalizeTier, tierAllowsSocial, type Tier } from '@/lib/tier'

/** Members get the label once this is true; the team has it now. */
export const PAID_LABEL_FOR_MEMBERS = false

/** Members testing it before everyone gets it (Seb, 2026-10-29: "can i have
 *  alejandro test this"), by MVP user id. */
export const PAID_LABEL_TESTERS: readonly string[] = [
  '9936ec62-d758-4c7e-b14c-7890aa8d251d', // Alejandro
]

export function paidLabelAllowed(tier: Tier | string | null | undefined, userId?: string | null): boolean {
  if (userId && PAID_LABEL_TESTERS.includes(userId)) return true
  if (!tier) return false
  const t = normalizeTier(tier)
  if (t === 'admin') return true
  return PAID_LABEL_FOR_MEMBERS && tierAllowsSocial(t, 'instagram')
}

/** The Facebook permissions posting to Instagram through a Page needs. */
export const FB_INSTAGRAM_SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'] as const

export type PaidLabelWhy = 'off' | 'not-yet' | 'no-facebook' | 'no-link' | 'reconnect' | 'refused' | 'unknown-account'

/** What the member reads for each reason the label was not added. Pure. */
export function paidLabelWords(why: PaidLabelWhy, detail?: string | null): string {
  switch (why) {
    case 'off': return 'You turned the label off.'
    case 'not-yet': return 'The label is not open to your account yet.'
    case 'no-facebook': return 'Connect the Facebook Page your Instagram is linked to, and MVP adds the label for you.'
    case 'no-link': return 'None of the Facebook Pages connected in MVP is linked to this Instagram account. In the Instagram app open Edit profile, then Page, and pick your Facebook Page. If it is already linked to a Page MVP does not have, reconnect Facebook in MVP and tick that Page.'
    case 'reconnect': return 'Reconnect Facebook in MVP and allow Instagram when Facebook asks, so MVP can post through it with the label.'
    case 'refused': return `Instagram turned the label down${detail ? `: ${detail}` : ''}. The post went out without it.`
    case 'unknown-account': return 'MVP could not match this Instagram account to your MVP account.'
  }
}

export type PaidLabelEntry = { at: string; on: boolean; why?: PaidLabelWhy; detail?: string; mediaId?: string; kind?: string }
/** The newest first, ten kept. Pure. */
export function withEntry(log: unknown, e: PaidLabelEntry, keep = 10): PaidLabelEntry[] {
  const prev = Array.isArray(log) ? (log as PaidLabelEntry[]).filter((x) => x && typeof x.at === 'string') : []
  return [e, ...prev].slice(0, keep)
}

const FB_GRAPH = 'https://graph.facebook.com/v22.0'
const ROUTE_TTL_MS = 10 * 60 * 1000

type Route = { igId: string; token: string; pageName: string | null }
type Found = { route: Route; why?: undefined } | { route?: undefined; why: PaidLabelWhy; detail?: string }
type Owner = { rowId: string | null; userId: string; extra: Record<string, unknown> }

const routes = new Map<string, { at: number; found: Found; checked: string[] }>()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

async function admin(): Promise<Sb> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  return createAdminClient()
}

/** The MVP account this Instagram account belongs to. */
async function ownerOf(sb: Sb, igUserId: string): Promise<Owner | null> {
  const { data: rows } = await sb.from('social_accounts').select('id,user_id,extra').eq('platform', 'instagram').eq('external_id', igUserId).limit(2)
  const list = (rows ?? []) as { id: string; user_id: string; extra: Record<string, unknown> | null }[]
  if (list.length === 1) return { rowId: list[0].id, userId: list[0].user_id, extra: list[0].extra ?? {} }
  if (list.length > 1) return null // two MVP accounts claim it: never guess whose Page to use
  const { data: legacy } = await sb.from('integrations').select('user_id').eq('instagram_user_id', igUserId).limit(2)
  const l = (legacy ?? []) as { user_id: string }[]
  return l.length === 1 ? { rowId: null, userId: l[0].user_id, extra: {} } : null
}

/** The account's professional id (17841...), which a Page's
 *  instagram_business_account carries. */
async function professionalId(igToken: string): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.instagram.com/v22.0/me?fields=user_id&access_token=${encodeURIComponent(igToken)}`, { signal: AbortSignal.timeout(15_000) })
    const data = await res.json().catch(() => ({})) as { user_id?: string | number }
    const id = String(data?.user_id ?? '').replace(/[^0-9]/g, '')
    return res.ok && id ? id : null
  } catch { return null }
}

/** The permissions a Facebook token was granted, from Facebook itself
 *  (debug_token with the app's own token), or null when it cannot say. Without
 *  instagram_basic Facebook leaves a Page's linked Instagram out of its answer
 *  without an error, so "no Page is linked" and "MVP may not see the link"
 *  look the same until the grant is read (Seb, 2026-10-29). */
export async function grantedScopes(token: string): Promise<string[] | null> {
  const id = process.env.FACEBOOK_APP_ID, secret = process.env.FACEBOOK_APP_SECRET
  if (!id || !secret) return null
  try {
    const res = await fetch(`${FB_GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${id}|${secret}`)}`, { signal: AbortSignal.timeout(15_000) })
    const data = await res.json().catch(() => ({})) as { data?: { scopes?: string[] } }
    return res.ok && Array.isArray(data.data?.scopes) ? data.data!.scopes! : null
  } catch { return null }
}

/** Is a grant missing what posting to Instagram through a Page needs? Pure. */
export function lacksInstagramGrant(scopes: string[] | null): boolean {
  return !!scopes && !(['instagram_basic', 'instagram_content_publish'] as const).every((s) => scopes.includes(s))
}

/** Facebook said the connection lacks a permission (Graph error 10, 200 to 299). */
export function isPermissionError(body: unknown): boolean {
  const e = (body as { error?: { code?: number } } | null)?.error
  const c = typeof e?.code === 'number' ? e.code : null
  return c === 10 || (c != null && c >= 200 && c < 300)
}

/** Which way this account's posts can carry the label, or why not. */
export async function findPaidLabelRoute(igUserId: string, igToken: string): Promise<Found & { owner?: Owner | null; checked?: string[] }> {
  const sb = await admin()
  const owner = await ownerOf(sb, igUserId)
  if (!owner) return { why: 'unknown-account', owner }
  const { data: integ } = await sb.from('integrations').select('tier,facebook_page_id,facebook_page_access_token').eq('user_id', owner.userId).maybeSingle()
  if (!paidLabelAllowed(integ?.tier, owner.userId)) return { why: 'not-yet', owner }
  if (owner.extra.paid_label_off === true) return { why: 'off', owner }

  const { maybeDecrypt } = await import('@/lib/secrets')
  const pages = new Map<string, string>()
  const { data: fbRows } = await sb.from('social_accounts').select('external_id,access_token').eq('user_id', owner.userId).eq('platform', 'facebook')
  for (const r of (fbRows ?? []) as { external_id: string; access_token: string | null }[]) {
    const t = maybeDecrypt(r.access_token)
    if (r.external_id && t) pages.set(r.external_id, t)
  }
  const legacyToken = maybeDecrypt(integ?.facebook_page_access_token)
  if (integ?.facebook_page_id && legacyToken && !pages.has(integ.facebook_page_id)) pages.set(integ.facebook_page_id, legacyToken)

  // Remembered per connection: a reconnect brings new tokens, so the next
  // post (and the card) reads the new connection straight away.
  const { createHash } = await import('node:crypto')
  const key = `${igUserId}|${createHash('sha1').update([...pages].map(([p, tk]) => `${p}:${tk}`).sort().join(',')).digest('hex')}`
  const cached = routes.get(key)
  if (cached && Date.now() - cached.at < ROUTE_TTL_MS) return { ...cached.found, owner, checked: cached.checked }

  // WHAT MVP CHECKED, kept with the answer: the card shows it to the team, so
  // "not linked" can be read against what Facebook actually said.
  const checked: string[] = []
  let found: Found
  if (!pages.size) found = { why: 'no-facebook' }
  else {
    const proId = await professionalId(igToken)
    checked.push(proId ? `This Instagram account's id is ${proId}.` : 'Instagram did not give this account\'s id, so no Page can be matched to it.')
    const scopes = await grantedScopes(pages.values().next().value as string)
    checked.push(scopes ? `Your Facebook connection allows: ${scopes.join(', ')}.` : 'Facebook did not say which permissions your connection has.')
    let sawPermission = false
    let match: Route | null = null
    for (const [pageId, token] of pages) {
      try {
        const res = await fetch(`${FB_GRAPH}/${encodeURIComponent(pageId)}?fields=name,instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15_000) })
        const data = await res.json().catch(() => ({})) as { name?: string; instagram_business_account?: { id?: string; username?: string }; error?: { message?: string } }
        if (!res.ok) {
          if (isPermissionError(data)) sawPermission = true
          checked.push(`Page ${pageId}: Facebook refused (${String(data.error?.message || res.status).slice(0, 160)}).`)
          continue
        }
        const linked = String(data.instagram_business_account?.id ?? '')
        checked.push(`Page "${data.name ?? pageId}": ${linked ? `linked to Instagram ${data.instagram_business_account?.username ? `@${data.instagram_business_account.username}` : ''} (${linked})${linked === proId ? ', this account' : ''}` : 'Facebook shows no Instagram account linked to it'}.`)
        if (linked && proId && linked === proId) { match = { igId: linked, token, pageName: data.name ?? null }; break }
      } catch { checked.push(`Page ${pageId}: no answer from Facebook.`) }
    }
    const missingGrant = sawPermission || lacksInstagramGrant(scopes)
    found = match ? { route: match } : missingGrant ? { why: 'reconnect' } : { why: 'no-link' }
  }
  routes.set(key, { at: Date.now(), found, checked })
  return { ...found, owner, checked }
}

/** Whether Instagram shows the label from the switch on a direct post. It
 *  does not (tested 2026-10-29); kept as a switch in case Meta adds it. */
export const DIRECT_SWITCH_WORKS = false

/** What an old log entry from the direct test really means. Pure. */
export function entryWords(e: { on: boolean; detail?: string }): string | null {
  return e.on && /^Instagram took the switch/.test(String(e.detail ?? '')) ? 'Posted without the label: Instagram ignores the switch on a direct post, so the label needs a linked Facebook Page.' : null
}

/** Instagram refused the switch on a direct post this long ago or less: use
 *  the Facebook route meanwhile, and try the direct way again after it. */
export const DIRECT_REFUSAL_KEEP_MS = 7 * 24 * 60 * 60 * 1000

/** Is the direct refusal kept on this account still current? Pure. */
export function directRefused(extra: Record<string, unknown> | null | undefined, now = Date.now()): boolean {
  const at = Date.parse(String(extra?.paid_label_direct_refused_at ?? ''))
  return Number.isFinite(at) && now - at < DIRECT_REFUSAL_KEEP_MS
}

/** Did Instagram refuse the parameter itself (not the media)? Pure. */
export function refusedTheSwitch(message: string): boolean {
  return /is_paid_partnership|paid.?partnership|invalid parameter|unsupported|not supported|\(#?100\)|code 100/i.test(message)
}

/** Should this account's next post carry the label, and may the direct way
 *  be tried? */
export async function paidLabelWanted(igUserId: string): Promise<{ on: boolean; direct: boolean; owner: Owner | null }> {
  const sb = await admin()
  const owner = await ownerOf(sb, igUserId)
  if (!owner) return { on: false, direct: false, owner }
  const { data: integ } = await sb.from('integrations').select('tier').eq('user_id', owner.userId).maybeSingle()
  const on = paidLabelAllowed(integ?.tier, owner.userId) && owner.extra.paid_label_off !== true
  return { on, direct: DIRECT_SWITCH_WORKS && on && !directRefused(owner.extra), owner }
}

/** Keeps that Instagram refused the switch on a direct post. */
export async function noteDirectRefusal(owner: Owner | null, detail: string): Promise<void> {
  if (!owner?.rowId) return
  try {
    const sb = await admin()
    const { data } = await sb.from('social_accounts').select('extra').eq('id', owner.rowId).maybeSingle()
    const extra = (data?.extra ?? {}) as Record<string, unknown>
    await sb.from('social_accounts').update({ extra: { ...extra, paid_label_direct_refused_at: new Date().toISOString(), paid_label_direct_refused_why: detail.slice(0, 300) } }).eq('id', owner.rowId)
  } catch { /* the post is what matters */ }
}

/** Whether Instagram says the label is on a published post, or null when it
 *  will not say. */
export async function readBackLabel(mediaId: string, igToken: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://graph.instagram.com/v22.0/${encodeURIComponent(mediaId)}?fields=is_paid_partnership&access_token=${encodeURIComponent(igToken)}`, { signal: AbortSignal.timeout(15_000) })
    const data = await res.json().catch(() => ({})) as { is_paid_partnership?: boolean }
    return res.ok && typeof data.is_paid_partnership === 'boolean' ? data.is_paid_partnership : null
  } catch { return null }
}

/** Keeps what happened to this post on the account, for the settings card. */
export async function remember(owner: Owner | null | undefined, e: PaidLabelEntry): Promise<void> {
  if (!owner?.rowId) return
  try {
    const sb = await admin()
    const { data } = await sb.from('social_accounts').select('extra').eq('id', owner.rowId).maybeSingle()
    const extra = (data?.extra ?? {}) as Record<string, unknown>
    await sb.from('social_accounts').update({ extra: { ...extra, paid_label_log: withEntry(extra.paid_label_log, e) } }).eq('id', owner.rowId)
  } catch { /* the post is what matters */ }
}

/** Thrown when the labelled post may already be live, so the usual way must
 *  not post it again. */
export class PaidLabelUncertainError extends Error {
  name = 'PaidLabelUncertainError'
}

/**
 * Posts with the Paid partnership label when this account can, and returns
 * the media id. Returns null when it could not, before anything was
 * published, so the caller posts the usual way; the reason is kept. Throws
 * only when the post may already be live, or the media itself failed.
 */
export async function publishWithPaidLabel(opts: {
  userId: string
  accessToken: string
  params: URLSearchParams
  kind: string
  /** Injected in tests; the real lookup otherwise. */
  find?: typeof findPaidLabelRoute
}): Promise<string | null> {
  let found: Awaited<ReturnType<typeof findPaidLabelRoute>>
  try { found = await (opts.find ?? findPaidLabelRoute)(opts.userId, opts.accessToken) } catch { return null }
  const at = new Date().toISOString()
  if (!found.route) {
    // Nothing kept for accounts the label is not open to, or turned off.
    if (found.why !== 'not-yet' && found.why !== 'unknown-account') await remember(found.owner, { at, on: false, why: found.why, kind: opts.kind })
    return null
  }
  const { igId, token } = found.route
  const body = new URLSearchParams(opts.params)
  body.set('is_paid_partnership', 'true')
  body.set('access_token', token)

  // 1. The container. A refusal here means nothing exists yet: the usual way.
  let containerId: string
  try {
    const res = await fetch(`${FB_GRAPH}/${igId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(60_000) })
    const data = await res.json().catch(() => ({})) as { id?: string; error?: { message?: string } }
    if (!res.ok || !data.id) {
      if (isPermissionError(data)) routes.clear()
      await remember(found.owner, { at, on: false, why: isPermissionError(data) ? 'reconnect' : 'refused', detail: String(data.error?.message || `HTTP ${res.status}`).slice(0, 200), kind: opts.kind })
      return null
    }
    containerId = data.id
  } catch (e) {
    await remember(found.owner, { at, on: false, why: 'refused', detail: e instanceof Error ? e.message.slice(0, 200) : 'no answer', kind: opts.kind })
    return null
  }

  // 2. Instagram processes the media. A failure here is the media's own and
  //    would fail the usual way too, so it is thrown as it is.
  const deadline = Date.now() + 5 * 60 * 1000
  for (let i = 0; ; i++) {
    if (Date.now() > deadline) throw new Error('Instagram container processing timed out after 5 minutes')
    const res = await fetch(`${FB_GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20_000) })
    const data = await res.json().catch(() => ({})) as { status_code?: string; status?: string; error?: { message?: string } }
    if (!res.ok) throw new Error(`Instagram status check failed: ${data.error?.message || `HTTP ${res.status}`}`)
    if (data.status_code === 'FINISHED') break
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') throw new Error(`Instagram container failed: status=${data.status_code} ${data.status ?? ''}`)
    await new Promise((r) => setTimeout(r, i === 0 ? 3000 : 5000))
  }

  // 3. Publish. A clear refusal means it is not live: the usual way. No
  //    answer at all means it may be live: never post it twice.
  let res: Response
  try {
    res = await fetch(`${FB_GRAPH}/${igId}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: containerId, access_token: token }).toString(), signal: AbortSignal.timeout(60_000) })
  } catch {
    throw new PaidLabelUncertainError('Instagram did not answer the publish, so MVP did not try again: check Instagram before posting this again, it may already be live.')
  }
  const data = await res.json().catch(() => ({})) as { id?: string; error?: { message?: string } }
  if (!res.ok || !data.id) {
    if (res.status >= 500) throw new PaidLabelUncertainError('Instagram failed while publishing, so MVP did not try again: check Instagram before posting this again, it may already be live.')
    await remember(found.owner, { at, on: false, why: 'refused', detail: String(data.error?.message || `HTTP ${res.status}`).slice(0, 200), kind: opts.kind })
    return null
  }
  await remember(found.owner, { at, on: true, mediaId: data.id, kind: opts.kind })
  return data.id
}
