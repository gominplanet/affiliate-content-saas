// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Bulk-schedule modal for Deal Radar. Given the deals a user multi-selected,
// pick the socials, a start time, and an interval, and queue them all at once,
// staggered (deal i fires at firstAt + i × intervalMins). One POST to
// /api/deal-radar/bulk-schedule inserts the whole batch; captions are written by
// the cron at fire time, and any deal that has ended by then is skipped.

'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, X as CloseIcon, Loader2, Check, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QUICK_PLATFORMS, type QuickPostDeal } from '@/components/deal/QuickPostModal'

const INTERVALS: { value: number; label: string }[] = [
  { value: 5, label: '5 minutes apart' },
  { value: 15, label: '15 minutes apart' },
  { value: 30, label: '30 minutes apart' },
  { value: 60, label: '1 hour apart' },
  { value: 180, label: '3 hours apart' },
  { value: 360, label: '6 hours apart' },
  { value: 720, label: '12 hours apart' },
  { value: 1440, label: '1 day apart' },
]

// Default: 2 hours out, on the minute, formatted for datetime-local (local time).
const pad = (n: number) => String(n).padStart(2, '0')
function defaultStart(): string {
  const d = new Date(Date.now() + 2 * 3600_000)
  d.setSeconds(0, 0)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmt(ms: number): string {
  const d = new Date(ms)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function BulkScheduleDealsModal({
  deals, onClose, onScheduled,
}: {
  deals: QuickPostDeal[]
  onClose: () => void
  onScheduled: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(QUICK_PLATFORMS.map((p) => p.key)))
  const [firstAt, setFirstAt] = useState<string>(defaultStart())
  const [intervalMins, setIntervalMins] = useState<number>(30)
  const [saving, setSaving] = useState(false)

  const toggle = (key: string) => setSelected((s) => {
    const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n
  })

  const firstMs = new Date(firstAt).getTime()
  const lastMs = firstMs + (deals.length - 1) * intervalMins * 60_000

  const submit = async () => {
    if (selected.size === 0) { toast.error('Pick at least one platform.'); return }
    if (isNaN(firstMs)) { toast.error('Pick a valid start time.'); return }
    if (firstMs < Date.now()) { toast.error('Pick a start time in the future.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/deal-radar/bulk-schedule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deals: deals.map((d) => ({ asin: d.asin, title: d.title, imageUrl: d.imageUrl })),
          platforms: [...selected],
          firstAt: new Date(firstMs).toISOString(),
          intervalMins,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { toast.error(data.error || 'Could not schedule those posts.'); return }
      toast.success(`Scheduled ${data.scheduled} deal${data.scheduled === 1 ? '' : 's'}, ${fmt(new Date(data.firstAt).getTime())} to ${fmt(new Date(data.lastAt).getTime())}.`)
      onScheduled()
      onClose()
    } catch {
      toast.error('Could not schedule those posts.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => { if (!saving) onClose() }}>
      <div className="bg-white dark:bg-[#16161a] rounded-xl border shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2 font-semibold"><CalendarClock size={16} /> Schedule {deals.length} deal{deals.length === 1 ? '' : 's'}</div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><CloseIcon size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5">Post each to</div>
            <div className="flex flex-wrap gap-2">
              {QUICK_PLATFORMS.map((p) => (
                <button key={p.key} onClick={() => toggle(p.key)}
                  className={`text-sm rounded-lg border px-3 py-1.5 ${selected.has(p.key) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'}`}>
                  {selected.has(p.key) && <Check size={12} className="inline mr-1" />}{p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">First deal at</div>
              <input
                type="datetime-local" value={firstAt} min={defaultStart()}
                onChange={(e) => setFirstAt(e.target.value)}
                className="w-full text-sm rounded-lg border bg-background p-2.5"
              />
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1.5">Spaced</div>
              <select
                value={intervalMins} onChange={(e) => setIntervalMins(Number(e.target.value))}
                className="w-full text-sm rounded-lg border bg-background p-2.5"
              >
                {INTERVALS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 border p-3 text-[12px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">{deals.length}</span> deal{deals.length === 1 ? '' : 's'} to{' '}
            <span className="font-semibold text-foreground">{selected.size}</span> platform{selected.size === 1 ? '' : 's'}.
            First fires <span className="font-semibold text-foreground">{fmt(firstMs)}</span>, last fires{' '}
            <span className="font-semibold text-foreground">{fmt(lastMs)}</span>. Each caption is written when it posts.
          </div>

          <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#7C3AED' }}>
            <Info size={14} className="shrink-0" />
            <span>We only post each deal if it&apos;s still live at its scheduled time.</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={saving || selected.size === 0}
            className="bg-red-600 hover:bg-red-700 text-white">
            {saving ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Scheduling…</> : <><CalendarClock size={14} className="mr-1.5" /> Schedule all</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
