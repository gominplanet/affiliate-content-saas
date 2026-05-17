/**
 * GET /api/wp-version
 *
 * Public, unauthenticated. Every installed MVP Affiliate theme + plugin
 * polls this (cached 6h on their side) to decide whether to show a native
 * "Update available" in wp-admin. Must NOT require a session — it's hit
 * by WordPress cron on the user's host, not a browser. (Whitelisted in
 * middleware alongside /api/cron and the .zip assets.)
 *
 * Shape is intentionally flat + stable — the WP-side parser is dumb on
 * purpose so we never have to ship a parser change to fix a response change.
 */

import { NextResponse } from 'next/server'
import { WP_VERSIONS } from '@/lib/wp-versions'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    {
      theme: {
        version: WP_VERSIONS.theme.version,
        download_url: WP_VERSIONS.theme.downloadUrl,
        requires: '5.6',
        tested: '6.8',
      },
      plugin: {
        version: WP_VERSIONS.plugin.version,
        download_url: WP_VERSIONS.plugin.downloadUrl,
        requires: '5.6',
        tested: '6.8',
      },
    },
    {
      // Allow WP hosts + any CDN in front of them to cache briefly; the
      // WP side also caches 6h so this is belt-and-suspenders.
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    },
  )
}
