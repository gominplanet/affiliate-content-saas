// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BRAND BY NAME, FROM TRYBE ITSELF (Seb, 2026-11-05: "I can find a brand
// like Alphatech Apparel really quickly by just searching for the brand...
// When I do the same thing and I search for a brand by brand name, it
// doesn't show up").
//
// Find brands searches MVP's copy of TRYBE's brand list. A brand the copy
// does not have (TRYBE's Discover list leaves some out, and a collection can
// stop partway) is asked for from TRYBE's own brand list through SCOUT, by
// name, and what TRYBE answers is kept in the copy like any collection.
// Read only: the same list SCOUT already reads, with the name added.
//
// Pure, so the page and the tests read one copy.

import { mergeDirectory, type DirectoryBrand } from '@/lib/trybe-directory'

/** The ways TRYBE's brand list may take a name to search by, tried in turn.
 *  One TRYBE does not know is ignored by it and finds nothing by name. */
export const TRYBE_SEARCH_PARAMS = ['search', 'q', 'name', 'query', 'keyword'] as const

/** A name as compared: lower case, letters and digits only, so "Alpha Tech"
 *  and "AlphaTech" are the same. Pure. */
export function nameKey(s: string | null | undefined): string {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The address asked of TRYBE's brand list for one way of searching. Every
 *  character outside letters, digits and . - is escaped, so it stays inside
 *  what SCOUT allows (extension/background.js TRYBE_API_ALLOW). Pure. */
export function trybeSearchPath(param: string, name: string): string {
  const v = encodeURIComponent(name.trim().slice(0, 60)).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `/backend/api/discovery/brands?limit=75&page=1&${param}=${v}`
}

/** The brands in one answer from TRYBE's brand list whose name holds the one
 *  asked for. Pure. */
export function brandsNamed(json: unknown, name: string): DirectoryBrand[] {
  const want = nameKey(name)
  if (want.length < 2) return []
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const list = Array.isArray(json) ? json : Array.isArray(j.data) ? j.data : Array.isArray(j.brands) ? j.brands : Array.isArray(j.items) ? j.items : []
  return mergeDirectory(list as unknown[]).filter((b) => nameKey(b.name).includes(want))
}
