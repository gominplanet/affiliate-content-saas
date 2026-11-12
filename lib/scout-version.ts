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
export const SCOUT_LATEST_VERSION = '1.60.11'

/** One-line "what's new". No longer shown in a nag (store installs auto-update);
 *  kept as a changelog note for whoever bumps the version. */
export const SCOUT_WHATS_NEW =
  'Match my TikTok: download your matched TikTok videos to upload them to TRYBE. SCOUT saves each one to your Downloads folder.'

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

/** The oldest SCOUT that drives the Studio steps (the page-by-page kit).
 *
 * A FIXED FLOOR, NOT THE LATEST. The Studio gate used to be "not older than
 * SCOUT_LATEST_VERSION", so every SCOUT release switched the Studio steps off
 * for every creator until Chrome pulled the new build, which on the Web Store
 * waits for review first. Raise this only when the page needs something an
 * older SCOUT cannot do. */
/** SCOUT that can pull Amazon's newest Creator Connections campaigns (the
 *  "early access" grid) for the team's daily pull. */
export const SCOUT_CC_NEW_MIN_VERSION = '1.53.0'

/** SCOUT works on TRYBE only through the creator's own open TRYBE tab, and
 *  sends requests the way TRYBE's own button does (lib/trybe-tab). */
export const SCOUT_TRYBE_OWN_TAB_MIN_VERSION = '1.53.2'

/** SCOUT opens TRYBE in a tab behind MVP's when none is open (MVP_TRYBE_TAB_OPEN). */
export const SCOUT_TRYBE_TAB_OPEN_MIN_VERSION = '1.53.5'

/** SCOUT runs the team's Daily refresh by itself every morning at the hour
 *  set (MVP_TRYBE_MORNING): it opens MVP's TRYBE page behind the creator's
 *  tabs with ?daily=auto, once a day (Seb, 2026-11-06). */
export const SCOUT_TRYBE_MORNING_MIN_VERSION = '1.56.0'

/** SCOUT counts a brand's Meta ads on its own advertiser Page: found once from
 *  the Ad Library's search suggestions, then counted there (Seb, 2026-11-06:
 *  "search for meta ads the right way"). Older SCOUT counts by the exact name. */
export const SCOUT_META_PAGE_MIN_VERSION = '1.57.0'

/** SCOUT reads an Amazon product's reviews for Video Scripts: the reviews the
 *  product page shows, Amazon's "Customers say" summary, and the critical
 *  reviews (Alejandro, via Seb 2026-11-06: "read the reviews and find the
 *  weakness points"). Older SCOUT reads the product without its reviews. */
export const SCOUT_AMAZON_REVIEWS_MIN_VERSION = '1.58.0'

/** SCOUT opens TRYBE behind MVP's tab by itself as the first step of any
 *  TRYBE request, upload, brand list read or Send all run that finds it
 *  closed (Seb, 2026-11-03: "this should always be the first thing it
 *  does"). Older SCOUT is covered by MVP opening it first (ensureTrybeTab). */
export const SCOUT_TRYBE_SELF_OPEN_MIN_VERSION = '1.54.0'

/** SCOUT tags up to three products on one Amazon video (job.moreAsins) and
 *  says which went on (tagged / notTagged). Older SCOUT tags the first one
 *  only, and the saved line says so (lib/launch-products taggedLine). */
export const SCOUT_MORE_PRODUCTS_MIN_VERSION = '1.55.0'

/** SCOUT reads Instagram tag counts quietly, only through an Instagram tab the
 *  creator already has open, never opening one (MVP_HASHTAG_INSTAGRAM quiet). */
export const SCOUT_IG_QUIET_MIN_VERSION = '1.53.6'

/** SCOUT puts the intro video in the creator's TRYBE portfolio and sends it
 *  with each Request to Join (sampleCreativeUrl; lib/trybe-intro). */
export const SCOUT_TRYBE_INTRO_MIN_VERSION = '1.53.7'

export const SCOUT_STUDIO_MIN_VERSION = '1.20.0'

/** The oldest SCOUT that can pin a comment MVP posted (On sale now). */
export const SCOUT_PIN_MIN_VERSION = '1.21.16'

/** The oldest SCOUT that can fill a post into a Facebook Group. */
export const SCOUT_FB_GROUP_MIN_VERSION = '1.22.0'

/** The oldest SCOUT that can attach the hero (thumbnail or video card) to a
 *  Group post it fills. */
export const SCOUT_FB_GROUP_MEDIA_MIN_VERSION = '1.23.0'

/** The oldest SCOUT that watches for the filled Group post to go up and
 *  reports its address, so MVP can offer a Page post linking to it. */
export const SCOUT_FB_GROUP_WATCH_MIN_VERSION = '1.24.0'
/** SCOUT answers "is it allowed on Facebook" and can ask, for Facebook setup. */
/** The oldest SCOUT that reads TRYBE's Discover Brands and sends requests to join (Labs). */
export const SCOUT_TRYBE_MIN_VERSION = '1.41.0'
/** The oldest SCOUT that searches TRYBE by the creator's keywords and
 *  categories, and reads the whole Discover list (Labs). */
export const SCOUT_TRYBE_FIND_MIN_VERSION = '1.41.1'
/** The oldest SCOUT that collects TRYBE's whole brand list for MVP's own
 *  directory (Labs). 1.41.2 failed in the page every time; 1.41.3 could not
 *  read TRYBE's sign-in cookie and went in signed out. */
export const SCOUT_TRYBE_HARVEST_MIN_VERSION = '1.41.4'
/** The oldest SCOUT that reads and answers TRYBE conversations for MVP (Labs). */
export const SCOUT_TRYBE_INBOX_MIN_VERSION = '1.41.5'
/** The oldest SCOUT that sends TRYBE requests in a tab behind MVP's, taking
 *  the screen only when a send needs it (Labs). */
export const SCOUT_TRYBE_BACKGROUND_SEND_MIN_VERSION = '1.41.7'
/** The oldest SCOUT that runs Send all by itself (1.48.0): MVP hands it the
 *  list and its tab can close; nothing takes the screen during the run. */
export const SCOUT_TRYBE_RUNNER_MIN_VERSION = '1.48.0'
/** Sending to TRYBE from SCOUT's hidden window. Before 1.52.3 the page there
 *  was never drawn, so every send failed with "brand-not-found ... no search
 *  box" (Alejandro, Oct 18 and 19, on 1.52.0 and 1.52.2). MVP refuses to start
 *  a send from an older SCOUT and says to update, rather than fail each one. */
export const SCOUT_TRYBE_HIDDEN_SEND_MIN_VERSION = '1.52.3'
/** The oldest SCOUT that reads hashtag trends (TikTok Creative Center and
 *  Instagram's tag counts, Labs). */
export const SCOUT_HASHTAG_TRENDS_MIN_VERSION = '1.49.0'
/** The oldest SCOUT that can run comment pins, Creator Connections, Amazon
 *  videos and YouTube Studio out of sight when MVP says so (lib/scout-quiet). */
export const SCOUT_QUIET_MIN_VERSION = '1.50.2'
/** The oldest SCOUT that hands MVP the words of each Meta ad card with the
 *  count (What's working's ads gallery). */
export const SCOUT_META_CARDS_MIN_VERSION = '1.51.0'
/** The oldest SCOUT that looks past a brand's first 8 Meta ads and copies the
 *  8 running longest (Seb, 2026-10-24). Older ones copy the first 8. */
export const SCOUT_META_LONGEST_MIN_VERSION = '1.53.8'
/** The oldest SCOUT that sends each Meta ad's video file, so MVP can hear its
 *  spoken hook (Seb, 2026-10-24). */
export const SCOUT_META_VIDEO_MIN_VERSION = '1.53.9'
/** The oldest SCOUT that sends a video to a TRYBE brand (Send to TRYBE, Labs). */
export const SCOUT_TRYBE_SUBMIT_MIN_VERSION = '1.52.0'
/** 1.52.1: the Facebook tab can close once Post is pressed. A handed-off Reel
 *  job carries on by looking in the Group itself, out of sight, and the watch
 *  says what it last saw (Seb, 2026-10-19). */
export const SCOUT_FB_GROUP_SEARCH_MIN_VERSION = '1.52.1'
/** The oldest SCOUT that takes a Page Reel job and reports back from the
 *  background (Clip Factory, Group first). */
export const SCOUT_FB_REEL_JOB_MIN_VERSION = '1.50.0'
/** The oldest SCOUT that opens one brand's own popup on TRYBE for the
 *  creator (On TRYBE links, Labs). */
export const SCOUT_TRYBE_OPEN_BRAND_MIN_VERSION = '1.41.8'
/** 1.45.0 (Cole's playbook): TRYBE's Top 100 and a brand's details, read
 *  only, and the Meta Ad Library count per brand. */
export const SCOUT_TRYBE_PLAYBOOK_MIN_VERSION = '1.45.0'
/** 1.46.0 (My brands): the creator's totals per brand, each brand's
 *  submissions and the words of a brand's best videos, read only. */
export const SCOUT_TRYBE_MYBRANDS_MIN_VERSION = '1.46.0'
/** 1.46.1: an Amazon upload says which video of how many each store is on,
 *  for the live bar on Bulk Amazon upload. Older SCOUT shows the step and
 *  percentage without the count. */
export const SCOUT_AMAZON_COUNT_MIN_VERSION = '1.46.1'

export const SCOUT_FB_ACCESS_MIN_VERSION = '1.39.0'
/** SCOUT attaches a Clip Factory clip's video to a Group post. */
export const SCOUT_FB_GROUP_CLIP_MIN_VERSION = '1.40.0'

/** The oldest SCOUT that uploads Liftoff videos through YouTube Studio
 *  (MVP_STUDIO_UPLOAD), so an upload costs nothing from the shared quota. */
export const SCOUT_STUDIO_UPLOAD_MIN_VERSION = '1.25.0'

/** The oldest SCOUT that posts first comments itself, at no YouTube quota. */
export const SCOUT_COMMENT_POST_MIN_VERSION = '1.26.0'

/** True when the installed SCOUT is at least `min`. False when unknown. */
export function scoutAtLeast(installed: string | null | undefined, min: string): boolean {
  if (!installed) return false
  const a = String(installed).split('.').map(n => parseInt(n, 10) || 0)
  const b = min.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

/** SCOUT reads the creator's own public TikTok videos for Match my TikTok, in
 *  its own minimized window, and hands them to MVP itself (MVP_TIKTOK_SCAN;
 *  Seb, 2026-11-09: "we're going to use Scout to start"). */
export const SCOUT_TIKTOK_LIBRARY_MIN_VERSION = '1.59.0'

/** SCOUT saves one of the creator's own TikTok videos to their Downloads, from
 *  the video's page in its own window (MVP_TIKTOK_DOWNLOAD; Seb, 2026-11-09:
 *  "a download button for each video matched so users can then re-upload
 *  those to trybe"). */
export const SCOUT_TIKTOK_DOWNLOAD_MIN_VERSION = '1.60.0'
/** SCOUT 1.60.2: a TikTok download says how far it is (MVP_TIKTOK_DL_STATUS),
 *  waits while Chrome asks where to save, and is always answered with the step
 *  it reached (Seb, 2026-11-09: 1.60.1 still ended in "took too long"). */
export const SCOUT_TIKTOK_DL_PROGRESS_MIN_VERSION = '1.60.2'
/** SCOUT 1.60.4: a download from a TikTok tab in front of the creator, on
 *  their ask, to tell whether SCOUT's hidden window is what stops it. */
export const SCOUT_TIKTOK_VISIBLE_MIN_VERSION = '1.60.4'
