// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ArtDirectorThumbnailButton — have MVP design a new featured image for a post
// that is already published, without touching a word of the article.
//
// WHY IT EXISTS. A creator reported a thumbnail whose headline was misspelled
// and asked how to regenerate it. The only way was to tick "Update my post
// thumbnail with Art Director" on the generate panel and rewrite the whole
// post, which rewrites text that was already fine and spends a generation to
// fix an image.
//
// THE SAME WORDS AS THAT CHECKBOX, deliberately. It is the same action, and
// giving it a second name would make it look like a second feature with its
// own rules.
//
// SITS BESIDE ChangeThumbnailButton, which is the other half of the same
// question: upload one you already have, or have one designed.
'use client'

import { useState } from 'react'
import { Loader2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'

export function ArtDirectorThumbnailButton({ postId, onDone }: {
  /** The blog_posts uuid, or the WordPress numeric id. The route takes both,
   *  because the two tabs carry different ones. */
  postId?: string | number
  /** Called with the new image URL, so a row can show it without a reload. */
  onDone?: (imageUrl: string | null) => void
}) {
  const [busy, setBusy] = useState(false)

  async function rebuild() {
    if (!postId) { toast.error('No published post to update yet.'); return }
    setBusy(true)
    // IT IS SLOW AND THE MESSAGE SAYS SO. A designed render takes the better
    // part of a minute, and a silent button for that long reads as a broken
    // one and gets pressed again.
    const t = toast.loading('Designing a new thumbnail… this takes up to a minute.')
    try {
      const resp = await fetch(`/api/blog/posts/${postId}/thumbnail`, { method: 'POST' })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok || !data?.ok) {
        // THE ROUTE'S OWN SENTENCE. It knows whether this was the cap, a
        // missing product photo or a render that failed, and those have three
        // different answers.
        toast.error(data?.error || 'The thumbnail could not be rebuilt.', { id: t, duration: 10000 })
        return
      }
      toast.success(data.message || 'New thumbnail set.', { id: t, duration: 8000 })
      onDone?.(data.imageUrl ?? null)
    } catch {
      toast.error('Could not reach MVP. Nothing on the post changed.', { id: t })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={rebuild}
      disabled={busy || !postId}
      title="Have Art Director design a new featured thumbnail from the product. The article is not touched. Uses one thumbnail credit."
      className="inline-flex items-center gap-1 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#7C3AED] transition-colors disabled:opacity-60"
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
      {busy ? 'Designing…' : 'Update my post thumbnail with Art Director'}
    </button>
  )
}
