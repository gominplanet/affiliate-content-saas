'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The panel a Clip Factory platform pill opens: what goes in the description
// (product link, link in bio, full review, hashtags), the disclosure that is
// always there, and for YouTube a title and a full tag set, all before posting.
// The text box shows exactly what posts (lib/clip-description), and a choice
// that would add nothing says why rather than looking switched on.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import {
  CLIP_PLATFORM_RULES, CLIP_TEXT_LIMIT, composeClipDescription, unavailableReasons,
  type ClipInclude, type ClipPlatform,
} from '@/lib/clip-description'

export type PublishKit = {
  productLink: string | null
  productSource: 'blog-post' | 'enhance-product' | 'video-asin' | null
  linkNote: string | null
  amazon: boolean
  blogUrl: string | null
  videoUrl: string | null
  linkHub: string | null
  disclosure: string
  youtube: { title: string; tags: string[]; note: string | null } | null
}

export type PublishChoice = { text: string; title?: string; tags?: string[] }

const SOURCE_LABEL: Record<string, string> = {
  'blog-post': 'from the blog post for this video',
  'enhance-product': 'from the product you added in Enhance',
  'video-asin': 'from the product on this video',
}

const OPTIONS: Array<{ key: keyof ClipInclude; label: string }> = [
  { key: 'productLink', label: 'Product link' },
  { key: 'bioCta', label: 'Link in bio line' },
  { key: 'review', label: 'Full review link' },
  { key: 'hashtags', label: 'Hashtags' },
]

export default function PublishPanel(props: {
  platform: ClipPlatform
  color: string
  kit: PublishKit | null
  kitError: string | null
  writeUp: string
  hashtags: string[]
  busy: boolean
  /** Already posted to this platform from this clip: posting again makes a second post. */
  alreadyPosted?: boolean
  onRetry: () => void
  onConfirm: (c: PublishChoice) => void
  onCancel: () => void
  /** The button's words when the caller does something other than post here
   *  (Facebook, Group first: "Post to my Group + Page"). */
  confirmLabel?: string
}) {
  const { platform, kit } = props
  const rules = CLIP_PLATFORM_RULES[platform]
  const missing = useMemo(() => (kit ? unavailableReasons(kit, props.hashtags) : {}), [kit, props.hashtags])
  const [include, setInclude] = useState<ClipInclude>(rules.defaults)
  const [text, setText] = useState('')
  const [edited, setEdited] = useState(false)
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')

  // A new platform starts from its own defaults.
  useEffect(() => { setInclude(rules.defaults); setEdited(false) }, [platform, rules.defaults])
  useEffect(() => {
    if (kit?.youtube) { setTitle(kit.youtube.title); setTags(kit.youtube.tags) }
  }, [kit])

  const composed = useMemo(() => kit ? composeClipDescription({
    platform, writeUp: props.writeUp, include,
    productLink: kit.productLink, amazon: kit.amazon, videoUrl: kit.videoUrl, blogUrl: kit.blogUrl,
    linkHub: kit.linkHub, hashtags: props.hashtags, disclosure: kit.disclosure,
  }) : '', [kit, platform, props.writeUp, include, props.hashtags])
  // The choices rebuild the text until the creator types in it; after that a
  // choice rebuilds it only when they ask, so their edits are never lost.
  useEffect(() => { if (!edited) setText(composed) }, [composed, edited])

  // What YouTube takes: a phrase of 2 to 40 characters, no angle brackets or
  // quotes, all of them under 500 characters together.
  const tagTotal = tags.reduce((n, t) => n + t.length + 1, 0)
  const addTag = () => {
    const v = tagDraft.replace(/^#+/, '').replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (v.length >= 2 && v.length <= 40 && !tags.includes(v) && tags.length < 15 && tagTotal + v.length + 1 <= 480) setTags([...tags, v])
    setTagDraft('')
  }
  const limit = CLIP_TEXT_LIMIT[platform]
  const tooLong = text.length > limit
  // No disclosure means the post must not go: the links request failed and
  // nothing is known about this clip, which is not the same as nothing found.
  const blocked = !kit?.disclosure
  const confirmLabel = props.confirmLabel ?? (platform === 'youtube' ? 'Post Short' : platform === 'facebook' ? 'Post Reel' : `Continue to ${rules.label}`)

  return (
    <div className="rounded-xl border p-3 flex flex-col gap-3" style={{ borderColor: `${props.color}55` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{rules.label}: what goes in the description</p>
        <button onClick={props.onCancel} disabled={props.busy} aria-label="Close" className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"><X size={15} /></button>
      </div>

      {!kit && !props.kitError && (
        <p className="text-[12.5px] text-[#86868b] inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Finding the product link and your links…</p>
      )}
      {props.kitError && (
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12.5px] text-[#ff3b30]">{props.kitError} Nothing can post until MVP has your disclosure and links.</p>
          <button onClick={props.onRetry} className="text-[12.5px] font-semibold hover:underline" style={{ color: props.color }}>Try again</button>
        </div>
      )}

      {kit && (<>
        <p className="text-[12px] text-[#6e6e73] dark:text-[#b0b0b5] leading-snug">{rules.linkNote}</p>

        {platform === 'youtube' && (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7]">Title ({title.length}/100)</span>
              <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1.5 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]" />
            </label>
            {kit.youtube?.note && <p className="text-[12px] text-[#ff9500] leading-snug">{kit.youtube.note}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((o) => {
            const why = o.key === 'bioCta' ? undefined : missing[o.key]
            const on = include[o.key] && !why
            return (
              <label key={o.key} title={why} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] ${why ? 'opacity-50' : 'cursor-pointer'}`}
                style={{ borderColor: on ? props.color : 'rgba(0,0,0,0.12)', color: on ? props.color : undefined }}>
                <input type="checkbox" checked={on} disabled={!!why} onChange={(e) => setInclude((p) => ({ ...p, [o.key]: e.target.checked }))} />
                {o.label}
              </label>
            )
          })}
        </div>
        {/* Said, not implied: a choice that cannot add anything, and where the
            product link came from. */}
        {include.productLink && missing.productLink && <p className="text-[12px] text-[#ff9500] leading-snug">{missing.productLink}</p>}
        {include.productLink && kit.productLink && (
          <p className="text-[12px] text-[#10B981] leading-snug break-all">Product link {SOURCE_LABEL[kit.productSource ?? ''] ?? ''}: {kit.productLink}</p>
        )}
        {kit.linkNote && include.productLink && <p className="text-[12px] text-[#ff9500] leading-snug">{kit.linkNote}</p>}
        {include.review && missing.review && <p className="text-[12px] text-[#86868b] leading-snug">{missing.review}</p>}
        {kit.disclosure
          ? <p className="text-[12px] text-[#86868b] leading-snug">Your disclosure is always included: the FTC and Amazon require it wherever there is an affiliate link or a link in bio.</p>
          : <p className="text-[12px] text-[#ff3b30] leading-snug">No disclosure could be loaded, so this cannot post. Try again.</p>}

        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7]">Description, exactly as it posts</span>
          <textarea value={text} rows={8} onChange={(e) => { setText(e.target.value); setEdited(true) }}
            className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent p-2 text-[12.5px] text-[#1d1d1f] dark:text-[#f5f5f7]" />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {edited ? (
              <span className="text-[12px] text-[#86868b]">
                Your edits are kept, so the choices above no longer change the text.{' '}
                <button onClick={() => setEdited(false)} className="font-medium hover:underline" style={{ color: props.color }}>Rebuild from the choices (drops your edits)</button>
              </span>
            ) : <span />}
            <span className={`text-[11.5px] ${tooLong ? 'text-[#ff3b30] font-semibold' : 'text-[#86868b]'}`}>{text.length}/{limit}{tooLong ? ': too long, the end (your disclosure) would be cut' : ''}</span>
          </div>
          {platform === 'youtube' && <p className="text-[11.5px] text-[#86868b]">YouTube also gets #Shorts at the end, so it files the clip as a Short.</p>}
        </div>

        {platform === 'youtube' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#3a3a3c] dark:text-[#d2d2d7]">Tags ({tags.length}/15, {tagTotal}/500 characters)</span>
            <p className="text-[12px] text-[#86868b] leading-snug">Tags help YouTube with spellings and related searches; the title and the first lines of the description matter more.</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <button key={t} onClick={() => setTags(tags.filter((x) => x !== t))} title="Remove"
                  className="text-[11.5px] rounded-full px-2.5 py-1 border border-black/10 dark:border-white/15 text-[#4b4b4f] dark:text-[#b0b0b5] hover:line-through">{t} ×</button>
              ))}
              {tags.length < 15 && (
                <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="Add a tag"
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }} onBlur={addTag}
                  className="text-[11.5px] rounded-full px-2.5 py-1 border border-dashed border-black/20 dark:border-white/20 bg-transparent w-28" />
              )}
            </div>
          </div>
        )}

        {props.alreadyPosted && (
          <p className="text-[12px] text-[#ff9500] leading-snug">Already posted to {rules.label} from this clip. Posting again makes a second post.</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => props.onConfirm({ text: text.trim(), ...(platform === 'youtube' ? { title: title.trim(), tags } : {}) })}
            disabled={props.busy || blocked || tooLong || !text.trim() || (platform === 'youtube' && !title.trim())}
            className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50" style={{ background: props.color }}>
            {props.busy ? 'Posting…' : props.alreadyPosted ? `${confirmLabel} again` : confirmLabel}
          </button>
          <button onClick={props.onCancel} disabled={props.busy} className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/15">Cancel</button>
        </div>
      </>)}
    </div>
  )
}
