'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Passport Links settings for Brand Profile: turn on MVP's geo-routing links and
// enter the creator's Amazon tag for each country they're an Associate in. The US
// tag is the main Associates tag (set just above this card); here they add the
// others. Anything left blank falls back to the US tag, so no click is wasted.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Globe } from 'lucide-react'

// The countries we route to, most common first. US is the main Associates tag,
// so it isn't listed here.
// The full set of Amazon markets OneLink covers (US is the main tag, set above).
const COUNTRIES: { code: string; label: string; flag: string; example: string }[] = [
  { code: 'AU', label: 'Australia', flag: '🇦🇺', example: 'brand-22' },
  { code: 'CA', label: 'Canada', flag: '🇨🇦', example: 'brand-20' },
  { code: 'FR', label: 'France', flag: '🇫🇷', example: 'brand-21' },
  { code: 'DE', label: 'Germany', flag: '🇩🇪', example: 'brand-21' },
  { code: 'IN', label: 'India', flag: '🇮🇳', example: 'brand-21' },
  { code: 'IE', label: 'Ireland', flag: '🇮🇪', example: 'brand-21' },
  { code: 'IT', label: 'Italy', flag: '🇮🇹', example: 'brand-21' },
  { code: 'NL', label: 'Netherlands', flag: '🇳🇱', example: 'brand-21' },
  { code: 'SG', label: 'Singapore', flag: '🇸🇬', example: 'brand-22' },
  { code: 'ES', label: 'Spain', flag: '🇪🇸', example: 'brand-21' },
  { code: 'SE', label: 'Sweden', flag: '🇸🇪', example: 'brand-21' },
  { code: 'GB', label: 'United Kingdom', flag: '🇬🇧', example: 'brand-21' },
]

export default function PassportLinksCard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [usTag, setUsTag] = useState('')
  const [tags, setTags] = useState<Record<string, string>>({})
  const [linkBase, setLinkBase] = useState('')

  useEffect(() => {
    fetch('/api/passport').then((r) => r.json()).then((d) => {
      if (d?.ok) {
        setUsTag((d.usTag as string) || '')
        setTags((d.countryTags as Record<string, string>) || {})
        setLinkBase((d.linkBase as string) || '')
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      // Only the per-country tags — the on/off flag is owned by the big toggle.
      const res = await fetch('/api/passport', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countryTags: tags }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) { toast.error(d.error || 'Could not save your country tags.'); return }
      toast.success('Country tags saved.')
    } catch {
      toast.error('Could not save your country tags.')
    } finally { setSaving(false) }
  }

  const setTag = (code: string, val: string) =>
    setTags((prev) => { const n = { ...prev }; if (val.trim()) n[code] = val.trim(); else delete n[code]; return n })

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#7C3AED]/10 flex-shrink-0">
          <Globe size={16} className="text-[#7C3AED]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your Amazon tag per country</p>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">So each visitor earns you commission in their own store</p>
        </div>
      </div>

      <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mb-3 leading-relaxed">
        Enter your Associates tag for each country you&rsquo;re signed up in. The US uses your main tag{usTag ? <> (<code className="bg-[#f5f5f7] dark:bg-[#1c1c1e] px-1 py-0.5 rounded text-[10px]">{usTag}</code>)</> : ' set above'}. Any country you leave blank falls back to the US, so nothing is ever lost.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-[#86868b] py-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          {/* Country tags */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {COUNTRIES.map((c) => (
              <div key={c.code}>
                <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">{c.flag} {c.label}</label>
                <input
                  type="text" value={tags[c.code] || ''} onChange={(e) => setTag(c.code, e.target.value)}
                  placeholder={`e.g. ${c.example}`} className="input-field text-xs font-mono w-full"
                />
              </div>
            ))}
          </div>

          <p className="text-[10.5px] text-[#86868b] dark:text-[#8e8e93] mt-2 leading-relaxed">
            Don&rsquo;t have an account in a country? Leave it blank. You only earn abroad in programs you&rsquo;ve actually joined at Amazon Associates, so sign up there first, then add the tag here.
            {linkBase ? <> Your links will look like <code className="bg-[#f5f5f7] dark:bg-[#1c1c1e] px-1 py-0.5 rounded text-[10px]">{linkBase.replace(/^https?:\/\//, '')}/x7k</code>.</> : null}
          </p>

          <div className="mt-3">
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: '#7C3AED' }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null} Save country tags
            </button>
          </div>
        </>
      )}
    </div>
  )
}
