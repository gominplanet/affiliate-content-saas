'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Passport Links settings for Brand Profile: turn on MVP's geo-routing links and
// enter the creator's Amazon tag for each country they're an Associate in. The US
// tag is the main Associates tag (set just above this card); here they add the
// others. Anything left blank falls back to the US tag, so no click is wasted.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Globe, Check } from 'lucide-react'

// The countries we route to, most common first. US is the main Associates tag,
// so it isn't listed here.
const COUNTRIES: { code: string; label: string; flag: string; example: string }[] = [
  { code: 'GB', label: 'United Kingdom', flag: '🇬🇧', example: 'brand-21' },
  { code: 'CA', label: 'Canada', flag: '🇨🇦', example: 'brand-20' },
  { code: 'DE', label: 'Germany', flag: '🇩🇪', example: 'brand-21' },
  { code: 'FR', label: 'France', flag: '🇫🇷', example: 'brand-21' },
  { code: 'IT', label: 'Italy', flag: '🇮🇹', example: 'brand-21' },
  { code: 'ES', label: 'Spain', flag: '🇪🇸', example: 'brand-21' },
  { code: 'AU', label: 'Australia', flag: '🇦🇺', example: 'brand-22' },
  { code: 'JP', label: 'Japan', flag: '🇯🇵', example: 'brand-22' },
]

export default function PassportLinksCard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [usTag, setUsTag] = useState('')
  const [tags, setTags] = useState<Record<string, string>>({})
  const [linkBase, setLinkBase] = useState('')

  useEffect(() => {
    fetch('/api/passport').then((r) => r.json()).then((d) => {
      if (d?.ok) {
        setEnabled(!!d.enabled)
        setUsTag((d.usTag as string) || '')
        setTags((d.countryTags as Record<string, string>) || {})
        setLinkBase((d.linkBase as string) || '')
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/passport', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, countryTags: tags }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) { toast.error(d.error || 'Could not save Passport Links.'); return }
      toast.success('Passport Links saved.')
    } catch {
      toast.error('Could not save Passport Links.')
    } finally { setSaving(false) }
  }

  const setTag = (code: string, val: string) =>
    setTags((prev) => { const n = { ...prev }; if (val.trim()) n[code] = val.trim(); else delete n[code]; return n })

  const filledCount = Object.keys(tags).length

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 mt-3">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#7C3AED]/10 flex-shrink-0">
          <Globe size={16} className="text-[#7C3AED]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Passport Links <span className="text-[10px] font-medium align-middle ml-1 px-1.5 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}>Geo-routing</span></p>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Send every shopper to their own country&rsquo;s Amazon, and earn there</p>
        </div>
        {enabled && filledCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-[#34c759] flex-shrink-0"><Check size={12} /> On</span>
        )}
      </div>

      <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mb-3 leading-relaxed">
        When on, MVP puts one smart link in your posts that reads each visitor&rsquo;s country and forwards them to their local Amazon store with your tag there (a UK reader lands on Amazon UK, and so on). It replaces needing Geniuslink or any WordPress setup. Enter your Associates tag for each country you&rsquo;re signed up in below. The US uses your main tag{usTag ? <> (<code className="bg-[#f5f5f7] dark:bg-[#1c1c1e] px-1 py-0.5 rounded text-[10px]">{usTag}</code>)</> : ' set above'}. Any country you leave blank falls back to the US, so nothing is ever lost.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-[#86868b] py-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          {/* Master toggle */}
          <label className="flex items-center gap-2 mb-3 cursor-pointer select-none">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4 accent-[#7C3AED]" />
            <span className="text-[12.5px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Use Passport Links for my blog and social posts</span>
          </label>

          {/* Country tags */}
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
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

          {enabled && (
            <p className="text-[10.5px] text-[#86868b] dark:text-[#8e8e93] mt-2 leading-relaxed">
              Don&rsquo;t have an account in a country? Leave it blank. You only earn abroad in programs you&rsquo;ve actually joined at Amazon Associates, so sign up there first, then add the tag here.
              {linkBase ? <> Your links will look like <code className="bg-[#f5f5f7] dark:bg-[#1c1c1e] px-1 py-0.5 rounded text-[10px]">{linkBase.replace(/^https?:\/\//, '')}/go/…</code>.</> : null}
            </p>
          )}

          <div className="mt-3">
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: '#7C3AED' }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null} Save Passport Links
            </button>
          </div>
        </>
      )}
    </div>
  )
}
