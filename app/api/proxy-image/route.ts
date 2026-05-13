import { NextResponse } from 'next/server'

// Simple image proxy to enable client-side canvas compositing for thumbnail text overlays.
// External CDN images (fal.media, etc.) don't have CORS headers, so canvas.drawImage()
// taints the canvas. Routing through here adds Access-Control-Allow-Origin: *.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Missing url param' }, { status: 400 })

  // Only proxy known image CDNs — prevent open-proxy abuse
  const allowed = ['fal.media', 'cdn.fal.ai', 'storage.googleapis.com', 'replicate.delivery', 'pbxt.replicate.delivery', 'i.ytimg.com', 'img.youtube.com']
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  if (!allowed.some(h => hostname.endsWith(h))) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 403 })
  }

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) {
    return NextResponse.json({ error: `Upstream ${res.status}` }, { status: 502 })
  }

  const buffer = await res.arrayBuffer()
  const contentType = res.headers.get('content-type') || 'image/jpeg'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
