/**
 * WordPress compatibility doctor.
 *
 * Detects what security plugins / host WAFs are running on a user's
 * WordPress site, classifies how they interact with MVP's REST writes,
 * and returns per-stack fix instructions.
 *
 * The detection is non-authenticated — we fetch /wp-json/ root (which
 * any site exposes publicly) and parse the `namespaces` list. Most
 * security/host plugins register their own REST namespace, so the list
 * is a reliable fingerprint of what's running. When even the root
 * /wp-json/ is blocked (HTML response, 403 from a CDN/WAF) we treat
 * that as the strongest signal: an edge-layer block exists.
 *
 * See app/api/wordpress/compat-check + app/(dashboard)/setup/wp-doctor
 * for the callers.
 */

/** Per-detected-plugin fix instructions. Keyed by a stable id we can
 *  look up + render. Title is shown as a section header; steps are the
 *  exact UI clicks the user needs to make. */
export interface PluginFix {
  /** Stable id (used as React key and for analytics). */
  id: string
  /** Short label shown as a chip / section heading. */
  label: string
  /** One-line summary of WHAT this plugin does to our requests. */
  summary: string
  /** Concrete numbered steps the user follows in wp-admin or their host panel. */
  steps: string[]
  /** Severity:
   *  - block: this is actively breaking writes; user MUST fix it
   *  - warn:  may break writes intermittently; user should review
   *  - info:  detected, but not known to block (kept for transparency) */
  severity: 'block' | 'warn' | 'info'
}

/** Map of known security/host plugin namespaces → their fix instructions.
 *  Adding a new plugin = one entry here, no other code change needed.
 *
 *  Maintenance note: WordPress REST namespaces sometimes change between
 *  major plugin versions. When a plugin renames (e.g. iThemes → Solid),
 *  add BOTH the legacy and new namespace as separate keys — they map to
 *  the same fix object. */
/** Shared LiteSpeed fix used for both v1 and v3 namespace detections.
 *
 *  Tone: this card now LEADS with the actionable step (paste your Posting
 *  Key) rather than burying it as "the plugin handles it automatically."
 *  Reason: on hosts that strip Authorization headers, the plugin can't
 *  "handle it automatically" — MVP needs the key to use the body-auth
 *  proxy. We saw this confuse Alejandro at reviewcentralhub.com — the
 *  doctor told him everything was fine while posts kept failing. */
const LITESPEED_FIX: PluginFix = {
  id: 'litespeed',
  label: 'LiteSpeed (host/server)',
  summary: 'Your host runs LiteSpeed, which strips the Authorization header on every request — including GETs. Basic Auth will never work on this host. Use the Posting Key path instead (it bypasses the header entirely).',
  severity: 'block',
  steps: [
    'Confirm the MVP Affiliate plugin is v1.0.26 or later — wp-admin → Plugins (older versions don\'t mint the Posting Key).',
    'In wp-admin, look for the violet "MVP Affiliate · Posting Key" notice on the Dashboard or Plugins page. Click Copy.',
    'Scroll to the top of this page and paste the Posting Key into the violet panel labeled "Posting Key (for hosts that strip the Authorization header)" → Save.',
    'After saving, click "Re-test" — the Body-auth proxy test should turn green.',
  ],
}

/** Comprehensive Wordfence fix — reused whether we detect Wordfence by its
 *  REST namespace (site reachable, writes may fail) or by fingerprinting its
 *  block page (edge-blocked).
 *
 *  Why this is longer than "just allowlist the URL": Wordfence blocks MVP in
 *  TWO independent ways, and the URL allowlist only fixes the first.
 *    1. Firewall RULES (SQLi/XSS heuristics) can false-positive on a rich
 *       affiliate post body → fixed by allowlisting the wp-json URL.
 *    2. RATE LIMITING / IP blocking flags the burst of REST writes from our
 *       single hosting (AWS) IP as a "crawler" and blocks it mid-publish →
 *       fixed by relaxing the crawler rate limit + unblocking the IP. This is
 *       the one we saw in the wild (a Wordfence Live-Traffic log showing our
 *       Ashburn/AWS IP hitting /wp-json/). The URL allowlist does NOT bypass
 *       rate limiting, so we walk through both. */
const WORDFENCE_FIX: PluginFix = {
  id: 'wordfence',
  label: 'Wordfence',
  summary: 'Wordfence is blocking MVP\'s requests to /wp-json/. It can do this two ways: its firewall rules (fixed by allowlisting the URL) and its rate-limiting / IP blocking, which flags the burst of requests from our hosting IP as a crawler (fixed by relaxing the limit and unblocking the IP). Do both to be safe — rate limiting is the most common cause.',
  severity: 'block',
  steps: [
    'ALLOWLIST THE URL — wp-admin → Wordfence → Firewall → All Options → find "Allowlisted URLs" (search the page) → add this exact line: */wp-json/* → Save Changes.',
    'RELAX RATE LIMITING (most common cause) — same "All Options" page → "Rate Limiting" section → set "If a crawler\'s page views exceed" and "…pages not found (404s) exceed" to a high value or "Unlimited", and change the action to "Throttle it" instead of "Block it". Save.',
    'UNBLOCK MVP\'s SERVER — wp-admin → Wordfence → Tools → Live Traffic. If you see recent blocked hits to /wp-json/ from a US "Ashburn, Virginia" / Amazon (AWS) IP, that\'s MVP — click it → "Unblock". (Our server IP rotates, so relaxing the rate limit above is the durable fix, not blocking a single IP.)',
    'CHECK NETWORK/COUNTRY BLOCKING — wp-admin → Wordfence → Blocking: make sure you are not blocking whole hosting networks or the entire US, which would block MVP\'s servers.',
    'Wait ~1 minute, then click "Re-test connection" above.',
  ],
}

export const KNOWN_PLUGINS: Record<string, PluginFix> = {
  // ─── Security plugins ───────────────────────────────────────────────
  'wordfence/v1': WORDFENCE_FIX,
  'sucuri-scanner/v1': {
    id: 'sucuri',
    label: 'Sucuri',
    summary: 'Sucuri\'s firewall blocks REST API writes from server IPs without an allowlist.',
    severity: 'block',
    steps: [
      'Log into your Sucuri dashboard (sucuri.net/firewall)',
      'Go to Settings → Whitelist URLs',
      'Add: https://yoursite.com/wp-json/*',
      'Save and wait 1–2 minutes for the rule to deploy',
      'Return here and click "Re-test connection"',
    ],
  },
  'aios/v1': {
    id: 'aios',
    label: 'All In One WP Security',
    summary: 'AIOS can block REST API writes via its "WordPress REST API protection" rule.',
    severity: 'warn',
    steps: [
      'In wp-admin → go to WP Security → Firewall',
      'Click the "Additional Firewall Rules" tab',
      'Disable "REST API security" (or set it to allow Application Passwords)',
      'Save changes',
      'Return here and click "Re-test connection"',
    ],
  },
  'itsec/v1': {
    id: 'solid-security-legacy',
    label: 'iThemes Security (legacy)',
    summary: 'iThemes Security can block REST API writes via its "REST API" module.',
    severity: 'warn',
    steps: [
      'In wp-admin → go to Security → Settings → Advanced',
      'Find "WordPress Tweaks" → "REST API"',
      'Set REST API access to "Default Access"',
      'Save changes',
      'Return here and click "Re-test connection"',
    ],
  },
  'solidsecurity/v1': {
    id: 'solid-security',
    label: 'Solid Security',
    summary: 'Solid Security (formerly iThemes Security) can restrict REST API access.',
    severity: 'warn',
    steps: [
      'In wp-admin → go to Solid Security → Settings → WordPress Tweaks',
      'Find "REST API"',
      'Set to "Default Access" (allow all)',
      'Save changes',
      'Return here and click "Re-test connection"',
    ],
  },
  'cerber/v1': {
    id: 'wp-cerber',
    label: 'WP Cerber Security',
    summary: 'WP Cerber blocks REST API by default unless explicitly enabled for non-logged-in clients.',
    severity: 'block',
    steps: [
      'In wp-admin → go to WP Cerber → Hardening',
      'Find "Block access to WordPress REST API except the following"',
      'Add: wp/v2, affiliateos/v1',
      'Save settings',
      'Return here and click "Re-test connection"',
    ],
  },

  // ─── Host-managed namespaces (signal, not always a block) ───────────
  'sg-ai-studio': {
    id: 'siteground',
    label: 'SiteGround host',
    summary: 'SiteGround installs SG Security by default, which can block REST API writes.',
    severity: 'warn',
    steps: [
      'In wp-admin → SG Security → Site Security',
      'Make sure "Limit Login Attempts" is OFF (it often locks integrations out)',
      'Disable any "Block XML-RPC" or "Block Direct File Access" rules that mention /wp-json/',
      'In your SiteGround Site Tools → Security → Site Scanner — check for a managed WAF rule on /wp-json/',
      'Return here and click "Re-test connection"',
    ],
  },
  'litespeed/v1': LITESPEED_FIX,
  'litespeed/v3': LITESPEED_FIX, // same product, newer version
}

/** Edge-layer (CDN/WAF/security plugin) block — the request never reaches
 *  WordPress REST API. Detected when /wp-json/ returns HTML instead of
 *  JSON (a security interstitial / "you have been blocked" page).
 *
 *  Multiple things can produce this signature: a CDN (Cloudflare),
 *  a host WAF (Hostinger / SiteGround managed firewall), or a
 *  security PLUGIN that runs before REST routing (Wordfence's
 *  "Live Traffic block" can serve an HTML interstitial too).
 *
 *  Steps walk through the most-common causes in order of probability
 *  for affiliate creators. Wordfence is #1 because it's installed on
 *  ~30% of WP sites and its default settings block server-IP requests
 *  to /wp-json/. */
export const EDGE_BLOCK_FIX: PluginFix = {
  id: 'edge-block',
  label: 'CDN, WAF, or security plugin (edge block)',
  summary: 'Something between MVP and your WordPress REST API is blocking server-to-server requests — usually a security plugin like Wordfence, a host WAF (SiteGround, Hostinger), or a CDN (Cloudflare).',
  severity: 'block',
  steps: [
    'Identify what is blocking. (a) In wp-admin → Plugins, check if Wordfence or SiteGround Security is active. (b) In a browser, open developer tools → Network → reload your homepage → check response headers for cf-ray (Cloudflare), x-sucuri-id (Sucuri), or server: LiteSpeed (Hostinger/SiteGround).',
    'WORDFENCE (most common — try this first if installed): wp-admin → Wordfence → All Options → search the page for "Allowlisted URLs" (under Firewall Options) → add this exact line: */wp-json/* → Save Changes. Then check Wordfence → Tools → Live Traffic for recent server-IP blocks and unblock them if you see any.',
    'SITEGROUND SECURITY plugin (different from Site Scanner — Site Scanner is SG\'s paid malware scanner, not relevant here): wp-admin → SG Security → Site Security → turn OFF "Limit Login Attempts" temporarily, and disable any "Block XML-RPC" or "REST API" toggles.',
    'SITEGROUND host WAF: Site Tools (in your SiteGround client area, not WordPress) → Security → Web Application Firewall → disable for your domain OR add /wp-json/* to allowed URLs.',
    'CLOUDFLARE: dash.cloudflare.com → your domain → Security → WAF → Custom Rules → create rule: When URI Path "starts with" /wp-json/, Action: Skip (check all WAF features). Also: Security → Bots → turn OFF Bot Fight Mode.',
    'HOSTINGER: hPanel → Security → Web Application Firewall → either disable WAF OR add /wp-json/* to allowed URLs.',
    'After making the change, wait 1–2 minutes for it to deploy, then click "Re-test connection" above.',
  ],
}

/** Cloudflare edge block — cf-ray header or a Cloudflare challenge/block body. */
const CLOUDFLARE_EDGE_FIX: PluginFix = {
  id: 'cloudflare',
  label: 'Cloudflare',
  summary: 'Cloudflare is intercepting MVP\'s requests to /wp-json/ before they reach WordPress — usually Bot Fight Mode or a WAF managed rule challenging non-browser traffic.',
  severity: 'block',
  steps: [
    'dash.cloudflare.com → your domain → Security → WAF → Custom rules → Create rule: When incoming requests match URI Path "starts with" /wp-json/ → Action "Skip" → check "All remaining custom rules" + the managed ruleset → Deploy.',
    'Security → Bots → turn OFF "Bot Fight Mode". (On paid plans, set Super Bot Fight Mode → "Definitely automated" to Allow — it challenges legitimate server traffic like MVP.)',
    'If "Under Attack Mode" / a Managed Challenge is on, disable it or add the /wp-json/* Skip rule above.',
    'Wait ~1 minute for the rule to deploy, then click "Re-test connection" above.',
  ],
}

/** Sucuri cloud firewall block — x-sucuri-* header or "Sucuri WebSite Firewall" body. */
const SUCURI_EDGE_FIX: PluginFix = {
  id: 'sucuri',
  label: 'Sucuri Firewall',
  summary: 'Sucuri\'s cloud firewall is blocking server-to-server REST requests to /wp-json/.',
  severity: 'block',
  steps: [
    'Log into Sucuri (sucuri.net/firewall) → Settings → Whitelist → "Whitelist URL Paths" → add /wp-json/',
    'Under Access Control, make sure the site isn\'t in "Emergency DDoS / Under Attack" mode (it challenges all non-browser traffic).',
    'Save and wait 1–2 minutes for the rule to deploy.',
    'Click "Re-test connection" above.',
  ],
}

/** SiteGround edge (SG Security plugin / SG Optimizer / host WAF) block. */
const SITEGROUND_EDGE_FIX: PluginFix = {
  id: 'siteground-edge',
  label: 'SiteGround (security / host WAF)',
  summary: 'SiteGround\'s security layer (the SG Security plugin or the host-level WAF) is blocking REST requests to /wp-json/ before they reach WordPress.',
  severity: 'block',
  steps: [
    'wp-admin → SG Security → turn OFF "Limit Login Attempts" temporarily and disable any "Block XML-RPC" / "REST API" toggles.',
    'SiteGround Site Tools (your hosting client area, NOT wp-admin) → Security → check for a Web Application Firewall / managed rule on /wp-json/ and allow it.',
    'Also purge SiteGround caching: SG Optimizer → Purge Cache (a cached block page can persist after you fix the rule).',
    'Wait 1–2 minutes, then click "Re-test connection" above.',
  ],
}

/** Identify WHICH edge layer produced an HTML block page, from response
 *  headers (most reliable) + body markers, so the doctor shows the ONE precise
 *  fix instead of the generic six-cause list. Falls back to EDGE_BLOCK_FIX when
 *  nothing matches. Header/body checks are lowercased + substring — deliberately
 *  lenient (a false match still lands the user on a close, actionable card). */
export function fingerprintEdgeBlock(headers: Headers, body: string): PluginFix {
  const h = (k: string) => (headers.get(k) || '').toLowerCase()
  const b = (body || '').toLowerCase()
  const server = h('server')

  // Wordfence has no distinctive header, but its block page is unmistakable:
  // "Your access to this site has been limited by the site owner" + a footer
  // "Generated by Wordfence".
  const wfLimited = b.includes('access to this') && b.includes('has been limited')
  if (b.includes('wordfence') || wfLimited) return WORDFENCE_FIX

  if (h('cf-ray') || server.includes('cloudflare') || b.includes('cf-ray') || b.includes('cloudflare') || b.includes('attention required')) {
    return CLOUDFLARE_EDGE_FIX
  }
  if (h('x-sucuri-id') || h('x-sucuri-block') || b.includes('sucuri')) {
    return SUCURI_EDGE_FIX
  }
  if (b.includes('sgcaptcha') || b.includes('siteground') || b.includes('sg-security')) {
    return SITEGROUND_EDGE_FIX
  }
  return EDGE_BLOCK_FIX
}

/** /wp-json/ root response shape we care about. */
interface WpJsonRoot {
  name?: string
  url?: string
  namespaces?: string[]
}

export interface CompatDetection {
  /** Did /wp-json/ return parseable JSON? false = edge-blocked. */
  reachable: boolean
  /** Site identity (only filled when reachable). */
  site: { name: string; url: string } | null
  /** Raw namespaces list from /wp-json/ root. Empty when unreachable. */
  namespaces: string[]
  /** All known plugin fixes detected on this site. */
  detected: PluginFix[]
  /** Edge-block details when reachable=false. */
  edgeBlock: PluginFix | null
  /** Raw HTML snippet when the response wasn't JSON — useful for support. */
  rawSnippet?: string
}

/** Probe `/wp-json/` and classify what's running. No auth required —
 *  the root response is public on every WP install. Returns a fully
 *  populated CompatDetection regardless of outcome (never throws). */
export async function detectWpCompat(siteUrl: string): Promise<CompatDetection> {
  const base = siteUrl.replace(/\/$/, '')
  // Cache-bust: the /wp-json/ index is aggressively cached by LiteSpeed/SG
  // Optimizer/Cloudflare, which serve a STALE copy for minutes after a plugin
  // is (re)activated — making a freshly-activated MVP plugin look "not
  // installed" in the namespaces list (the exact false-negative that sent a
  // user reinstalling a plugin that was already active). A unique query param
  // forces a cache miss so we read the live index.
  const url = `${base}/wp-json/?_mvp=${Date.now()}`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    const contentType = res.headers.get('content-type') || ''
    const body = await res.text()

    // HTML response (or any non-JSON) means an edge layer intercepted
    // before WP. The status code is usually 403/406 but the giveaway is
    // the body being HTML — a real WP REST 403 returns JSON.
    if (!contentType.includes('application/json') || body.trim().startsWith('<')) {
      // Fingerprint WHICH edge layer blocked us (Wordfence / Cloudflare /
      // Sucuri / SiteGround) from headers + body, so the doctor shows the one
      // precise fix instead of the generic list. Falls back to EDGE_BLOCK_FIX.
      return {
        reachable: false,
        site: null,
        namespaces: [],
        detected: [],
        edgeBlock: fingerprintEdgeBlock(res.headers, body),
        rawSnippet: body.slice(0, 200),
      }
    }

    const json = JSON.parse(body) as WpJsonRoot
    const namespaces = Array.isArray(json.namespaces) ? json.namespaces : []

    // De-duplicate: some plugins ship both v1 and v3 namespaces (LiteSpeed),
    // and our KNOWN_PLUGINS entry maps them to the same fix id. Dedup by id.
    const seen = new Set<string>()
    const detected: PluginFix[] = []
    for (const ns of namespaces) {
      const fix = KNOWN_PLUGINS[ns]
      if (fix && !seen.has(fix.id)) {
        seen.add(fix.id)
        detected.push(fix)
      }
    }

    return {
      reachable: true,
      site: {
        name: (json.name as string) || '',
        url: (json.url as string) || base,
      },
      namespaces,
      detected,
      edgeBlock: null,
    }
  } catch (err) {
    // Network error / DNS / timeout — same UX as edge-block from the
    // user's perspective (we can't reach their site). The fix steps for
    // edge-block cover this case too.
    return {
      reachable: false,
      site: null,
      namespaces: [],
      detected: [],
      edgeBlock: EDGE_BLOCK_FIX,
      rawSnippet: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/** Convenience: filter detected fixes by severity. Blocks come first,
 *  warns second, info last — that's the priority order the doctor UI
 *  renders them in. */
export function sortFixes(fixes: PluginFix[]): PluginFix[] {
  const rank: Record<PluginFix['severity'], number> = { block: 0, warn: 1, info: 2 }
  return [...fixes].sort((a, b) => rank[a.severity] - rank[b.severity])
}
