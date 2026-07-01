// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// NotificationBell — topbar bell with a dropdown panel of recent
// scheduled-post events (completed + failed) from the last 7 days.
//
// Why: before this existed, the user only saw scheduled-job results via
// the schedule modal's persistent toast — and only IF they stayed on
// the same page during the 30-60s + cron window. Close the tab early,
// you have no idea what happened. The bell closes that loop.
//
// Unread tracking: localStorage stores the timestamp of the newest event
// the user has seen. New events with a later updated_at count as unread
// and drive the red dot + count badge.
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react'

interface NotificationEvent {
  id: string
  kind: 'social' | 'blog_publish' | 'support' | 'brand_inquiry'
  platform: string | null
  status: 'completed' | 'failed'
  blog_post_title: string | null
  blog_post_url: string | null
  scheduled_at: string
  updated_at: string
  error_message: string | null
}

const LAST_SEEN_KEY = 'mvp_notifications_last_seen_at'

function getLastSeen(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(LAST_SEEN_KEY)
    if (!raw) return 0
    const n = parseInt(raw, 10)
    return isNaN(n) ? 0 : n
  } catch { return 0 }
}

function setLastSeen(ms: number) {
  try { localStorage.setItem(LAST_SEEN_KEY, String(ms)) } catch { /* ignore */ }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}hr ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function platformLabel(kind: string, platform: string | null): string {
  if (kind === 'blog_publish') return 'Blog published'
  if (kind === 'brand_inquiry') return 'New brand inquiry'
  if (!platform) return 'Social push'
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<NotificationEvent[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const json = await res.json()
      const list: NotificationEvent[] = Array.isArray(json.events) ? json.events : []
      setEvents(list)
      const lastSeen = getLastSeen()
      const unread = list.filter(e => new Date(e.updated_at).getTime() > lastSeen).length
      setUnreadCount(unread)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    load()
    // Poll every 60s — the cron fires every minute so this catches new
    // events within a tick. Cheap query (limit 20, filtered indexed cols).
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function toggleOpen() {
    setOpen(prev => {
      const next = !prev
      if (next) {
        // Mark all currently-visible events as seen.
        const newest = events.length > 0
          ? Math.max(...events.map(e => new Date(e.updated_at).getTime()))
          : Date.now()
        setLastSeen(newest)
        setUnreadCount(0)
      }
      return next
    })
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggleOpen}
        className="relative p-1.5 rounded-lg transition-colors"
        style={{ color: 'var(--text-soft)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
          e.currentTarget.style.color = 'var(--text)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'var(--text-soft)'
        }}
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} new)` : 'Notifications'}
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#ff3b30] text-white text-[10px] font-bold flex items-center justify-center"
            aria-hidden
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[380px] rounded-xl border shadow-xl z-50"
          style={{
            backgroundColor: 'var(--bg, #0E0E11)',
            borderColor: 'var(--border, rgba(255,255,255,0.08))',
            color: 'var(--text, #F5F5F7)',
          }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
            <p className="text-sm font-semibold">Recent activity</p>
            <p className="text-[11px]" style={{ color: 'var(--text-faint, rgba(255,255,255,0.5))' }}>
              Last 7 days of activity
            </p>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {events.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs" style={{ color: 'var(--text-faint, rgba(255,255,255,0.5))' }}>
                  No events yet. Schedule a post to see results here.
                </p>
              </div>
            ) : (
              events.map((e) => {
                const isFailed = e.status === 'failed'
                return (
                  <div
                    key={e.id}
                    className="px-4 py-2.5 border-b last:border-b-0 hover:bg-white/[0.02] transition-colors"
                    style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex-shrink-0">
                        {isFailed
                          ? <AlertCircle size={14} className="text-[#ff3b30]" />
                          : <CheckCircle2 size={14} className="text-[#34c759]" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold">
                          {e.kind === 'support'
                            ? 'Support ticket answered'
                            : e.kind === 'brand_inquiry'
                              ? 'New brand inquiry'
                              : `${platformLabel(e.kind, e.platform)} ${isFailed ? 'failed' : 'published'}`}
                        </p>
                        <p className="text-[11px] truncate" style={{ color: 'var(--text-soft, rgba(255,255,255,0.7))' }}>
                          {e.blog_post_title || 'Untitled post'}
                        </p>
                        {isFailed && e.error_message && (
                          <p className="text-[11px] mt-0.5 text-[#ff3b30] truncate" title={e.error_message}>
                            {e.error_message}
                          </p>
                        )}
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-faint, rgba(255,255,255,0.5))' }}>
                          {timeAgo(e.updated_at)}
                        </p>
                      </div>
                      {!isFailed && e.blog_post_url && (
                        <a
                          href={e.blog_post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
                          title="Open post"
                        >
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
