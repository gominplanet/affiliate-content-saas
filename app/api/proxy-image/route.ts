import { NextResponse } from 'next/server'

// Simple image proxy to enable client-side canvas compositing for thumbnail text overlays.
// External CDN images (fal.media, etc.) don't have CORS headers, so canvas.drawImage()
// taints the canvas. Routing through here adds Access-Control-Allow-Origin: *.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Missing url param' }, { status: 400 })

  // Only proxy known image CDNs — prevent open-proxy abuse. fal serves images
  // across several hosts (fal.media, *.fal.media, *.fal.ai, fal.run) depending
  // on the endpoint, so allow the whole fal family.
  const allowed = ['fal.media', 'fal.ai', 'fal.run', 'storage.googleapis.com', 'replicate.delivery', 'pbxt.replicate.delivery', 'i.ytimg.com', 'img.youtube.com']
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

  // Bound the response size so we never buffer a multi-MB asset into the
  // function. The allowed CDNs all serve well-formed Content-Length headers;
  // we 413 if it's missing or oversized. 20MB covers any thumbnail / HD jpeg
  // we'd ever composite client-side.
  const MAX_BYTES = 20 * 1024 * 1024
  const declared = parseInt(res.headers.get('content-length') || '0', 10)
  if (!declared || declared > MAX_BYTES) {
    return NextResponse.json({ error: 'Upstream asset is too large to proxy' }, { status: 413 })
  }
  const buffer = await res.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Upstream asset is too large to proxy' }, { status: 413 })
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      // CDN images are content-addressed / immutable — cache hard so we don't
      // re-invoke this function for the same image. (Canvas-compositing path
      // only; display images should use next/image, not this proxy.)
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
