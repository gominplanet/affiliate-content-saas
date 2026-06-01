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
export const KNOWN_PLUGINS: Record<string, PluginFix> = {
  // ─── Security plugins ───────────────────────────────────────────────
  'wordfence/v1': {
    id: 'wordfence',
    label: 'Wordfence',
    summary: 'Wordfence blocks non-browser POST requests to /wp-json/ unless the path is allowlisted.',
    severity: 'block',
    steps: [
      'In wp-admin → go to Wordfence → All Options',
      'Scroll to the "Firewall Options" section',
      'Find "Allowlisted URLs" (search the page if needed)',
      'Add this exact line: */wp-json/*',
      'Click "Save Changes" at the bottom',
      'Return here and click "Re-test connection"',
    ],
  },
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
  'litespeed/v1': {
    id: 'litespeed',
    label: 'LiteSpeed (host/server)',
    summary: 'Your host runs LiteSpeed, which can strip Authorization headers on POST. The MVP plugin v1.0.25+ handles this automatically with its body-auth proxy.',
    severity: 'info',
    steps: [
      'Confirm the MVP Affiliate plugin is v1.0.25 or later (wp-admin → Plugins)',
      'If older: from this dashboard, click "Update now" in the WordPress update banner, OR upload the latest plugin zip manually',
      'No .htaccess editing required — the plugin handles header forwarding',
    ],
  },
  'litespeed/v3': {
    // Same fix as litespeed/v1 — newer version of the same plugin.
    id: 'litespeed',
    label: 'LiteSpeed (host/server)',
    summary: 'Your host runs LiteSpeed, which can strip Authorization headers on POST. The MVP plugin v1.0.25+ handles this automatically with its body-auth proxy.',
    severity: 'info',
    steps: [
      'Confirm the MVP Affiliate plugin is v1.0.25 or later (wp-admin → Plugins)',
      'If older: from this dashboard, click "Update now" in the WordPress update banner, OR upload the latest plugin zip manually',
      'No .htaccess editing required — the plugin handles header forwarding',
    ],
  },
}

/** Edge-layer (CDN/WAF) block — the request never reaches WordPress PHP.
 *  Detected when /wp-json/ returns HTML instead of JSON (a security
 *  interstitial / "you have been blocked" page). The fix is host-side
 *  and not plugin-specific. */
export const EDGE_BLOCK_FIX: PluginFix = {
  id: 'edge-block',
  label: 'CDN / WAF (edge block)',
  summary: 'A CDN or WAF is blocking server-to-server requests to your /wp-json/ entirely — WordPress never sees them.',
  severity: 'block',
  steps: [
    'Identify your CDN / WAF: in a browser, open developer tools → Network → reload your homepage → check response headers for cf-ray (Cloudflare), server: cloudflare, x-sucuri-id (Sucuri), or server: LiteSpeed (Hostinger/SiteGround).',
    'CLOUDFLARE: dash.cloudflare.com → your domain → Security → WAF → Custom Rules → create rule: When URI Path "starts with" /wp-json/, Action: Skip (check all WAF features). Also: Security → Bots → turn OFF Bot Fight Mode.',
    'HOSTINGER: hPanel → Security → Web Application Firewall → either disable WAF OR add /wp-json/* to allowed URLs.',
    'SITEGROUND: Site Tools → Security → Site Scanner / Web App Firewall — disable REST API protection for your domain.',
    'After making the change, wait 1–2 minutes for it to deploy, then click "Re-test connection".',
  ],
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
  const url = `${base}/wp-json/`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MVP Affiliate/1.0 Compat-Doctor)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })
    const contentType = res.headers.get('content-type') || ''
    const body = await res.text()

    // HTML response (or any non-JSON) means an edge layer intercepted
    // before WP. The status code is usually 403/406 but the giveaway is
    // the body being HTML — a real WP REST 403 returns JSON.
    if (!contentType.includes('application/json') || body.trim().startsWith('<')) {
      return {
        reachable: false,
        site: null,
        namespaces: [],
        detected: [],
        edgeBlock: EDGE_BLOCK_FIX,
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
