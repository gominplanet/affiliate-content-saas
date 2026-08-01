/**
 * SOURCE OF TRUTH for the SCOUT extension version the app ships.
 *
 * ⚠️  BUMP THIS on every SCOUT change — in lockstep with
 *     extension/manifest.json's "version". SCOUT now lives on the Chrome Web
 *     Store, so a version bump is what makes Chrome pull the new build (icons
 *     included) on its next background auto-update. The app no longer nags
 *     store installs to "update" — isScoutOutdated survives only as a
 *     low-level helper, not a user-facing gate.
 */
export const SCOUT_LATEST_VERSION = '1.11.92'

/** One-line "what's new". No longer shown in a nag (store installs auto-update);
 *  kept as a changelog note for whoever bumps the version. */
export const SCOUT_WHATS_NEW =
  'Send on Creator Connections now sends through Amazon’s real chat API — it looks up the brand’s chat by campaign, then posts your recap directly (no button-clicking, no popups, no DOM, invisible). Learned automatically from your own sends; the visible-tab flow stays as a fallback.'

/** Canonical download for the latest SCOUT build (public/, rebuilt from
 *  extension/ on every version bump). Used by the EPC banner + the top-bar
 *  "Get / Update SCOUT" button so there's ONE source of the URL. */
export const SCOUT_DOWNLOAD_URL = '/mvp-cc-scout.zip'

/** The Chrome Web Store UPLOAD build (`key` stripped, ≤132-char description) —
 *  the zip you drop into the CWS Developer Dashboard. Distinct from
 *  SCOUT_DOWNLOAD_URL, which is the load-unpacked build that keeps the `key`
 *  for existing installs. See extension/CHROME-WEB-STORE.md. */
export const SCOUT_STORE_UPLOAD_URL = '/mvp-cc-scout-store.zip'

/** LIVE Chrome Web Store listing (approved 2026-07-02). One-click install +
 *  Chrome auto-updates it — so store users never touch the download/reload
 *  flow. This is the canonical "Get SCOUT" destination. */
export const SCOUT_STORE_LISTING_URL =
  'https://chromewebstore.google.com/detail/scout-%E2%80%94-mvp-affiliate/blpmlneliggaekangckpgknphpacapkg'

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
