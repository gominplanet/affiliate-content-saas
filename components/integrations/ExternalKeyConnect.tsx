// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Inline "connect your API key" panel for an external affiliate network
// (Levanta, PartnerBoost). Lives at the TOP of each partner page so the key is
// entered right where it's used. Collapses to a slim "connected" bar once a key
// is saved; click "Replace key" to re-expand. Keys are stored encrypted
// server-side via /api/integrations/external — we only ever read back a masked
// last-4. Renders nothing while checking, or if the API forbids (the page shows
// its own paid-plan lock in that case).

'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ShoppingBag, Store, ExternalLink, Loader2, CheckCircle2, Trash2, Plug, Pencil, X } from 'lucide-react'

const CYAN = '#0E7490'

type Provider = 'levanta' | 'partnerboost'

const META: Record<Provider, { name: string; icon: ReactNode; where: string; dash: string; blurb: string }> = {
  levanta: {
    name: 'Levanta',
    icon: <ShoppingBag size={16} />,
    where: 'Levanta → Settings → API → Generate API Key',
    dash: 'https://app.levanta.io/',
    blurb: 'Paste your Levanta Creator API key to connect your account. Stored encrypted server-side — we only ever show the last 4 digits.',
  },
  partnerboost: {
    name: 'PartnerBoost',
    icon: <Store size={16} />,
    where: 'PartnerBoost → Tools → API token',
    dash: 'https://app.partnerboost.com/',
    blurb: 'Paste your PartnerBoost API token to connect your account. Stored encrypted server-side — we only ever show the last 4 digits.',
  },
}

interface Props { provider: Provider; onConnected?: () => void }

export default function ExternalKeyConnect({ provider, onConnected }: Props) {
  const m = META[provider]
  const [status, setStatus] = useState<{ connected: boolean; last4: string | null; viaEnv: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/integrations/external')
      if (res.status === 403) { setForbidden(true); return }
      const j = await res.json()
      if (j.ok) setStatus(j.status?.[provider] ?? { connected: false, last4: null, viaEnv: false })
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [provider])
  useEffect(() => { load() }, [load])

  async function save() {
    const key = draft.trim()
    if (!key) return
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/integrations/external', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key }),
      })
      const j = await res.json()
      if (!j.ok) { setMsg(j.error || 'Could not save'); return }
      setDraft(''); setEditing(false)
      await load()
      onConnected?.()
    } catch { setMsg('Network error') } finally { setBusy(false) }
  }

  async function disconnect() {
    setBusy(true)
    try {
      await fetch('/api/integrations/external', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      setEditing(false)
      await load()
      onConnected?.()
    } catch { /* ignore */ } finally { setBusy(false) }
  }

  // Quiet while checking; the page renders its own paid-plan lock on 403.
  if (loading || forbidden) return null

  const connected = !!status && (status.connected || status.viaEnv)
  const showForm = !connected || editing

  return (
    <div className="rounded-xl border mb-4"
      style={{ background: 'var(--surface)', borderColor: connected && !editing ? 'rgba(16,185,129,0.35)' : 'rgba(34,211,238,0.35)' }}>
      {!showForm ? (
        // Collapsed "connected" bar.
        <div className="flex items-center gap-2 p-3 flex-wrap">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(16,185,129,0.14)', color: '#10B981' }}><CheckCircle2 size={15} /></span>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
            {m.name} connected
            {status?.last4 ? <span style={{ color: 'var(--text-soft)', fontWeight: 400 }}> ••••{status.last4}</span> : null}
          </span>
          {status?.viaEnv && (
            <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-bright)', color: 'var(--text-soft)' }}>shared key</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => { setEditing(true); setMsg('') }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold"
              style={{ background: 'var(--surface-bright)', color: 'var(--text)' }}>
              <Pencil size={12} /> Replace key
            </button>
            {!status?.viaEnv && (
              <button onClick={disconnect} disabled={busy} title="Remove this key"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg disabled:opacity-50"
                style={{ background: 'var(--surface-bright)', color: '#ef4444' }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            )}
          </div>
        </div>
      ) : (
        // Expanded connect form.
        <div className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(34,211,238,0.12)', color: CYAN }}>{m.icon}</span>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Connect {m.name}</p>
            {editing && (
              <button onClick={() => { setEditing(false); setDraft(''); setMsg('') }} className="ml-auto" title="Cancel" style={{ color: 'var(--text-soft)' }}>
                <X size={15} />
              </button>
            )}
          </div>
          <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--text-soft)' }}>{m.blurb}</p>
          <p className="text-[11px] mb-2" style={{ color: 'var(--text-soft)' }}>
            Get your key: <span className="font-medium">{m.where}</span>{' '}
            <a href={m.dash} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium" style={{ color: CYAN }}>
              open <ExternalLink size={10} />
            </a>
          </p>
          <div className="flex items-center gap-2">
            <input type="password" autoComplete="off" value={draft}
              onChange={(e) => { setDraft(e.target.value); setMsg('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') save() }}
              placeholder={connected ? 'Paste a new key to replace' : 'Paste your API key'}
              className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-[13px] focus:outline-none"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            <button onClick={save} disabled={busy || !draft.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)' }}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <><Plug size={12} /> Connect</>}
            </button>
          </div>
          {msg && <p className="text-[12px] mt-1.5" style={{ color: '#ef4444' }}>{msg}</p>}
        </div>
      )}
    </div>
  )
}
