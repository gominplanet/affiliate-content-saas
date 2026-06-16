// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// External Integrations (Labs) — Pro + admin, behind the LABS password gate.
// One place for users to connect their OWN API keys for external networks
// (Levanta, PartnerBoost, …). Keys are stored encrypted server-side; this page
// only ever shows a masked last-4. Adding a new provider = one entry in
// PROVIDERS here + lib/external-keys.ts (no migration — generic table).

'use client'

import { useCallback, useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { FlaskConical, ShoppingBag, Store, ExternalLink, Loader2, CheckCircle2, Lock, Trash2 } from 'lucide-react'

const CYAN = '#0E7490'

const PROVIDERS = [
  {
    id: 'levanta',
    name: 'Levanta',
    tool: 'MVP x Levanta',
    icon: <ShoppingBag size={16} />,
    blurb: 'Amazon creator affiliate network. Powers MVP x Levanta — browse your partnered brands and publish posts with a real commissionable link.',
    where: 'Levanta → Settings → API → Generate API Key',
    dash: 'https://app.levanta.io/',
  },
  {
    id: 'partnerboost',
    name: 'PartnerBoost',
    tool: 'MVP x PartnerBoost',
    icon: <Store size={16} />,
    blurb: 'Multi-network affiliate platform (Walmart, Amazon, DTC). Powers MVP x PartnerBoost — browse joined brands and publish posts.',
    where: 'PartnerBoost → Tools → API token',
    dash: 'https://app.partnerboost.com/',
  },
] as const

type Status = Record<string, { connected: boolean; last4: string | null; viaEnv: boolean }>

export default function ExternalIntegrationsPage() {
  const [status, setStatus] = useState<Status>({})
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/integrations/external')
      if (res.status === 403) { setForbidden(true); return }
      const j = await res.json()
      if (j.ok) setStatus(j.status || {})
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function save(provider: string) {
    const key = (drafts[provider] || '').trim()
    if (!key) return
    setBusy(provider); setMsg((m) => ({ ...m, [provider]: '' }))
    try {
      const res = await fetch('/api/integrations/external', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key }),
      })
      const j = await res.json()
      if (!j.ok) { setMsg((m) => ({ ...m, [provider]: j.error || 'Could not save' })); return }
      setDrafts((d) => ({ ...d, [provider]: '' }))
      await load()
    } catch { setMsg((m) => ({ ...m, [provider]: 'Network error' })) } finally { setBusy(null) }
  }

  async function disconnect(provider: string) {
    setBusy(provider)
    try {
      await fetch('/api/integrations/external', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      await load()
    } catch { /* ignore */ } finally { setBusy(null) }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-3">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
          style={{ background: 'rgba(34,211,238,0.14)', color: CYAN }}>
          <FlaskConical size={11} /> MVP Labs
        </span>
      </div>

      <PageHero
        title="External Integrations"
        subtitle="Connect your own API keys for external affiliate networks. Each key unlocks its matching Labs tool for your account. Keys are encrypted and stored server-side — we only ever show the last 4 digits."
        accent="rgba(34,211,238,0.32)"
      />

      {forbidden && (
        <div className="rounded-xl border p-4 mb-4 flex items-start gap-3"
          style={{ background: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.40)' }}>
          <Lock size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
          <p className="text-[13px]" style={{ color: 'var(--text)' }}>External Integrations are a <strong>Pro</strong> feature.</p>
        </div>
      )}

      {loading && !forbidden && (
        <p className="text-[13px] flex items-center gap-1.5" style={{ color: 'var(--text-soft)' }}>
          <Loader2 size={13} className="animate-spin" /> Loading…
        </p>
      )}

      {!forbidden && !loading && (
        <div className="flex flex-col gap-3">
          {PROVIDERS.map((p) => {
            const st = status[p.id] || { connected: false, last4: null, viaEnv: false }
            return (
              <div key={p.id} className="rounded-xl border p-4"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(34,211,238,0.12)', color: CYAN }}>{p.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{p.name}</p>
                      <span className="text-[11px]" style={{ color: 'var(--text-soft)' }}>→ {p.tool}</span>
                      {st.connected ? (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                          style={{ background: 'rgba(16,185,129,0.14)', color: '#10B981' }}>
                          <CheckCircle2 size={11} /> Connected{st.last4 ? ` ••••${st.last4}` : ''}
                        </span>
                      ) : st.viaEnv ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-bright)', color: 'var(--text-soft)' }}>
                          Using shared key
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-bright)', color: 'var(--text-soft)' }}>
                          Not connected
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{p.blurb}</p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-soft)' }}>
                      Get your key: <span className="font-medium">{p.where}</span>{' '}
                      <a href={p.dash} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 font-medium" style={{ color: CYAN }}>
                        open <ExternalLink size={10} />
                      </a>
                    </p>

                    <div className="flex items-center gap-2 mt-3">
                      <input
                        type="password" autoComplete="off"
                        value={drafts[p.id] || ''}
                        onChange={(e) => { setDrafts((d) => ({ ...d, [p.id]: e.target.value })); setMsg((m) => ({ ...m, [p.id]: '' })) }}
                        placeholder={st.connected ? 'Paste a new key to replace' : 'Paste your API key'}
                        className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-[13px] focus:outline-none"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      />
                      <button onClick={() => save(p.id)} disabled={busy === p.id || !(drafts[p.id] || '').trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
                        style={{ background: 'linear-gradient(45deg, #0E7490 0%, #22D3EE 100%)' }}>
                        {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
                      </button>
                      {st.connected && (
                        <button onClick={() => disconnect(p.id)} disabled={busy === p.id}
                          title="Remove this key"
                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg disabled:opacity-50"
                          style={{ background: 'var(--surface-bright)', color: '#ef4444' }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    {msg[p.id] && <p className="text-[12px] mt-1.5" style={{ color: '#ef4444' }}>{msg[p.id]}</p>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
