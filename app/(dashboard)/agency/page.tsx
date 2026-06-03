'use client'

/**
 * /agency — Pro tier agency seat management.
 *
 *   - Invite a new member by email + role + optional note
 *   - List pending invites with their age (revoke + re-invite)
 *   - List active members with their role (revoke)
 *   - Show "N of M seats used" gauge
 *
 * Non-Pro users get the paywall card — same pattern as /developers + /branding.
 *
 * IMPORTANT: This is Phase 1 — members can be invited and accept the
 * invite (creating the agency_members row), but they don't yet inherit
 * the owner's resources. Phase 2 wires getOwnerUserId() into every
 * route that filters by user_id.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Users, Lock, Plus, Mail, Trash2, Clock, Shield, User as UserIcon } from 'lucide-react'
import { useConfirm } from '@/components/ui/useConfirm'

interface InviteRow {
  id: string
  email: string
  role: 'admin' | 'member'
  note: string | null
  created_at: string
}
interface MemberRow {
  id: string
  member_user_id: string
  role: 'admin' | 'member'
  created_at: string
}
interface AgencyState {
  tier: string
  seatCeiling: number
  seatsUsed: number
  seatsRemaining: number
  members: MemberRow[]
  invites: InviteRow[]
}

export default function AgencyPage() {
  const { confirm, ConfirmHost } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<AgencyState | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [note, setNote] = useState('')
  const [inviting, setInviting] = useState(false)

  useEffect(() => { void refresh() }, [])

  async function refresh() {
    try {
      const res = await fetch('/api/agency')
      if (!res.ok) return
      const data = await res.json()
      setState(data)
    } finally {
      setLoading(false)
    }
  }

  async function handleInvite() {
    if (!email.trim()) {
      toast.error('Enter an email')
      return
    }
    setInviting(true)
    try {
      const res = await fetch('/api/agency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          role,
          note: note.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to send invite')
        return
      }
      toast.success(`Invite sent to ${email.trim()}`)
      setEmail(''); setRole('member'); setNote('')
      void refresh()
    } finally {
      setInviting(false)
    }
  }

  async function handleRevokeInvite(id: string, email: string) {
    if (!(await confirm({
      title: 'Cancel this invite?',
      description: `The invite to "${email}" will be revoked and the link won't work anymore. You can re-invite the same email afterwards.`,
      confirmLabel: 'Cancel invite',
      destructive: true,
    }))) return
    const res = await fetch(`/api/agency/invites/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Failed to cancel invite')
      return
    }
    toast.success(`Cancelled invite to ${email}`)
    void refresh()
  }

  async function handleRevokeMember(id: string) {
    if (!(await confirm({
      title: 'Revoke this agency seat?',
      description: 'The member will lose access to your account immediately. Their account stays open but is no longer linked to your workspace.',
      confirmLabel: 'Revoke seat',
      destructive: true,
    }))) return
    const res = await fetch(`/api/agency/members/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Failed to revoke seat')
      return
    }
    toast.success('Seat revoked')
    void refresh()
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto p-8 text-sm text-gray-500">Loading…</div>
  }

  const isPro = state?.tier === 'pro' || state?.tier === 'admin'
  if (!isPro || !state) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users size={22} /> Agency Seats
        </h1>
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50">
          <Lock size={32} className="mx-auto text-gray-400 mb-3" />
          <h2 className="text-lg font-semibold mb-2">Agency seats are a Pro feature</h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto mb-5">
            Invite up to 3 teammates or contractors to your MVP Affiliate workspace. They each get
            their own login, while their work counts toward your single subscription.
          </p>
          <Link
            href="/billing"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-white"
            style={{ background: '#7C3AED' }}
          >
            Upgrade to Pro
          </Link>
        </div>
      </div>
    )
  }

  const canInvite = state.seatsRemaining > 0

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users size={22} /> Agency Seats
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Invite teammates or contractors to your workspace. Each member gets their own login on your
          single Pro subscription. <b>{state.seatsUsed} of {state.seatCeiling}</b> seats used.
        </p>
      </div>

      {/* Roll-out banner — clearly call out Phase 1 vs Phase 2 */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
        <b>Phase 1 — invites + roster:</b> members can accept and appear in your team list. Full
        resource sharing (content library, brand profiles, integrations) rolls out in Phase 2 —
        we'll email you when it's live. For now, invited members can log in but will see an empty
        workspace until then.
      </div>

      {/* Invite form */}
      <div className="border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Invite a teammate
        </h2>
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            disabled={!canInvite}
            className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:opacity-50"
          />
          <div className="flex items-center gap-3">
            <select
              value={role}
              onChange={e => setRole(e.target.value as 'admin' | 'member')}
              disabled={!canInvite}
              className="px-3 py-2 border rounded-lg text-sm disabled:opacity-50"
            >
              <option value="member">Member — can create content</option>
              <option value="admin">Admin — can also manage seats</option>
            </select>
          </div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder='Personal note (optional, e.g. "welcome aboard Sarah!")'
            maxLength={280}
            rows={2}
            disabled={!canInvite}
            className="w-full px-3 py-2 border rounded-lg text-sm disabled:bg-gray-50 disabled:opacity-50"
          />
          <button
            onClick={handleInvite}
            disabled={inviting || !canInvite || !email.trim()}
            className="px-4 py-2 rounded-lg font-semibold text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: '#7C3AED' }}
          >
            <Plus size={14} /> {inviting ? 'Sending…' : 'Send invite'}
          </button>
          {!canInvite && (
            <p className="text-xs text-amber-700">
              All seats used. Revoke a member or cancel a pending invite to add someone new.
            </p>
          )}
        </div>
      </div>

      {/* Active members */}
      <div className="border rounded-xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Active members ({state.members.length})
        </h2>
        {state.members.length === 0 ? (
          <p className="text-sm text-gray-500">
            No active members yet. Invite someone above — they'll appear here once they accept.
          </p>
        ) : (
          <ul className="divide-y">
            {state.members.map(m => (
              <li key={m.id} className="py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
                  {m.role === 'admin' ? <Shield size={16} className="text-amber-600" /> : <UserIcon size={16} className="text-gray-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono text-gray-500 truncate">{m.member_user_id.slice(0, 8)}…</div>
                  <div className="text-xs text-gray-500">
                    {m.role === 'admin' ? 'Admin' : 'Member'} · joined {new Date(m.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => void handleRevokeMember(m.id)}
                  className="text-red-600 hover:bg-red-50 rounded p-1.5"
                  title="Revoke seat"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pending invites */}
      <div className="border rounded-xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Pending invites ({state.invites.length})
        </h2>
        {state.invites.length === 0 ? (
          <p className="text-sm text-gray-500">No pending invites.</p>
        ) : (
          <ul className="divide-y">
            {state.invites.map(inv => (
              <li key={inv.id} className="py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
                  <Mail size={16} className="text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{inv.email}</div>
                  <div className="text-xs text-gray-500 inline-flex items-center gap-1.5">
                    <Clock size={11} /> Sent {new Date(inv.created_at).toLocaleDateString()} ·{' '}
                    {inv.role === 'admin' ? 'Admin' : 'Member'}
                  </div>
                  {inv.note && <div className="text-xs text-gray-500 italic mt-0.5">"{inv.note}"</div>}
                </div>
                <button
                  onClick={() => void handleRevokeInvite(inv.id, inv.email)}
                  className="text-red-600 hover:bg-red-50 rounded p-1.5"
                  title="Cancel invite"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmHost />
    </div>
  )
}
