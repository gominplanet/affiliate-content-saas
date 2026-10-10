'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE HOOK TITLE CARD, CHOSEN BY THE CREATOR (Seb, 2026-10-10: "could it not
// be by default.. give users options.. maybe even give them options of hooks..
// and let them write their own"). Off until ticked. Ticked, it offers the
// clip's own hook, more written on request from what the clip says, and a box
// to write one. The chosen words go with the render; nothing else changes.

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { cleanHook, cleanHookOptions, HOOK_MAX_CHARS } from '@/lib/shorts-hooks'

export type HookChoice = { on: boolean; text: string }

export function HookPicker({ shortId, clipHook, value, onChange, disabled }: {
  shortId: string
  clipHook: string | null | undefined
  value: HookChoice | undefined
  onChange: (v: HookChoice) => void
  disabled?: boolean
}) {
  const [options, setOptions] = useState<string[]>(() => cleanHookOptions([clipHook]))
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [own, setOwn] = useState(false)
  const on = value?.on === true
  const text = value?.text ?? options[0] ?? ''

  const more = async () => {
    setLoading(true); setNote(null)
    try {
      const r = await fetch('/api/youtube/shorts/hooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shortId }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'MVP could not write more hooks just now.')
      const next = cleanHookOptions([...options, ...(Array.isArray(j.hooks) ? j.hooks : [])])
      setOptions(next)
      if (j.note) setNote(String(j.note))
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'MVP could not write more hooks just now.')
    } finally { setLoading(false) }
  }

  const chip = (h: string) => {
    const picked = !own && text === h
    return (
      <button key={h} type="button" disabled={disabled}
        onClick={() => { setOwn(false); onChange({ on: true, text: h }) }}
        className={`text-left text-[11px] rounded-lg border px-2 py-1 disabled:opacity-50 ${picked ? 'border-[#7C3AED] bg-[#7C3AED]/10 text-[#1d1d1f] dark:text-[#f5f5f7] font-semibold' : 'border-black/10 dark:border-white/15 text-[#4b4b4f] dark:text-[#b0b0b5]'}`}>
        {h}
      </button>
    )
  }

  return (
    <div className="w-full flex flex-col gap-1.5">
      <label className="inline-flex items-center gap-1.5 text-[11px] text-[#4b4b4f] dark:text-[#b0b0b5] cursor-pointer select-none" title="Show a hook as a title card over the first 2 seconds">
        <input type="checkbox" checked={on} disabled={disabled} className="accent-[#7C3AED]"
          onChange={(e) => onChange({ on: e.target.checked, text: text || options[0] || '' })} />
        Hook title for the first 2 seconds
      </label>
      {on && (
        <div className="flex flex-col gap-1.5 pl-5">
          <div className="flex flex-wrap gap-1.5">
            {options.map(chip)}
            <button type="button" onClick={more} disabled={disabled || loading}
              className="inline-flex items-center gap-1 text-[11px] rounded-lg px-2 py-1 text-[#7C3AED] hover:underline disabled:opacity-50">
              {loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {loading ? 'Writing…' : 'More hooks'}
            </button>
            <button type="button" disabled={disabled}
              onClick={() => { setOwn(true); onChange({ on: true, text: '' }) }}
              className={`text-[11px] rounded-lg border px-2 py-1 disabled:opacity-50 ${own ? 'border-[#7C3AED] bg-[#7C3AED]/10 font-semibold' : 'border-dashed border-black/20 dark:border-white/20'} text-[#4b4b4f] dark:text-[#b0b0b5]`}>
              Write my own
            </button>
          </div>
          {own && (
            <input type="text" value={text} maxLength={HOOK_MAX_CHARS} disabled={disabled} autoFocus
              onChange={(e) => onChange({ on: true, text: e.target.value })}
              onBlur={(e) => onChange({ on: true, text: cleanHook(e.target.value) })}
              placeholder="Your hook, up to 8 words"
              className="text-[12px] rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1.5 text-[#1d1d1f] dark:text-[#f5f5f7]" />
          )}
          {on && !cleanHook(text) && <p className="text-[11px] text-[#ff9500]">No hook picked yet, so the clip renders without a title card.</p>}
          {note && <p className="text-[11px] text-[#86868b]">{note}</p>}
        </div>
      )}
    </div>
  )
}
