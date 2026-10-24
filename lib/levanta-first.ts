// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LEVANTA LINKS WHEN THEY PAY MORE (Seb, 2026-10-24: "could mvp let users use
// levanta links when possible?").
//
// Levanta pays a brand's own commission, often several times Amazon's, on a
// sale through its link, which uses Amazon Attribution rather than the
// creator's Associates tag. A creator who connected Levanta and turned on
// "Use Levanta links when they pay more" (integrations.prefer_levanta,
// migration 455) gets, for each Amazon product MVP links:
//   - the Levanta link, when Levanta has the product for them;
//   - unless its Creator Connections campaign pays as much or more, because a
//     Levanta link earns no Associates commission and no campaign bonus.
// What MVP decided is kept per creator and product (levanta_links), so Levanta
// is asked once and not on every link, and the Levanta page lists it.
//
// What a Levanta link gives up, said on the Levanta page: Amazon pays on the
// whole cart for 24 hours, Levanta on the product for 14 days; and a Levanta
// link always goes to amazon.com, where Passport sends a visitor to their own
// country's Amazon.
//
// Server only. Never throws: anything that goes wrong leaves the normal
// Amazon link in place, and the reason is kept in levanta_links.

import { createAdminClient } from '@/lib/supabase/admin'
import { getExternalKey } from '@/lib/external-keys'
import { listLevantaProducts, createLevantaLink } from '@/services/levanta'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type LevantaState = 'use' | 'pays-less' | 'not-on-levanta' | 'no-access' | 'no-key' | 'failed'

export interface LevantaPick {
  /** The Levanta link, the full one (Levanta asks for it under any shortener). */
  url: string
  /** Levanta's commission for this creator, in percent. */
  commission: number | null
  /** The product's Creator Connections rate it beat, in percent. */
  ccCommission: number | null
}

/** Ask Levanta again after this long. A product can join Levanta, a brand can
 *  approve the creator, a rate can change; a failed ask is retried soon. */
export const LEVANTA_FRESH_MS: Record<LevantaState, number> = {
  'use': 7 * 86_400_000,
  'pays-less': 3 * 86_400_000,
  'not-on-levanta': 7 * 86_400_000,
  'no-access': 3 * 86_400_000,
  'no-key': 3_600_000,
  'failed': 6 * 3_600_000,
}

/** A link MVP can wait for: Levanta answers fast or the normal link goes. */
const ASK_MS = 8000

/** What to do with a product, from what Levanta and the CC catalogue say. Pure. */
export function levantaDecision(p: { onLevanta: boolean; access: boolean; commission: number | null; ccCommission: number | null }): LevantaState {
  if (!p.onLevanta) return 'not-on-levanta'
  if (!p.access) return 'no-access'
  // A Levanta link earns no Associates commission and no campaign bonus, so a
  // Creator Connections campaign that pays as much keeps the Amazon link. A
  // rate Levanta did not give is not assumed to be higher.
  if (p.ccCommission != null && (p.commission == null || p.commission <= p.ccCommission)) return 'pays-less'
  return 'use'
}

/** Is this row still a good answer. Pure. */
export function levantaFresh(row: { state: string; checked_at: string } | null | undefined, now = Date.now()): boolean {
  if (!row) return false
  const ttl = LEVANTA_FRESH_MS[row.state as LevantaState]
  const at = Date.parse(row.checked_at)
  return ttl != null && Number.isFinite(at) && now - at < ttl
}

/** How long a saved Levanta link keeps sending clicks while it is asked
 *  about again in the background: a link that worked last week still works
 *  today far more often than not, and a click never waits on Levanta. */
export const LEVANTA_CLICK_MAX_MS = 30 * 86_400_000

/** PASSPORT AT CLICK TIME (Seb, 2026-10-24, after McKay C's Geniuslink video:
 *  "build the passport, click time Levanta switch"). For one click on a
 *  Passport link to an Amazon product: the Levanta link to send this visitor
 *  to, or null to keep the normal Amazon link; and whether Levanta should be
 *  asked about the product again, in the background, after the redirect.
 *    - only with the creator's switch on;
 *    - only a visitor who would land on amazon.com anyway (a Levanta link is
 *      for the US store; everyone else keeps their own Amazon and tag);
 *    - only a saved answer of "use" (Levanta has it, the brand approved them,
 *      and it pays more than the Creator Connections campaign), at most
 *      LEVANTA_CLICK_MAX_MS old. Pure. */
export function levantaAtClick(o: { prefer: boolean; usStore: boolean; row: { state: string; url?: string | null; checked_at: string } | null | undefined; now?: number }): { url: string | null; ask: boolean } {
  if (!o.prefer || !o.usStore) return { url: null, ask: false }
  const now = o.now ?? Date.now()
  const at = o.row ? Date.parse(o.row.checked_at) : NaN
  const url = o.row && o.row.state === 'use' && o.row.url && /^https?:\/\//i.test(o.row.url) && Number.isFinite(at) && now - at < LEVANTA_CLICK_MAX_MS ? String(o.row.url) : null
  return { url, ask: !levantaFresh(o.row ?? null, now) }
}

/** A Levanta link: its short lvnta.com form, or an Amazon link carrying
 *  Amazon Attribution's tracking (maas). Never rebuilt from its ASIN, which
 *  would put the Associates tag back and drop Levanta's commission. Pure. */
export function isLevantaUrl(url: string | null | undefined): boolean {
  return /^https?:\/\/(?:www\.)?lvnta\.com\/|[?&]maas=|[?&]ref_=aa_maas/i.test(String(url || ''))
}

/** Only amazon.com: Levanta links are for the US store. Pure. */
export function levantaMarketplaceOk(destination: string | null | undefined): boolean {
  const d = String(destination || '').trim()
  if (!d) return true
  try {
    const h = new URL(d).hostname.toLowerCase().replace(/^www\./, '')
    return h === 'amazon.com' || h === 'amzn.to' || h === 'a.co' || !/amazon\./.test(h)
  } catch { return true }
}

// One ask per creator and product at a time: a blog post that names the same
// product five times asks Levanta once.
const inflight = new Map<string, Promise<LevantaPick | null>>()

/**
 * The Levanta link for this product, or null to keep the normal Amazon link.
 * `prefer` is the creator's switch (LinkStyleConfig.preferLevanta); off costs
 * nothing, not even a read.
 */
export async function levantaLinkFor(opts: { userId: string; asin: string | null | undefined; prefer: boolean; destination?: string | null }): Promise<LevantaPick | null> {
  if (!opts.prefer) return null
  const asin = String(opts.asin || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin) || !levantaMarketplaceOk(opts.destination)) return null
  const key = `${opts.userId}:${asin}`
  const running = inflight.get(key)
  if (running) return running
  const p = ask(opts.userId, asin).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

async function ask(userId: string, asin: string): Promise<LevantaPick | null> {
  const db: Db = createAdminClient()
  try {
    const { data: row } = await db.from('levanta_links').select('*').eq('user_id', userId).eq('asin', asin).maybeSingle()
    if (levantaFresh(row)) {
      if (row.state !== 'use' || !row.url) return null
      void db.from('levanta_links').update({ used_at: new Date().toISOString() }).eq('user_id', userId).eq('asin', asin)
      return { url: String(row.url), commission: num(row.commission), ccCommission: num(row.cc_commission) }
    }
  } catch {
    // levanta_links missing (migration 455 not run): the switch cannot be on
    // either, since it lives in the same migration. Keep the normal link.
    return null
  }

  const save = async (state: LevantaState, extra: { url?: string | null; commission?: number | null; cc?: number | null } = {}) => {
    try {
      await db.from('levanta_links').upsert({
        user_id: userId, asin, state, url: extra.url ?? null, commission: extra.commission ?? null,
        cc_commission: extra.cc ?? null, checked_at: new Date().toISOString(),
        ...(state === 'use' ? { used_at: new Date().toISOString() } : {}),
      }, { onConflict: 'user_id,asin' })
    } catch { /* the answer is used now even if it could not be kept */ }
  }

  const token = await getExternalKey(db, userId, 'levanta')
  if (!token) { await save('no-key'); return null }
  try {
    // marketplace is required (Levanta answers 422 without it), and the same
    // ASIN can be listed for other countries: only amazon.com counts here.
    const { products } = await listLevantaProducts(token, { asins: asin, marketplace: 'amazon.com', limit: 10, timeoutMs: ASK_MS })
    const prod = products.find((x) => x.asin === asin && (!x.marketplace || x.marketplace === 'amazon.com')) ?? null
    const cc = await ccRate(db, asin)
    const state = levantaDecision({ onLevanta: !!prod, access: !!prod?.access, commission: prod?.commission ?? null, ccCommission: cc })
    if (state !== 'use') { await save(state, { commission: prod?.commission ?? null, cc }); return null }
    const { url } = await createLevantaLink(token, { asin, marketplace: 'amazon.com', subid1: 'mvp', timeoutMs: ASK_MS })
    if (!/^https?:\/\//i.test(url || '')) { await save('failed', { commission: prod?.commission ?? null, cc }); return null }
    await save('use', { url, commission: prod?.commission ?? null, cc })
    return { url, commission: prod?.commission ?? null, ccCommission: cc }
  } catch {
    await save('failed')
    return null
  }
}

/** The best live Creator Connections rate on this product, or null. */
async function ccRate(db: Db, asin: string): Promise<number | null> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await db.from('cc_campaign_catalog').select('commission_pct').contains('asins', [asin]).gte('ends_at', today).limit(50)
    const rates = ((data || []) as Array<{ commission_pct: unknown }>).map((r) => num(r.commission_pct)).filter((n): n is number => n != null)
    return rates.length ? Math.max(...rates) : null
  } catch { return null }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** What MVP decided for a product, in the creator's words. Pure. */
export function levantaStateWords(state: string, p: { commission?: number | null; ccCommission?: number | null } = {}): string {
  const pct = (n: number | null | undefined) => (n == null ? null : `${Math.round(n * 10) / 10}%`)
  switch (state) {
    case 'use': return `Levanta link${pct(p.commission) ? `, ${pct(p.commission)}` : ''}${pct(p.ccCommission) ? ` (Creator Connections pays ${pct(p.ccCommission)})` : ''}`
    case 'pays-less': return `Amazon link: its Creator Connections campaign pays ${pct(p.ccCommission) ?? 'as much'}${pct(p.commission) ? `, Levanta ${pct(p.commission)}` : ''}`
    case 'not-on-levanta': return 'Amazon link: not on Levanta'
    case 'no-access': return 'Amazon link: on Levanta, but its brand has not approved you yet'
    case 'no-key': return 'Amazon link: Levanta is not connected'
    default: return 'Amazon link: Levanta did not answer, asked again in a few hours'
  }
}
