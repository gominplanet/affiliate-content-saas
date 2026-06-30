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
export const SCOUT_LATEST_VERSION = '1.11.0'

/** One-line "what's new", shown in the update banner. Keep it user-facing. */
export const SCOUT_WHATS_NEW =
  'New: SCOUT can read your YouTube Studio schedule so the Co-Pilot planning calendar shows every scheduled video (the YouTube API misses most on large channels). Re-download + reload once to apply.'

/** Canonical download for the latest SCOUT build (public/, rebuilt from
 *  extension/ on every version bump). Used by the EPC banner + the top-bar
 *  "Get / Update SCOUT" button so there's ONE source of the URL. */
export const SCOUT_DOWNLOAD_URL = '/mvp-cc-scout.zip'

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
