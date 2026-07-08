// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ChangeThumbnailButton — a first-class row action to REPLACE a published post's
// hero / featured image with a brand-new one. Sits in the Library / Social Push
// row toolbars so it's obvious (the same capability also lives inside Manual
// edit). Uploads through /api/blog/thumbnail, which sets featured_media on the
// live WordPress post (proxy-first, so it survives host WAFs). Works for any
// post — video-backed, link-based, or manually created.
'use client'

import { useRef, useState } from 'react'
import { Loader2, ImagePlus } from 'lucide-react'
import { toast } from 'sonner'

export function ChangeThumbnailButton({ postId }: { postId?: string | number }) {
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
        body: JSON.stringify({ postId: String(postId), image: dataUrl }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) { toast.error(data.error || 'Upload failed.', { id: t }); return }
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
