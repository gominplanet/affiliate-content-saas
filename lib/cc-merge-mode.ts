// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Two ways to merge the Creator Connections catalogue, and the difference
// matters more than it looks.
//
// The merge has always been REPLACE: whatever is in staging is kept, and every
// campaign not in staging is deleted. That is the right shape when the upload
// really is the complete catalogue, because it is the only thing that clears
// campaigns Amazon has retired.
//
// It is the wrong shape when the upload is partial, and Amazon's own export is
// partial. The CC dashboard reported 928,250 campaigns; the export it produced,
// re-downloaded to be sure, held 379,181. A replace against that export would
// have deleted 539,567 catalogue rows, and 514,994 of those (95.4%) were still
// inside their own run dates. Every deleted row also loses its Keepa enrichment
// permanently, and enrichment refills at a few rows a minute.
//
// So ADD-ONLY exists: upsert everything staged, delete nothing. It cannot clean
// up retired campaigns, which is a real cost and the reason it is not the
// default. It also cannot destroy half the catalogue on the strength of an
// export nobody can verify, which on this evidence is the larger risk.
//
// Pure and import-free so the route, the cron, and the admin page all decide
// this the same way.

export type CcMergeMode = 'replace' | 'add-only'

/** Read the mode off a request body / stored flag.
 *
 *  REPLACE is the opt-in, and it takes an explicit `false`. That is deliberate
 *  and it is the opposite of how this shipped. A caller that says nothing gets
 *  add-only, because the callers that say nothing are exactly the ones that
 *  should not be deleting half a million rows: SCOUT's one-click auto-load arms
 *  the background drain with no mode field at all, unattended, straight after
 *  staging the same short export. A typo in the field name now costs a stale
 *  catalogue row instead of a permanent deletion.
 *
 *  An old stored flag from before this change also reads as add-only. Its drain
 *  finishes without purging, which is the same recoverable outcome. */
export function ccMergeMode(v: unknown): CcMergeMode {
  if (v === false || v === 'replace' || v === 'full') return 'replace'
  return 'add-only'
}

/** Whether this merge deletes catalogue rows that are absent from staging. */
export function ccShouldPurge(mode: CcMergeMode): boolean {
  return mode === 'replace'
}

/** Whether the pre-merge safety guards apply. Both of them (staging much
 *  smaller than live, and staged ids barely overlapping live ones) exist only
 *  to warn about the purge. With nothing being deleted there is nothing for
 *  them to warn about, and a confirm dialog that asks about removing campaigns
 *  when none will be removed teaches the admin to click through warnings. */
export function ccNeedsPurgeGuards(mode: CcMergeMode): boolean {
  return ccShouldPurge(mode)
}

/** HIDE WHAT THE EXPORT LEFT OUT. Amazon's "available campaigns" export drops
 *  campaigns that can no longer be joined, and add-only kept them with their old
 *  spot counts (5 of 5 sampled were full on Amazon). After an add-only merge,
 *  campaigns missing from the upload are marked full: open spots set to 0, never
 *  deleted, enrichment kept, back as soon as an export or live refresh has them.
 *
 *  Only for an upload big enough to be a real export: a partial upload (one
 *  CSV of five) would otherwise hide most of the catalogue until the next one. */
export const CC_HIDE_MIN_STAGED = 250_000

/** AND ONLY FOR AN UPLOAD THAT IS A WHOLE EXPORT (Seb, 2026-10-10: CC search
 *  came back empty for everyone). An upload of 105,838 rows, one part of the
 *  export, passed the old 100,000 floor against 955,236 live campaigns, and
 *  "Hide missing" marked the other ~850,000 full. A whole export is about
 *  440,000 rows (Amazon leaves out what can no longer be joined, so it is
 *  less than half the catalogue), so the floor is now 250,000 rows AND 30% of
 *  the live catalogue, and a live count MVP cannot read blocks it.
 *
 *  Spot counts are NOT required: Amazon's export no longer has them. A
 *  campaign in the export is open (count unknown); that is what the hide uses. */
export const CC_HIDE_MIN_SHARE = 0.3

export type CcHideFacts = {
  /** Live campaigns in the catalogue now (ends today or later). */
  live?: number | null
  /** Whether ANY staged row carries an open-slots value (reported, not required). */
  stagedHasSpots?: boolean | null
}

/** Why missing campaigns must NOT be marked full, in words; null when it is
 *  safe. Pure. */
export function ccHideMissingBlock(mode: CcMergeMode, stagedEstimate: number | null | undefined, facts: CcHideFacts = {}): string | null {
  if (mode !== 'add-only') return 'Replace mode removes missing campaigns instead.'
  if (typeof stagedEstimate !== 'number') return 'MVP could not count the upload.'
  if (typeof facts.live !== 'number') return 'MVP could not count the live catalogue, so nothing was marked full.'
  if (stagedEstimate < CC_HIDE_MIN_STAGED || stagedEstimate < facts.live * CC_HIDE_MIN_SHARE) {
    return `The upload has ${stagedEstimate.toLocaleString('en-US')} rows against ${facts.live.toLocaleString('en-US')} live campaigns, so it looks like part of the export. Upload every ZIP of the export together, then try again.`
  }
  return null
}

export function ccShouldHideMissing(mode: CcMergeMode, stagedEstimate: number | null | undefined, facts: CcHideFacts = {}): boolean {
  return ccHideMissingBlock(mode, stagedEstimate, facts) === null
}

/** One line of plain English for what a finished merge actually did.
 *
 *  Written to be distinguishable in the failure direction, which is the whole
 *  point: "purged 0" in replace mode means the sweep ran and found nothing to
 *  remove, while add-only means the sweep never ran. Those are different facts
 *  and used to render as the same sentence, so an admin who ticked add-only had
 *  no way to see on screen that it had taken effect. */
export function describeCcMergeOutcome(args: {
  mode: CcMergeMode
  upserted: number
  purged: number
  /** Add-only: the missing campaigns are being marked full in the background. */
  hiding?: boolean
}): string {
  const n = (x: number) => Math.max(0, Math.round(Number(x) || 0)).toLocaleString()
  if (args.mode === 'add-only') {
    return args.hiding
      ? `Added or updated ${n(args.upserted)} campaigns. Nothing was removed: add-only was ticked. Campaigns missing from this upload are being marked full in the background, so they stop showing open spots (nothing is deleted, and any that come back in a later upload reopen).`
      : `Added or updated ${n(args.upserted)} campaigns. Nothing was removed: add-only was ticked, so campaigns missing from this upload were left alone.`
  }
  if ((Number(args.purged) || 0) > 0) {
    return `Added or updated ${n(args.upserted)} campaigns and removed ${n(args.purged)} that were missing from this upload.`
  }
  return `Added or updated ${n(args.upserted)} campaigns. The cleanup sweep ran and found nothing to remove.`
}
