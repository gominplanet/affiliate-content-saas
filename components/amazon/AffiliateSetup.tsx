// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Affiliate setup for the Amazon Influencer, and the screen that was selling a
// competitor.
//
// It used to read "Geniuslink is best (it geo-routes to each visitor's local
// store)" and offered two fields: Geniuslink keys, or an Amazon tag. Passport
// Links was not on the page at all. On this tier that is three mistakes at once:
// Passport IS geo-routing, it is ours, and it is already included in the plan;
// pickLinkStyle returns 'passport' ahead of Geniuslink whenever it is on, so
// keys pasted here are ignored the moment somebody finds the toggle; and this is
// the first screen a new Amazon subscriber meets, which is where the ads land.
//
// So Passport leads, with a real switch. The status row reports what is ACTUALLY
// in force rather than what the copy hopes, which is the whole reason
// lib/amazon-link-setup exists as a separate, tested decision.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tag, Link2, Check, Loader2, X, Pencil, AlertCircle, Globe } from 'lucide-react'
import { amazonLinkStatus, amazonLinkOptions } from '@/lib/amazon-link-setup'

interface Status {
  amazonTag: string
  geniuslinkKey: string
  geniuslinkSet: boolean
  passportEnabled: boolean
  passportCanUse: boolean
  linkBase: string
}

const EMPTY: Status = { amazonTag: '', geniuslinkKey: '', geniuslinkSet: false, passportEnabled: false, passportCanUse: false, linkBase: '' }

export default function AffiliateSetup() {
  const [status, setStatus] = useState<Status | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      // Both, together: the active method depends on the Passport flag and on
      // what credentials are on file, and reading one without the other is how
      // this panel came to describe a setup nobody was using.
      const [a, p] = await Promise.all([
        fetch('/api/amazon/affiliate-setup').then(r => r.json()).catch(() => ({})),
        fetch('/api/passport').then(r => r.json()).catch(() => ({})),
      ])
      setStatus({
        amazonTag: a.amazonTag || '',
        geniuslinkKey: a.geniuslinkKey || '',
        geniuslinkSet: !!a.geniuslinkSet,
        passportEnabled: !!p.enabled,
        passportCanUse: !!p.canUse,
        linkBase: p.linkBase || '',
      })
    } catch { setStatus(EMPTY) }
  }, [])
  useEffect(() => { load() }, [load])

  const s = status ?? EMPTY
  const active = amazonLinkStatus({
    passportEnabled: s.passportEnabled,
    passportCanUse: s.passportCanUse,
    hasGeniuslink: s.geniuslinkSet,
    amazonTag: s.amazonTag,
  })

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-soft)' }}>Your affiliate links</h2>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline" style={{ color: 'var(--text-soft)' }}>
          <Pencil size={11} /> {active.style === 'none' ? 'Set up' : 'Change'}
        </button>
      </div>

      {/* ONE row: what is actually in force. Three cards side by side invited
          the reading that all three are running, which is not how it works. */}
      <div className="flex items-start gap-3 rounded-xl border p-3.5"
        style={{
          borderColor: active.earning ? 'rgba(52,199,89,0.35)' : 'rgba(217,119,6,0.4)',
          background: active.earning ? 'rgba(52,199,89,0.05)' : 'rgba(217,119,6,0.05)',
        }}>
        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: active.style === 'passport' ? '#7C3AED1a' : '#d977061a' }}>
          {active.style === 'passport'
            ? <Globe size={15} style={{ color: '#7C3AED' }} />
            : active.style === 'geniuslink'
              ? <Link2 size={15} style={{ color: '#7C3AED' }} />
              : <Tag size={15} style={{ color: '#d97706' }} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>{active.label}</span>
            {status != null && (active.earning
              ? <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[#34c759]"><Check size={11} /> Earning</span>
              : <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: '#d97706' }}><AlertCircle size={11} /> Not earning</span>)}
          </div>
          <p className="text-[11.5px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
            {status == null ? ' ' : active.detail}
          </p>
          {status != null && active.warning && (
            <p className="text-[11.5px] leading-relaxed mt-1.5 flex items-start gap-1.5" style={{ color: '#d97706' }}>
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />{active.warning}
            </p>
          )}
        </div>
      </div>

      {open && <SetupModal initial={s} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load() }} />}
    </div>
  )
}

function SetupModal({ initial, onClose, onSaved }: { initial: Status; onClose: () => void; onSaved: () => void }) {
  const [amazonTag, setAmazonTag] = useState(initial.amazonTag)
  const [geniuslinkKey, setGeniuslinkKey] = useState(initial.geniuslinkKey)
  const [geniuslinkSecret, setGeniuslinkSecret] = useState('')
  const [passport, setPassport] = useState(initial.passportEnabled)
  const [showGeni, setShowGeni] = useState(!!initial.geniuslinkSet || !!initial.geniuslinkKey)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alreadyHasSecret = initial.geniuslinkSet
  const options = amazonLinkOptions(initial.passportCanUse)

  const save = useCallback(async () => {
    setSaving(true); setError(null)
    try {
      // The tag and keys first, then the Passport flag. If the flag write fails
      // the credentials are still saved, which is the harmless half; the other
      // order could switch on geo-routing with nothing to earn with.
      const res = await fetch('/api/amazon/affiliate-setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amazonTag: amazonTag.trim(), geniuslinkKey: geniuslinkKey.trim(), geniuslinkSecret: geniuslinkSecret.trim() || undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((d.error as string) || 'Could not save. Try again.')

      if (initial.passportCanUse && passport !== initial.passportEnabled) {
        const pr = await fetch('/api/passport', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: passport }),
        })
        const pd = await pr.json().catch(() => ({}))
        // Named separately. "Saved" over a Passport switch that did not move is
        // the failure this whole file is about.
        if (!pr.ok) throw new Error((pd.error as string) || 'Your tag was saved, but Passport Links could not be switched. Try that part again.')
      }
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.') } finally { setSaving(false) }
  }, [amazonTag, geniuslinkKey, geniuslinkSecret, passport, initial.passportCanUse, initial.passportEnabled, onSaved])

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm border border-[#d2d2d7] dark:border-[#3a3a3c] bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#a1a1a6]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold" style={{ color: 'var(--text)' }}>Affiliate setup</h3>
          <button onClick={onClose} className="text-[var(--text-soft)] hover:opacity-70"><X size={18} /></button>
        </div>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          Every pin and post routes its product link through this, so it earns on your account.
        </p>

        {/* ── Passport, first ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: initial.passportCanUse ? 'rgba(124,58,237,0.35)' : undefined }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                <Globe size={13} style={{ color: '#7C3AED' }} /> {options[0].title}
                {options[0].recommended && <span className="font-normal" style={{ color: '#7C3AED' }}>(recommended)</span>}
              </span>
              <p className="text-[11.5px] leading-relaxed mt-1" style={{ color: 'var(--text-soft)' }}>{options[0].blurb}</p>
            </div>
            {initial.passportCanUse ? (
              <button
                type="button"
                role="switch"
                aria-checked={passport}
                aria-label="Passport Links"
                onClick={() => setPassport(v => !v)}
                className="relative w-11 h-6 rounded-full flex-shrink-0 transition"
                style={{ backgroundColor: passport ? '#7C3AED' : 'rgba(120,120,128,0.32)' }}
              >
                <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: passport ? '22px' : '2px' }} />
              </button>
            ) : (
              <span className="text-[10px] font-semibold whitespace-nowrap px-2 py-1 rounded-full" style={{ background: 'rgba(124,58,237,0.10)', color: '#7C3AED' }}>Paid plans</span>
            )}
          </div>
          {passport && initial.passportCanUse && !amazonTag.trim() && (
            <p className="text-[11.5px] flex items-start gap-1.5" style={{ color: '#d97706' }}>
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              Passport routes the shopper; your Associates tag is what earns. Add it below.
            </p>
          )}
        </div>

        {/* ── The tag, which every option needs ───────────────────────────── */}
        <div className="flex flex-col gap-2 rounded-xl border border-gray-200 dark:border-white/10 p-3">
          <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text)' }}><Tag size={13} style={{ color: '#d97706' }} /> {options[1].title}</span>
          <input value={amazonTag} onChange={e => setAmazonTag(e.target.value)} placeholder="yourtag-20" className={`${inputCls} font-mono`} />
          <span className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{options[1].blurb}</span>
        </div>

        {/* ── Geniuslink, folded away ─────────────────────────────────────── */}
        {!showGeni ? (
          <button onClick={() => setShowGeni(true)} className="text-[12px] text-left hover:underline" style={{ color: 'var(--text-soft)' }}>
            Already use Geniuslink? Add your keys
          </button>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-gray-200 dark:border-white/10 p-3">
            <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--text)' }}><Link2 size={13} style={{ color: '#7C3AED' }} /> {options[2].title}</span>
            <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{options[2].blurb}</p>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-soft)' }}>API key</span>
              <input value={geniuslinkKey} onChange={e => setGeniuslinkKey(e.target.value)} placeholder="Geniuslink API key" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-soft)' }}>API secret {alreadyHasSecret && <span style={{ color: '#34c759' }}>— saved, leave blank to keep</span>}</span>
              <input type="password" value={geniuslinkSecret} onChange={e => setGeniuslinkSecret(e.target.value)} placeholder={alreadyHasSecret ? '••••••••' : 'Geniuslink API secret'} className={inputCls} />
            </label>
            <a href="https://geni.us/account/api" target="_blank" rel="noreferrer" className="text-[11px] hover:underline" style={{ color: '#7C3AED' }}>Where do I find these?</a>
          </div>
        )}

        {error && <p className="text-[13px] text-[#b91c1c] dark:text-[#f87171] flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5" />{error}</p>}

        <button onClick={save} disabled={saving}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white font-semibold text-sm transition disabled:opacity-60" style={{ backgroundColor: '#d97706' }}>
          {saving ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Check size={16} /> Save</>}
        </button>
      </div>
    </div>
  )
}
