# SCOUT — reviewer notes for the v1.11.49 update

Paste the block below into **"Notes to reviewer"** (aka the justification field)
when you upload `mvp-cc-scout-store.zip` in the Developer Dashboard. It exists to
explain the two host-permission additions since the last approved build (1.11.12)
so the update clears review without a back-and-forth.

---

## Summary
This is an update to the approved **SCOUT — MVP Affiliate** listing. The single
purpose is unchanged: SCOUT bridges the MVP Affiliate web app
(https://www.mvpaffiliate.io) to the signed-in user's OWN YouTube and retail
browser sessions, and acts **only** when the user triggers an action from the MVP
dashboard. Nothing runs automatically or in the background.

## Install-time (API) permissions — UNCHANGED
Exactly as approved: `activeTab`, `scripting`, `storage`, `tabs`. No new API
permissions in this version.

## host_permissions — what was added since the approved build
Two additions, both serving the same "read product details the user already has
access to" purpose. Both are read-only and only fire on an explicit user action —
no logins, forms, purchases, or account changes on any site.

1. **Major US retail domains** — `*.walmart.com`, `*.target.com`, `*.bestbuy.com`,
   `*.homedepot.com`, `*.lowes.com`, `*.wayfair.com`, `*.etsy.com`, `*.ebay.com`,
   `*.chewy.com`, `*.costco.com`, `*.macys.com`, `*.kohls.com`, `*.newegg.com`,
   `*.ulta.com`, `*.sephora.com`, `*.nike.com`.
   **Why:** when a creator writes a post from a **non-Amazon** product link, SCOUT
   reads that product's public page in the user's own browser (title, price,
   images) so MVP can ground the article in real product facts. It runs only when
   the user pastes a link and asks MVP to build the post.

2. **`https://www.amazon.com/s*`** (Amazon search results).
   **Why:** the "Product Finder" feature lets a creator search Amazon for products
   to review; SCOUT reads the public search-results page in the user's browser.
   Same read-only, on-demand pattern as the already-approved `/dp` product-page
   permission.

All other hosts are unchanged from the approved build (Amazon
creatorconnections / manage-content / shop / dp / gp, affiliate-program.amazon.com,
`*.youtube.com` for the user's own video frame capture, and `mvpaffiliate.io` for
externally_connectable messaging between the dashboard and the extension).

## Functional changes in this version
- Reads Amazon's "Sponsored Products for Creators" tab (the ASIN, price and
  Estimated EPC shown on each card) so the user can sort and filter before
  importing opportunities into their MVP account.
- Cleaner toolbar popup: an on/off switch for the extension plus MVP connection
  status. The old in-popup scanner UI was removed (that flow now lives inline on
  the Amazon page).
- More reliable import of selected campaigns into MVP (network hardening).

## Data handling — UNCHANGED
SCOUT does not collect, store, sell, or transmit personal data to third parties.
It reads a page only when the user triggers an action from MVP, passes the result
to the user's own MVP Affiliate account, and stores only a local settings token.
No analytics.

---

**Heads-up (not for the reviewer):** because this build adds new host
permissions, Chrome will show existing store users a "SCOUT wants to read data on
walmart.com + 15 other sites" prompt on auto-update and pause the extension until
they accept — that's expected Chrome behaviour for added host_permissions, not a
bug.
