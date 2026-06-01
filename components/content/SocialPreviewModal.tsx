'use client'

import { useEffect, useState } from 'react'
import { Loader2, X, RefreshCw, CheckCircle, AlertCircle, Calendar, Copy, ExternalLink, Users } from 'lucide-react'

/** Platform key the SocialPreviewModal accepts for scheduling. The cron
 *  worker handles the same set. */
type SchedulablePlatform = 'facebook' | 'threads' | 'twitter' | 'linkedin' | 'bluesky' | 'telegram'

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
  platformKey,
  brandColor,
  endpoint,
  postId,
  onClose,
  onPublished,
  onScheduled,
  extraBody,
  shareUrl,
  shareHashtags,
  shareDisclaimer,
  facebookGroups,
  publishTargetLabel,
}: {
  /** Display label, e.g. "Threads" — shows in the modal header. */
  platform: string
  /** Lowercase platform key used by /api/blog/schedule-post. If omitted,
   *  the Schedule-for-later toggle is hidden (immediate publish only). */
  platformKey?: SchedulablePlatform
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
  /** Called after a scheduled-for-later succeeds. */
  onScheduled?: (when: Date) => void
  /** Extra fields merged into every request body — e.g. a chosen
   *  { socialAccountId } for multi-account targeting. */
  extraBody?: Record<string, unknown>
  /** Facebook-only manual-share extras. When `shareUrl` is provided, the modal
   *  shows a copy-paste block (post text + hashtags + URL + disclaimer) and a
   *  list of the user's saved Facebook Groups to open and paste into — Meta's
   *  API can't post to Groups, only Pages. */
  shareUrl?: string
  shareHashtags?: string
  shareDisclaimer?: string
  facebookGroups?: Array<{ name: string; url: string }>
  /** Name of the exact destination the Publish button posts to (e.g. the
   *  selected Facebook Page). Shown next to the button so it's unambiguous. */
  publishTargetLabel?: string
}) {
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [finalText, setFinalText] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  // ── Schedule-for-later state ─────────────────────────────────────────────
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  // Default schedule: 1 hour from now, rounded to the next 5 min boundary.
  // datetime-local <input> wants a local-time string ("YYYY-MM-DDTHH:mm").
  const [scheduledAt, setScheduledAt] = useState<string>(() => defaultScheduleString())
  const [scheduling, setScheduling] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Niche hashtags generated server-side for THIS product/topic (preferred over
  // the generic brand-niche fallback passed in via shareHashtags).
  const [serverHashtags, setServerHashtags] = useState('')

  // Assembled copy-paste block for manual Group sharing: the (edited) post
  // text + hashtags + URL + FTC disclaimer. Reactive to textarea edits.
  const groupCopy = [text.trim(), (serverHashtags || shareHashtags || '').trim(), (shareUrl || '').trim(), (shareDisclaimer || '').trim()]
    .filter(Boolean).join('\n\n')

  async function generate() {
    setLoadError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, dryRun: true, ...extraBody }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Preview failed')
      setText(data.text || '')
      setFinalText(data.finalText || data.text || '')
      if (typeof data.hashtags === 'string' && data.hashtags.trim()) setServerHashtags(data.hashtags.trim())
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
        body: JSON.stringify({ postId, text, ...extraBody }),
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

  /** Schedule-for-later path. Posts to /api/blog/schedule-post with the
   *  user's edited text and the chosen ISO timestamp. */
  async function schedule() {
    if (!platformKey) return
    if (!text.trim()) return
    setScheduling(true)
    setScheduleError(null)
    try {
      // Build the ISO timestamp from the datetime-local string. The browser
      // returns it as local time without TZ — we treat it as the user's
      // local clock and convert to ISO for the server.
      const when = new Date(scheduledAt)
      if (isNaN(when.getTime())) throw new Error('Invalid date / time')
      const res = await fetch('/api/blog/schedule-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          platform: platformKey,
          scheduledAt: when.toISOString(),
          text,
          ...extraBody,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Schedule failed')
      onScheduled?.(when)
      onClose()
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Schedule failed')
    } finally {
      setScheduling(false)
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
              <Loader2 size={18} className="animate-spin text-[#7C3AED]" />
              <span>Generating preview…</span>
            </div>
          ) : loadError ? (
            <div className="flex flex-col gap-3 py-6 text-center">
              <p className="text-xs text-[#ff3b30] flex items-center gap-1.5 justify-center">
                <AlertCircle size={12} /> {loadError}
              </p>
              <button onClick={handleRegenerate} className="text-xs text-[#7C3AED] hover:underline">Retry</button>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <label className="text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1 flex items-center justify-between">
                  <span>Post text <span className="text-[#86868b]">({text.length} chars)</span></span>
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerating}
                    className="text-[10px] text-[#7C3AED] hover:underline inline-flex items-center gap-1 disabled:opacity-60"
                  >
                    {regenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Regenerate
                  </button>
                </label>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={9}
                  className="w-full text-xs text-[#1d1d1f] dark:text-[#f5f5f7] p-3 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#7C3AED] focus:outline-none leading-relaxed font-mono resize-none"
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

              {/* Facebook manual-share: copy block + saved Groups. Only shown
                  when the caller passes shareUrl (the Facebook flow). */}
              {shareUrl && (
                <div className="mb-4 rounded-xl border border-gray-200 dark:border-white/10 p-3 bg-[#f5f5f7] dark:bg-white/5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Post to a Facebook Group</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(groupCopy).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7C3AED] hover:underline"
                    >
                      {copied ? <><CheckCircle size={11} /> Copied!</> : <><Copy size={11} /> Copy</>}
                    </button>
                  </div>
                  <pre className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-wrap font-mono leading-relaxed max-h-32 overflow-y-auto p-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10">{groupCopy}</pre>
                  <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5 leading-relaxed">
                    Copy this, then open a Group below and paste it into a new post. (Facebook can&apos;t post to Groups via API — Pages only.)
                  </p>
                  {facebookGroups && facebookGroups.length > 0 ? (
                    <div className="mt-2 flex flex-col gap-1">
                      {facebookGroups.filter(g => g.url?.trim()).map((g, i) => (
                        <a
                          key={i}
                          href={g.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-[11px] text-[#1877f2] hover:underline"
                        >
                          <Users size={11} /> {g.name?.trim() || g.url} <ExternalLink size={9} />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-2">
                      No groups saved yet — add them in <a href="/brand" className="text-[#7C3AED] hover:underline">Brand Profile</a> to list them here.
                    </p>
                  )}
                </div>
              )}

              {/* Schedule-for-later toggle + date picker (only when caller
                  passed a platformKey — i.e. one of the 6 supported
                  schedulable platforms). */}
              {platformKey && (
                <div className="mb-4">
                  <label className="flex items-center gap-2 text-xs cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={scheduleEnabled}
                      onChange={e => setScheduleEnabled(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
                      <Calendar size={11} className="text-[#86868b]" />
                      Schedule for later
                    </span>
                  </label>
                  {scheduleEnabled && (
                    <div className="pl-6">
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={e => setScheduledAt(e.target.value)}
                        min={defaultScheduleString()}
                        className="w-full text-xs px-3 py-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#7C3AED] focus:outline-none"
                      />
                      <p className="text-[10px] text-[#86868b] dark:text-[#8e8e93] mt-1.5 leading-relaxed">
                        Your timezone. The post fires automatically — you don&apos;t need to keep the app open.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {publishTargetLabel && !scheduleEnabled && (
                <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-[#1877f2]/8 border border-[#1877f2]/20 px-3 py-2">
                  <CheckCircle size={12} className="text-[#1877f2] flex-shrink-0" />
                  <span className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                    Publish posts to your Page: <span className="font-semibold">{publishTargetLabel}</span>
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={onClose}
                  disabled={publishing || scheduling}
                  className="text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] px-3 py-2 disabled:opacity-60"
                >
                  Cancel
                </button>
                {scheduleEnabled && platformKey ? (
                  <button
                    onClick={schedule}
                    disabled={scheduling || !text.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                    style={{ background: brandColor }}
                  >
                    {scheduling
                      ? <><Loader2 size={12} className="animate-spin" /> Scheduling…</>
                      : <><Calendar size={12} /> Schedule for {platform}</>
                    }
                  </button>
                ) : (
                  <button
                    onClick={publish}
                    disabled={publishing || !text.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                    style={{ background: brandColor }}
                  >
                    {publishing
                      ? <><Loader2 size={12} className="animate-spin" /> Publishing…</>
                      : <><CheckCircle size={12} /> Publish to {publishTargetLabel || platform}</>
                    }
                  </button>
                )}
              </div>
              {publishError && <p className="text-[11px] text-[#ff3b30] mt-3 break-all">{publishError}</p>}
              {scheduleError && <p className="text-[11px] text-[#ff3b30] mt-3 break-all">{scheduleError}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Returns a "YYYY-MM-DDTHH:mm" string for <input type="datetime-local">
 *  pointing at now + 1 hour, rounded to the next 5-minute mark. */
function defaultScheduleString(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  const m = d.getMinutes()
  d.setMinutes(Math.ceil(m / 5) * 5, 0, 0)
  // Local components (datetime-local has no timezone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
