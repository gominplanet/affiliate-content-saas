// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Pinning first comments from the browser. YouTube has no pin API, so SCOUT
// pins in the creator's own signed-in YouTube and reports whether the pinned
// badge showed; that report is saved on the row. One helper for Co-Pilot, the
// older videos tool and Liftoff's background tab, so they cannot disagree
// about what counts as pinned.
'use client'

import { getScoutStatus, requestPinComment } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_PIN_MIN_VERSION } from '@/lib/scout-version'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

export async function pinFirstComment(rowId: string, youtubeVideoId: string, commentId: string): Promise<{ pinned: boolean; error?: string }> {
  const scout = await getScoutStatus()
  const fail = (error: string) => ({ pinned: false, error })
  let r: { pinned: boolean; error?: string }
  if (!scout.installed) r = fail('SCOUT is not installed in this browser, so it is not pinned. Pin it in YouTube Studio.')
  else if (!scoutAtLeast(scout.version, SCOUT_PIN_MIN_VERSION)) r = fail(`SCOUT ${scout.version ?? ''} cannot pin yet; Chrome updates it by itself soon.`)
  else {
    const res = await requestPinComment(youtubeVideoId, commentId)
    r = res.ok && res.pinned ? { pinned: true } : fail(`${res.error || 'SCOUT could not pin it.'}${res.steps ? ` What SCOUT saw: ${res.steps}.` : ''}`)
  }
  await fetchWithTimeout(`/api/youtube/first-comment/${rowId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pin_result', pinned: r.pinned, error: r.error }),
    timeoutMs: 15_000,
  }).catch(() => {})
  return r
}

type Row = { id: string; youtube_video_id: string; video_title: string | null; state: string; comment_id: string | null; pinned: boolean | null; publish_at: string | null }

/**
 * Pin every posted first comment SCOUT has not tried yet, one at a time.
 * Returns what happened, and whether any comment is due to be posted soon
 * (so a background pass knows to come back and pin it).
 *
 * NOT TRIED ONLY. A pin that failed is left for a person to retry from
 * Co-Pilot's banner, so a background tab never hammers one that cannot pin.
 */
export async function pinUntriedFirstComments(say?: (line: string) => void): Promise<{ pinned: number; failed: number; dueSoon: boolean; available: boolean }> {
  const out = { pinned: 0, failed: 0, dueSoon: false, available: false }
  let rows: Row[] = []
  try {
    const r = await fetchWithTimeout('/api/youtube/first-comment', { timeoutMs: 20_000 })
    if (!r.ok) return out
    const j = await r.json().catch(() => ({}))
    rows = (j.comments ?? []) as Row[]
    out.available = true
  } catch { return out }
  const soon = Date.now() + 2 * 3_600_000
  out.dueSoon = rows.some((r) => r.state === 'waiting' && !!r.publish_at && Date.parse(r.publish_at) <= soon)
  for (const r of rows.filter((x) => x.state === 'posted' && x.comment_id && x.pinned === null)) {
    say?.(`Pinning the first comment on ${r.video_title || r.youtube_video_id}`)
    const res = await pinFirstComment(r.id, r.youtube_video_id, r.comment_id as string)
    if (res.pinned) out.pinned++
    else { out.failed++; say?.(`  not pinned: ${res.error || 'no reason given'}`) }
  }
  return out
}
