'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Where a Clip Factory Reel goes. The Page is named before posting (and can be
// picked when there are several). After it is up, it can be shared into the
// creator's Facebook Groups with SCOUT: Meta lets no app post into a Group, so
// SCOUT opens the Group and fills the post (the Reel's link first, so Facebook
// shows the playable Reel), and the creator presses Post.
import { useState } from 'react'
import { Loader2, Copy } from 'lucide-react'
import { toast } from 'sonner'

export type ReelPage = { id: string; name: string; isDefault: boolean }
export type ReelGroup = { name: string; url: string }

export function ReelPagePicker(p: { pages: ReelPage[] | null; value: string; onChange: (id: string) => void; error?: string | null }) {
  if (p.error) return <p className="text-[12px] text-[#ff3b30]">Your Facebook Pages could not be loaded: {p.error}</p>
  if (!p.pages) return <p className="text-[12px] text-[#86868b] inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Finding your Facebook Page…</p>
  if (!p.pages.length) return <p className="text-[12px] text-[#ff3b30]">No Facebook Page is connected, so the Reel has nowhere to go. Connect one under Connect Socials.</p>
  if (p.pages.length === 1) return <p className="text-[12.5px] text-[#1d1d1f] dark:text-[#f5f5f7]">Posts as a Reel on your Page <b>{p.pages[0].name}</b>.</p>
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-[#1d1d1f] dark:text-[#f5f5f7] flex-wrap">
      Posts as a Reel on
      <select id="reel-page" value={p.value} onChange={(e) => p.onChange(e.target.value)}
        className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 text-[12.5px]">
        {p.pages.map((pg) => <option key={pg.id} value={pg.id}>{pg.name}{pg.isDefault ? ' (default)' : ''}</option>)}
      </select>
    </label>
  )
}

type FillState = { state: 'working' } | { state: 'done'; filled: boolean; message: string }

export function ShareReelToGroups(p: { reelUrl: string; text: string; groups: ReelGroup[] | null }) {
  // The Reel's own link goes first: Facebook builds the post's card from the
  // first link, and this one plays the Reel right in the Group.
  const post = [p.reelUrl, p.text.trim()].filter(Boolean).join('\n\n')
  const [fill, setFill] = useState<Record<number, FillState>>({})

  async function share(i: number, g: ReelGroup) {
    try { await navigator.clipboard.writeText(post) } catch { /* the message still says what to do */ }
    setFill((m) => ({ ...m, [i]: { state: 'working' } }))
    const { requestFacebookGroupPrefill } = await import('@/lib/extension-frame')
    const res = await requestFacebookGroupPrefill(g.url, post, null)
    setFill((m) => ({
      ...m,
      [i]: res.filled
        ? { state: 'done', filled: true, message: `SCOUT filled the post in ${g.name}. Check it in the Facebook tab and press Post.` }
        : { state: 'done', filled: false, message: res.error || 'SCOUT could not fill it. The post is copied: paste it in the Group yourself.' },
    }))
  }

  return (
    <div className="rounded-xl border border-[#1877F2]/30 bg-[#1877F2]/[0.04] p-3 flex flex-col gap-2">
      <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Share this Reel to your Groups</p>
      <p className="text-[12px] text-[#6e6e73] dark:text-[#b0b0b5] leading-snug">
        Facebook lets no app post into a Group, so SCOUT opens the Group and fills the post: the Reel&apos;s link first (it shows as the playable Reel), then your text. You press Post.
      </p>
      {p.groups === null && <p className="text-[12px] text-[#86868b]"><Loader2 size={12} className="inline animate-spin" /> Loading your Groups…</p>}
      {p.groups && p.groups.length === 0 && (
        <p className="text-[12px] text-[#86868b]">No Groups saved yet. Add them in <a href="/brand" className="text-[#7C3AED] hover:underline">Brand Profile</a> under Facebook Groups.</p>
      )}
      {p.groups && p.groups.map((g, i) => {
        const f = fill[i]
        return (
          <div key={g.url} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12.5px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] min-w-0 truncate">{g.name}</span>
              <button onClick={() => share(i, g)} disabled={f?.state === 'working'}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white bg-[#1877F2] disabled:opacity-60">
                {f?.state === 'working' ? <><Loader2 size={12} className="animate-spin" /> SCOUT is filling it…</> : 'Fill with SCOUT'}
              </button>
            </div>
            {f?.state === 'done' && <p className={`text-[12px] ${f.filled ? 'text-[#10B981]' : 'text-[#ff9500]'}`}>{f.message}</p>}
          </div>
        )
      })}
      <button onClick={() => navigator.clipboard.writeText(post).then(() => toast.success('Group post copied'), () => toast.error('Copy failed'))}
        className="self-start inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1877F2] hover:underline">
        <Copy size={12} /> Copy the Group post instead
      </button>
    </div>
  )
}
