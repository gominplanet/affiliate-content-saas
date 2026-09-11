// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ChangeThumbnailButton — a first-class row action to REPLACE a published post's
// hero / featured image with a brand-new one. Sits in the Library / Social Push
// row toolbars so it's obvious (the same capability also lives inside Manual
// edit). Uploads through /api/blog/thumbnail, which sets featured_media on the
// live WordPress post (proxy-first, so it survives host WAFs). Works for any
// post — video-backed, link-based, or manually created.
//
// `postUrl` is the live permalink and is worth passing wherever it is known. The
// Posts tab identifies rows by their WordPress numeric id, and a post MVP has no
// blog_posts row for (a buying guide whose row insert failed after publishing,
// a rebuild that minted a new WP id) can only be resolved by its address. Send
// it and the button works on those posts; omit it and the route has no safe way
// to tell which blog a bare post id belongs to, and says so.
'use client'

import { useRef, useState } from 'react'
import { Loader2, ImagePlus } from 'lucide-react'
import { toast } from 'sonner'

export function ChangeThumbnailButton({ postId, postUrl }: { postId?: string | number; postUrl?: string | null }) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(file: File | null) {
    if (!file) return
    if (!postId) { toast.error('No published post to update yet.'); return }
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file.'); return }
    if (file.size > 8 * 1024 * 1024) { toast.error('That image is too large (max 8MB).'); return }
    setBusy(true)
    const t = toast.loading('Replacing thumbnail…')
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file)
      })
      const resp = await fetch('/api/blog/thumbnail', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: String(postId), image: dataUrl, postUrl: postUrl || null }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) { toast.error(data.error || 'Upload failed.', { id: t }); return }
      // The image is live either way, but a post MVP has no row for behaves
      // differently everywhere else in the app. Saying so here is the only place
      // the creator finds out before the next feature quietly skips it.
      if (data.tracked === false) {
        toast.success('Thumbnail replaced on your site ✓ — note this post isn’t tracked in MVP, so Rebuild and the social buttons won’t see it.', { id: t, duration: 9000 })
        return
      }
      toast.success('Thumbnail replaced ✓ (may take a minute to refresh on the live site)', { id: t })
    } catch {
      toast.error('Upload failed — try again.', { id: t })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ''; upload(f ?? null) }} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy || !postId}
        title="Upload a new image to replace this post's featured thumbnail"
        className="inline-flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors disabled:opacity-60"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />}
        {busy ? 'Uploading…' : 'Change thumbnail'}
      </button>
    </>
  )
}
