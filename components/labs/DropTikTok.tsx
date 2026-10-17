'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drop: the TikTok choices for one vertical video, under the same rules TikTok's
// app review holds MVP's own TikTok panel to (components/TikTokDirectModal):
// the creator's TikTok account named, who can see it chosen by the creator
// with no default, every "allow viewers to" switch starting off, commercial
// content declared by the creator, and TikTok's Music Usage Confirmation (and
// Branded Content Policy when it applies) shown before posting.

export type TikTokPrivacy = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY' | 'FOLLOWER_OF_CREATOR'

export interface TikTokInfo {
  username: string
  displayName?: string
  privacyLevelOptions: TikTokPrivacy[]
  maxVideoDurationSec?: number
  commentDisabled?: boolean
  duetDisabled?: boolean
  stitchDisabled?: boolean
}

export interface TikTokChoice {
  privacyLevel: TikTokPrivacy | ''
  allowComment: boolean
  allowDuet: boolean
  allowStitch: boolean
  commercial: boolean
  brandedContent: boolean
  brandedPartnership: boolean
}

export const emptyTikTok = (): TikTokChoice => ({ privacyLevel: '', allowComment: false, allowDuet: false, allowStitch: false, commercial: false, brandedContent: false, brandedPartnership: false })

const LABELS: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: 'Public: anyone can see',
  MUTUAL_FOLLOW_FRIENDS: 'Friends: mutual follows only',
  FOLLOWER_OF_CREATOR: 'Followers only',
  SELF_ONLY: 'Only me (private)',
}

/** What still stops this video going to TikTok, or null. */
export function tiktokBlocker(c: TikTokChoice, info: TikTokInfo | null, durationSec: number): string | null {
  if (!info) return 'TikTok is not connected'
  if (!c.privacyLevel) return 'Pick who can see it on TikTok'
  if (c.commercial && !c.brandedContent && !c.brandedPartnership) return 'Say whether the TikTok promotes your brand, another brand, or both'
  if (c.brandedPartnership && c.privacyLevel === 'SELF_ONLY') return 'Branded content on TikTok cannot be private'
  if (info.maxVideoDurationSec && durationSec > info.maxVideoDurationSec) return `TikTok takes up to ${info.maxVideoDurationSec} seconds from your account`
  return null
}

/** The choice as the TikTok handler (lib/drop-places) reads it. */
export const tiktokOptions = (c: TikTokChoice) => ({
  privacyLevel: c.privacyLevel, allowComment: c.allowComment, allowDuet: c.allowDuet, allowStitch: c.allowStitch,
  brandedContent: c.commercial && c.brandedContent, brandedPartnership: c.commercial && c.brandedPartnership,
})

function Switch({ label, on, disabled, hint, onChange }: { label: string; on: boolean; disabled?: boolean; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex items-center gap-2 text-[12px] ${disabled ? 'opacity-60' : ''}`} style={{ color: 'var(--text)' }}>
      <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}{hint ? <span style={{ color: 'var(--text-2)' }}> · {hint}</span> : null}
    </label>
  )
}

export default function DropTikTok({ info, infoError, value, onChange }: {
  info: TikTokInfo | null
  infoError: string | null
  value: TikTokChoice
  onChange: (c: TikTokChoice) => void
}) {
  if (!info) {
    return (
      <div className="rounded-xl border p-3 text-[12px]" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
        <span className="text-amber-700 dark:text-amber-300">{infoError || 'Reading your TikTok account'}</span>
        {infoError && <a href="/connect-socials" className="ml-1.5 underline" style={{ color: 'var(--text)' }}>Connect TikTok</a>}
      </div>
    )
  }
  const set = (p: Partial<TikTokChoice>) => onChange({ ...value, ...p })
  const field = 'w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] bg-transparent'
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
      <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>Posting to TikTok as <span className="font-semibold" style={{ color: 'var(--text)' }}>@{info.username}</span></p>
      <label className="flex flex-col gap-1 text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
        Who can view this <span className="sr-only">(required)</span>
        <select className={field} style={{ borderColor: 'var(--border)', color: 'var(--text)' }} value={value.privacyLevel}
          onChange={(e) => set({ privacyLevel: e.target.value as TikTokPrivacy | '' })}>
          <option value="">Choose...</option>
          {info.privacyLevelOptions.map((opt) => {
            const blocked = opt === 'SELF_ONLY' && value.commercial && value.brandedPartnership
            return <option key={opt} value={opt} disabled={blocked}>{LABELS[opt] || opt}{blocked ? ': not allowed for branded content' : ''}</option>
          })}
        </select>
        {!value.privacyLevel && info.privacyLevelOptions.includes('PUBLIC_TO_EVERYONE') && (
          <button type="button" onClick={() => set({ privacyLevel: 'PUBLIC_TO_EVERYONE' })}
            className="self-start mt-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300" style={{ borderColor: 'rgba(16,185,129,0.5)' }}>
            Public, anyone can see
          </button>
        )}
      </label>
      <div className="flex flex-col gap-1">
        <p className="text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>Allow viewers to</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Switch label="Comment" on={value.allowComment} disabled={info.commentDisabled} hint={info.commentDisabled ? 'off on TikTok' : undefined} onChange={(v) => set({ allowComment: v })} />
          <Switch label="Duet" on={value.allowDuet} disabled={info.duetDisabled} hint={info.duetDisabled ? 'off on TikTok' : undefined} onChange={(v) => set({ allowDuet: v })} />
          <Switch label="Stitch" on={value.allowStitch} disabled={info.stitchDisabled} hint={info.stitchDisabled ? 'off on TikTok' : undefined} onChange={(v) => set({ allowStitch: v })} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 rounded-lg border p-2.5" style={{ borderColor: 'var(--border)' }}>
        <Switch label="This is commercial content" on={value.commercial} onChange={(v) => set({ commercial: v, ...(v ? {} : { brandedContent: false, brandedPartnership: false }) })} />
        {value.commercial && (
          <div className="pl-5 flex flex-col gap-1">
            <Switch label="Your brand" on={value.brandedContent} onChange={(v) => set({ brandedContent: v })} />
            <Switch label="Branded content" on={value.brandedPartnership} onChange={(v) => set({ brandedPartnership: v, ...(v && value.privacyLevel === 'SELF_ONLY' ? { privacyLevel: '' } : {}) })} />
            {(value.brandedContent || value.brandedPartnership) && (
              <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>Your post will be labeled as <strong>{value.brandedPartnership ? '“Paid partnership”' : '“Promotional content”'}</strong>.</p>
            )}
            {!value.brandedContent && !value.brandedPartnership && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">Say whether it promotes your brand, another brand, or both.</p>
            )}
          </div>
        )}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
        By posting, you agree to TikTok&apos;s{' '}
        {value.commercial && value.brandedPartnership && (
          <><a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener noreferrer" className="underline">Branded Content Policy</a> and </>
        )}
        <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener noreferrer" className="underline">Music Usage Confirmation</a>.
      </p>
    </div>
  )
}
