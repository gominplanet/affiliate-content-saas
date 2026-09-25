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
import { useEffect } from 'react'
import { Send, Check, AlertCircle, X as CloseIcon, Loader2, CalendarClock, Info, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/InfoTip'
import SavedProductImage, { useSavedProductImage } from '@/components/product/SavedProductImage'
import ShowcaseToggle, { useShowcase } from '@/components/product/ShowcaseToggle'
import { useConnectedPlatforms, useSelectedPlatforms } from '@/components/social/useConnectedPlatforms'
import PlatformPicker from '@/components/social/PlatformPicker'

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
interface PostResult {
  platform: string; ok: boolean; url?: string; error?: string
  /** The post went out and is not quite what was asked for — an X post whose
   *  image could not be attached. Separate from `error`, which means nothing
   *  was posted at all. */
  note?: string
  /** Pinterest only, and not really a failure: the pin was refused because
   *  there is no page of the creator's to point at yet (Pinterest does not
   *  accept affiliate redirect links). One setup step from working, so it is
   *  shown as a step to take rather than as a platform rejecting their content. */
  needsLinkPage?: boolean
  setupPath?: string
}

// Turn a raw platform API error into something a creator can act on. The socials
// hand back long JSON blobs (Meta) or terse strings ("Authentication failed")
// that read as an MVP bug when they're really an account-side reconnect or a
// Meta identity check. Returns friendly text plus, when relevant, where to fix it.
function friendlyPostError(platform: string, raw?: string): { text: string; fixHref?: string; fixLabel?: string } {
  const r = (raw || '').toLowerCase()
  const label = platform === 'instagram_story' ? 'Instagram'
    : (QUICK_PLATFORMS.find((p) => p.key === platform)?.label || platform)
  // Meta identity confirmation (error 368) — must be cleared in the Facebook app.
  if (/\b368\b/.test(r) || r.includes('confirm your identity') || r.includes('publish as this page')) {
    return { text: `${label} needs you to confirm your identity before it will let MVP post as your Page. Open the Facebook app on your phone, follow its confirmation prompt, then try again.` }
  }
  // Expired / revoked connection — reconnect the account.
  if (r.includes('authentication failed') || r.includes('access token') || r.includes('oauthexception')
    || r.includes('token has expired') || r.includes('session has expired') || r.includes('invalid token')
    || r.includes('401') || r.includes('reconnect') || r.includes('re-authenticate')) {
    return { text: `Your ${label} connection expired. Reconnect it, then try again.`, fixHref: '/connect-socials', fixLabel: `Reconnect ${label}` }
  }
  // Fallback: keep the raw text but trim the JSON noise so it stays readable.
  const trimmed = (raw || 'Post failed.').replace(/\s+/g, ' ').trim().slice(0, 220)
  return { text: trimmed }
}

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
  deal, onClose, initialCaption = '', pinterestEnabled = false, instagramEnabled = false, source, onDone,
}: {
  deal: QuickPostDeal; onClose: () => void; initialCaption?: string; pinterestEnabled?: boolean; instagramEnabled?: boolean
  /** Where the post comes from, so that page can remember what was shared (On sale now: 'on_sale'). */
  source?: 'on_sale'
  /** Called once a post went out or was scheduled, so the page can refresh what it shows. */
  onDone?: () => void
}) {
  // Pinterest is a separate pipeline (a designed pin linking to the affiliate
  // link), shown only when the plan allows Pinterest. It flows through the same
  // `platforms` array; the API routes it to the pin path.
  // Pinterest and Instagram both ride in the same `platforms` array and are
  // split back out server-side, because each runs its own pipeline (a designed
  // image, no clickable link in the caption) rather than the caption-link path
  // the six text networks share.
  const platformOptions = [
    ...QUICK_PLATFORMS,
    ...(pinterestEnabled ? [{ key: 'pinterest', label: 'Pinterest' }] : []),
    ...(instagramEnabled ? [{ key: 'instagram', label: 'Instagram' }] : []),
  ]
  // ── Only tick what is actually connected ─────────────────────────────────
  // This used to open with every platform selected. A creator with one
  // connected network unselected six buttons before every post, and forgetting
  // meant the post went out to the one that works and came back with six red
  // "failed" rows for six accounts that were never connected. The plan decides
  // what APPEARS here (Pinterest and Instagram are tier-gated); the creator's
  // connections decide what is TICKED. An unconnected platform stays clickable
  // on purpose, so if the connection check is ever wrong it costs a click
  // rather than a channel.
  const conn = useConnectedPlatforms()
  const offeredKeys = platformOptions.map((p) => p.key)
  const [selected, setSelected] = useSelectedPlatforms(offeredKeys, conn)
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
  // An image the creator already approved for this ASIN somewhere else (a
  // Co-Pilot thumbnail, or one they uploaded). Offered, not imposed: it starts
  // selected because that is what asking for recall means, and the panel says
  // so in words with a way back to the product photo.
  const { saved } = useSavedProductImage(deal.asin)
  const [useSaved, setUseSaved] = useState(true)
  // A FLAG, not a URL. The server resolves the saved image itself from
  // (user, asin); handing it a URL from the browser would let any URL be
  // pushed to the creator's own socials through this endpoint.
  const useSavedImage = !!saved && useSaved

  // ── Send the clicks to the creator's TikTok Shop showcase instead ─────────
  // Off by default: this replaces the affiliate link on a real published post,
  // so it is never something MVP decides for them. The saved default loads from
  // Settings; the box below overrides it for this post only.
  // The SHARED hook, not a second copy: it also loads the account-level default
  // (migration 333), so a creator whose whole account points at their shop sees
  // this already ticked here too rather than only on the other surfaces.
  const showcase = useShowcase()
  const { on: useShowcaseOn, override: showcaseUrl, saved: savedShowcase } = showcase
  const setUseShowcase = showcase.setOn
  const setShowcaseUrl = showcase.setOverride
  // The one case worth blocking on: the toggle is on and there is nothing to
  // point at. Posting anyway would quietly publish Amazon links under a toggle
  // that reads as on.
  const showcaseMissing = showcase.blocked

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
          // What the panel promised is what fires: the server resolves the
          // saved image NOW and stores that URL on the queued row. Resolving
          // it again at fire time would silently pick up a newer one and make
          // the line the creator read while scheduling untrue.
          useSavedImage,
          useShowcase: useShowcaseOn,
          showcaseUrl: showcaseUrl.trim() || undefined,
          source,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.scheduled) { toast.error(data.error || 'Could not schedule that post.'); return }
      onDone?.()
      toast.success(`Scheduled for ${when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`, {
        // Say where the queued post will send people. A scheduled post that
        // quietly fell back to Amazon is otherwise only discovered after it fires.
        description: typeof data.destinationNote === 'string' && data.destinationNote
          ? data.destinationNote
          : (data.destinationKind === 'showcase' ? 'Links will point at your TikTok showcase.' : undefined),
      })
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
          title: deal.title, imageUrl: deal.imageUrl, useSavedImage,
          useShowcase: useShowcaseOn, showcaseUrl: showcaseUrl.trim() || undefined,
          source,
        }),
      })
      const data = await res.json()
      if (!res.ok && !Array.isArray(data.results)) { toast.error(data.error || 'Could not post.'); return }
      const posted = data.results as PostResult[]
      setResults(posted)
      // Two separate things can be worth saying: the cloaker fell back, and the
      // destination is not the one that was asked for. Show both rather than
      // letting one hide the other.
      const notes = [
        typeof data.destinationNote === 'string' ? data.destinationNote : null,
        typeof data.geniuslinkNote === 'string' ? data.geniuslinkNote : null,
      ].filter(Boolean) as string[]
      const note = notes.length ? notes.join(' ') : null
      setLinkNote(note)
      if (data.destinationKind === 'showcase') {
        toast.success('Links point at your TikTok showcase on this post.')
      }
      const okCount = posted.filter((r) => r.ok).length
      const failCount = posted.length - okCount
      if (okCount > 0) toast.success(`Posted to ${okCount} platform${okCount > 1 ? 's' : ''}.`)
      if (okCount > 0) onDone?.()
      if (data.caption && !caption) setCaption(data.caption)
      // Auto-close only when there is nothing left to read. A per-platform note
      // (an X post with no image) is on screen in the results list, and closing
      // the modal under it would make the warning unreadable by design.
      const hasPlatformNote = posted.some((r) => r.ok && r.note)
      if (okCount > 0 && failCount === 0 && !note && !hasPlatformNote) setTimeout(onClose, 900)
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
            {deal.imageUrl && <img loading="lazy" decoding="async" src={deal.imageUrl} alt="" className="h-16 w-16 object-contain rounded border bg-white shrink-0" />}
            <div className="text-sm font-medium line-clamp-3">{deal.title}</div>
          </div>

          {saved && (
            <SavedProductImage
              saved={saved}
              inUse={useSaved}
              onUse={() => setUseSaved(true)}
              onReplace={() => setUseSaved(false)}
              replaceLabel="Use the product photo instead"
              keepLabel="we design a deal card from the product photo"
            />
          )}
          {saved && useSaved && (
            <p className="text-[11px] text-muted-foreground -mt-2">
              Posted as it is. We don&apos;t paint a deal badge over an image you designed yourself.
            </p>
          )}

          <div>
            <PlatformPicker
              options={platformOptions} selected={selected} onToggle={toggle}
              known={conn.known} connected={conn.connected}
            />
            {pinterestEnabled && selected.has('pinterest') && (
              <p className="text-[11px] text-muted-foreground mt-1.5">Pinterest gets its own designed pin. Pinterest does not accept affiliate redirect links, so the pin points at your Link in Bio shop page and the product is added there with your affiliate link on it.</p>
            )}
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

          {/* The SHARED control, not a second copy of it. One place to change
              the wording, and no chance of the modal and the composers
              disagreeing about what the toggle does. */}
          <ShowcaseToggle state={showcase} setOn={setUseShowcase} setOverride={setShowcaseUrl} />

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">Caption <span className="font-normal">(leave blank to auto-write)</span></div>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3}
              placeholder="We'll write a price-safe caption for you, or type your own…"
              className="w-full text-sm rounded-lg border bg-background p-2.5 resize-none" />
            <p className="text-[11px] text-muted-foreground mt-1">
              {useShowcaseOn && !showcaseMissing
                ? 'Your showcase link and an #ad disclosure are added automatically. Amazon prices and discounts are left out of this post.'
                : 'Your affiliate link and an #ad disclosure are added automatically. We avoid quoting a specific price so the post stays accurate over time.'}
            </p>
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
              {results.map((r) => {
                const fe = r.ok ? null : friendlyPostError(r.platform, r.error)
                // A missing Link in Bio page is the one "failure" here that the
                // creator can fix in a minute, so it gets the amber treatment
                // and a way to go and do it, not a red line among red lines.
                const setup = !r.ok && r.needsLinkPage
                return (
                  <div key={r.platform} className="flex items-start gap-2 text-sm">
                    {r.ok && !r.note
                      ? <Check size={15} className="text-emerald-600 mt-0.5" />
                      : r.ok
                      ? <AlertCircle size={15} className="text-amber-600 mt-0.5 shrink-0" />
                      : <AlertCircle size={15} className={`mt-0.5 shrink-0 ${setup ? 'text-amber-600' : 'text-red-600'}`} />}
                    <span className="capitalize font-medium shrink-0">{r.platform === 'instagram_story' ? 'Instagram Story' : (QUICK_PLATFORMS.find((p) => p.key === r.platform)?.label || r.platform)}</span>
                    {r.ok
                      ? (
                        <span className="min-w-0">
                          {r.url
                            ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">view</a>
                            : <span className="text-xs text-muted-foreground">posted</span>}
                          {/* Posted, and not carrying what it was meant to. A
                              bare green tick here is exactly how a creator
                              keeps posting imageless tweets for months. */}
                          {r.note && (
                            <span className="block text-xs text-amber-700 dark:text-amber-500">{r.note}</span>
                          )}
                        </span>
                      )
                      : setup ? (
                        <span className="text-xs text-amber-700 dark:text-amber-500 min-w-0">
                          {r.error}
                          {' '}
                          <a href={r.setupPath || '/link-in-bio'} className="underline font-medium whitespace-nowrap">Set up Link in Bio →</a>
                        </span>
                      ) : (
                        <span className="text-xs text-red-600 min-w-0">
                          {fe!.text}
                          {fe!.fixHref && (
                            <> <a href={fe!.fixHref} className="underline font-medium whitespace-nowrap">{fe!.fixLabel} →</a></>
                          )}
                        </span>
                      )}
                  </div>
                )
              })}
            </div>
          )}

          {linkNote && (
            <div className="flex items-start gap-2 text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-400">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {/* Printed as written. This used to be wrapped in "we couldn't shorten via
                  Geniuslink", which then framed notes that had nothing to do with
                  Geniuslink, or with shortening: a pin explaining that it points at
                  the shop page was announced as a Geniuslink failure. The note is a
                  complete sentence at its source. */}
              <span>{linkNote}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={post} disabled={posting || scheduling || showcaseMissing || (selected.size === 0 && !story)}>
              {posting ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Posting…</> : <><Send size={14} className="mr-1.5" /> Post now</>}
            </Button>
            <Button size="sm" onClick={schedule} disabled={scheduling || posting || showcaseMissing || (selected.size === 0 && !story)}
              className="bg-red-600 hover:bg-red-700 text-white">
              {scheduling ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Scheduling…</> : <><CalendarClock size={14} className="mr-1.5" /> Schedule</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
