'use client'

import { useEffect, useRef, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Search, Loader2, CheckCircle, AlertCircle, User as UserIcon, ChevronLeft, ChevronRight, Users as UsersIcon, Mail, Send } from 'lucide-react'

type Tier = 'trial' | 'creator' | 'amazon' | 'studio' | 'pro' | 'admin'

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

/** A row in the browse list — lighter than TargetUser (no post count). */
interface ListUser {
  id: string
  email: string
  createdAt: string
  lastSignInAt: string | null
  tier: Tier
  wordpressUrl: string | null
  brandName: string | null
}

const TIER_BADGE: Record<Tier, string> = {
  trial:   'bg-gray-100 text-[#6e6e73]',
  creator: 'bg-[#ff3b30]/10 text-[#ff3b30]',   // red
  amazon:  'bg-[#d97706]/10 text-[#d97706]',   // amazon orange
  studio:  'bg-[#007aff]/10 text-[#007aff]',   // blue
  pro:     'bg-[#34c759]/10 text-[#34c759]',   // green
  admin:   'bg-[#ff9500]/10 text-[#ff9500]',   // orange
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

  // Direct message
  const [msgOpen, setMsgOpen] = useState(false)
  const [msgSubject, setMsgSubject] = useState('')
  const [msgBody, setMsgBody] = useState('')
  const [msgSending, setMsgSending] = useState(false)
  const [msgConfirm, setMsgConfirm] = useState(false)
  const [msgSent, setMsgSent] = useState<string | null>(null)
  const [msgError, setMsgError] = useState<string | null>(null)

  // Browse list
  const [list, setList] = useState<ListUser[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [listPage, setListPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const detailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { loadList(1) }, [])

  async function loadList(page: number) {
    setListLoading(true)
    setListError(null)
    try {
      const res = await fetch(`/api/admin/users-list?page=${page}&perPage=50`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load users')
      setList((data.users ?? []) as ListUser[])
      setListPage(page)
      setHasMore(!!data.hasMore)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load users')
    } finally {
      setListLoading(false)
    }
  }

  // Accepts an optional email so a row click can open that user's detail card,
  // reusing the whole lookup → detail → tier-change flow the search box uses.
  async function lookup(overrideEmail?: string) {
    const em = (overrideEmail ?? email).trim()
    if (!em) return
    if (overrideEmail) setEmail(overrideEmail)
    setLooking(true)
    setLookupError(null)
    setUser(null)
    setSavedMsg(null)
    setSaveError(null)
    // Never carry a half-typed message across to a DIFFERENT user — that's how
    // the wrong person gets emailed.
    setMsgOpen(false)
    setMsgSubject('')
    setMsgBody('')
    setMsgConfirm(false)
    setMsgSent(null)
    setMsgError(null)
    try {
      const res = await fetch('/api/admin/user-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Lookup failed')
      setUser(data.user as TargetUser)
      setNewTier(data.user.tier as Tier)
      // Bring the detail card into view — the list can be far down the page.
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setLooking(false)
    }
  }

  // Two-step on purpose: the first click arms, the second sends. An email to a
  // customer can't be recalled, and the confirm line restates WHO it's going to
  // — the one detail that makes a misfire obvious before it happens.
  async function sendMessage() {
    if (!user) return
    if (!msgConfirm) { setMsgConfirm(true); setMsgError(null); return }
    setMsgSending(true)
    setMsgError(null)
    try {
      const res = await fetch('/api/admin/message-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, subject: msgSubject, body: msgBody }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `Send failed (${res.status})`)
      setMsgSent(`Sent to ${data.to}`)
      setMsgSubject('')
      setMsgBody('')
      setMsgConfirm(false)
      setMsgOpen(false)
    } catch (err) {
      setMsgError(err instanceof Error ? err.message : 'Send failed')
      setMsgConfirm(false)
    } finally {
      setMsgSending(false)
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
      <PageHero
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
            onClick={() => lookup()}
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
        <div ref={detailRef} className="card p-5 max-w-2xl mt-5">
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
            <Field label="WordPress">{user.wordpressUrl ? <a href={user.wordpressUrl} target="_blank" rel="noreferrer" className="text-[#7C3AED] hover:underline truncate inline-block max-w-[200px]">{user.wordpressUrl.replace(/^https?:\/\//, '')}</a> : <span className="italic text-[#86868b]">not connected</span>}</Field>
          </div>

          {/* Direct message — account-specific updates ("your Telegram is
              fixed", "reconnect X"). Replies come back to the admin's inbox. */}
          <div className="border-t border-gray-100 dark:border-white/10 pt-4 mb-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Message this user</p>
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
                  Emails {user.email} directly. Replies come back to you.
                </p>
              </div>
              {!msgOpen && (
                <button
                  onClick={() => { setMsgOpen(true); setMsgSent(null); setMsgError(null) }}
                  className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0"
                >
                  <Mail size={13} /> Message
                </button>
              )}
              {msgSent && !msgOpen && (
                <span className="text-xs text-[#34c759] flex items-center gap-1">
                  <CheckCircle size={12} /> {msgSent}
                </span>
              )}
            </div>

            {msgOpen && (
              <div className="mt-3 space-y-2">
                <input
                  value={msgSubject}
                  onChange={e => { setMsgSubject(e.target.value); setMsgConfirm(false) }}
                  placeholder="Subject — e.g. Your Telegram posts are fixed"
                  maxLength={200}
                  className="input-field text-sm w-full"
                />
                <textarea
                  value={msgBody}
                  onChange={e => { setMsgBody(e.target.value); setMsgConfirm(false) }}
                  rows={7}
                  maxLength={10_000}
                  placeholder={'Write it the way you\'d say it.\n\nBlank lines become paragraphs. It goes out on MVP letterhead, signed off with your reply address.'}
                  className="input-field text-sm w-full leading-relaxed"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={sendMessage}
                    disabled={msgSending || !msgSubject.trim() || !msgBody.trim()}
                    className="btn-primary text-sm flex items-center gap-1.5"
                  >
                    {msgSending
                      ? <><Loader2 size={13} className="animate-spin" /> Sending…</>
                      : msgConfirm
                        ? <><Send size={13} /> Confirm send</>
                        : <><Send size={13} /> Send</>}
                  </button>
                  <button
                    onClick={() => { setMsgOpen(false); setMsgConfirm(false); setMsgError(null) }}
                    disabled={msgSending}
                    className="btn-secondary text-sm"
                  >
                    Cancel
                  </button>
                  {msgConfirm && !msgSending && (
                    <span className="text-xs text-[#ff9500] flex items-center gap-1">
                      <AlertCircle size={12} /> Sends to {user.email} — click again to confirm.
                    </span>
                  )}
                  {msgError && (
                    <span className="text-xs text-[#ff3b30] flex items-center gap-1">
                      <AlertCircle size={12} /> {msgError}
                    </span>
                  )}
                </div>
              </div>
            )}
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
                <option value="amazon">Amazon — $79/mo</option>
                <option value="studio">Studio — $99/mo</option>
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

      {/* ── All users (browse) ─────────────────────────────────────────────── */}
      <div className="card p-0 mt-5 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 dark:border-white/10">
          <UsersIcon size={15} className="text-[#86868b]" />
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">All users</p>
          <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">· click a row to manage</span>
          <button
            onClick={() => loadList(listPage)}
            disabled={listLoading}
            className="ml-auto text-[11px] text-[#7C3AED] hover:underline disabled:opacity-50 inline-flex items-center gap-1"
          >
            {listLoading ? <Loader2 size={11} className="animate-spin" /> : null} Refresh
          </button>
        </div>

        {listError ? (
          <p className="text-xs text-[#ff3b30] px-5 py-4 flex items-center gap-1.5"><AlertCircle size={12} /> {listError}</p>
        ) : listLoading && list.length === 0 ? (
          <div className="flex items-center gap-2 text-sm px-5 py-8 justify-center text-[#86868b]">
            <Loader2 size={16} className="animate-spin" /> Loading users…
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-[#86868b] px-5 py-8 text-center">No users found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b] dark:text-[#8e8e93] border-b border-gray-100 dark:border-white/10">
                  <th className="text-left font-semibold px-5 py-2.5">Email</th>
                  <th className="text-left font-semibold px-3 py-2.5">Tier</th>
                  <th className="text-left font-semibold px-3 py-2.5">Brand</th>
                  <th className="text-left font-semibold px-3 py-2.5">Signed up</th>
                  <th className="text-left font-semibold px-3 py-2.5">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => lookup(u.email)}
                    className="border-b border-gray-50 dark:border-white/5 last:border-0 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <td className="px-5 py-2.5 text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap">{u.email || <span className="italic text-[#86868b]">no email</span>}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${TIER_BADGE[u.tier] ?? TIER_BADGE.trial}`}>{u.tier}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[#6e6e73] dark:text-[#ebebf0] max-w-[160px] truncate">{u.brandName || <span className="italic text-[#86868b]">—</span>}</td>
                    <td className="px-3 py-2.5 text-[#6e6e73] dark:text-[#ebebf0] whitespace-nowrap">{u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td className="px-3 py-2.5 text-[#6e6e73] dark:text-[#ebebf0] whitespace-nowrap">{u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {(list.length > 0 || listPage > 1) && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-white/10">
            <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">Page {listPage}{list.length > 0 ? ` · ${list.length} shown` : ''}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => loadList(listPage - 1)}
                disabled={listLoading || listPage <= 1}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-[12px] inline-flex items-center gap-1 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                <ChevronLeft size={13} /> Prev
              </button>
              <button
                onClick={() => loadList(listPage + 1)}
                disabled={listLoading || !hasMore}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-[12px] inline-flex items-center gap-1 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
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
