/**
 * Single source of truth for the User-Agent we send to user WordPress
 * sites.
 *
 * Why a constant: we discovered (Alejandro at reviewcentralhub.com on
 * SiteGround, 2026-06-01) that some host WAFs fingerprint specific UA
 * strings. Our original UA — `Mozilla/5.0 (compatible; MVP Affiliate/1.0;
 * +https://www.mvpaffiliate.io)` — gets a flat 403 HTML response from
 * SiteGround's edge, regardless of path or auth. The user sees the
 * Connection Doctor flag the site as "CDN/WAF blocking" and there's no
 * obvious fix from their end — the rule fires before WP itself runs.
 *
 * Probed alternatives:
 *   - `Mozilla/5.0 (compatible; MVP Affiliate/1.0; ...)`     → 403 HTML  ✗
 *   - `Mozilla/5.0 (compatible; MVP Affiliate/1.0)`          → 403 HTML  ✗
 *   - `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome` → 401 JSON  ✓
 *   - `Mozilla/5.0`                                          → 401 JSON  ✓
 *   - `WordPress/6.5; https://wordpress.org`                 → 401 JSON  ✓
 *
 * 401 JSON = WAF passes, WP itself responds (auth-required). That's the
 * "good" answer — same as a healthy site without our auth. From there,
 * either /proxy (body-auth) or /wp/v2/posts (basic auth) takes over.
 *
 * Choice: a plain Chrome UA. It's the safest default that no WAF
 * heuristic flags as suspicious (real browsers send it constantly), and
 * it's stable across deploys.
 *
 * Trade-off accepted: we lose the explicit "MVP Affiliate" identification
 * in WP access logs. Worth it — Alejandro's posts being blocked is a
 * much bigger problem than logs being slightly less self-explanatory.
 * Site owners who want to identify us can grep their logs for our Vercel
 * IP ranges instead.
 */
export const WP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
