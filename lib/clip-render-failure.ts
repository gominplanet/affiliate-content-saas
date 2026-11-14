// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHY A CLIP DID NOT RENDER, FROM THE RENDERER THAT TRIED (Seb, 2026-11-14:
// "Couldn't render the clip: cloud_name is disabled"). MVP renders clips on
// its own render server; Cloudinary is only a backup, and it is switched off.
// When MVP's render failed, the route fell back to Cloudinary and showed
// Cloudinary's refusal, so the real reason was thrown away and the screen
// blamed a service the clip never needed. The render server's own reason now
// comes first, in words; the backup's is only said when nothing else tried.
// Pure. Tested in scripts/test-clip-render-failure.

import { cloudinaryAccountDown } from '@/lib/burn-error'

const AGAIN = 'Nothing was used from your monthly renders.'

/** What the creator reads. `primary`: MVP's render server's reason, or null
 *  when it did not try. `backup`: Cloudinary's, or null when it did not try. */
export function clipRenderFailureWords(primary: string | null | undefined, backup: string | null | undefined): string {
  const p = String(primary || '').trim()
  const b = String(backup || '').trim()
  if (p) {
    if (/timed? ?out|timeout/i.test(p)) return `Couldn't render the clip: MVP's render server took longer than its time limit on it and stopped. Try Standard instead of Split screen, or a shorter clip, then render again. ${AGAIN}`
    if (/SIGKILL|out of memory|\bOOM\b|Cannot allocate/i.test(p)) return `Couldn't render the clip: MVP's render server ran out of room on this video and stopped. Try Standard instead of Split screen, or bring the video in at 1080p, then render again. ${AGAIN}`
    if (/source download|download produced no file|could not (download|fetch) (the )?source|HTTP 40[34]|ECONNRESET|ENOTFOUND/i.test(p)) return `Couldn't render the clip: MVP's render server could not read the video file. Bring the video in again (Get it from YouTube Studio, or upload it), then render again. ${AGAIN}`
    if (/did not answer|ECONNREFUSED|render service 50[234]/i.test(p)) return `Couldn't render the clip: MVP's render server is not answering right now. Try again in a few minutes. ${AGAIN}`
    return `Couldn't render the clip: MVP's render server said ${p.replace(/^render service \d+:\s*/i, '').slice(0, 220)}. ${AGAIN}`
  }
  if (b && cloudinaryAccountDown(b)) return `Couldn't render the clip: MVP's render server is not set up here, and the backup renderer is switched off. ${AGAIN}`
  return `Couldn't render the clip: ${b || 'no reason was given'}. ${AGAIN}`
}

/** Kept on the clip for the team: both renderers' own words, as they came. */
export function clipRenderFailureRecord(primary: string | null | undefined, backup: string | null | undefined): string {
  return [primary ? `render server: ${primary}` : '', backup ? `backup: ${backup}` : ''].filter(Boolean).join(' | ').slice(0, 600) || 'no reason given'
}
