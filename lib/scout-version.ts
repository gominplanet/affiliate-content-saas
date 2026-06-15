/**
 * SOURCE OF TRUTH for the SCOUT extension version the app expects.
 *
 * ⚠️  BUMP THIS on every SCOUT change — in lockstep with
 *     extension/manifest.json's "version". The /epc page pings the installed
 *     extension (MVP_PING → { version }) and, when it's older than this,
 *     shows an "Update available" banner telling the user to reload the
 *     unpacked extension (SCOUT isn't in the Web Store, so Chrome never
 *     auto-updates it). Forget to bump this and the banner never fires.
 *
 * Also drop a one-liner in SCOUT_WHATS_NEW so the banner says what changed.
 */
export const SCOUT_LATEST_VERSION = '1.7.3'

/** One-line "what's new", shown in the update banner. Keep it user-facing. */
export const SCOUT_WHATS_NEW =
  'Rebuilt SCOUT: search Amazon by keyword, filter by EPC, pick the winners, and Push to MVP — with a one-time connected token that tucks away.'

/** True when the installed version is older than SCOUT_LATEST_VERSION.
 *  Returns false for a missing/unknown version (that's "not installed",
 *  handled by the install instructions, not the update banner). */
export function isScoutOutdated(installed: string | null | undefined): boolean {
  if (!installed) return false
  const a = String(installed).split('.').map(n => parseInt(n, 10) || 0)
  const b = SCOUT_LATEST_VERSION.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}
