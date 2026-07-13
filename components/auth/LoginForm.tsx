'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import TurnstileField, { captchaRequired, type TurnstileHandle } from '@/components/auth/TurnstileField'
import { friendlyAuthError } from '@/lib/auth-error'

export default function LoginForm() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetMode, setResetMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<TurnstileHandle>(null)
  // When the user clicks a button before Turnstile has minted a token (its
  // first challenge often fails then auto-retries to success a couple seconds
  // later), we QUEUE the action instead of erroring, and fire it the moment the
  // token arrives. This kills the spurious "Please complete the captcha below."
  const [pendingAction, setPendingAction] = useState<null | 'signin' | 'reset'>(null)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function resetCaptcha() {
    captchaRef.current?.reset()
    setCaptchaToken(null)
  }

  function clearPending() {
    setPendingAction(null)
    if (pendingTimer.current) { clearTimeout(pendingTimer.current); pendingTimer.current = null }
  }

  // Queue an action to run as soon as a captcha token arrives. Times out after
  // 15s (Turnstile blocked by an extension / offline) with a friendly retry.
  function queuePending(action: 'signin' | 'reset') {
    setError(null)
    setPendingAction(action)
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
    pendingTimer.current = setTimeout(() => {
      setPendingAction(null)
      setError('Couldn’t verify you’re human — please try again.')
      resetCaptcha()
    }, 15000)
  }

  // Fire a queued action once the token lands. Done in an effect (not the
  // widget's callback) on purpose: TurnstileField renders the widget ONCE and
  // captures its onVerify closure, so a callback-based dispatch would read a
  // stale `pendingAction`. This effect always sees fresh state.
  useEffect(() => {
    if (!captchaToken || !pendingAction) return
    const action = pendingAction
    clearPending()
    if (action === 'signin') void doSignIn(captchaToken)
    else if (action === 'reset') void doReset(captchaToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captchaToken, pendingAction])

  async function doSignIn(token: string | null) {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: token ?? undefined },
    })
    if (error) {
      setError(friendlyAuthError(error.message))
      setLoading(false)
      resetCaptcha() // tokens are single-use
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Not ready? Don't error — wait for the token, then auto-submit.
    if (captchaRequired && !captchaToken) { queuePending('signin'); return }
    await doSignIn(captchaToken)
  }

  async function doReset(token: string | null) {
    setResetLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken: token ?? undefined,
    })
    setResetLoading(false)
    resetCaptcha() // single-use token, whether or not the call succeeded
    if (error) {
      setError(friendlyAuthError(error.message))
    } else {
      setResetSent(true)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (captchaRequired && !captchaToken) { queuePending('reset'); return }
    await doReset(captchaToken)
  }

  if (resetMode) {
    return (
      <div className="card p-8">
        {resetSent ? (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-[#34c759]/10 flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="#34c759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Check your email</h2>
            <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-6">
              We sent a password reset link to <strong>{email}</strong>.
            </p>
            <button onClick={() => { setResetMode(false); setResetSent(false) }} className="text-sm text-[#7C3AED] hover:underline">
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Reset your password</h2>
            <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-6">Enter your email and we&apos;ll send you a reset link.</p>

            <form onSubmit={handleReset} className="flex flex-col gap-4">
              <div>
                <label htmlFor="reset-email" className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Email</label>
                <input
                  id="reset-email"
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

              {error && (
                <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <TurnstileField ref={captchaRef} onVerify={setCaptchaToken} onExpire={() => setCaptchaToken(null)} />

              <button type="submit" disabled={resetLoading || pendingAction === 'reset'} className="btn-primary w-full mt-1">
                {pendingAction === 'reset' ? 'Verifying…' : resetLoading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <p className="text-sm text-center text-[#6e6e73] dark:text-[#ebebf0] mt-5">
              <button onClick={() => setResetMode(false)} className="text-[#7C3AED] hover:underline font-medium">
                Back to sign in
              </button>
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="card p-8">
      <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Welcome back</h2>
      <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-6">Pick up where you left off — your drafts, brand profile and connected platforms are right where you parked them.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="login-email" className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Email</label>
          <input
            id="login-email"
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
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="login-password" className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Password</label>
            <button
              type="button"
              onClick={() => setResetMode(true)}
              className="text-xs text-[#7C3AED] hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <input
            id="login-password"
            name="password"
            autoComplete="current-password"
            type="password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            className="input-field"
          />
        </div>

        {error && (
          <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <TurnstileField ref={captchaRef} onVerify={setCaptchaToken} onExpire={() => setCaptchaToken(null)} />

        <button type="submit" disabled={loading || pendingAction === 'signin'} className="btn-primary w-full mt-1">
          {pendingAction === 'signin' ? 'Verifying…' : loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-sm text-center text-[#6e6e73] dark:text-[#ebebf0] mt-5">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="text-[#7C3AED] hover:underline font-medium">
          Sign up
        </Link>
      </p>
    </div>
  )
}
