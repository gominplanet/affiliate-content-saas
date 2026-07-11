/**
 * GET /api/download/[asset]   — asset ∈ { plugin, theme }
 *
 * Serves MVP's WordPress plugin/theme zips as a FORCED download
 * (Content-Type: application/octet-stream + Content-Disposition: attachment).
 *
 * Why not just link the static /public/*.zip? Safari's "Open 'safe' files after
 * downloading" auto-unzips a .zip served as application/zip the instant it lands
 * — leaving the user staring at the inner mvpaffiliate-platform.php, which
 * WordPress's "Upload Plugin" then rejects (it wants the .zip). Serving as
 * octet-stream stops Safari from treating it as a safe-to-open archive, so the
 * user keeps the real .zip. It also names the saved file nicely.
 *
 * The zips live in /public, which is NOT on the serverless filesystem at runtime
 * (Vercel serves it via CDN), so we fetch the CDN copy from our own origin and
 * re-stream it with our headers rather than read from disk.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ASSETS: Record<string, { path: string; filename: string }> = {
  plugin: { path: '/mvp-affiliate.zip', filename: 'mvpaffiliate-platform.zip' },
  theme: { path: '/mvp-affiliate-theme.zip', filename: 'mvpaffiliate-theme.zip' },
}

export async function GET(req: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset: key } = await params
  const asset = ASSETS[key]
  if (!asset) return NextResponse.json({ error: 'Unknown download' }, { status: 404 })

  // Fetch the static file from our own origin (same host as the request, so this
  // works on prod + preview deploys without a hardcoded URL).
  let upstream: Response
  try {
    upstream = await fetch(new URL(asset.path, req.url), { cache: 'no-store' })
  } catch {
    return NextResponse.json({ error: 'Download temporarily unavailable — try again shortly.' }, { status: 502 })
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Download temporarily unavailable — try again shortly.' }, { status: 502 })
  }

  const buf = await upstream.arrayBuffer()
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${asset.filename}"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
