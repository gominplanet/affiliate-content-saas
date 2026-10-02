// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Pinning first comments from the browser. YouTube has no pin API, so SCOUT
// pins in the creator's own signed-in YouTube and reports whether the pinned
// badge showed; that report is saved on the row. One helper for Co-Pilot, the
// older videos tool and Liftoff's background tab, so they cannot disagree
// about what counts as pinned.
'use client'

import { getScoutStatus, requestPinComment, requestPostComment } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_PIN_MIN_VERSION, SCOUT_COMMENT_POST_MIN_VERSION } from '@/lib/scout-version'
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

/**
 * POST THE FIRST COMMENTS THAT ARE DUE, THROUGH SCOUT, AT NO QUOTA (for
 * creators on "YouTube through SCOUT"). Each is claimed first, so this and
 * the ten-minute cron can never both post one; one SCOUT could not post goes
 * back to waiting, and the cron posts it through the API after a grace time.
 * Returns how many went, and when the next one is due (for a background pass).
 */
export async function postDueFirstCommentsViaScout(say?: (line: string) => void): Promise<{ posted: number; failed: number; nextAt: string | null; on: boolean }> {
  const out = { posted: 0, failed: 0, nextAt: null as string | null, on: false }
  const scout = await getScoutStatus()
  if (!scout.installed || !scoutAtLeast(scout.version, SCOUT_COMMENT_POST_MIN_VERSION)) return out
  let rows: Array<{ id: string; youtube_video_id: string; video_title: string | null; text: string }> = []
  try {
    const r = await fetchWithTimeout('/api/youtube/first-comment/scout', { timeoutMs: 20_000 })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.on) return out
    out.on = true
    out.nextAt = j.nextAt ?? null
    rows = j.comments ?? []
  } catch { return out }
  for (const c of rows) {
    const cl = await fetchWithTimeout('/api/youtube/first-comment/scout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, claim: true }), timeoutMs: 15_000,
    }).then((x) => x.json()).catch(() => null)
    if (!cl?.ok) continue
    say?.(`Posting the first comment on ${c.video_title || c.youtube_video_id}`)
    const res = await requestPostComment(c.youtube_video_id, c.text)
    // Reported however it went, and tried again: an id that never reaches MVP
    // reads as unposted.
    for (let a = 0; a < 3; a++) {
      const ok = await fetchWithTimeout('/api/youtube/first-comment/scout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, result: res }), timeoutMs: 15_000,
      }).then((x) => x.ok).catch(() => false)
      if (ok) break
      await new Promise((r) => setTimeout(r, 1500 * (a + 1)))
    }
    if (res.ok && res.commentId) out.posted++
    else if (!res.notPublic) { out.failed++; say?.(`  not posted: ${res.detail || res.error || 'no reason given'}`) }
  }
  return out
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
  // Any that are due go up first (through SCOUT, at no quota), so they can be
  // pinned in this same pass.
  await postDueFirstCommentsViaScout(say).catch(() => null)
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
