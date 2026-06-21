'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import type HCaptcha from '@hcaptcha/react-hcaptcha'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { SALES_PAUSED, SALES_PAUSED_MESSAGE } from '@/lib/sales-paused'
import HCaptchaField, { captchaRequired } from '@/components/auth/HCaptchaField'

export default function SignupForm() {
  const router = useRouter()
  const supabase = createBrowserClient()

  // Hard stop: no new accounts during a pause. Existing users sign in
  // via /login as normal. Also recommended to flip Supabase Auth's
  // "Allow new users to sign up" off as a belt-and-suspenders measure.
  if (SALES_PAUSED) {
    return (
      <div className="card p-8 text-center">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Sign-ups paused</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-4">{SALES_PAUSED_MESSAGE}</p>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Already have an account?{' '}
          <Link href="/login" className="text-[#7C3AED] hover:underline font-medium">Sign in</Link>
        </p>
      </div>
    )
  }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [paidIntent, setPaidIntent] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<HCaptcha>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (captchaRequired && !captchaToken) {
      setError('Please complete the captcha below.')
      return
    }
    setLoading(true)
    setError(null)

    // Where to send them AFTER they confirm their email. A logged-out visitor
    // who clicked a paid plan ("Get Pro") is bounced here as
    // /signup?next=/pricing&tier=pro — we must carry that checkout intent
    // through email confirmation, or they land on /onboarding (trial) and are
    // never charged. Paid intent → back to /pricing with an auto-resume flag
    // so checkout fires the moment they return (Rewardful referral cookie is
    // still in their browser, so affiliate attribution survives). Everyone else
    // → /onboarding, the normal new-user setup funnel.
    const sp = new URLSearchParams(window.location.search)
    const tierParam = sp.get('tier')
    const paid = !!tierParam && ['creator', 'studio', 'pro'].includes(tierParam)
    setPaidIntent(paid)
    const dest = paid ? `/pricing?checkout=${tierParam}` : '/onboarding'

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        captchaToken: captchaToken ?? undefined,
        // Send the email-confirmation link through our auth callback (which
        // exchanges the code for a session) and on to `dest`. window.origin
        // keeps it correct across preview + prod. NOTE: the Supabase dashboard's
        // Auth → URL Configuration redirect allow-list must include
        // <site>/api/auth/callback (already used by the existing flow).
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(dest)}`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      // hCaptcha tokens are single-use — reset so the user can retry.
      captchaRef.current?.resetCaptcha()
      setCaptchaToken(null)
    } else {
      setSuccess(true)
    }
  }

  if (success) {
    return (
      <div className="card p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-[#34c759]/10 flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="#34c759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Check your inbox</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          We sent a confirmation link to <strong>{email}</strong>.{' '}
          {paidIntent
            ? <>Click it to confirm your email — we&apos;ll take you straight to checkout to start your plan. (Check spam if it doesn&apos;t show in a minute.)</>
            : <>Click it to unlock your 5 free reviews — no card required. (Check spam if it doesn&apos;t show in a minute.)</>}
        </p>
      </div>
    )
  }

  return (
    <div className="card p-8">
      <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Start free — 5 reviews on the house</h2>
      <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-6">No credit card. The full agent pipeline, the YouTube autopilot, and a branded review site — unlocked the moment you confirm your email.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="signup-fullname" className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Full name</label>
          <input
            id="signup-fullname"
            name="name"
            autoComplete="name"
            type="text"
            required
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="Jane Smith"
            className="input-field"
          />
        </div>

        <div>
          <label htmlFor="signup-email" className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Email</label>
          <input
            id="signup-email"
            name="email"
            autoComplete="email"
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input-field"
          />
        </div>

        <div>
          <label htmlFor="signup-password" className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Password</label>
          <input
            id="signup-password"
            name="password"
            autoComplete="new-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            className="input-field"
          />
        </div>

        {error && (
          <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <HCaptchaField ref={captchaRef} onVerify={setCaptchaToken} onExpire={() => setCaptchaToken(null)} />

        <button type="submit" disabled={loading} className="btn-primary w-full mt-1">
          {loading ? 'Creating account…' : 'Create my free account'}
        </button>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] text-center mt-1">
          No credit card · Cancel anytime · 5 free reviews to try the full workflow
        </p>
      </form>

      <p className="text-sm text-center text-[#6e6e73] dark:text-[#ebebf0] mt-5">
        Already have an account?{' '}
        <Link href="/login" className="text-[#7C3AED] hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </div>
  )
}
