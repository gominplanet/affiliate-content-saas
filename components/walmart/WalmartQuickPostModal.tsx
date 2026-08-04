// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Walmart "Quick post to socials" modal — the Walmart twin of QuickPostModal.
// Fires ONE Walmart offer straight to the link-friendly socials with a
// thumbnail, an auto-written price-safe caption (editable), and the creator's
// minted + Geniuslink-cloaked Walmart link. Posts to /api/walmart/social-post.
// (No scheduling: Walmart deals have no live-deal cache/cron to gate a queued
// post, so we keep it to immediate posting.)

'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Send, Check, AlertCircle, X as CloseIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface WalmartQuickPostItem { itemId: string; name: string; imageUrl: string | null; url: string }
interface PostResult { platform: string; ok: boolean; url?: string; error?: string }

const QUICK_PLATFORMS: { key: string; label: string }[] = [
  { key: 'twitter', label: 'X' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'threads', label: 'Threads' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'bluesky', label: 'Bluesky' },
]

export default function WalmartQuickPostModal({
  item, onClose, initialCaption = '',
}: { item: WalmartQuickPostItem; onClose: () => void; initialCaption?: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(QUICK_PLATFORMS.map((p) => p.key)))
  const [caption, setCaption] = useState(initialCaption)
  const [posting, setPosting] = useState(false)
  const [results, setResults] = useState<PostResult[] | null>(null)
  const [linkNote, setLinkNote] = useState<string | null>(null)

  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  const post = async () => {
    if (selected.size === 0) { toast.error('Pick at least one destination.'); return }
    setPosting(true); setResults(null); setLinkNote(null)
    try {
      const res = await fetch('/api/walmart/social-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.itemId, name: item.name, imageUrl: item.imageUrl, url: item.url,
          platforms: [...selected], caption: caption.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok && !Array.isArray(data.results)) { toast.error(data.error || 'Could not post.'); return }
      const posted = data.results as PostResult[]
      setResults(posted)
      const note = typeof data.geniuslinkNote === 'string' ? data.geniuslinkNote : null
      setLinkNote(note)
      const okCount = posted.filter((r) => r.ok).length
      if (okCount > 0) toast.success(`Posted to ${okCount} platform${okCount > 1 ? 's' : ''}.`)
      if (data.caption && !caption) setCaption(data.caption)
      if (okCount > 0 && okCount === posted.length && !note) setTimeout(onClose, 900)
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
            {item.imageUrl && <img src={item.imageUrl} alt="" className="h-16 w-16 object-contain rounded border bg-white shrink-0" />}
            <div className="text-sm font-medium line-clamp-3">{item.name}</div>
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

          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">Caption <span className="font-normal">(leave blank to auto-write)</span></div>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3}
              placeholder="We'll write a price-safe caption for you, or type your own…"
              className="w-full text-sm rounded-lg border bg-background p-2.5 resize-none" />
            <p className="text-[11px] text-muted-foreground mt-1">Your Walmart affiliate link and an #ad disclosure are added automatically. We avoid quoting a specific price so the post stays accurate over time.</p>
          </div>

          {results && (
            <div className="space-y-1.5">
              {results.map((r) => (
                <div key={r.platform} className="flex items-center gap-2 text-sm">
                  {r.ok ? <Check size={15} className="text-emerald-600" /> : <AlertCircle size={15} className="text-red-600" />}
                  <span className="capitalize font-medium">{QUICK_PLATFORMS.find((p) => p.key === r.platform)?.label || r.platform}</span>
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
              <span>Your link still earns, but we couldn&apos;t shorten via Geniuslink this time. Reason: {linkNote}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <Button size="sm" onClick={post} disabled={posting || selected.size === 0}>
            {posting ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Posting…</> : <><Send size={14} className="mr-1.5" /> Post now</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
