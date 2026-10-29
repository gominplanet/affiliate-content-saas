'use client'

// Instagram's "Paid partnership" label on the posts MVP makes
// (lib/ig-paid-label). Per connected Instagram account: whether the next post
// will carry it, and when it will not, why and what fixes it; then what
// happened to the last posts, so a post that went out unlabelled never looks
// like one that carried it. Renders nothing for accounts it is not open to.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, BadgeCheck } from 'lucide-react'
import { toast } from 'sonner'

interface Account {
  username: string | null
  ready: boolean
  page: string | null
  why: string | null
  checked?: string[]
  recent: { at: string; on: boolean; kind: string | null; words: string }[]
}
interface State { allowed: boolean; enabled?: boolean; accounts?: Account[] }

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function InstagramPaidLabel() {
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/instagram/paid-label', { cache: 'no-store' })
      setState(r.ok ? await r.json() : { allowed: false })
    } catch { setState({ allowed: false }) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (!state || !state.allowed) return null
  const accounts = state.accounts ?? []

  const toggle = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/instagram/paid-label', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !state.enabled }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) toast.error(d.error || 'The setting was not saved.')
      else { toast.success(d.enabled ? 'The label is on for your Instagram posts' : 'The label is off'); await load() }
    } finally { setBusy(false) }
  }

  // WORKING OR NOT, SAID FIRST (Seb, 2026-10-29, Alejandro: "I didn't do
  // anything and it's already enabled", from a card whose account line said
  // the next post goes out without the label). The setting being on is not
  // the label working; the badge says which it is.
  const working = !!state.enabled && accounts.length > 0 && accounts.every((a) => a.ready)
  const status = !state.enabled ? { text: 'Off', bg: 'var(--border)', fg: 'var(--text-faint)' }
    : working ? { text: 'Working', bg: 'rgba(52,199,89,0.15)', fg: '#1f8a3b' }
    : { text: 'Not working yet: one step to do', bg: 'rgba(255,149,0,0.15)', fg: '#a35a00' }

  return (
    <div className="rounded-2xl border p-4 flex flex-col gap-3 mt-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <BadgeCheck size={18} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text)' }} />
          <div>
            <div className="text-sm font-semibold flex flex-wrap items-center gap-1.5" style={{ color: 'var(--text)' }}>
              Instagram&apos;s Paid partnership label
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'var(--border)', color: 'var(--text-faint)' }}>Labs</span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: status.bg, color: status.fg }}>{status.text}</span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
              When this works, MVP adds the label to your Instagram posts so you do not add it by hand. Instagram only allows it when MVP posts through the Facebook Page your Instagram is linked to. Your #ad and Amazon disclosure stay in the caption either way.
            </p>
          </div>
        </div>
      </div>
      {!accounts.length && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Connect Instagram first.</p>}
      {accounts.map((a, i) => (
        <div key={i} className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-2 text-xs">
            {a.ready && state.enabled ? <CheckCircle2 size={15} className="text-[#34c759] flex-shrink-0" /> : <XCircle size={15} className="text-[#ff3b30] flex-shrink-0" />}
            <div style={{ color: 'var(--text)' }}>
              <span className="font-medium">@{a.username || 'instagram'}</span>
              {a.ready && state.enabled
                ? <>: working. The next post goes out with the label{a.page ? `, posted through ${a.page}` : ''}.</>
                : <>: not working yet, so the next post goes out without the label. {state.enabled ? a.why : 'You turned the label off.'}</>}
            </div>
          </div>
          {!a.ready && state.enabled && a.why && /Facebook/.test(a.why) && (
            <a href="/api/auth/facebook" className="self-start ml-6 text-xs font-semibold px-3 py-1.5 rounded-full text-white" style={{ background: '#1877f2' }}>Reconnect Facebook</a>
          )}
          {(a.checked?.length ?? 0) > 0 && (
            <details className="text-[11px] pl-6" style={{ color: 'var(--text-faint)' }}>
              <summary className="cursor-pointer">What MVP checked</summary>
              <ul className="flex flex-col gap-0.5 mt-1">{a.checked!.map((c, k) => <li key={k}>{c}</li>)}</ul>
            </details>
          )}
          {a.recent.length > 0 && (
            <ul className="text-[11px] flex flex-col gap-1 pl-6" style={{ color: 'var(--text-faint)' }}>
              {a.recent.map((r, j) => (
                <li key={j}>{when(r.at)}{r.kind ? `, ${r.kind === 'REELS' ? 'Reel' : r.kind === 'STORIES' ? 'Story' : 'post'}` : ''}: <span style={{ color: r.on ? '#34c759' : 'var(--text)' }}>{r.words}</span></li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <button onClick={toggle} disabled={busy} className="self-start text-[11px] underline" style={{ color: 'var(--text-faint)' }}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : state.enabled ? 'Turn the label off' : 'Turn the label on'}
      </button>
    </div>
  )
}
