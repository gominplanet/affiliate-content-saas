'use client'

import { useEffect, useState } from 'react'
import { Loader2, X, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'

/**
 * Generic preview/edit modal used before any text-based social publish.
 *
 * Flow:
 *   1. On mount, calls the endpoint with { dryRun: true } to get the AI-generated text.
 *   2. User can edit the textarea or click Regenerate.
 *   3. Publish hits the SAME endpoint with the (possibly edited) text and no dryRun.
 *
 * Endpoint contract (each /api/blog/{platform}-post route):
 *   Request:  { postId, dryRun?: boolean, text?: string }
 *   Response: { ok: true, dryRun?: true, text: string, finalText: string }
 *              | { error: string }
 *
 * Used for: Threads, Twitter/X, Bluesky, LinkedIn, Facebook, Telegram.
 * Instagram has its own purpose-built modal (image + multi-target flow).
 * Pinterest has its own preview flow (description + image).
 */
export function SocialPreviewModal({
  platform,
  brandColor,
  endpoint,
  postId,
  onClose,
  onPublished,
}: {
  /** Display label, e.g. "Threads" — shows in the modal header. */
  platform: string
  /** Hex color used for the publish button background. */
  brandColor: string
  /** Relative API path, e.g. /api/blog/threads-post */
  endpoint: string
  /** Blog post id to send in the body. */
  postId: string
  /** Closes the modal (cancel or success). */
  onClose: () => void
  /** Called after a successful publish so the pill can flip to "Posted". */
  onPublished: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [finalText, setFinalText] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  async function generate() {
    setLoadError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, dryRun: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Preview failed')
      setText(data.text || '')
      setFinalText(data.finalText || data.text || '')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Preview failed')
    }
  }

  // Initial load
  useEffect(() => {
    let alive = true
    setLoading(true)
    generate().finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, endpoint])

  async function handleRegenerate() {
    setRegenerating(true)
    await generate()
    setRegenerating(false)
  }

  async function publish() {
    if (!text.trim()) return
    setPublishing(true)
    setPublishError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Publish failed')
      onPublished()
      onClose()
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                style={{ background: brandColor }}
              >
                {platform.charAt(0)}
              </div>
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Preview {platform} post</h3>
            </div>
            <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
              <X size={16} />
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-xs text-[#6e6e73]">
              <Loader2 size={18} className="animate-spin text-[#0071e3]" />
              <span>Generating preview…</span>
            </div>
          ) : loadError ? (
            <div className="flex flex-col gap-3 py-6 text-center">
              <p className="text-xs text-[#ff3b30] flex items-center gap-1.5 justify-center">
                <AlertCircle size={12} /> {loadError}
              </p>
              <button onClick={handleRegenerate} className="text-xs text-[#0071e3] hover:underline">Retry</button>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <label className="text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1 flex items-center justify-between">
                  <span>Post text <span className="text-[#86868b]">({text.length} chars)</span></span>
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className="text-[10px] text-[#0071e3] hover:underline inline-flex items-center gap-1 disabled:opacity-60"
                  >
                    {regenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Regenerate
                  </button>
                </label>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={9}
                  className="w-full text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#0071e3] focus:outline-none leading-relaxed font-mono resize-none"
                  placeholder="Post body — edit freely"
                />
              </div>

              {finalText && finalText !== text && (
                <details className="mb-3 text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">
                  <summary className="cursor-pointer hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
                    Preview what gets posted (with URL + disclaimer appended)
                  </summary>
                  <pre className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 whitespace-pre-wrap font-mono leading-relaxed">{finalText}</pre>
                </details>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={onClose}
                  disabled={publishing}
                  className="text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] px-3 py-2 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={publish}
                  disabled={publishing || !text.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                  style={{ background: brandColor }}
                >
                  {publishing
                    ? <><Loader2 size={12} className="animate-spin" /> Publishing…</>
                    : <><CheckCircle size={12} /> Publish to {platform}</>
                  }
                </button>
              </div>
              {publishError && <p className="text-[11px] text-[#ff3b30] mt-3 break-all">{publishError}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
