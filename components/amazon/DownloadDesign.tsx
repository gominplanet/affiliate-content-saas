// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Take the design away. The one thing a free account is here to do.
//
// The free trial's whole promise is: paste an Amazon product link, get a
// finished design with your face on it, download it. Publishing is the paywall,
// deliberately. So on the design composers the Publish button is disabled for a
// trial account, and until now that was the ONLY button. A free user generated
// one of their five designs and had nothing they could do with it. The design
// sat on screen and the trial ended there.
//
// WHY THIS IS NOT JUST AN <a download>
//
// The images are served from fal's CDN, a different origin. The HTML `download`
// attribute is ignored cross-origin: the browser navigates to the image instead
// of saving it. The thumbnail page had exactly that and it has never actually
// downloaded anything on desktop; it opened a tab. So the bytes are fetched
// first and saved from a blob, which works because /api/proxy-image serves the
// allowed CDNs from our own origin with CORS.
//
// And when even that fails, it SAYS so and opens the image, rather than being a
// button that does nothing. A silent no-op on the one action the trial exists
// for is the worst possible failure here.
'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/** Same-origin URL for an image the proxy is allowed to serve. Falls back to
 *  the original when the host is not on the proxy's allowlist, which is fine:
 *  the fetch below tries it directly and only loses if that host blocks CORS. */
function proxied(url: string): string {
  try {
    const host = new URL(url).hostname
    const ALLOWED = ['fal.media', 'fal.ai', 'fal.run', 'storage.googleapis.com', 'replicate.delivery', 'i.ytimg.com', 'img.youtube.com']
    if (ALLOWED.some(h => host === h || host.endsWith('.' + h))) {
      return `/api/proxy-image?url=${encodeURIComponent(url)}`
    }
  } catch { /* not a URL; hand it back unchanged and let the fetch decide */ }
  return url
}

export default function DownloadDesign({
  url, filename = 'mvp-design.jpg', accent = '#d97706', label = 'Download',
}: {
  url: string | null | undefined
  filename?: string
  accent?: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  if (!url) return null

  async function save() {
    if (!url) return
    setBusy(true)
    try {
      // The proxy first (same origin, so no CORS question at all), then the raw
      // URL for a host it will not serve.
      let blob: Blob | null = null
      for (const candidate of [proxied(url), url]) {
        try {
          const res = await fetch(candidate)
          if (res.ok) { blob = await res.blob(); break }
        } catch { /* try the next one */ }
      }
      if (!blob) {
        // Not silent. The image opens so they can long-press or right-click it,
        // and they are told that is what just happened.
        window.open(url, '_blank', 'noopener')
        toast.info('Opened your design in a new tab — press and hold, or right-click, to save it.')
        return
      }
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoked on a delay: Safari has not finished reading the blob when the
      // click returns, and revoking immediately saves a zero-byte file.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
    } catch {
      window.open(url, '_blank', 'noopener')
      toast.info('Opened your design in a new tab — press and hold, or right-click, to save it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={save}
      disabled={busy}
      className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm text-white transition disabled:opacity-60"
      style={{ backgroundColor: accent }}
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
      {busy ? 'Saving…' : label}
    </button>
  )
}
