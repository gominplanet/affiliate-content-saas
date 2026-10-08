// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ACCEPTED, PENDING, DECLINED (Seb, 2026-10-08 upgrade 1). TRYBE's Discover
// Brands list (/backend/api/discovery/brands) carries, for the creator who is
// signed in, `hasPendingRequest` (they asked this brand and it has not
// answered) and `hasPendingInvite` (the brand invited them). Seen in MVP's
// copy of the list on 2026-10-08: both on every one of 6,115 entries.
//
// TRYBE has no accepted or declined flag there, so the rest is read with the
// inbox: a request no longer pending whose brand opened a chat was accepted;
// one no longer pending with no chat was declined or ran out. Without the
// inbox, a request no longer pending is left untagged rather than guessed.

export type RequestState = 'accepted' | 'pending' | 'declined'

export interface BrandFlags { brandId: string; name: string; pendingRequest: boolean; pendingInvite: boolean }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** One page of Discover Brands: each brand's two flags, and how many pages
 *  TRYBE says there are (null when it does not say). */
export function readDiscoveryPage(json: unknown): { flags: BrandFlags[]; listed: number; totalPages: number | null } {
  const list = Array.isArray(json) ? json
    : isObj(json) ? (Array.isArray(json.data) ? json.data : Array.isArray(json.brands) ? json.brands : Array.isArray(json.items) ? json.items : [])
      : []
  const flags: BrandFlags[] = []
  for (const raw of list) {
    if (!isObj(raw)) continue
    const brand = isObj(raw.brand) ? raw.brand : null
    const brandId = str(raw.brandId ?? raw.brand_id ?? brand?.id)
    if (!brandId) continue
    flags.push({
      brandId,
      name: str(brand?.name ?? brand?.brandName ?? raw.brandName ?? raw.name).slice(0, 120),
      pendingRequest: raw.hasPendingRequest === true,
      pendingInvite: raw.hasPendingInvite === true,
    })
  }
  const pg = isObj(json) && isObj(json.pagination) ? json.pagination : null
  const totalPages = pg && Number(pg.totalPages) > 0 ? Number(pg.totalPages) : null
  return { flags, listed: list.length, totalPages }
}

/** Where a request MVP sent stands. Null when it cannot be told: the brand
 *  was not in the list read, or it is no longer pending and the inbox was
 *  not read, so accepted and declined cannot be told apart. */
export function requestState(flags: BrandFlags | undefined, chat: boolean | null): RequestState | null {
  if (!flags) return null
  if (flags.pendingRequest) return 'pending'
  if (chat === null) return null
  return chat ? 'accepted' : 'declined'
}

/** Accepted out of those TRYBE has answered (pending ones are not counted
 *  against the creator). Null until at least one has been answered. */
export function acceptRate(states: RequestState[]): number | null {
  const answered = states.filter(s => s !== 'pending')
  if (!answered.length) return null
  return Math.round(100 * answered.filter(s => s === 'accepted').length / answered.length)
}
