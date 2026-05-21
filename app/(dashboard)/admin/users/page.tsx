'use client'

import { useState } from 'react'
import Header from '@/components/layout/Header'
import { Search, Loader2, CheckCircle, AlertCircle, User as UserIcon } from 'lucide-react'

type Tier = 'trial' | 'creator' | 'pro' | 'admin'

interface TargetUser {
  id: string
  email: string
  createdAt: string
  lastSignInAt: string | null
  tier: Tier
  wordpressUrl: string | null
  brandName: string | null
  authorName: string | null
  postCount: number
}

const TIER_BADGE: Record<Tier, string> = {
  trial:   'bg-gray-100 text-[#6e6e73]',
  creator: 'bg-[#0071e3]/10 text-[#0071e3]',
  pro:     'bg-[#34c759]/10 text-[#34c759]',
  admin:   'bg-[#ff9500]/10 text-[#ff9500]',
}

export default function AdminUsersPage() {
  const [email, setEmail] = useState('')
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [user, setUser] = useState<TargetUser | null>(null)

  const [newTier, setNewTier] = useState<Tier>('pro')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function lookup() {
    if (!email.trim()) return
    setLooking(true)
    setLookupError(null)
    setUser(null)
    setSavedMsg(null)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/user-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Lookup failed')
      setUser(data.user as TargetUser)
      setNewTier(data.user.tier as Tier)
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setLooking(false)
    }
  }

  async function applyTier() {
    if (!user) return
    setSaving(true)
    setSavedMsg(null)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/set-tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, tier: newTier }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setUser({ ...user, tier: newTier })
      setSavedMsg(`Tier updated to ${newTier}.`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Header
        title="Admin · Users"
        subtitle="Look up a user by email and bump their tier. Changes are immediate — affects their next request."
      />

      <div className="card p-5 max-w-2xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Find a user</p>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookup()}
            placeholder="user@example.com"
            className="input-field flex-1 text-sm"
            autoComplete="off"
          />
          <button
            onClick={lookup}
            disabled={looking || !email.trim()}
            className="btn-primary flex items-center gap-1.5 text-sm whitespace-nowrap"
          >
            {looking ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            Look up
          </button>
        </div>
        {lookupError && (
          <p className="text-xs text-[#ff3b30] mt-2 flex items-center gap-1.5">
            <AlertCircle size={11} /> {lookupError}
          </p>
        )}
      </div>

      {user && (
        <div className="card p-5 max-w-2xl mt-5">
          <div className="flex items-start gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center flex-shrink-0">
              <UserIcon size={18} className="text-[#86868b]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{user.email}</p>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5 font-mono">{user.id}</p>
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${TIER_BADGE[user.tier]}`}>
              {user.tier}
            </span>
          </div>

          {/* User stats */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs mb-5">
            <Field label="Signed up">{new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Field>
            <Field label="Last sign-in">{user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</Field>
            <Field label="Posts published">{user.postCount}</Field>
            <Field label="Brand">{user.brandName || <span className="italic text-[#86868b]">not set</span>}</Field>
            <Field label="WordPress">{user.wordpressUrl ? <a href={user.wordpressUrl} target="_blank" rel="noreferrer" className="text-[#0071e3] hover:underline truncate inline-block max-w-[200px]">{user.wordpressUrl.replace(/^https?:\/\//, '')}</a> : <span className="italic text-[#86868b]">not connected</span>}</Field>
          </div>

          {/* Tier change */}
          <div className="border-t border-gray-100 dark:border-white/10 pt-4">
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Change tier</p>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={newTier}
                onChange={e => setNewTier(e.target.value as Tier)}
                disabled={saving}
                className="input-field text-sm w-auto"
              >
                <option value="trial">Free Trial</option>
                <option value="creator">Creator — $49/mo</option>
                <option value="pro">Pro — $199/mo</option>
                <option value="admin">Admin (god mode)</option>
              </select>
              <button
                onClick={applyTier}
                disabled={saving || newTier === user.tier}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : 'Apply'}
              </button>
              {savedMsg && (
                <span className="text-xs text-[#34c759] flex items-center gap-1">
                  <CheckCircle size={12} /> {savedMsg}
                </span>
              )}
              {saveError && (
                <span className="text-xs text-[#ff3b30] flex items-center gap-1">
                  <AlertCircle size={12} /> {saveError}
                </span>
              )}
            </div>
            {newTier === user.tier && !savedMsg && (
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2">Already on {user.tier}. Pick a different tier to change it.</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] mb-0.5">{label}</p>
      <p className="text-[#1d1d1f] dark:text-[#f5f5f7]">{children}</p>
    </div>
  )
}
