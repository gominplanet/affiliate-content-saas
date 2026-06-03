'use client'

/**
 * /agency/accept/[token] — Invite-acceptance landing page.
 *
 * The recipient clicks the link in their email and lands here. We check
 * their session:
 *   - Logged in   → POST /api/agency/accept with the token, show success/failure
 *   - Logged out  → redirect to /signup?next=/agency/accept/[token]
 *                   (signup page already supports next=)
 *
 * The actual authorization (email match, TTL, prior membership check) lives
 * server-side in /api/agency/accept. This page is just the UX shell.
 */

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '@/lib/supabase/client'
import { CheckCircle2, AlertTriangle, Loader2, Users } from 'lucide-react'

type Phase = 'checking' | 'unauthed' | 'accepting' | 'success' | 'error'

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('checking')
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const supabase = createBrowserClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setPhase('unauthed')
        return
      }
      setPhase('accepting')
      try {
        const res = await fetch('/api/agency/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Failed to accept invite')
          setErrorCode(data.code || null)
          setPhase('error')
          return
        }
        setOwnerId(data.ownerUserId)
        setPhase('success')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error')
        setPhase('error')
      }
    })()
  }, [token])

  return (
    <div className="max-w-md mx-auto p-6 mt-12 space-y-6">
      <div className="text-center space-y-2">
        <Users size={32} className="mx-auto text-[#7C3AED]" />
        <h1 className="text-2xl font-bold">Agency invite</h1>
      </div>

      {phase === 'checking' && (
        <div className="border rounded-xl p-8 text-center space-y-3">
          <Loader2 size={24} className="mx-auto animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Checking your invite…</p>
        </div>
      )}

      {phase === 'unauthed' && (
        <div className="border rounded-xl p-8 text-center space-y-4">
          <p className="text-sm">Sign in or sign up to accept your invite.</p>
          <div className="flex flex-col gap-2">
            <Link
              href={`/login?next=${encodeURIComponent(`/agency/accept/${token}`)}`}
              className="px-4 py-2 rounded-lg font-semibold text-white text-sm"
              style={{ background: '#7C3AED' }}
            >
              Sign in
            </Link>
            <Link
              href={`/signup?next=${encodeURIComponent(`/agency/accept/${token}`)}`}
              className="px-4 py-2 rounded-lg border text-sm font-medium"
            >
              Create account
            </Link>
            <p className="text-xs text-gray-500 mt-2">
              Use the email the invite was sent to — the link only works for that address.
            </p>
          </div>
        </div>
      )}

      {phase === 'accepting' && (
        <div className="border rounded-xl p-8 text-center space-y-3">
          <Loader2 size={24} className="mx-auto animate-spin text-gray-400" />
          <p className="text-sm text-gray-500">Accepting…</p>
        </div>
      )}

      {phase === 'success' && (
        <div className="border border-green-200 bg-green-50 rounded-xl p-6 text-center space-y-4">
          <CheckCircle2 size={32} className="mx-auto text-green-600" />
          <div>
            <p className="font-semibold text-green-900">You're in!</p>
            <p className="text-sm text-green-800 mt-1">
              You're now a member of {ownerId ? <code className="text-xs">{ownerId.slice(0, 8)}…</code> : 'this'} workspace.
            </p>
          </div>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-5 py-2 rounded-lg font-semibold text-white text-sm"
            style={{ background: '#7C3AED' }}
          >
            Go to dashboard
          </button>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            <b>Heads up:</b> resource sharing (content library, brand profiles, integrations) rolls out
            in Phase 2. For now you can log in but the workspace owner needs to publish from their
            own login.
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div className="border border-red-200 bg-red-50 rounded-xl p-6 text-center space-y-3">
          <AlertTriangle size={32} className="mx-auto text-red-600" />
          <p className="font-semibold text-red-900">{error}</p>
          {errorCode === 'email_mismatch' && (
            <p className="text-xs text-red-700">
              Sign out and sign back in with the email the invite was sent to, then click the link
              from your email again.
            </p>
          )}
          {errorCode === 'expired' && (
            <p className="text-xs text-red-700">
              Ask the workspace owner to send a fresh invite — they expire after 14 days.
            </p>
          )}
          <Link
            href="/dashboard"
            className="inline-block px-4 py-2 rounded-lg border text-sm font-medium"
          >
            Go to dashboard
          </Link>
        </div>
      )}
    </div>
  )
}
