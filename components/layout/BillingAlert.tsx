'use client'

/**
 * A PAYMENT THAT DID NOT GO THROUGH, SAID (lib/billing-alert; Seb, 2026-10-27:
 * Douglas's card was declined for eight days and MVP said nothing, then
 * showed him on no plan). While a payment is failing, Update your card opens
 * Stripe's billing portal; once the plan ended for it, Subscribe again opens
 * Billing. Not dismissible while the payment is failing: it is the one thing
 * that keeps the plan. Renders nothing otherwise, and on any read error.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { billingAlertWords, type BillingAlert as Alert } from '@/lib/billing-alert'

export default function BillingAlert() {
  const [alert, setAlert] = useState<Alert | null>(null)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/stripe/billing-alert').then((r) => (r.ok ? r.json() : null)).then((d: { alert?: Alert | null } | null) => { if (alive && d?.alert) setAlert(d.alert) }).catch(() => {})
    return () => { alive = false }
  }, [])
  if (!alert) return null

  async function openPortal() {
    setOpening(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const { url, error } = await res.json().catch(() => ({} as { url?: string; error?: string }))
      if (error || !url) { toast.error(error || 'The billing portal did not open. Try again, or open Billing.'); return }
      window.location.href = url
    } catch { toast.error('The billing portal did not open. Try again, or open Billing.') }
    finally { setOpening(false) }
  }

  const words = billingAlertWords(alert)
  const accent = alert.kind === 'past_due' ? '#DC2626' : '#B45309'
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b px-6 py-2 text-[12px]" role="alert" style={{ borderColor: 'var(--border)', backgroundColor: `${accent}12` }}>
      <AlertTriangle size={14} style={{ color: accent }} className="flex-shrink-0" />
      <span className="flex-1 min-w-[16rem]" style={{ color: 'var(--text)' }}>{words.text}</span>
      {alert.kind === 'past_due'
        ? <button onClick={() => void openPortal()} disabled={opening} className="flex-shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60" style={{ background: accent }}>{opening && <Loader2 size={11} className="animate-spin" />} {words.action}</button>
        : <Link href="/billing" className="flex-shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white" style={{ background: accent }}>{words.action}</Link>}
    </div>
  )
}
