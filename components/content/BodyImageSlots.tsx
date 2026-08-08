'use client'

// Three optional "bring-your-own photo" slots for the article body. Uploads each
// file to Supabase storage (product-images bucket) and hands the public URLs up
// via onChange. Empty slots fall back to AI photos; filled ones are used as-is,
// in order. Shared by the Generate flow and the Schedule-for-later modal so both
// entry points offer the exact same upload (the Schedule path was missing it —
// modernday.tech support ticket "Photos").

import { useRef, useState } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

export function BodyImageSlots({
  videoId,
  value,
  onChange,
  disabled,
}: {
  /** Namespaces the storage path; any stable id for this post/video works. */
  videoId: string
  /** Controlled: a 3-length array of public URLs or null. */
  value: (string | null)[]
  onChange: (next: (string | null)[]) => void
  disabled?: boolean
}) {
  const [busyIdx, setBusyIdx] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const ref0 = useRef<HTMLInputElement>(null)
  const ref1 = useRef<HTMLInputElement>(null)
  const ref2 = useRef<HTMLInputElement>(null)
  const refs = [ref0, ref1, ref2]
  const supabase = createBrowserClient()

  async function uploadSlot(idx: number, files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    setErr(null)
    if (!f.type.startsWith('image/')) { setErr('Images only'); return }
    if (f.size > 10 * 1024 * 1024) { setErr('Each image must be under 10 MB'); return }
    setBusyIdx(idx)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')
      const ext = f.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${user.id}/blog/${videoId}/${crypto.randomUUID()}.${ext}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any).from('product-images').upload(path, f, {
        cacheControl: '31536000', upsert: false, contentType: f.type || 'image/jpeg',
      })
      if (upErr) throw new Error(upErr.message || 'Upload failed')
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path)
      if (urlData?.publicUrl) {
        const next = [...value]
        next[idx] = urlData.publicUrl
        onChange(next)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusyIdx(null)
      const r = refs[idx]?.current
      if (r) r.value = ''
    }
  }

  function clearSlot(idx: number) {
    const next = [...value]
    next[idx] = null
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {[0, 1, 2].map((idx) => {
          const u = value[idx]
          const busy = busyIdx === idx
          return (
            <div key={idx} className="flex flex-col items-center gap-1">
              <input
                ref={refs[idx]}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => uploadSlot(idx, e.target.files)}
              />
              {u ? (
                <div className="relative w-14 h-14 rounded-md overflow-hidden border border-gray-200 dark:border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`Article image ${idx + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => clearSlot(idx)}
                    aria-label={`Remove image ${idx + 1}`}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 hover:bg-[#ff3b30] text-white flex items-center justify-center"
                  >
                    <X size={9} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => refs[idx]?.current?.click()}
                  disabled={busy || disabled}
                  className="w-14 h-14 rounded-md border border-dashed border-gray-300 dark:border-white/15 flex items-center justify-center text-[#86868b] dark:text-[#8e8e93] hover:border-[#7C3AED] hover:text-[#7C3AED] disabled:opacity-50 transition-colors"
                  title={`Upload your own image ${idx + 1} (optional)`}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                </button>
              )}
              <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">Image {idx + 1}</span>
            </div>
          )
        })}
      </div>
      <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">
        {value.some(Boolean)
          ? 'Only the photos you add here go in the article (no AI photos mixed in). Fill more slots for more images.'
          : 'Optional. By default we generate AI photos of the actual product in different real-world settings — or drop in up to 3 of your own above.'}
      </span>
      {err && <span className="text-[10px] text-[#ff3b30]">{err}</span>}
    </div>
  )
}
