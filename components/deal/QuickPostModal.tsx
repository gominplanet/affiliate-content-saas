// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared "Quick post to socials" modal — fire ONE product straight to the
// link-friendly socials with a thumbnail, an auto-written price-safe caption
// (editable), and the creator's affiliate link. No IG/TikTok (no clickable
// caption link) or Pinterest. Used by Deal Radar cards AND the dashboard Price
// Alerts box (one-tap re-share a price drop).

'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Send, Check, AlertCircle, X as CloseIcon, Loader2, CalendarClock, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/InfoTip'

// Sensible defaults: 2 hours out, on the minute. Split into date (YYYY-MM-DD)
// and time (HH:mm) for the two separate pickers, both in the viewer's local time.
const pad = (n: number) => String(n).padStart(2, '0')
function defaultSchedule(): { date: string; time: string } {
  const d = new Date(Date.now() + 2 * 3600_000)
  d.setSeconds(0, 0)
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

export interface QuickPostDeal { asin: string; title: string; imageUrl: string | null }
interface PostResult { platform: string; ok: boolean; url?: string; error?: string }

// Link-friendly platforms for a direct post.
export const QUICK_PLATFORMS: { key: string; label: string }[] = [
  { key: 'twitter', label: 'X' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'threads', label: 'Threads' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'bluesky', label: 'Bluesky' },
]

export default function QuickPostModal({
  deal, onClose, initialCaption = '',
}: { deal: QuickPostDeal; onClose: () => void; initialCaption?: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(QUICK_PLATFORMS.map((p) => p.key)))
  const [story, setStory] = useState(false)
  const [caption, setCaption] = useState(initialCaption)
  const [posting, setPosting] = useState(false)
  const [results, setResults] = useState<PostResult[] | null>(null)
  const [linkNote, setLinkNote] = useState<string | null>(null)
  // Scheduling: the red "Schedule" button reveals a date + time picker; the same
  // button then queues the deal instead of posting now.
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const initial = defaultSchedule()
  const [scheduleDate, setScheduleDate] = useState(initial.date)
  const [scheduleTime, setScheduleTime] = useState(initial.time)
  const [scheduling, setScheduling] = useState(false)

  const toggle = (key: string) => setSelected((s) => {
    const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n
  })

  const schedule = async () => {
    // First click just opens the picker; the second (with the picker showing) submits.
    if (!scheduleOpen) { setScheduleOpen(true); return }
    if (selected.size === 0 && !story) { toast.error('Pick at least one destination.'); return }
    const when = new Date(`${scheduleDate}T${scheduleTime}`)
    if (isNaN(when.getTime())) { toast.error('Pick a valid date and time.'); return }
    if (when.getTime() < Date.now()) { toast.error('Pick a time in the future.'); return }
    setScheduling(true)
    try {
      const res = await fetch('/api/deal-radar/social-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: deal.asin, platforms: [...selected], story, caption: caption.trim() || undefined,
          title: deal.title, imageUrl: deal.imageUrl, scheduledFor: when.toISOString(),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.scheduled) { toast.error(data.error || 'Could not schedule that post.'); return }
      toast.success(`Scheduled for ${when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`)
      setTimeout(onClose, 700)
    } catch {
      toast.error('Could not schedule that post.')
    } finally {
      setScheduling(false)
    }
  }

  const post = async () => {
    if (selected.size === 0 && !story) { toast.error('Pick at least one destination.'); return }
    setPosting(true); setResults(null); setLinkNote(null)
    try {
      const res = await fetch('/api/deal-radar/social-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // title/imageUrl are a fallback the API uses when the ASIN has rotated
        // out of the live deal cache (e.g. re-sharing an older watched product).
        body: JSON.stringify({
          asin: deal.asin, platforms: [...selected], story, caption: caption.trim() || undefined,
          title: deal.title, imageUrl: deal.imageUrl,
        }),
      })
      const data = await res.json()
      if (!res.ok && !Array.isArray(data.results)) { toast.error(data.error || 'Could not post.'); return }
      const posted = data.results as PostResult[]
      setResults(posted)
      const note = typeof data.geniuslinkNote === 'string' ? data.geniuslinkNote : null
      setLinkNote(note)
      const okCount = posted.filter((r) => r.ok).length
      const failCount = posted.length - okCount
      if (okCount > 0) toast.success(`Posted to ${okCount} platform${okCount > 1 ? 's' : ''}.`)
      if (data.caption && !caption) setCaption(data.caption)
      if (okCount > 0 && failCount === 0 && !note) setTimeout(onClose, 900)
    } catch {
      toast.error('Could not post.')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => { if (!posting) onClose() }}>
      <div className="bg-white dark:bg-[#16161a] rounded-xl border shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 font-semibold"><Send size={16} /> Quick post to socials</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><CloseIcon size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-3">
            {deal.imageUrl && <img src={deal.imageUrl} alt="" className="h-16 w-16 object-contain rounded border bg-white shrink-0" />}
            <div className="text-sm font-medium line-clamp-3">{deal.title}</div>
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">Post to</div>
            <div className="flex flex-wrap gap-2">
              {QUICK_PLATFORMS.map((p) => (
                <button key={p.key} onClick={() => toggle(p.key)}
                  className={`text-sm rounded-lg border px-3 py-1.5 ${selected.has(p.key) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Instagram Story — a separate path: a 9:16 image with a baked-in
              "LINK IN BIO" call-to-action (Stories can't carry a link/caption). */}
          <div>
            <button onClick={() => setStory((v) => !v)}
              className={`w-full text-left text-sm rounded-lg border px-3 py-2.5 flex items-start gap-2.5 transition ${story ? 'border-pink-500 bg-pink-500/10' : 'bg-background hover:bg-accent'}`}>
              <span className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded border shrink-0 ${story ? 'bg-pink-500 border-pink-500 text-white' : ''}`}>{story && <Check size={12} />}</span>
              <span>
                <span className="font-medium">Also post an Instagram Story</span>
                <span className="block text-[11px] text-muted-foreground leading-snug mt-0.5">A 9:16 image with a “link in bio” sticker burned on. Point your bio at your Link in Bio page so followers can shop it.</span>
              </span>
            </button>
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">Caption <span className="font-normal">(leave blank to auto-write)</span></div>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3}
              placeholder="We'll write a price-safe caption for you, or type your own…"
              className="w-full text-sm rounded-lg border bg-background p-2.5 resize-none" />
            <p className="text-[11px] text-muted-foreground mt-1">Your affiliate link and an #ad disclosure are added automatically. We avoid quoting a specific price so the post stays accurate over time.</p>
          </div>

          {/* Schedule panel — revealed by the red Schedule button in the footer. */}
          {scheduleOpen && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Schedule for</div>
              <div className="flex gap-2">
                <input
                  type="date" value={scheduleDate} min={initial.date}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="flex-1 min-w-0 text-sm rounded-lg border bg-background p-2.5"
                />
                <input
                  type="time" value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-32 text-sm rounded-lg border bg-background p-2.5"
                />
              </div>
              <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#7C3AED' }}>
                <Info size={14} className="shrink-0" />
                <span>We&apos;ll only post if the deal is still live.</span>
                <InfoTip>
                  Deals end. If this one is no longer live when the scheduled time comes around, we won&apos;t post it. Better to skip it than to promote a deal that&apos;s already gone. Timed and lightning deals are the ones to watch.
                </InfoTip>
              </div>
            </div>
          )}

          {results && (
            <div className="space-y-1.5">
              {results.map((r) => (
                <div key={r.platform} className="flex items-center gap-2 text-sm">
                  {r.ok ? <Check size={15} className="text-emerald-600" /> : <AlertCircle size={15} className="text-red-600" />}
                  <span className="capitalize font-medium">{r.platform === 'instagram_story' ? 'Instagram Story' : (QUICK_PLATFORMS.find((p) => p.key === r.platform)?.label || r.platform)}</span>
                  {r.ok
                    ? (r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">view</a> : <span className="text-xs text-muted-foreground">posted</span>)
                    : <span className="text-xs text-red-600">{r.error}</span>}
                </div>
              ))}
            </div>
          )}

          {linkNote && (
            <div className="flex items-start gap-2 text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-400">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>Your affiliate tag still earns, but we couldn&apos;t shorten via Geniuslink this time, so the post used your plain Amazon link. Reason: {linkNote}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={post} disabled={posting || scheduling || (selected.size === 0 && !story)}>
              {posting ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Posting…</> : <><Send size={14} className="mr-1.5" /> Post now</>}
            </Button>
            <Button size="sm" onClick={schedule} disabled={scheduling || posting || (selected.size === 0 && !story)}
              className="bg-red-600 hover:bg-red-700 text-white">
              {scheduling ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Scheduling…</> : <><CalendarClock size={14} className="mr-1.5" /> Schedule</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
