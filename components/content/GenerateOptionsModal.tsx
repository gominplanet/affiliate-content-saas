'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GenerateOptionsModal — the pre-flight options a creator picks BEFORE a post is
// generated, instead of firing on click. Reusable across the generate buttons
// (Levanta first). Returns a plain options object; the caller passes it to its
// generate endpoint. Social availability reuses /api/blog/autopilot (tier +
// connected gating), so a creator can only pick channels that will actually fire.

import { useEffect, useState } from 'react'
import { X, Loader2, Sparkles, FileText, Image as ImageIcon, Share2, Rocket } from 'lucide-react'

export interface GenerateOptions {
  publish: 'live' | 'draft'
  format: 'review' | 'guide' | 'listicle'
  length: 'standard' | 'deep'
  heroStyle: 'scene' | 'photo'
  socials: string[]
}

const DEFAULTS: GenerateOptions = { publish: 'draft', format: 'review', length: 'standard', heroStyle: 'scene', socials: [] }

const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook', twitter: 'X', threads: 'Threads', linkedin: 'LinkedIn',
  bluesky: 'Bluesky', telegram: 'Telegram', pinterest: 'Pinterest',
}
const SOCIAL_ORDER = ['facebook', 'twitter', 'threads', 'linkedin', 'bluesky', 'telegram', 'pinterest']

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ v: T; label: string; hint?: string }> }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map(o => {
        const on = value === o.v
        return (
          <button key={o.v} type="button" onClick={() => onChange(o.v)}
            className="rounded-lg border px-2.5 py-2 text-left transition"
            style={{ borderColor: on ? '#7C3AED' : 'var(--border-2,#e5e5e7)', background: on ? 'rgba(124,58,237,0.08)' : 'transparent' }}>
            <div className="text-[12.5px] font-semibold" style={{ color: on ? '#7C3AED' : 'var(--text,#1d1d1f)' }}>{o.label}</div>
            {o.hint && <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-faint,#86868b)' }}>{o.hint}</div>}
          </button>
        )
      })}
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft,#6e6e73)' }}>
        {icon} {title}
      </div>
      {children}
    </div>
  )
}

export default function GenerateOptionsModal({
  productTitle, busy = false, initial, onClose, onConfirm,
}: {
  productTitle?: string | null
  busy?: boolean
  initial?: Partial<GenerateOptions>
  onClose: () => void
  onConfirm: (opts: GenerateOptions) => void
}) {
  const [opts, setOpts] = useState<GenerateOptions>({ ...DEFAULTS, ...initial })
  const [tierSocials, setTierSocials] = useState<string[]>([])
  const [connected, setConnected] = useState<string[]>([])
  const [loadingSocials, setLoadingSocials] = useState(true)

  useEffect(() => {
    fetch('/api/blog/autopilot').then(r => r.json()).then(d => {
      if (Array.isArray(d.tierSocials)) setTierSocials(d.tierSocials)
      if (Array.isArray(d.connectedSocials)) setConnected(d.connectedSocials)
    }).catch(() => {}).finally(() => setLoadingSocials(false))
  }, [])

  const set = <K extends keyof GenerateOptions>(k: K, v: GenerateOptions[K]) => setOpts(o => ({ ...o, [k]: v }))
  const usableSocials = SOCIAL_ORDER.filter(s => tierSocials.includes(s) && connected.includes(s))
  const toggleSocial = (s: string) => set('socials', opts.socials.includes(s) ? opts.socials.filter(x => x !== s) : [...opts.socials, s])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[90vh] bg-white dark:bg-[#18181b]" style={{ border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div className="shrink-0 flex items-start justify-between px-5 pt-5 pb-3 border-b" style={{ borderColor: 'var(--border-2,#e5e5e7)' }}>
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-[#7C3AED]" />
            <div>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text,#1d1d1f)' }}>Post options</h3>
              {productTitle && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--text-faint,#86868b)' }}>{productTitle}</p>}
            </div>
          </div>
          <button onClick={onClose} disabled={busy} className="p-1 disabled:opacity-40" style={{ color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <Section icon={<FileText size={12} />} title="Format">
            <Seg value={opts.format} onChange={v => set('format', v)} options={[
              { v: 'review', label: 'Review', hint: 'Verdict + who it suits' },
              { v: 'guide', label: 'Buying guide', hint: 'What to look for' },
              { v: 'listicle', label: 'Listicle', hint: 'Scannable highlights' },
            ]} />
          </Section>

          <Section icon={<FileText size={12} />} title="Length">
            <Seg value={opts.length} onChange={v => set('length', v)} options={[
              { v: 'standard', label: 'Standard' },
              { v: 'deep', label: 'In-depth', hint: 'Longer, more detail' },
            ]} />
          </Section>

          <Section icon={<ImageIcon size={12} />} title="Hero image">
            <Seg value={opts.heroStyle} onChange={v => set('heroStyle', v)} options={[
              { v: 'scene', label: 'AI scene', hint: 'Styled lifestyle shot' },
              { v: 'photo', label: 'Real photo', hint: "The product's own image" },
            ]} />
          </Section>

          <Section icon={<Share2 size={12} />} title="Also post to socials">
            {loadingSocials ? (
              <div className="text-[12px] flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}><Loader2 size={12} className="animate-spin" /> Checking your channels…</div>
            ) : usableSocials.length === 0 ? (
              <p className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>No connected channels on your plan yet. <a href="/connect-socials" className="text-[#7C3AED] font-medium">Connect some</a> to auto-post.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {usableSocials.map(s => {
                  const on = opts.socials.includes(s)
                  return (
                    <button key={s} type="button" onClick={() => toggleSocial(s)}
                      className="rounded-lg border px-2 py-1.5 text-[12px] font-medium transition"
                      style={{ borderColor: on ? '#7C3AED' : 'var(--border-2,#e5e5e7)', background: on ? 'rgba(124,58,237,0.08)' : 'transparent', color: on ? '#7C3AED' : 'var(--text-soft,#6e6e73)' }}>
                      {SOCIAL_LABELS[s] || s}
                    </button>
                  )
                })}
              </div>
            )}
            {opts.socials.length > 0 && opts.publish === 'draft' && (
              <p className="text-[10.5px] mt-1.5" style={{ color: '#b45309' }}>Socials only fire when the post publishes live — switch Publish to Live below.</p>
            )}
          </Section>

          <Section icon={<Rocket size={12} />} title="Publish">
            <Seg value={opts.publish} onChange={v => set('publish', v)} options={[
              { v: 'draft', label: 'Save as draft', hint: 'Review in WP first' },
              { v: 'live', label: 'Publish live', hint: 'Goes public now' },
            ]} />
          </Section>
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: 'var(--border-2,#e5e5e7)' }}>
          <button onClick={onClose} disabled={busy} className="px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ color: 'var(--text-soft)' }}>Cancel</button>
          <button onClick={() => onConfirm(opts)} disabled={busy}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 inline-flex items-center gap-1.5">
            {busy ? <><Loader2 size={13} className="animate-spin" /> Generating…</> : <><Sparkles size={13} /> Generate post</>}
          </button>
        </div>
      </div>
    </div>
  )
}
