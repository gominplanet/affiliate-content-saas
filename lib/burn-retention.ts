// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BURNED VIDEOS ARE KEPT 30 DAYS, UNLESS STILL SCHEDULED (Seb, 2026-10-28:
// "deletion of storage, so we don't have a pileup, after 30 days they've been
// posted ... keep anything that is still scheduled"). Cloudinary switched MVP
// off for going over its limits, and part of what filled it was every burned
// video kept for good. Burns are made by MVP's render server now and saved in
// MVP's storage as <user>/burned-<time>.mp4 (lib/overlay-burn, kind 'burn').
// Instagram, TikTok and the rest keep their own copy once a video is posted,
// so MVP's copy is only needed until then.
//
// The rule: a burned-*.mp4 older than BURN_KEEP_DAYS is deleted, unless any
// post, Story, deal or burn job that has not gone out yet (pending or
// processing) still points at it. Nothing else in storage is touched: Shorts,
// Liftoff files, uploads and pictures have their own rules or none.
// Pure, tested in scripts/test-burn-retention.

export const BURN_KEEP_DAYS = 30
export const BURN_BUCKET = 'instagram-videos'
const DAY_MS = 24 * 60 * 60 * 1000

/** A video the overlay burner saved, or a review editor video
 *  (<user>/edit-<time>-wide|vertical.mp4, lib/review-edit-server): the same
 *  30 days, the same "unless still scheduled". */
export function isBurnedVideo(name: string | null | undefined): boolean {
  return /^burned-\d+\.mp4$/.test(String(name || '')) || /^edit-\d+-(wide|vertical)\.mp4$/.test(String(name || ''))
}

/** Every storage path in the bucket these rows point at, read from the whole
 *  row so a link in any column or option counts. */
export function pathsIn(rows: unknown[], bucket = BURN_BUCKET): Set<string> {
  const out = new Set<string>()
  const re = new RegExp(`/${bucket}/([^"'?#\\s\\\\]+)`, 'g')
  for (const r of rows) {
    const text = JSON.stringify(r ?? '')
    for (const m of text.matchAll(re)) {
      try { out.add(decodeURIComponent(m[1])) } catch { out.add(m[1]) }
    }
  }
  return out
}

export type StoredFile = { name: string; created_at?: string | null; id?: string | null }

/** The burned videos in one folder that can go: older than the keep window
 *  and not wanted by anything still to be posted. Pure. */
export function burnsToDelete(folder: string, files: StoredFile[], keep: Set<string>, now = Date.now()): string[] {
  const cutoff = now - BURN_KEEP_DAYS * DAY_MS
  return files.filter((f) => {
    if (!f.id || !isBurnedVideo(f.name)) return false
    const made = Date.parse(String(f.created_at || ''))
    if (!Number.isFinite(made) || made >= cutoff) return false
    return !keep.has(`${folder}/${f.name}`)
  }).map((f) => `${folder}/${f.name}`)
}

/** The queues whose rows that have not gone out yet keep a burned video. */
export const STILL_TO_POST: { table: string; states: string[]; column: string }[] = [
  { table: 'scheduled_posts', column: 'status', states: ['pending', 'processing'] },
  { table: 'amazon_scheduled_posts', column: 'status', states: ['pending', 'processing'] },
  { table: 'deal_scheduled_posts', column: 'status', states: ['pending', 'processing'] },
  { table: 'ig_burn_jobs', column: 'status', states: ['pending', 'processing'] },
  // Facebook Reels and group posts SCOUT fills in for the creator to press.
  { table: 'facebook_reel_jobs', column: 'status', states: ['waiting', 'pending', 'processing', 'posting'] },
  { table: 'facebook_queue', column: 'status', states: ['waiting'] },
]
