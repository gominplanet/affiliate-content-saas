# SCOUT — Chrome Web Store

The store build is `public/mvp-cc-scout-store.zip` (served at
`https://www.mvpaffiliate.io/mvp-cc-scout-store.zip`). It is the normal
extension MINUS the `key` field (CWS forbids it) and with the manifest
`description` trimmed to ≤132 chars. The unpacked build
(`public/mvp-cc-scout.zip`) keeps the `key` for load-unpacked users.

The item is **LIVE** (id `blpmlneliggaekangckpgknphpacapkg`, first approved
2026-07-02), so new releases are UPDATES, not first submissions.

## Publishing a new version (the normal path now)
On every SCOUT change: bump `extension/manifest.json` "version" AND
`lib/scout-version.ts` `SCOUT_LATEST_VERSION` in lockstep, then rebuild both
zips (`bash scripts/zip-extension.sh && bash scripts/zip-extension-store.sh`)
and commit them. Then upload the store build:

1. Download `https://www.mvpaffiliate.io/mvp-cc-scout-store.zip` (after deploy).
2. Developer Dashboard (https://chrome.google.com/webstore/devconsole) → open
   **SCOUT — MVP Affiliate** → **Package** → **Upload new package** → drop the
   zip → **Submit for review**.
3. The version must be higher than the live one; the listing/screenshots/privacy
   fields carry over. The extension **id does not change** on an update, so no
   env changes are needed. Chrome auto-updates store users once approved.

Latest release: **1.11.71** — Send-on-Creator-Connections now (a) types the ASIN
into the Affiliate+ "Search brand, keyword, or ASIN" box specifically (not the
global/SPC search), so it filters straight to the campaign instead of scrolling
the whole grid, and (b) accepts + sends in ONE background tab (new
MVP_CC_ACCEPT_AND_SEND flow) so there's no cross-tab teardown race (the "Frame
with ID 0 was removed" error).

## First-time submission (historical — kept for reference)
Developer Dashboard → **Add new item** → drop `mvp-cc-scout-store.zip`. The two
earlier errors (key not allowed, description too long) are fixed in this build.

## Store listing — copy/paste

**Item name:** SCOUT — MVP Affiliate

**Summary (≤132):** Companion for MVP Affiliate: grabs real YouTube frames for sharper thumbnails and reads Amazon product details.

**Category:** Productivity

**Detailed description:**
> SCOUT is the free companion extension for MVP Affiliate (mvpaffiliate.io). It
> runs in your own browser and makes a few things work that a server can't do on
> its own:
>
> • Sharper thumbnails — captures a real frame from your YouTube video so MVP can
>   ground your thumbnail on how you and the product actually look on screen.
> • Accurate product details — reads an Amazon product page (title, bullets,
>   price, images) from your logged-in browser when our server is rate-limited.
> • Brand recaps — finds your own on-Amazon videos so MVP can include the right
>   links when you pitch a brand.
> • Deal discovery — scans Amazon Creator Connections you have access to and
>   sends the opportunities into MVP.
>
> SCOUT only acts when you ask it to from MVP Affiliate, and only on your own
> logged-in YouTube and Amazon sessions. You need an MVP Affiliate account to use
> it.

## Privacy practices (REQUIRED — review fails without these)

**Single purpose:** Bridge the MVP Affiliate web app to the user's own logged-in
YouTube and Amazon sessions so MVP can read data the user already has access to
(video frames, product details) and act only on the user's request.

**Permission justifications:**
- `activeTab` / `scripting` — read the page the user asked MVP to work with
  (grab a YouTube frame, read an Amazon product page) only on demand.
- `tabs` — open the specific YouTube/Amazon/Studio page needed for a requested
  action, then close it.
- `storage` — remember lightweight extension settings.
- Host `*.youtube.com` — capture a frame from the user's own video and read
  their Studio content list (for the planning calendar / metadata).
- Host `amazon.com/*` (creatorconnections, manage-content, shop, dp) +
  `affiliate-program.amazon.com` — read product details and the user's own
  affiliate content from their logged-in session.
- Host `mvpaffiliate.io` — receive requests from the MVP dashboard
  (externally_connectable) and hand results back.

**Data usage:** SCOUT does not collect, store, or transmit personal data to any
third party. It passes the data the user requested (a video frame, product text)
back to the user's own MVP Affiliate dashboard only. No analytics, no selling.

**Privacy policy URL:** use the MVP Affiliate privacy policy (e.g.
`https://www.mvpaffiliate.io/privacy`). REQUIRED field.

**Screenshots:** at least one 1280×800 (or 640×400) PNG. Easiest: a screenshot
of the YouTube Co-Pilot generating a thumbnail, or the SCOUT popup.

## Store extension ID (DONE — historical)
On first publish CWS assigned the store id `blpmlneliggaekangckpgknphpacapkg`
(different from the unpacked `inpklaogoifhgaimbnlgmijnnjkopnlc`, because CWS
ignores our `key`). This is already wired: `lib/extension-frame.ts` messages
BOTH the store id and the sideload id, so store users and load-unpacked users
both work. **Updates keep this same id** — the id only changes on first publish,
never on a version update, so there is nothing to reconfigure when releasing a
new version.
