'use client'

/**
 * ShortVideoUpload — drag-and-drop / file-picker upload for the vertical
 * MP4 of a YouTube Short. Used inside the TikTok + IG direct-publish
 * modals when the row's instagram_video_url is empty (or the user wants
 * to replace what's stored).
 *
 * Why client-side upload: Supabase Storage's browser client streams
 * directly to S3-compatible storage, bypassing Vercel's 4.5MB request-
 * body limit and 300s function timeout. Even a 200MB Short uploads in
 * ~30s on a normal connection without burning function time.
 *
 * On success we PATCH the row's instagram_video_url + trigger a refresh
 * in the parent (loadMeta), which makes the video preview + AI caption
 * appear in the modal automatically.
 */
import { useState, useRef, useCallback } from 'react'
import { Loader2, Upload, AlertCircle } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

const MAX_BYTES = 300 * 1024 * 1024 // 300 MB — matches the IG-burner cap

export function ShortVideoUpload({
  videoId,
  onUploaded,
  compact = false,
}: {
  /** youtube_videos.id (uuid) — the row whose instagram_video_url we update. */
  videoId: string
  /** Fires once the upload + DB patch both succeed. Parent should re-load
   *  meta so the new video URL flows through to the preview + caption. */
  onUploaded: () => void | Promise<void>
  /** Smaller layout for the "wrong video, replace this" path under an
   *  already-loaded preview. Big drop-zone for the first-time case. */
  compact?: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const supabase = createBrowserClient()

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    if (!file.type.startsWith('video/')) {
      setError('That doesn\'t look like a video file. MP4 works best.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under 300 MB.`)
      return
    }
    setUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')

      // Path shape matches the existing IG burner / composer uploads so the
      // bucket's RLS policy (first folder = user id) accepts it.
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const path = `${user.id}/short-${crypto.randomUUID()}.${ext}`

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any)
        .from('instagram-videos')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'video/mp4',
        })
      if (upErr) throw new Error(upErr.message || 'Storage upload failed.')

      const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
      const publicUrl = urlData.publicUrl
      if (!publicUrl) throw new Error('Storage did not return a public URL.')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: dbErr } = await (supabase as any)
        .from('youtube_videos')
        .update({ instagram_video_url: publicUrl })
        .eq('id', videoId)
        .eq('user_id', user.id)
      if (dbErr) throw new Error(`Couldn't link the video: ${dbErr.message}`)

      await onUploaded()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [videoId, supabase, onUploaded])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }, [handleFile])

  if (compact) {
    // Compact mode — sits under an already-loaded video preview. Just a
    // small text link + hidden file input. Click triggers picker.
    return (
      <div className="flex flex-col items-center gap-1">
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-[10px] text-[#86868b] hover:text-[#0071e3] inline-flex items-center gap-1 disabled:opacity-50"
          title="Upload the MP4 from your computer"
        >
          {uploading
            ? <><Loader2 size={10} className="animate-spin" /> Uploading…</>
            : <><Upload size={10} /> Or upload a different MP4 from your computer</>
          }
        </button>
        {error && <p className="text-[10px] text-[#ff3b30]">{error}</p>}
      </div>
    )
  }

  // Full mode — used when there's no video URL stored yet. Big drop zone.
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => !uploading && inputRef.current?.click()}
      className={`rounded-lg border-2 border-dashed p-5 flex flex-col items-center gap-2 cursor-pointer transition-colors ${dragOver ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-gray-300 dark:border-white/15 hover:border-[#0071e3]/60'} ${uploading ? 'opacity-60 cursor-wait' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
      />
      {uploading ? (
        <>
          <Loader2 size={20} className="text-[#0071e3] animate-spin" />
          <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">Uploading…</p>
          <p className="text-[11px] text-[#86868b]">Don&apos;t close this window.</p>
        </>
      ) : (
        <>
          <Upload size={20} className="text-[#0071e3]" />
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Drop the MP4 here</p>
          <p className="text-[11px] text-[#86868b] text-center">
            or click to pick from your computer. 9:16 vertical, under 300 MB.<br />
            Probably already in your Downloads folder from when you uploaded to YouTube.
          </p>
        </>
      )}
      {error && (
        <p className="text-[11px] text-[#ff3b30] flex items-center gap-1 mt-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  )
}
