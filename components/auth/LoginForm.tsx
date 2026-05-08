'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setResetLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setResetLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setResetSent(true)
    }
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
            <button onClick={() => { setResetMode(false); setResetSent(false) }} className="text-sm text-[#0071e3] hover:underline">
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Reset your password</h2>
            <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-6">Enter your email and we&apos;ll send you a reset link.</p>

            <form onSubmit={handleReset} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Email</label>
                <input
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

              <button type="submit" disabled={resetLoading} className="btn-primary w-full mt-1">
                {resetLoading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <p className="text-sm text-center text-[#6e6e73] dark:text-[#ebebf0] mt-5">
              <button onClick={() => setResetMode(false)} className="text-[#0071e3] hover:underline font-medium">
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
      <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-6">Sign in to your MVP Affiliate account.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Email</label>
          <input
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
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Password</label>
            <button
              type="button"
              onClick={() => setResetMode(true)}
              className="text-xs text-[#0071e3] hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <input
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

        <button type="submit" disabled={loading} className="btn-primary w-full mt-1">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-sm text-center text-[#6e6e73] dark:text-[#ebebf0] mt-5">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="text-[#0071e3] hover:underline font-medium">
          Sign up
        </Link>
      </p>
    </div>
  )
}
