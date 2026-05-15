'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SignupForm() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
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
          We sent a confirmation link to <strong>{email}</strong>. Click it to unlock your 15 free
          reviews — no card required. (Check spam if it doesn&apos;t show in a minute.)
        </p>
      </div>
    )
  }

  return (
    <div className="card p-8">
      <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Start free — 15 reviews on the house</h2>
      <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-6">No credit card. The full agent pipeline, the YouTube autopilot, and a branded review site — unlocked the moment you confirm your email.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Full name</label>
          <input
            type="text"
            required
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="Jane Smith"
            className="input-field"
          />
        </div>

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
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Password</label>
          <input
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

        <button type="submit" disabled={loading} className="btn-primary w-full mt-1">
          {loading ? 'Creating account…' : 'Create my free account'}
        </button>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] text-center mt-1">
          No credit card · Cancel anytime · 15 free reviews to try the full workflow
        </p>
      </form>

      <p className="text-sm text-center text-[#6e6e73] dark:text-[#ebebf0] mt-5">
        Already have an account?{' '}
        <Link href="/login" className="text-[#0071e3] hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </div>
  )
}
