// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /labs-unlock — the password screen middleware sends users to when they hit a
// LABS tool (EPC Scout / PartnerBoost) without the labs_unlocked cookie. Enter
// the shared early-access password → POST /api/labs/unlock sets the cookie →
// bounce back to the originally-requested LABS page (?next=).

'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FlaskConical, Lock, ArrowRight } from 'lucide-react'

const CYAN = '#22D3EE'

/** Only follow internal same-origin paths — never an attacker-supplied URL. */
function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/epc'
}

function LabsUnlockForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get('next'))

  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/labs/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data.error as string) || 'Could not unlock — try again.')
        setLoading(false)
        return
      }
      // Cookie is set — go to the requested LABS page. refresh() re-runs
      // middleware so the now-present cookie is honored.
      router.replace(next)
      router.refresh()
    } catch {
      setError('Network error — try again.')
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto mt-16 sm:mt-24 px-4">
      <div className="card p-8 text-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: 'rgba(34, 211, 238, 0.12)', color: CYAN }}
        >
          <FlaskConical size={26} />
        </div>
        <h1 className="text-xl font-semibold mb-1">Labs — early access</h1>
        <p className="text-sm text-[#86868b] dark:text-[#8e8e93] mb-6">
          These experimental tools are invite-only for now. Enter the access password to continue.
        </p>

        <form onSubmit={submit} className="space-y-3 text-left">
          <label htmlFor="labs-password" className="sr-only">Labs access password</label>
          <div className="relative">
            <Lock
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] dark:text-[#8e8e93]"
              aria-hidden="true"
            />
            <input
              id="labs-password"
              type="password"
              autoFocus
              autoComplete="off"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              placeholder="Access password"
              className="w-full rounded-lg border border-[#d2d2d7] dark:border-[#3a3a3c] bg-transparent pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{ ['--tw-ring-color' as string]: CYAN }}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-semibold text-[#04344a] transition-opacity disabled:opacity-50"
            style={{ background: CYAN }}
          >
            {loading ? 'Unlocking…' : <>Unlock Labs <ArrowRight size={15} /></>}
          </button>
        </form>

        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-5">
          Don&apos;t have the password? Labs is in limited preview — reach out and we&apos;ll get you in.
        </p>
      </div>
    </div>
  )
}

export default function LabsUnlockPage() {
  return (
    <Suspense fallback={null}>
      <LabsUnlockForm />
    </Suspense>
  )
}
