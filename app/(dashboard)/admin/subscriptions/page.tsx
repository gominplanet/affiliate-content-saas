'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Search, Loader2, AlertCircle, CheckCircle2, XCircle, RotateCcw } from 'lucide-react'

interface Sub {
  id: string
  status: string
  planTier: string
  priceId: string | null
  amount: number | null
  interval: string | null
  created: string | null
  currentPeriodEnd: string | null
  latestInvoice: string | null
}
interface DupCustomer {
  customerId: string
  email: string | null
  mvpUserId: string | null
  mvpTier: string | null
  subscriptions: Sub[]
}

export default function AdminDuplicateSubsPage() {
  const [loading, setLoading] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [dups, setDups] = useState<DupCustomer[]>([])
  const [busy, setBusy] = useState<string | null>(null) // subscriptionId being acted on

  async function scan() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/duplicate-subscriptions')
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Scan failed'); return }
      setDups(Array.isArray(d.duplicates) ? d.duplicates : [])
      setScanned(true)
    } catch { toast.error('Scan failed — try again.') }
    finally { setLoading(false) }
  }

  async function act(action: 'cancel' | 'refund', sub: Sub) {
    const verb = action === 'cancel' ? 'CANCEL' : 'REFUND the last payment on'
    if (!window.confirm(`${verb} subscription ${sub.id} (${sub.planTier}${sub.amount != null ? ` $${sub.amount}` : ''})?\n\nThis is irreversible.`)) return
    setBusy(sub.id)
    try {
      const res = await fetch('/api/admin/duplicate-subscriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, subscriptionId: sub.id }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error || 'Action failed'); return }
      if (action === 'cancel') toast.success(`Canceled ${sub.id} (now ${d.status}).`)
      else toast.success(`Refunded $${d.amount} on ${sub.id}.`)
      // Re-scan so the list reflects the change.
      await scan()
    } catch { toast.error('Action failed — try again.') }
    finally { setBusy(null) }
  }

  return (
    <>
      <PageHero title="Duplicate subscriptions" subtitle="Customers with more than one live Stripe subscription (from the pre-proration-fix double-billing). Cancel the extra, refund if warranted." />

      <div className="mb-6">
        <button
          onClick={scan}
          disabled={loading}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          {loading ? 'Scanning Stripe…' : scanned ? 'Re-scan' : 'Scan for duplicates'}
        </button>
      </div>

      {scanned && dups.length === 0 && (
        <div className="card p-6 flex items-center gap-2 text-sm text-[var(--text-2)]">
          <CheckCircle2 size={16} className="text-[#34c759]" /> No customers with duplicate live subscriptions. All clean.
        </div>
      )}

      <div className="flex flex-col gap-4">
        {dups.map(d => (
          <div key={d.customerId} className="card p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text)]">{d.email || '(no email)'}</p>
                <p className="text-xs text-[var(--text-3)]">
                  MVP tier: <span className="font-medium">{d.mvpTier ?? 'unknown'}</span> · Stripe customer {d.customerId}
                  {d.mvpUserId ? <> · user {d.mvpUserId}</> : null}
                </p>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#ff3b30]/10 text-[#ff3b30] flex-shrink-0">
                {d.subscriptions.length} live subs
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {d.subscriptions.map((s, i) => (
                <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border-2)]">
                  <div className="min-w-0 text-xs">
                    <p className="font-medium text-[var(--text)]">
                      {s.planTier}{s.amount != null ? ` · $${s.amount}/${s.interval || 'mo'}` : ''} · <span className="text-[var(--text-3)]">{s.status}</span>
                      {i === 0 && <span className="ml-2 text-[10px] font-bold text-[#34c759]">OLDEST — likely keep</span>}
                    </p>
                    <p className="text-[var(--text-3)] mt-0.5 truncate">
                      {s.id} · created {s.created ? new Date(s.created).toLocaleDateString() : '?'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => act('refund', s)}
                      disabled={busy === s.id}
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs text-[#5856d6] hover:bg-[#5856d6]/10 disabled:opacity-60"
                      title="Refund the last payment on this subscription"
                    >
                      {busy === s.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Refund
                    </button>
                    <button
                      onClick={() => act('cancel', s)}
                      disabled={busy === s.id}
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-medium text-white bg-[#ff3b30] hover:bg-[#e0352b] disabled:opacity-60"
                      title="Cancel this subscription now"
                    >
                      {busy === s.id ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-start gap-2 text-[11px] text-[var(--text-3)] max-w-2xl">
        <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          Rule of thumb: keep the OLDEST subscription (that&apos;s the one they meant to have), cancel the newer duplicate, and refund the newer one&apos;s last charge if they were billed twice in the same period. Cancel + refund are irreversible and act directly on Stripe.
        </span>
      </div>
    </>
  )
}
