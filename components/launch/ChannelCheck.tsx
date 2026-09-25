'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "These go to THIS channel": the check above the Launch button.
//
// WHAT IT SHOWS IS YOUTUBE'S ANSWER. The name and picture come from YouTube,
// asked with the login the uploader will use, not from the row MVP wrote when
// the channel was connected. A login that uploads somewhere else is shown as
// exactly that, in red, with both names, and it cannot be confirmed.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check, AlertTriangle, Youtube } from 'lucide-react'

interface PushChannel { key: string; channelId: string; title: string; isDefault: boolean }
interface Live { id: string; title: string; thumbnail: string | null }
interface State {
  available: boolean
  confirmed: string | null
  locked: boolean
  channels: PushChannel[]
  checked: string | null
  live: Live | null
  matches: boolean
  error: string | null
}

export default function ChannelCheck({ batchId, onChanged }: {
  batchId: string
  /** Called with the confirmed channel id whenever it changes. */
  onChanged: (channelId: string | null) => void
}) {
  const [st, setSt] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/launch/batches/${batchId}/channel`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j?.error || 'Could not check your channel.'); return }
      setSt(j as State)
      setPick((j as State).checked ?? '')
      onChanged((j as State).confirmed ?? null)
    } finally { setLoading(false) }
  }, [batchId, onChanged])

  useEffect(() => { void load() }, [load])

  async function confirm(channelId: string) {
    setSaving(true); setErr(null)
    try {
      const r = await fetch(`/api/launch/batches/${batchId}/channel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErr(j?.error || 'Could not confirm that channel.')
      await load()
    } finally { setSaving(false) }
  }

  async function checkOther(channelId: string) {
    setPick(channelId)
    // Checking another channel IS confirming it, only if YouTube agrees. The
    // answer comes back either way and is shown.
    await confirm(channelId)
  }

  const box = 'rounded-xl border px-4 py-3 flex flex-col gap-2'
  if (loading && !st) {
    return (
      <div className={box} style={{ borderColor: 'var(--border)' }}>
        <span className="text-[12.5px] inline-flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
          <Loader2 size={13} className="animate-spin" /> Asking YouTube which channel these will upload to...
        </span>
      </div>
    )
  }
  if (!st) return err ? <p className="text-[12.5px]" style={{ color: '#ef4444' }}>{err}</p> : null

  const confirmedOk = !!st.confirmed && st.matches && st.live?.id === st.confirmed
  const wrong = !!st.live && !st.matches
  const border = confirmedOk ? '#10B981' : wrong || st.error ? '#ef4444' : '#d97706'
  const named = st.channels.find((c) => c.channelId === st.checked)

  return (
    <div className={box} style={{ borderColor: border }}>
      <div className="flex items-center gap-2">
        <Youtube size={15} style={{ color: border }} />
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
          {confirmedOk ? 'These upload to this channel' : 'Check your YouTube channel'}
        </span>
      </div>

      {st.live && (
        <div className="flex items-center gap-3">
          {st.live.thumbnail
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={st.live.thumbnail} alt="" width={36} height={36} className="rounded-full shrink-0" />
            : <span className="w-9 h-9 rounded-full shrink-0" style={{ background: 'var(--surface-hover)' }} />}
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold truncate" style={{ color: 'var(--text)' }}>{st.live.title}</span>
            <span className="block text-[11px] font-mono truncate" style={{ color: 'var(--text-2)' }}>{st.live.id}</span>
          </span>
          {confirmedOk && <Check size={16} className="ml-auto shrink-0" style={{ color: '#10B981' }} />}
        </div>
      )}

      {wrong && (
        <p className="text-[12px] flex gap-1.5" style={{ color: '#ef4444' }}>
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            The login saved for &quot;{named?.title ?? st.checked}&quot; uploads to &quot;{st.live?.title}&quot; instead. Reconnect
            that channel under Settings and choose it when Google asks, or pick another below.
          </span>
        </p>
      )}
      {st.error && !st.live && (
        <p className="text-[12px]" style={{ color: '#ef4444' }}>{st.error}</p>
      )}
      {!st.available && (
        <p className="text-[12px]" style={{ color: '#d97706' }}>
          Confirming the channel needs migration 372 in the database first.
        </p>
      )}

      {!confirmedOk && st.live && st.matches && !st.locked && st.available && (
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: 'var(--text-2)' }}>
            YouTube says your saved login uploads to the channel above. Is that where these videos should go?
          </span>
          <button type="button" onClick={() => void confirm(st.live!.id)} disabled={saving}
            className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white disabled:opacity-50"
            style={{ background: '#10B981' }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Yes, upload here
          </button>
        </div>
      )}

      {confirmedOk && (
        <span className="text-[11.5px]" style={{ color: 'var(--text-2)' }}>
          Checked with YouTube. MVP asks again when you press Launch and before every upload, and stops if the answer changes.
        </span>
      )}

      {st.channels.length > 1 && !st.locked && st.available && (
        <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
          <span className="shrink-0">Another channel:</span>
          <select value={pick} disabled={saving}
            onChange={(e) => { if (e.target.value) void checkOther(e.target.value) }}
            className="flex-1 min-w-0 px-2 py-1 rounded-lg border bg-transparent text-[12px]"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            {st.channels.map((c) => (
              <option key={c.key} value={c.channelId}>{c.title}{c.isDefault ? ' (default)' : ''}</option>
            ))}
          </select>
        </label>
      )}
      {st.locked && st.confirmed && (
        <span className="text-[11.5px]" style={{ color: 'var(--text-2)' }}>This batch has launched, so its channel is set.</span>
      )}
      {err && <p className="text-[12px]" style={{ color: '#ef4444' }}>{err}</p>}
    </div>
  )
}
