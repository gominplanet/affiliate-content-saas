// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ACCEPTED, PENDING, DECLINED (Seb, 2026-10-08 upgrade 1). TRYBE keeps each
// collaboration request a creator sent, with where it stands, under Pending
// Requests. SCOUT 1.42.0 may read that list (GET only) from the creator's
// own TRYBE tab, and this file reads it.
//
// TRYBE's address and field names for the list were not seen yet, so the
// likely addresses are tried in order and each field is found by the names
// it is likely to have. When nothing could be read, the caller is told what
// each address answered, so an unread list never looks like "no requests".

export type RequestState = 'accepted' | 'pending' | 'declined'

/** Tried in order; the first that answers with a readable list wins. Every
 *  one must also pass SCOUT's TRYBE_API_ALLOW (GET only). */
export const INVITE_PATHS = [
  '/backend/api/invitations?page=1&limit=100',
  '/backend/api/collaboration-requests?page=1&limit=100',
  '/backend/api/collaborations?page=1&limit=100',
  '/backend/api/requests?page=1&limit=100',
  '/backend/api/applications?page=1&limit=100',
  '/backend/api/partnerships?page=1&limit=100',
]

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** TRYBE's words for a request's state, in any of the usual spellings. */
export function stateOf(word: unknown): RequestState | null {
  const w = str(word).toLowerCase().replace(/[\s_-]+/g, '')
  if (!w) return null
  if (/declin|reject|denied|refus|cancel|expire|withdraw|closed/.test(w)) return 'declined'
  if (/accept|approv|active|joined|partner|confirm|ongoing|completed|inprogress/.test(w)) return 'accepted'
  if (/pend|request|sent|await|invit|review|open|new|waiting/.test(w)) return 'pending'
  return null
}

const STATUS_KEYS = ['status', 'state', 'requestStatus', 'request_status', 'invitationStatus', 'invitation_status', 'collaborationStatus', 'collaboration_status', 'applicationStatus', 'application_status', 'partnershipStatus', 'partnership_status']
const NESTS = ['invitation', 'request', 'collaboration', 'application', 'partnership']

/** One item's state: a status word, or yes/no flags, at the top or one level in. */
export function itemState(raw: Obj): RequestState | null {
  const look = (o: Obj): RequestState | null => {
    for (const k of STATUS_KEYS) { const s = stateOf(o[k]); if (s) return s }
    if (o.declined === true || o.isDeclined === true || o.rejected === true || o.isRejected === true) return 'declined'
    if (o.accepted === true || o.isAccepted === true || o.approved === true || o.isApproved === true) return 'accepted'
    if (o.pending === true || o.isPending === true) return 'pending'
    return null
  }
  const top = look(raw)
  if (top) return top
  for (const n of NESTS) if (isObj(raw[n])) { const s = look(raw[n] as Obj); if (s) return s }
  return null
}

export interface RequestRow { brandId: string | null; name: string; state: RequestState; at: number }

/** The list, whatever TRYBE wraps it in. */
function listIn(json: unknown): unknown[] {
  if (Array.isArray(json)) return json
  if (!isObj(json)) return []
  for (const k of ['data', 'items', 'results', 'rows', 'invitations', 'requests', 'collaborations', 'applications', 'partnerships']) {
    const v = json[k]
    if (Array.isArray(v)) return v
    if (isObj(v)) { const inner = listIn(v); if (inner.length) return inner }
  }
  return []
}

export function readRequests(json: unknown): { rows: RequestRow[]; listed: number } {
  const list = listIn(json)
  const rows: RequestRow[] = []
  for (const raw of list) {
    if (!isObj(raw)) continue
    const brand = isObj(raw.brand) ? raw.brand : isObj(raw.company) ? raw.company : null
    const brandId = str(raw.brandId ?? raw.brand_id ?? brand?.id) || null
    const name = str(brand?.name ?? brand?.brandName ?? raw.brandName ?? raw.brand_name ?? raw.companyName ?? (typeof raw.brand === 'string' ? raw.brand : ''))
    const state = itemState(raw)
    if (!state || (!brandId && !name)) continue
    const at = Date.parse(str(raw.updatedAt ?? raw.updated_at ?? raw.createdAt ?? raw.created_at)) || 0
    rows.push({ brandId, name: name.slice(0, 120), state, at })
  }
  return { rows, listed: list.length }
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Where a brand on the creator's list stands, by TRYBE id first, then name. */
export function requestFor(b: { brand_id: string; name: string }, rows: RequestRow[]): RequestRow | null {
  const byId = rows.filter(r => r.brandId === b.brand_id)
  const byName = byId.length ? byId : rows.filter(r => !r.brandId && r.name && key(r.name) === key(b.name))
  if (!byName.length) return null
  return [...byName].sort((x, y) => y.at - x.at)[0]
}

/** Accepted out of those TRYBE has answered (pending ones are not counted
 *  against the creator). Null until at least one has been answered. */
export function acceptRate(states: RequestState[]): number | null {
  const answered = states.filter(s => s !== 'pending')
  if (!answered.length) return null
  return Math.round(100 * answered.filter(s => s === 'accepted').length / answered.length)
}
