/**
 * GET /api/wordpress/compat-check?siteId=<uuid>
 *
 * The "connection doctor" backend. Runs a battery of live tests against
 * the user's WordPress site and returns:
 *
 *   1. Compatibility detection — what security plugins / CDN / WAF
 *      are running, what the per-stack fix instructions are.
 *   2. Test results — does Basic Auth GET work? Does Basic Auth POST
 *      work? Does the body-auth proxy work (if plugin v1.0.25+)?
 *   3. Overall verdict — can MVP publish to this site right now?
 *
 * The page at /setup/wp-doctor consumes this. Each failed test is
 * matched to the most likely fix (block-severity entries first).
 *
 * Multi-site: ?siteId=<uuid> picks one site to diagnose. Omitted →
 * default site. Multi-site users with one failing site can target
 * just that site without confusing the diagnostic with healthy sites.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { detectWpCompat, sortFixes, type CompatDetection } from '@/lib/wp-compat'
import { tryWpProxy } from '@/lib/wp-proxy'

export const maxDuration = 60

interface TestResult {
  /** Stable id for the test (UI key + analytics). */
  id: 'rest_root' | 'basic_auth_get' | 'basic_auth_post' | 'mvp_plugin' | 'proxy_write'
  /** Display name shown in the doctor UI. */
  label: string
  /** Did this test pass? null = couldn't run (prior dependency failed). */
  ok: boolean | null
  /** HTTP status code if available. */
  status?: number
  /** Short freeform detail (e.g. "rest_cookie_invalid_nonce"). */
  detail?: string
}

interface DoctorResponse {
  /** True when EVERY block-severity check passed — site is publishable. */
  healthy: boolean
  /** Site identity from /wp-json/ root (when reachable). */
  site: CompatDetection['site']
  /** Discovered REST namespaces — useful for support to see what's installed. */
  namespaces: string[]
  /** Per-stack fix instructions, ordered by severity (blocks first). */
  fixes: CompatDetection['detected'] | [CompatDetection['edgeBlock']]
  /** Edge-block specifically — null when /wp-json/ reaches WordPress. */
  edgeBlock: CompatDetection['edgeBlock']
  /** Raw HTML snippet from the WAF block, when edge-blocked. */
  rawSnippet?: string
  /** Live test results — one entry per test we ran. */
  tests: TestResult[]
  /** Plain-English single-line summary for the doctor's hero card. */
  summary: string
}

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const siteId = url.searchParams.get('siteId')
  const site = await getWordPressCredentials(supabase, user.id, siteId)
  if (!site) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }

  // ── Step 1: passive detection (no auth) — checks edge reachability
  //            and fingerprints active plugins. This ALWAYS runs first
  //            because if /wp-json/ is edge-blocked, every later auth
  //            test is doomed and a generic 401 would mislead the user.
  const detection = await detectWpCompat(site.wordpress_url)

  // When edge-blocked we short-circuit. No point running auth tests
  // we know will return HTML; instead surface the edge-block fix.
  if (!detection.reachable) {
    const response: DoctorResponse = {
      healthy: false,
      site: null,
      namespaces: [],
      fixes: detection.edgeBlock ? [detection.edgeBlock] : [],
      edgeBlock: detection.edgeBlock,
      rawSnippet: detection.rawSnippet,
      tests: [{
        id: 'rest_root',
        label: 'WordPress REST API reachable',
        ok: false,
        detail: 'Received HTML instead of JSON — a CDN/WAF is blocking server requests before WordPress sees them.',
      }],
      summary: 'A CDN or WAF is blocking MVP from reaching your /wp-json/ endpoint. Fix below.',
    }
    return NextResponse.json(response)
  }

  // ── Step 2: live auth tests against the WP REST API. We send a
  //            User-Agent that mimics a browser because some WAFs
  //            challenge "bare" UA strings even when the underlying
  //            firewall would otherwise allow the path.
  const tests: TestResult[] = []
  const wpBase = site.wordpress_url.replace(/\/$/, '')
  const cleanPw = site.wordpress_app_password.replace(/\s+/g, '')
  const basic = `Basic ${Buffer.from(`${site.wordpress_username}:${cleanPw}`).toString('base64')}`
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

  // 2a. REST root passed detection. Mark it as ok with status 200 (the
  //     namespaces list came back — that's sufficient proof).
  tests.push({
    id: 'rest_root',
    label: 'WordPress REST API reachable',
    ok: true,
    status: 200,
  })

  // 2b. Basic Auth GET — proves the Application Password works and
  //     the host doesn't strip Authorization on GET (most don't).
  let readOk = false
  try {
    const r = await fetch(`${wpBase}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: basic, 'User-Agent': ua },
      signal: AbortSignal.timeout(10_000),
    })
    readOk = r.ok
    tests.push({
      id: 'basic_auth_get',
      label: 'Read access (Basic Auth GET)',
      ok: r.ok,
      status: r.status,
      detail: r.ok ? undefined : await r.text().then(t => t.slice(0, 200)).catch(() => undefined),
    })
  } catch (err) {
    tests.push({
      id: 'basic_auth_get',
      label: 'Read access (Basic Auth GET)',
      ok: false,
      detail: err instanceof Error ? err.message : 'fetch failed',
    })
  }

  // 2c. MVP Affiliate plugin presence — checked via /wp-json/ namespaces
  //     (already gathered by detection). No additional HTTP call needed.
  const pluginActive = detection.namespaces.includes('affiliateos/v1')
  tests.push({
    id: 'mvp_plugin',
    label: 'MVP Affiliate plugin installed',
    ok: pluginActive,
    detail: pluginActive ? undefined : 'Not detected in /wp-json/ namespaces — reinstall from Setup.',
  })

  // 2d. Basic Auth POST — the canonical failure mode. We create a
  //     throwaway tag and immediately delete it. If the host strips
  //     Authorization on POST, this 401s while basic_auth_get passes.
  let writeOk = false
  let writeStatus = 0
  let writeDetail: string | undefined
  let probeTagId: number | undefined
  try {
    const r = await fetch(`${wpBase}/wp-json/wp/v2/tags`, {
      method: 'POST',
      headers: {
        Authorization: basic,
        'Content-Type': 'application/json',
        'User-Agent': ua,
      },
      body: JSON.stringify({
        name: `mvp-doctor-${Date.now()}`,
        description: 'Temporary tag created by the MVP connection doctor — safe to delete.',
      }),
      signal: AbortSignal.timeout(15_000),
    })
    writeOk = r.ok
    writeStatus = r.status
    if (r.ok) {
      const j = await r.json().catch(() => ({})) as { id?: number }
      probeTagId = j.id
    } else {
      writeDetail = await r.text().then(t => t.slice(0, 200)).catch(() => undefined)
    }
  } catch (err) {
    writeDetail = err instanceof Error ? err.message : 'fetch failed'
  }
  tests.push({
    id: 'basic_auth_post',
    label: 'Write access (Basic Auth POST)',
    ok: writeOk,
    status: writeStatus,
    detail: writeDetail,
  })

  // Cleanup the probe tag — best effort; if it fails the tag sits in
  // their tags list with a clear "safe to delete" description.
  if (probeTagId) {
    await fetch(`${wpBase}/wp-json/wp/v2/tags/${probeTagId}?force=true`, {
      method: 'DELETE',
      headers: { Authorization: basic, 'User-Agent': ua },
    }).catch(() => {/* non-fatal */})
  }

  // 2e. Body-auth proxy — only meaningful when api_token is on file
  //     (proxy_secret persisted from a previous wp-status poll). This
  //     is the FIX for the Basic-Auth-POST failure case: if 2d failed
  //     but 2e passes, MVP can still publish via the proxy.
  let proxyOk: boolean | null = null
  let proxyDetail: string | undefined
  if (site.wordpress_api_token) {
    // /affiliateos/v1/status is a safe path to test the proxy with —
    // it's GET-only (so no side effects) and returns 200 quickly.
    const proxied = await tryWpProxy({
      siteUrl: wpBase,
      proxySecret: site.wordpress_api_token,
      innerPath: '/affiliateos/v1/status',
      method: 'GET',
      timeoutMs: 10_000,
    })
    if (proxied === null) {
      // Plugin too old, no /proxy route, or token rejected.
      proxyOk = false
      proxyDetail = 'Plugin v1.0.25+ required, or stored proxy token is stale (refresh from /setup).'
    } else {
      proxyOk = proxied.ok
      if (!proxied.ok) {
        proxyDetail = typeof proxied.data === 'string'
          ? proxied.data.slice(0, 200)
          : JSON.stringify(proxied.data).slice(0, 200)
      }
    }
  }
  tests.push({
    id: 'proxy_write',
    label: 'Body-auth proxy (header-strip workaround)',
    ok: proxyOk,
    detail: proxyDetail,
  })

  // ── Step 3: synthesize the overall verdict + summary.
  // "Healthy" means we have at least one viable write path:
  //   - basic_auth_post succeeded, OR
  //   - basic_auth_post failed BUT the proxy works (proxy_write ok)
  // We require basic_auth_get to be ok regardless — without read
  // access nothing else matters.
  const hasWritePath = writeOk || (proxyOk === true)
  const healthy = readOk && pluginActive && hasWritePath

  let summary: string
  if (healthy) {
    summary = 'Your WordPress site is healthy. MVP can publish.'
  } else if (!readOk) {
    summary = 'WordPress is rejecting our Application Password. Check the credentials in /setup.'
  } else if (!pluginActive) {
    summary = 'The MVP Affiliate plugin isn\'t installed or activated. Reinstall from /setup.'
  } else if (!hasWritePath) {
    summary = detection.detected.length > 0
      ? `A security plugin (${detection.detected.filter(d => d.severity === 'block').map(d => d.label).join(', ') || detection.detected[0].label}) is blocking writes. Steps below.`
      : 'Your host is blocking REST API writes. Steps below.'
  } else {
    summary = 'Some checks failed — review the steps below.'
  }

  const response: DoctorResponse = {
    healthy,
    site: detection.site,
    namespaces: detection.namespaces,
    fixes: sortFixes(detection.detected),
    edgeBlock: null,
    tests,
    summary,
  }
  return NextResponse.json(response)
}
