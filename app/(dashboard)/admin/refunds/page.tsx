'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /admin/refunds: the 7-day refund, once per creator (Seb, 2026-10-18).
// New Pro members with the refund check beside each one: which day of the
// window, and any earlier refund the same creator had under another account.
// One button refunds the first payment through Stripe, cancels the
// subscription and records it. Each step's result is shown on its own.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Search, Loader2, CheckCircle2, XCircle, RotateCcw } from 'lucide-react'
import { GUARANTEE_DAYS } from '@/lib/guarantee'

interface Row {
  userId: string
  email: string | null
  tier: string
  status: string | null
  subscribedAt: string | null
  paidAt: string | null
  amount: number | null
  eligible: boolean
  day: number | null
  reason: string
  matches: Array<{ email: string | null; refundedAt: string; on: string[] }>
  stripeError: string | null
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not recorded')

export default function AdminRefundsPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [need, setNeed] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})

  async function load(q = '') {
    setLoading(true); setNote(null)
    try {
      const res = await fetch(`/api/admin/refunds${q ? `?email=${encodeURIComponent(q)}` : ''}`)
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Could not read the members.'); setRows([]); return }
      setRows(Array.isArray(d.members) ? d.members : [])
      setNeed(d.need || null)
      setNote(d.note || null)
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function refund(r: Row) {
    const force = !r.eligible
    const ask = force
      ? `${r.email}: ${r.reason}\n\nRefund ${r.amount != null ? `$${r.amount}` : 'the payment'} and cancel anyway?`
      : `Refund ${r.amount != null ? `$${r.amount}` : 'the payment'} to ${r.email} and cancel their subscription now?`
    if (!window.confirm(ask)) return
    setBusy(r.userId)
    try {
      const res = await fetch('/api/admin/refunds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: r.userId, force }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error || 'Not refunded.'); setResults((m) => ({ ...m, [r.userId]: `Not refunded: ${d.error || 'no answer'}` })); return }
      const parts = [
        `Refunded $${d.refunded ?? '?'}.`,
        d.cancelled ? 'Subscription cancelled.' : `Not cancelled: ${d.cancelError}. Cancel it in Stripe.`,
        d.recorded ? 'Recorded, so it cannot be given twice.' : `Not recorded: ${d.recordError}.`,
      ]
      setResults((m) => ({ ...m, [r.userId]: parts.join(' ') }))
      if (d.cancelled && d.recorded) toast.success(parts[0]); else toast.error(parts.slice(1).join(' '))
      void load(email.trim())
    } finally { setBusy(null) }
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-5">
      <PageHero accent="rgba(16,185,129,0.25)" title="Refunds"
        subtitle={`Pro starts with a ${GUARANTEE_DAYS}-day refund, no questions asked, once per creator. New members are listed with whether they can have it.`} />

      {need && <p className="rounded-xl px-4 py-3 text-[13px] text-amber-700 bg-amber-500/15 dark:text-amber-300 dark:bg-amber-400/15">{need}</p>}

      <form onSubmit={(e) => { e.preventDefault(); void load(email.trim()) }} className="flex gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Find a member by email"
          className="flex-1 rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
        <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white bg-[#7C3AED]">
          <Search size={14} /> Find
        </button>
        {email && <button type="button" onClick={() => { setEmail(''); void load() }} className="rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>New members</button>}
      </form>

      {loading && <p className="inline-flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-2)' }}><Loader2 size={14} className="animate-spin" /> Checking each member with Stripe</p>}
      {note && <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{note}</p>}
      {rows && !loading && rows.length === 0 && !note && (
        <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>No Pro member joined in the last 14 days.</p>
      )}

      {rows?.map((r) => (
        <article key={r.userId} className="rounded-2xl border p-4 flex flex-col gap-2" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--text)' }}>{r.email || r.userId}</p>
              <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                {r.tier} · {r.status || 'no status'} · paid {when(r.paidAt)}{r.amount != null ? ` · $${r.amount}` : ''}
              </p>
            </div>
            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${r.eligible
              ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300 dark:bg-emerald-400/15'
              : 'text-amber-700 bg-amber-500/15 dark:text-amber-300 dark:bg-amber-400/15'}`}>
              {r.eligible ? <CheckCircle2 size={12} /> : <XCircle size={12} />}{r.eligible ? 'Can have the refund' : 'Not covered'}
            </span>
          </div>
          <p className="text-[12.5px]" style={{ color: 'var(--text)' }}>{r.reason}</p>
          {r.matches.length > 0 && (
            <ul className="text-[12px] list-disc pl-5" style={{ color: 'var(--text-2)' }}>
              {r.matches.map((m, i) => <li key={i}>Refunded {when(m.refundedAt)}{m.email ? ` to ${m.email}` : ''}: {m.on.join(', ')}</li>)}
            </ul>
          )}
          {r.stripeError && <p className="text-[12px] text-red-700 dark:text-red-300">Stripe: {r.stripeError}</p>}
          {results[r.userId] && <p className="text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>{results[r.userId]}</p>}
          <div>
            <button type="button" disabled={busy === r.userId || r.amount == null} onClick={() => void refund(r)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50 ${r.eligible ? 'text-white bg-emerald-600' : 'border'}`}
              style={r.eligible ? undefined : { borderColor: 'var(--border)', color: 'var(--text)' }}>
              {busy === r.userId ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              {r.eligible ? 'Refund and cancel' : 'Refund anyway'}
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}
