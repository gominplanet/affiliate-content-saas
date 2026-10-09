'use client'

// The Instagram side of Auto-DM, checked live (/api/instagram/dm-debug): is the
// account connected, is it sending comments to MVP, are the server settings
// in place. One verdict names the first broken link, and "Turn on comment
// alerts" fixes the one a creator cannot fix anywhere else, showing Meta's own
// words when Instagram refuses. Comments from Instagram stopped reaching MVP
// after Aug 13 and no screen said so; this one does.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, CheckCircle2, XCircle, MinusCircle, Instagram, BellRing, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

interface Checks {
  connected: boolean
  username: string | null
  tokenExpired: boolean
  appSecretSet: boolean
  verifyTokenSet: boolean
  scopesRequested: boolean
  commentsOn: boolean | null
  subscribedFields: string[]
  subError: string | null
  professionalIdSaved: boolean
  autoDmEnabled: boolean
  lastInstagramEvent: string | null
}
interface Result { ok: boolean; verdict: string; appReviewUrl: string; checks: Checks }

function Mark({ state }: { state: boolean | null }) {
  if (state === true) return <CheckCircle2 size={15} className="text-[#34c759] flex-shrink-0" />
  if (state === false) return <XCircle size={15} className="text-[#ff3b30] flex-shrink-0" />
  return <MinusCircle size={15} className="flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
}

export default function InstagramDmStatus({ onAppReviewUrl }: { onAppReviewUrl?: (url: string) => void }) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Result | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/instagram/dm-debug', { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `Check failed (${res.status})`)
      setData(d as Result)
      if (d.appReviewUrl) onAppReviewUrl?.(d.appReviewUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [onAppReviewUrl])

  useEffect(() => { load() }, [load])

  async function turnOn() {
    setBusy(true)
    try {
      const res = await fetch('/api/instagram/dm-debug', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (d.ok) { toast.success('Comment alerts are on'); await load() }
      else toast.error(d.error || 'Instagram refused.', { duration: 12000 })
    } finally {
      setBusy(false)
    }
  }

  const c = data?.checks
  const rows: { label: string; state: boolean | null; note?: string }[] = c ? [
    { label: c.username ? `Instagram connected (@${c.username})` : 'Instagram connected', state: c.connected && !c.tokenExpired, note: c.tokenExpired ? 'The connection has expired.' : undefined },
    { label: 'Comments are sent to MVP', state: c.commentsOn, note: c.commentsOn === null && c.subError ? c.subError : undefined },
    { label: 'Messaging permissions asked for on connect (IG_DM_SCOPES)', state: c.scopesRequested },
    { label: 'Comment signatures can be checked (INSTAGRAM_APP_SECRET)', state: c.appSecretSet },
    { label: 'Webhook verify code set (IG_WEBHOOK_VERIFY_TOKEN)', state: c.verifyTokenSet },
    { label: 'Auto-DM turned on', state: c.autoDmEnabled },
  ] : []

  return (
    <div className="rounded-2xl border p-4 flex flex-col gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2">
        <Instagram size={16} className="text-[#E1306C]" />
        <p className="text-sm font-semibold flex-1" style={{ color: 'var(--text)' }}>Instagram status</p>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check again
        </button>
      </div>

      {error && <p className="text-[13px] text-[#ff3b30]">{error}</p>}
      {loading && !data && (
        <p className="text-[13px] flex items-center gap-2" style={{ color: 'var(--text-faint)' }}><Loader2 size={13} className="animate-spin" /> Checking with Instagram…</p>
      )}

      {data && (
        <>
          <p className="text-[13px] rounded-lg px-3 py-2"
            style={data.ok
              ? { background: 'rgba(52,199,89,0.10)', color: 'var(--text)' }
              : { background: 'rgba(255,59,48,0.08)', color: 'var(--text)' }}>
            {data.verdict}
          </p>
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.label} className="flex items-start gap-2 text-[13px]" style={{ color: 'var(--text-soft)' }}>
                <Mark state={r.state} />
                <span>{r.label}{r.note ? <span className="block text-[12px]" style={{ color: 'var(--text-faint)' }}>{r.note}</span> : null}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Last comment from Instagram: {c?.lastInstagramEvent ? new Date(c.lastInstagramEvent).toLocaleString() : 'none on record'}
          </p>
          <div className="flex flex-wrap gap-2">
            {c?.connected && c.commentsOn !== true && (
              <button onClick={turnOn} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#833AB4,#E1306C)' }}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />} Turn on comment alerts
              </button>
            )}
            <a href={data.appReviewUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold border"
              style={{ borderColor: 'var(--border-bright)', color: 'var(--text)' }}>
              <ExternalLink size={13} /> Check Meta approval
            </a>
          </div>
        </>
      )}
    </div>
  )
}
