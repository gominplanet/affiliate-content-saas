// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TWO SCOUTS IN ONE CHROME (Alejandro, 2026-10-19: on the latest SCOUT, TRYBE
// sends still failed with the old error, and "every time [it] ask[s] me to
// allow on Trybe and opens a new window completely").
//
// Each installed copy of SCOUT announces itself on MVP's pages (mvp-bridge.js,
// SCOUT_HELLO with its id and version). MVP kept only the LAST copy to speak,
// so with a Web Store copy and a copy added by hand the two took turns: the
// version MVP showed came from the Web Store copy (getScoutInstallKind asks it
// first), while the access check and the sends went to whichever spoke last.
// Allowed on TRYBE in one copy, the other asked again on the next visit; the
// old copy kept sending with its old error.
//
// Now every copy is kept with its version, the newest answers every time (the
// Web Store copy when they are the same), and the banner says when there are
// two. Pure, tested in scripts/test-scout-copies.

import { scoutAtLeast } from '@/lib/scout-version'

export interface ScoutCopy { id: string; version: string | null }

/** The order to try SCOUT copies in: the newest first, the Web Store copy
 *  first between equals, one with no version last. Pure. */
export function rankScoutCopies(copies: ScoutCopy[], storeId: string): ScoutCopy[] {
  const seen = new Map<string, ScoutCopy>()
  for (const c of copies) if (c && c.id) seen.set(c.id, { id: c.id, version: c.version ?? seen.get(c.id)?.version ?? null })
  return Array.from(seen.values()).sort((a, b) => {
    if (a.version && !b.version) return -1
    if (b.version && !a.version) return 1
    if (a.version && b.version && a.version !== b.version) {
      const aNewer = scoutAtLeast(a.version, b.version), bNewer = scoutAtLeast(b.version, a.version)
      if (aNewer !== bNewer) return aNewer ? -1 : 1
    }
    return (a.id === storeId ? 0 : 1) - (b.id === storeId ? 0 : 1)
  })
}

/** What the banner says when two copies answer. Null for one copy. */
export function twoCopiesWords(copies: ScoutCopy[], storeId: string): string | null {
  if (copies.length < 2) return null
  const named = rankScoutCopies(copies, storeId).map((c) =>
    `${c.version ? `SCOUT ${c.version}` : 'SCOUT'} ${c.id === storeId ? 'from the Chrome Web Store' : 'added by hand'}`)
  return `${copies.length} copies of SCOUT are installed in this Chrome (${named.join(', ')}). They take turns answering MVP, so TRYBE asks you to allow SCOUT again and some sends go through the old one.`
}
