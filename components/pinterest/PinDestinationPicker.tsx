// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Pin links to", right where a pin is made (Deal Radar's post window, the
// Amazon Pinterest composer). It opens on the creator's saved choice and a
// change is saved at once (migration 382), so MVP remembers it for every pin
// after, here and on the Brand page, until they pick something else.
//
// It says whether the change was saved. A save that failed says so, and the
// pin then follows the choice that is actually stored, which is shown.
'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { PinProductDest } from '@/lib/pinterest-destination'

const CHOICES: Array<{ value: PinProductDest; label: string; note: string }> = [
  { value: 'auto', label: 'Automatic', note: 'Your blog post about the product if there is one, else its page on your Link in Bio, else Amazon.' },
  { value: 'blog_post', label: 'My blog post', note: 'Your blog post about this product. With no post yet, the next choice in Automatic is used.' },
  { value: 'link_in_bio', label: 'Product page on Link in Bio', note: 'A page for this one product on your Link in Bio, with your link on its buy button. MVP adds the product to the page first.' },
  { value: 'amazon', label: 'Amazon directly', note: 'The full amazon.com product link with your tag. No country routing: everyone lands on amazon.com.' },
]

export default function PinDestinationPicker({ onBusy }: { onBusy?: (busy: boolean) => void }) {
  const [value, setValue] = useState<PinProductDest | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/pinterest/settings').then((r) => r.json()).then((j) => setValue((j.pref as PinProductDest) || 'auto')).catch(() => setValue('auto'))
  }, [])

  async function choose(next: PinProductDest) {
    const prev = value
    setValue(next); setSaving(true); setNote(null); onBusy?.(true)
    try {
      const r = await fetch('/api/pinterest/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pref: next }) })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.ok) setNote({ ok: true, text: 'Saved. Your pins link here from now on.' })
      else { setValue(prev); setNote({ ok: false, text: `${j.error || 'Not saved.'} Pins still follow the choice shown.` }) }
    } catch {
      setValue(prev); setNote({ ok: false, text: 'Could not reach the server. Not saved; pins still follow the choice shown.' })
    } finally { setSaving(false); onBusy?.(false) }
  }

  const current = CHOICES.find((c) => c.value === value)
  return (
    <div className="mt-2 rounded-lg border border-[var(--border-2,#e5e5e7)] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold">Pin links to</span>
        {value === null ? <Loader2 size={12} className="animate-spin text-muted-foreground" /> : (
          <select value={value} disabled={saving} onChange={(e) => void choose(e.target.value as PinProductDest)}
            className="text-[12px] rounded-md border border-[var(--border-2,#e5e5e7)] bg-transparent px-2 py-1">
            {CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        )}
        {saving && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
      </div>
      {current && <p className="text-[11px] text-muted-foreground mt-1">{current.note} Pinterest does not accept short or redirect links, so pins never use them.</p>}
      {note && <p className={`text-[11px] mt-1 ${note.ok ? 'text-[#248a3d]' : 'text-[#d70015]'}`}>{note.text}</p>}
    </div>
  )
}
