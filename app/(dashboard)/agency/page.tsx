'use client'

/**
 * /agency — Virtual Assistants management (the page is still mounted at
 * /agency since the API + DB tables are named agency_*; user-facing copy
 * everywhere says "Virtual Assistants").
 *
 *   - Invite a new VA by email + permission set + optional note
 *   - List pending invites with their age (revoke + re-invite)
 *   - List active VAs with their permissions (revoke + edit perms inline)
 *   - Show "N of M seats used" gauge (or "Unlimited" for admin)
 *
 * Non-Pro users get the paywall card — same pattern as /developers + /branding.
 *
 * IMPORTANT: This is Phase 1 — VAs can be invited and accept the
 * invite (creating the agency_members row), but they don't yet inherit
 * the owner's resources. Phase 2 wires getOwnerUserId() into every
 * route that filters by user_id.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Users, Lock, Plus, Mail, Trash2, Clock, Shield, User as UserIcon, Check, X as XIcon } from 'lucide-react'
import { useConfirm } from '@/components/ui/useConfirm'
// Import from the client-safe file — '@/lib/agency' pulls in node:crypto
// (for invite-token generation) which can't bundle for the browser.
import {
  VA_PERMISSION_KEYS, VA_PERMISSION_META, DEFAULT_VA_PERMISSIONS,
  type VaPermissions, type VaPermissionKey,
} from '@/lib/agency-permissions'

interface InviteRow {
  id: string
  email: string
  role: 'admin' | 'member'
  note: string | null
  permissions: VaPermissions | null
  created_at: string
}
interface MemberRow {
  id: string
  member_user_id: string
  role: 'admin' | 'member'
  permissions: VaPermissions | null
  created_at: string
}
interface AgencyState {
  tier: string
  seatCeiling: number | null
  seatCeilingUnbounded: boolean
  seatsUsed: number
  seatsRemaining: number | null
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
  const [permissions, setPermissions] = useState<VaPermissions>({ ...DEFAULT_VA_PERMISSIONS })
  const [inviting, setInviting] = useState(false)
  // Member id whose permissions panel is currently expanded for editing.
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [memberDraftPerms, setMemberDraftPerms] = useState<VaPermissions | null>(null)
  const [savingMember, setSavingMember] = useState(false)

  useEffect(() => { void refresh() }, [])

  async function refresh() {
    try {
      const res = await fetch('/api/agency')
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        toast.error(`Could not load Virtual Assistants${body ? `: ${body.slice(0, 120)}` : ''}`)
        return
      }
      const data = await res.json()
      setState(data)
    } catch (err) {
      // Network blip / response.json() throws — without this catch the
      // page sat on the paywall card even on Pro because state stayed null.
      toast.error(err instanceof Error ? err.message : 'Could not load Virtual Assistants')
    } finally {
      setLoading(false)
    }
  }

  function togglePermission(key: VaPermissionKey) {
    setPermissions(prev => ({ ...prev, [key]: !prev[key] }))
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
          permissions,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to send invite')
        return
      }
      toast.success(`Invite sent to ${email.trim()}`)
      setEmail(''); setRole('member'); setNote('')
      setPermissions({ ...DEFAULT_VA_PERMISSIONS })
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
      title: 'Revoke this Virtual Assistant?',
      description: 'The VA will lose access to your account immediately. Their account stays open but is no longer linked to your workspace.',
      confirmLabel: 'Revoke access',
      destructive: true,
    }))) return
    const res = await fetch(`/api/agency/members/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Failed to revoke access')
      return
    }
    toast.success('Access revoked')
    void refresh()
  }

  function startEditMember(m: MemberRow) {
    setEditingMemberId(m.id)
    setMemberDraftPerms({ ...DEFAULT_VA_PERMISSIONS, ...(m.permissions || {}) })
  }

  function toggleMemberDraftPerm(key: VaPermissionKey) {
    setMemberDraftPerms(prev => prev ? { ...prev, [key]: !prev[key] } : prev)
  }

  async function saveMemberPermissions(id: string) {
    if (!memberDraftPerms) return
    setSavingMember(true)
    try {
      const res = await fetch(`/api/agency/members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: memberDraftPerms }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to update permissions')
        return
      }
      toast.success('Permissions updated')
      setEditingMemberId(null)
      setMemberDraftPerms(null)
      void refresh()
    } finally {
      setSavingMember(false)
    }
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto p-8 text-sm text-gray-500">Loading…</div>
  }

  const isPro = state?.tier === 'pro' || state?.tier === 'admin'
  if (!isPro || !state) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users size={22} /> Virtual Assistants
        </h1>
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50">
          <Lock size={32} className="mx-auto text-gray-400 mb-3" />
          <h2 className="text-lg font-semibold mb-2">Virtual Assistants are a Pro feature</h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto mb-5">
            Invite VAs or contractors to your MVP Affiliate workspace with scoped permissions.
            Each VA gets their own login but only the access you explicitly grant — they can't
            see your billing, brand profile, or integrations.
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

  const canInvite = state.seatCeilingUnbounded || (state.seatsRemaining ?? 0) > 0
  const seatsCopy = state.seatCeilingUnbounded
    ? `${state.seatsUsed} active`
    : `${state.seatsUsed} of ${state.seatCeiling} seats used`

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users size={22} /> Virtual Assistants
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Invite VAs or contractors with scoped permissions. They get their own login on your
          single Pro subscription. <b>{seatsCopy}</b>.
        </p>
      </div>

      {/* Roll-out banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
        <b>Phase 1 — invites + roster:</b> VAs can accept and appear in your team list. Full
        resource sharing (content library, integrations) rolls out in Phase 2 — we'll email
        when it's live. VAs already CANNOT access: brand profile, blog customization,
        integrations, WordPress settings, billing, or this page.
      </div>

      {/* Invite form */}
      <div className="border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Invite a Virtual Assistant
        </h2>
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="va@example.com"
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
              <option value="member">Member — can use granted permissions</option>
              <option value="admin">Admin — can also manage other VAs</option>
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

          {/* Permissions grid */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              What this VA can do
            </p>
            <p className="text-[11px] text-gray-500">
              VAs can NEVER access: billing, brand profile, integrations, WordPress settings,
              blog customization, API keys, or this page. Those are owner-only.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {VA_PERMISSION_KEYS.map(key => {
                const meta = VA_PERMISSION_META[key]
                return (
                  <label key={key} className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={permissions[key]}
                      onChange={() => togglePermission(key)}
                      disabled={!canInvite}
                      className="accent-[#7C3AED] mt-0.5"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{meta.label}</span>
                      <span className="block text-[11px] text-gray-500 leading-tight">{meta.help}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

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
              All seats used. Revoke a VA or cancel a pending invite to add someone new.
            </p>
          )}
        </div>
      </div>

      {/* Active VAs */}
      <div className="border rounded-xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Active VAs ({state.members.length})
        </h2>
        {state.members.length === 0 ? (
          <p className="text-sm text-gray-500">
            No active VAs yet. Invite someone above — they'll appear here once they accept.
          </p>
        ) : (
          <ul className="divide-y">
            {state.members.map(m => {
              const editing = editingMemberId === m.id
              const memberPerms = m.permissions || DEFAULT_VA_PERMISSIONS
              const grantedCount = VA_PERMISSION_KEYS.filter(k => memberPerms[k]).length
              return (
                <li key={m.id} className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
                      {m.role === 'admin' ? <Shield size={16} className="text-amber-600" /> : <UserIcon size={16} className="text-gray-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono text-gray-500 truncate">{m.member_user_id.slice(0, 8)}…</div>
                      <div className="text-xs text-gray-500">
                        {m.role === 'admin' ? 'Admin' : 'Member'} · joined {new Date(m.created_at).toLocaleDateString()}
                        {' · '}
                        <button
                          onClick={() => editing ? setEditingMemberId(null) : startEditMember(m)}
                          className="text-[#7C3AED] hover:underline"
                        >
                          {grantedCount} of {VA_PERMISSION_KEYS.length} permissions {editing ? '(close)' : '(edit)'}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => void handleRevokeMember(m.id)}
                      className="text-red-600 hover:bg-red-50 rounded p-1.5"
                      title="Revoke access"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {editing && memberDraftPerms && (
                    <div className="mt-3 ml-12 border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {VA_PERMISSION_KEYS.map(key => {
                          const meta = VA_PERMISSION_META[key]
                          return (
                            <label key={key} className="flex items-start gap-2 cursor-pointer p-1.5 rounded hover:bg-white">
                              <input
                                type="checkbox"
                                checked={memberDraftPerms[key]}
                                onChange={() => toggleMemberDraftPerm(key)}
                                className="accent-[#7C3AED] mt-0.5"
                              />
                              <span className="text-xs">{meta.label}</span>
                            </label>
                          )
                        })}
                      </div>
                      <div className="flex items-center gap-2 pt-2">
                        <button
                          onClick={() => void saveMemberPermissions(m.id)}
                          disabled={savingMember}
                          className="px-3 py-1.5 text-xs font-semibold text-white rounded inline-flex items-center gap-1 disabled:opacity-50"
                          style={{ background: '#7C3AED' }}
                        >
                          <Check size={11} /> {savingMember ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setEditingMemberId(null); setMemberDraftPerms(null) }}
                          className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 rounded inline-flex items-center gap-1"
                        >
                          <XIcon size={11} /> Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
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
            {state.invites.map(inv => {
              const invPerms = inv.permissions || DEFAULT_VA_PERMISSIONS
              const grantedCount = VA_PERMISSION_KEYS.filter(k => invPerms[k]).length
              return (
                <li key={inv.id} className="py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
                    <Mail size={16} className="text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{inv.email}</div>
                    <div className="text-xs text-gray-500 inline-flex items-center gap-1.5">
                      <Clock size={11} /> Sent {new Date(inv.created_at).toLocaleDateString()} ·{' '}
                      {inv.role === 'admin' ? 'Admin' : 'Member'} · {grantedCount} permission{grantedCount === 1 ? '' : 's'}
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
              )
            })}
          </ul>
        )}
      </div>
      <ConfirmHost />
    </div>
  )
}
