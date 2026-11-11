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

Latest release: **1.60.10**: Your Amazon video library is read from Amazon's own list every time. SCOUT keeps the Manage content page's list request apart from the other requests the page makes, so it is not pushed out before SCOUT reads it, and waits up to 25 seconds for it (it waited 6). Read only; no new permissions. Previous: **1.60.9**: Your Amazon video library reads to the end. The background Manage content tab SCOUT reads the list in is kept from Chrome's Memory Saver, and when Chrome reloads, discards or closes it partway through, SCOUT opens Manage content again and carries on from the batch it was reading, instead of stopping. Read only; no new permissions. Previous: **1.60.8**: Your Amazon video library reads again. When Amazon answers SCOUT's request for the video list with no videos, SCOUT now asks again the way the Manage content page itself asks (fewer videos a page, down to the page's own request unchanged) instead of taking the empty answer for an empty library, and when every way comes back empty it says what Amazon answered to each. Read only; no new permissions. Previous: **1.60.7**: Match my TikTok downloads without running TikTok's page. SCOUT opens TikTok's robots.txt address (no TikTok code runs there), reads the creator's video page there as text for the video's addresses, and reads the file there in 1 MB parts the way TikTok's own player does. The download no longer tells a TikTok page it is on screen (on a signed-in video page that sent TikTok from video to video). Only when the text gives no address is the video's own page opened. No new permissions. Previous: **1.60.6**: Match my TikTok downloads keep only a whole video. Every file is checked against the size TikTok's own page gives for it (and, from the page, every part of the MP4 is checked to be there); a file cut short is deleted and said instead of kept. Each download writes down its steps with their times so a failure says where it stopped, a tab Chrome replaces is followed, a closed tab is said, and TikTok's own player in SCOUT's tab is paused while the file is saved. No new permissions. Previous: **1.60.5**: Match my TikTok downloads save the real video. TikTok's own page fetches the file first, the way TikTok's player does, and Chrome's downloads come after; every file is checked to be a video, and a page TikTok answered with is deleted instead of kept as .mp4; a download Chrome starts after SCOUT moved on is cancelled. No new permissions. Previous: **1.60.4**: Match my TikTok downloads save a file every player takes. SCOUT picks TikTok's H.264 version first and leaves out the one most players cannot open, waits while TikTok's own Please wait check finishes, says when a post is a photo post with no video file or when TikTok gave a status instead of the video, and tries more of TikTok's servers. No new permissions. Previous: **1.60.3**: Match my TikTok downloads find the video. When the video's own page does not show where it plays from, SCOUT finds the video in the creator's own profile grid on TikTok (the way the scan reads it), and a download that still finds nothing says what the page and the profile showed. No new permissions. Previous: **1.60.2**: Match my TikTok downloads that finish. A download that is still coming in is followed to the end instead of being cut off; every step has its own time limit; when Chrome is set to ask where to save each file, SCOUT waits for the answer and says so; and the page shows how many megabytes have come in. No new permissions. Previous: **1.60.1**: Match my TikTok downloads, steadier. SCOUT now saves a video through Chrome's own downloads first (never asking where to save), follows each download until it ends, cancels one that stalls, and keeps every try inside a time limit, so the creator is always told how it went. No new permissions. Previous: **1.60.0**: Match my TikTok downloads. When the creator presses Download on one of their own matched TikTok videos in MVP, SCOUT opens that video's page on tiktok.com in its own minimized window, reads the address TikTok's page plays the video from, and saves the file to the creator's Downloads folder (from the page itself, or through Chrome's downloads with the existing `downloads` permission), so they can upload it to TRYBE. Read only: nothing is posted, liked or changed. Uses the tiktok.com permission from 1.59.0; no new permissions. Previous: **1.59.0**: Match my TikTok. When the creator asks MVP to find the TRYBE brands they already filmed, SCOUT opens their own public TikTok profile in its own minimized window, keeps the answers TikTok's page receives for its video grid (tiktok-videos-hook.js, registered only for that read), scrolls the grid at a person's pace so the page loads the rest, and hands the videos' captions, dates, view counts, covers and product tags to MVP. Read only: nothing is pressed, liked, followed or posted, and if TikTok shows a puzzle SCOUT stops and says so. An optional daily check reads only the newest videos. TikTok access is a new OPTIONAL host permission (`https://www.tiktok.com/*`), requested on first use from tiktok-allow.html, so existing installs are not disabled by the update. Previous: **1.58.0**: Amazon reviews for MVP's Video Scripts. When MVP asks for a product with its reviews (MVP_AMZ_PRODUCT with reviews), SCOUT reads, in the background tab it already opens on the Amazon product page, the words and stars of the reviews that page shows and Amazon's "Customers say" summary, then the critical reviews on that product's reviews page, in the creator's own Amazon session. Only what was written about the product is read, never a reviewer's name or picture. Read only. One more path on www.amazon.com, a host SCOUT already has (`https://www.amazon.com/product-reviews/*`), so the permission warning creators see does not change. Previous: **1.57.0**: Meta ad counts on the brand's own advertiser Page. In the Ad Library tab SCOUT already reads, it types the brand's name into Meta's search box and takes the advertiser suggestion with exactly that name, then reads that Page's active ad count; with no such advertiser it counts by the exact name as before. Read only; no new permissions. Previous: **1.56.0**: SCOUT can run MVP's TRYBE Daily refresh by itself once a day at an hour the MVP team sets (MVP_TRYBE_MORNING): it opens MVP's own TRYBE page in a background tab, and the page does the reading. Uses the existing `alarms` and `tabs` permissions. No new permissions. Earlier: **1.24.0**: after the creator presses Post on a Group post SCOUT filled, SCOUT reads the new post's address (from Facebook's own response in that tab, the tab's URL, or the post's timestamp link in the feed) and gives it to MVP (MVP_FB_GROUP_POST_STATUS), so MVP can offer a Page post linking to it. It still never presses Post. No new permissions. Previous: **1.23.0**: Group posts SCOUT fills now carry the same hero as the Page post (the thumbnail attached as a photo, or the playable YouTube card, built before the text goes in). No new permissions. Previous: **1.22.0**: SCOUT can fill a post into the creator's Facebook Group. MVP asks (MVP_FB_GROUP_PREFILL), SCOUT opens the Group in the creator's own signed-in Facebook, opens "Write something" and puts the text in. It never presses Post; the creator does. Facebook access is a new OPTIONAL host permission (`https://*.facebook.com/*`), requested on first use from fb-allow.html, so existing installs are not disabled by the update.

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
