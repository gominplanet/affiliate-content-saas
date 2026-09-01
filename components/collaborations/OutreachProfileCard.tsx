'use client'

/**
 * OutreachProfileCard — the reusable "Brand Outreach Profile" saved once and
 * replayed on every Creator Connections "Message Brand" draft (SCOUT ✍️ Draft +
 * the /epc Message modal). Greeting / credibility / offer / categories /
 * portfolio links / sample-shipping details live on brand_profiles.outreach_profile
 * (migration 155) so the message matches the creator's proven multi-message
 * template without hand-editing. Self-contained: loads + saves via
 * /api/collaborations/profile.
 */

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2, Save, Send, ChevronDown, ChevronRight } from 'lucide-react'

interface Profile {
  greetingStyle: string
  intro: string
  offer: string
  categories: string[]
  youtube: string
  blog: string
  linktree: string
  storefrontUrl: string
  shipName: string
  shipAddress: string
  phone: string
  email: string
  signoff: string
}

const EMPTY: Profile = {
  greetingStyle: '', intro: '', offer: '', categories: [],
  youtube: '', blog: '', linktree: '', storefrontUrl: '',
  shipName: '', shipAddress: '', phone: '', email: '', signoff: '',
}

// Greeting presets — {brand} is filled in per message. First is warm/OINK-style.
const GREETINGS = [
  'Hey {brand}, you may or may not know us from our Amazon storefront —',
  'Hi {brand} team,',
  'Hello {brand}, thanks for running this campaign —',
]

// Common creator categories to tick (plus any already saved).
const CATEGORIES = [
  'Home & Kitchen', 'Tech', 'Outdoors', 'Sports', 'Beauty', 'Health & Household',
  'Musical Instruments', 'Office Products', 'Tools', 'Pet Supplies', 'Toys & Games',
  'Automotive', 'Baby', 'Garden', 'Grocery',
]

export default function OutreachProfileCard({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [p, setP] = useState<Profile>(EMPTY)
  const [open, setOpen] = useState(defaultOpen)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/collaborations/profile')
        const d = await res.json().catch(() => ({}))
        if (alive && d?.outreachProfile && typeof d.outreachProfile === 'object') {
          setP({ ...EMPTY, ...d.outreachProfile, categories: Array.isArray(d.outreachProfile.categories) ? d.outreachProfile.categories : [] })
        }
      } catch { /* leave empty */ } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [])

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP(prev => ({ ...prev, [k]: v }))
  const toggleCat = (c: string) => setP(prev => ({
    ...prev,
    categories: prev.categories.includes(c) ? prev.categories.filter(x => x !== c) : [...prev.categories, c],
  }))

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/collaborations/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outreachProfile: p }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Save failed') }
      toast.success('Outreach profile saved — every brand message now uses it.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }, [p])

  const allCats = Array.from(new Set([...CATEGORIES, ...p.categories]))
  const label = 'block text-xs font-medium mb-1'
  const labelStyle = { color: 'var(--text-2)' } as React.CSSProperties
  const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none'
  const inputStyle = { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' } as React.CSSProperties

  return (
    <div className="rounded-2xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2.5 p-4 text-left">
        <span className="grid place-items-center w-9 h-9 rounded-xl shrink-0" style={{ background: 'rgba(124,58,237,0.12)', color: '#9D6BFF' }}>
          <Send size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Brand Outreach Profile</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>Saved once, used on every &quot;Message Brand&quot; draft — greeting, credibility, offer, links &amp; sample address.</p>
        </div>
        {open ? <ChevronDown size={18} style={{ color: 'var(--text-2)' }} /> : <ChevronRight size={18} style={{ color: 'var(--text-2)' }} />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3.5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          {loading ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-2)' }}><Loader2 size={15} className="animate-spin" /> Loading…</div>
          ) : (
            <>
              <div>
                <label className={label} style={labelStyle}>Greeting <span style={{ color: 'var(--text-faint)' }}>({'{brand}'} is filled in per message)</span></label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {GREETINGS.map(g => (
                    <button key={g} type="button" onClick={() => set('greetingStyle', g)}
                      className="text-[11px] px-2 py-1 rounded-md border"
                      style={{ borderColor: p.greetingStyle === g ? '#7C3AED' : 'var(--border)', color: p.greetingStyle === g ? '#9D6BFF' : 'var(--text-2)' }}>
                      {g.length > 42 ? g.slice(0, 42) + '…' : g}
                    </button>
                  ))}
                </div>
                <input value={p.greetingStyle} onChange={e => set('greetingStyle', e.target.value)} placeholder="Or write your own greeting…" className={inputCls} style={inputStyle} />
              </div>

              <div>
                <label className={label} style={labelStyle}>Who you are / credibility <span style={{ color: 'var(--text-faint)' }}>(must be true — goes out verbatim)</span></label>
                <textarea value={p.intro} onChange={e => set('intro', e.target.value)} rows={2}
                  placeholder="e.g. We're Seb & Michelle from Gominplanet — Top Platinum Level Influencers since 2022 with 6,000+ video reviews and 4,000+ brand collaborations."
                  className={inputCls} style={inputStyle} />
              </div>

              <div>
                <label className={label} style={labelStyle}>What you offer the brand</label>
                <textarea value={p.offer} onChange={e => set('offer', e.target.value)} rows={2}
                  placeholder="e.g. High-quality video reviews that drive Creator Connections sales; open to many products across categories."
                  className={inputCls} style={inputStyle} />
              </div>

              <div>
                <label className={label} style={labelStyle}>Categories you cover</label>
                <div className="flex flex-wrap gap-1.5">
                  {allCats.map(c => (
                    <button key={c} type="button" onClick={() => toggleCat(c)}
                      className="text-[11px] px-2 py-1 rounded-full border"
                      style={{ borderColor: p.categories.includes(c) ? '#7C3AED' : 'var(--border)', background: p.categories.includes(c) ? 'rgba(124,58,237,0.12)' : 'transparent', color: p.categories.includes(c) ? '#9D6BFF' : 'var(--text-2)' }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className={label} style={labelStyle}>YouTube</label><input value={p.youtube} onChange={e => set('youtube', e.target.value)} placeholder="youtube.com/@…" className={inputCls} style={inputStyle} /></div>
                <div><label className={label} style={labelStyle}>Blog / website</label><input value={p.blog} onChange={e => set('blog', e.target.value)} placeholder="www.…" className={inputCls} style={inputStyle} /></div>
                <div><label className={label} style={labelStyle}>Portfolio / Linktree</label><input value={p.linktree} onChange={e => set('linktree', e.target.value)} placeholder="linktr.ee/…" className={inputCls} style={inputStyle} /></div>
                <div><label className={label} style={labelStyle}>Amazon storefront</label><input value={p.storefrontUrl} onChange={e => set('storefrontUrl', e.target.value)} placeholder="amazon.com/shop/…" className={inputCls} style={inputStyle} /></div>
              </div>

              <div className="pt-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-faint)' }}>Sample shipping (sent as its own message when you request a sample)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className={label} style={labelStyle}>Ship-to NAME (exact)</label><input value={p.shipName} onChange={e => set('shipName', e.target.value)} placeholder="FULL NAME - STM" className={inputCls} style={inputStyle} /></div>
                  <div><label className={label} style={labelStyle}>Phone</label><input value={p.phone} onChange={e => set('phone', e.target.value)} placeholder="(305) …" className={inputCls} style={inputStyle} /></div>
                  <div className="sm:col-span-2"><label className={label} style={labelStyle}>Address (exact)</label><input value={p.shipAddress} onChange={e => set('shipAddress', e.target.value)} placeholder="9505 NW 108th Ave. Medley, FL, 33178-2508" className={inputCls} style={inputStyle} /></div>
                  <div><label className={label} style={labelStyle}>Email</label><input value={p.email} onChange={e => set('email', e.target.value)} placeholder="you@…" className={inputCls} style={inputStyle} /></div>
                  <div><label className={label} style={labelStyle}>Sign off as</label><input value={p.signoff} onChange={e => set('signoff', e.target.value)} placeholder="Seb and Michelle" className={inputCls} style={inputStyle} /></div>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button onClick={save} disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60 transition-colors">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save outreach profile
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
