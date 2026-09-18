'use client'

import { useEffect, useRef, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Search, Loader2, CheckCircle, AlertCircle, User as UserIcon, ChevronLeft, ChevronRight, Users as UsersIcon, Mail, Send, Trash2 } from 'lucide-react'

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

interface UserPost {
  id: string
  title: string | null
  wordpress_post_id: number | null
  wordpress_url: string | null
  created_at: string
  status: string | null
}

interface DeleteResult {
  ok: boolean
  summary?: string
  error?: string
  results?: Array<{ id: string; title: string; outcome: string; detail: string; freedSlot: boolean }>
}

export default function AdminUsersPage() {
  const [email, setEmail] = useState('')
  // Affiliate-link preview for THIS user's posts. Read-only: the route refuses
  // anything but a dry run for another creator, so nothing here can write to
  // their site. It exists because diagnosing a customer's broken links used to
  // mean asking the customer to click a button and read the answer back.
  const [linkBusy, setLinkBusy] = useState(false)
  // Two separate facts, deliberately not merged into one sentence. `headline`
  // is what is published (counted link by link); `detail` is what the repair
  // tool can offer to change (counted post by post, one link per post). They
  // routinely disagree, and the old card printed only the second one while
  // reading like the first.
  const [linkResult, setLinkResult] = useState<{
    headline: string | null
    detail: string
    worst: Array<{ id: string; title: string; offStyle: number; total: number }>
  } | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [user, setUser] = useState<TargetUser | null>(null)

  const [newTier, setNewTier] = useState<Tier>('pro')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Direct message
  // Delete a customer's posts on their behalf. Exists because MVP's own delete
  // is scoped to the caller, so the only person who could clean up a duplicate
  // WE published was the person it happened to.
  const [postsOpen, setPostsOpen] = useState(false)
  const [postsLoading, setPostsLoading] = useState(false)
  const [userPosts, setUserPosts] = useState<UserPost[]>([])
  const [postsError, setPostsError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteResult, setDeleteResult] = useState<DeleteResult | null>(null)

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
    // Same reason as the message reset below: never carry one creator's
    // selected posts across to a different creator's card.
    setPostsOpen(false)
    setUserPosts([])
    setPicked(new Set())
    setDeleteConfirm(false)
    setDeleteResult(null)
    setPostsError(null)
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

  async function loadPosts() {
    if (!user) return
    setPostsLoading(true)
    setPostsError(null)
    try {
      const res = await fetch(`/api/admin/user-posts?userId=${encodeURIComponent(user.id)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not load posts')
      setUserPosts((data.posts ?? []) as UserPost[])
      setPostsOpen(true)
    } catch (err) {
      setPostsError(err instanceof Error ? err.message : 'Could not load posts')
    } finally {
      setPostsLoading(false)
    }
  }

  async function deletePicked() {
    if (!user || picked.size === 0) return
    setDeleting(true)
    setDeleteResult(null)
    try {
      const res = await fetch('/api/admin/user-posts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, postIds: Array.from(picked) }),
      })
      const data = await res.json().catch(() => null)
      // A call that could not report is not a call that deleted nothing, and
      // the two must not print the same sentence.
      setDeleteResult((data as DeleteResult) ?? { ok: false, error: 'The delete returned nothing readable.' })
      setPicked(new Set())
      setDeleteConfirm(false)
      await loadPosts()
    } catch (err) {
      setDeleteResult({ ok: false, error: err instanceof Error ? err.message : 'The delete could not be started.' })
    } finally {
      setDeleting(false)
    }
  }

  // Preview what Fix all affiliate links WOULD do to this user's posts.
  // dryRun is not optional here: the route rejects a non-dry run for another
  // creator, so this is the only shape that works, which is the intent.
  async function previewLinks(userId: string) {
    setLinkBusy(true); setLinkResult(null); setLinkError(null)
    try {
      const r = await fetch('/api/blog/fix-affiliate-links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, mode: 'all', asUserId: userId }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setLinkError(d.error || `Preview failed (${r.status})`); return }
      // Read the fields the route ACTUALLY returns. The first version of this
      // card read d.fixes and d.unresolved-as-an-array, neither of which exists,
      // so it rendered its own `undefined` as "0 posts would be re-pointed" for
      // an account with 113 posts needing exactly that. A number invented by the
      // reader is worse than no number.
      const toFix = typeof d.toFix === 'number' ? d.toFix : (Array.isArray(d.preview) ? d.preview.length : 0)
      const total = typeof d.total === 'number' ? d.total : null
      const unresolved = typeof d.unresolved === 'number' ? d.unresolved : 0
      const sk = (d.skipped || {}) as Record<string, number>
      const stuck = typeof d.offStyleStuckCount === 'number' ? d.offStyleStuckCount : 0

      // Every post is accounted for, not just the fixable ones. An account where
      // 120 posts all fall out for different reasons should not read the same as
      // one with nothing wrong.
      //
      // "already correct" is gone from this list on purpose. It counted posts
      // whose ONE examined link was on-style, and it was the sentence that told
      // an operator a site was fine while its pages carried raw Amazon links.
      // The census above answers that question properly; this list is now only
      // about why a post is not on offer.
      const why: string[] = []
      if (sk.alreadyRight) why.push(`${sk.alreadyRight} not offered (the link checked was on-style)`)
      if (sk.noVideo) why.push(`${sk.noVideo} no source video, never checked`)
      if (sk.noLink) why.push(`${sk.noLink} no link found`)
      if (sk.couldNotRebuild) why.push(`${sk.couldNotRebuild} could not rebuild`)
      if (sk.wouldDowngrade) why.push(`${sk.wouldDowngrade} refused (would strip cloaking)`)
      if (stuck) why.push(`${stuck} off-style but unresolvable`)
      if (unresolved) why.push(`${unresolved} unresolved`)

      const census = (d.linkCensus || null) as {
        offStyle?: number; postsAffected?: number
        worst?: Array<{ id: string; title: string; offStyle: number; total: number }>
      } | null
      const worst = Array.isArray(census?.worst) ? census!.worst.slice(0, 5) : []
      // When the census finds off-style links on more posts than the tool can
      // offer to re-point, say so here rather than leaving an operator to
      // subtract two numbers on different screens. That gap is the support
      // question: those posts need a fix the button does not perform.
      const affected = typeof census?.postsAffected === 'number' ? census.postsAffected : null
      const gap = affected !== null && affected > toFix ? affected - toFix : 0

      setLinkResult({
        headline: typeof d.censusNote === 'string' ? d.censusNote : null,
        detail:
          (d.message ? `${d.message} ` : '') +
          `Style: ${d.chosenStyleLabel || d.chosenStyle || 'unknown'} · ` +
          `${toFix} of ${total ?? '?'} posts can be re-pointed by this tool` +
          (gap ? ` · ${gap} more carry off-style links it will not touch` : '') +
          (why.length ? ` · ${why.join(' · ')}` : ''),
        worst,
      })
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : 'Preview failed')
    } finally { setLinkBusy(false) }
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

          {/* Affiliate links — READ ONLY. Shows what the fixer would change on
              this creator's posts without touching their site. Applying stays
              theirs to do, from their own account. */}
          <div className="border-t border-gray-100 dark:border-white/10 pt-4 mb-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Affiliate links</p>
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
                  Preview only. Shows what Fix all affiliate links would change. Nothing is written to their site.
                </p>
              </div>
              <button
                onClick={() => void previewLinks(user.id)}
                disabled={linkBusy}
                className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0 disabled:opacity-60"
              >
                {linkBusy ? 'Checking…' : 'Preview link fixes'}
              </button>
            </div>
            {linkResult && (
              <div className="mt-2 rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(124,58,237,0.08)', color: 'var(--text-2,#1d1d1f)' }}>
                {/* What is on the pages, first and in the heavier weight,
                    because it is the thing the creator can check by looking. */}
                {linkResult.headline && (
                  <p className="text-[12px] font-semibold">{linkResult.headline}</p>
                )}
                <p className={`text-[12px] ${linkResult.headline ? 'mt-1 opacity-80' : ''}`}>{linkResult.detail}</p>
                {linkResult.worst.length > 0 && (
                  <ul className="text-[11px] mt-1.5 space-y-0.5 opacity-80">
                    {linkResult.worst.map((w) => (
                      <li key={w.id} className="truncate">
                        {w.offStyle} of {w.total} off-style · {w.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {linkError && (
              <p className="text-[12px] mt-2 rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(245,158,11,0.10)', color: '#b45309' }}>
                {linkError}
              </p>
            )}
          </div>

          {/* Delete posts on the creator's behalf.
              The monthly allowance is COUNT(blog_posts) in the billing window,
              not a counter, so removing the row here is what actually returns
              the slot. Deleting in WP admin would take the post off their site
              and leave the slot spent, which is not something a customer should
              have to know. */}
          <div className="border-t border-gray-100 dark:border-white/10 pt-4 mb-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Delete posts for this user</p>
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5">
                  Removes them from their site and from MVP, which puts the slot back on their monthly allowance.
                </p>
              </div>
              {!postsOpen && (
                <button onClick={loadPosts} disabled={postsLoading} className="btn-secondary text-sm flex items-center gap-1.5 flex-shrink-0">
                  {postsLoading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  {postsLoading ? 'Loading' : 'Their posts'}
                </button>
              )}
            </div>

            {postsError && <p className="text-[11px] text-[#ff3b30] mt-2">{postsError}</p>}

            {deleteResult && (
              <div className="mt-3 rounded-lg p-3" style={{ backgroundColor: deleteResult.ok === false ? '#ff3b3012' : '#f5f5f710' }}>
                <p className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {deleteResult.ok === false
                    ? `The delete could not run, so nothing was changed. ${deleteResult.error ?? ''}`
                    : deleteResult.summary}
                </p>
                {(deleteResult.results ?? []).length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {(deleteResult.results ?? []).map(r => (
                      <li key={r.id} className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">
                        <span className={r.freedSlot ? 'text-[#34c759]' : 'text-[#ff9500]'}>{r.outcome}</span>
                        {' · '}{r.title}{' · '}<span className="text-[#86868b]">{r.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {postsOpen && (
              <div className="mt-3">
                {userPosts.length === 0 ? (
                  <p className="text-[12px] text-[#86868b]">This account has no posts on record.</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-1 max-h-72 overflow-y-auto pr-1">
                      {userPosts.map(p => (
                        <li key={p.id} className="flex items-start gap-2 py-1 border-b border-gray-100 dark:border-white/5 last:border-0">
                          <input
                            type="checkbox"
                            className="mt-1 flex-shrink-0"
                            checked={picked.has(p.id)}
                            onChange={e => {
                              const next = new Set(picked)
                              if (e.target.checked) next.add(p.id)
                              else next.delete(p.id)
                              setPicked(next)
                              setDeleteConfirm(false)
                            }}
                          />
                          <div className="min-w-0">
                            <p className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{p.title || 'Untitled'}</p>
                            <p className="text-[10px] text-[#86868b]">
                              {p.created_at?.slice(0, 10)}
                              {p.wordpress_post_id ? ` · wp #${p.wordpress_post_id}` : ' · never published'}
                              {p.wordpress_url ? ` · ${(() => { try { return new URL(p.wordpress_url).hostname } catch { return '' } })()}` : ''}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>

                    {picked.size > 0 && (
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        {!deleteConfirm ? (
                          <button onClick={() => setDeleteConfirm(true)} className="btn-secondary text-xs" style={{ color: '#ff3b30' }}>
                            Delete {picked.size} selected
                          </button>
                        ) : (
                          <>
                            <span className="text-[11px] text-[#ff3b30]">
                              This removes {picked.size} post{picked.size === 1 ? '' : 's'} from {user.email}&apos;s live site. It cannot be undone.
                            </span>
                            <button onClick={deletePicked} disabled={deleting} className="btn-primary text-xs inline-flex items-center gap-1.5">
                              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                              {deleting ? 'Deleting' : 'Yes, delete them'}
                            </button>
                            <button onClick={() => setDeleteConfirm(false)} className="btn-secondary text-xs">Cancel</button>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
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
