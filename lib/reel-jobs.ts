// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PAGE REEL POSTS ITSELF (Seb, 2026-10-16: "while meta is processing the
// video.. mvp is not able to post on the facebook page.. are we able to get
// this done in the background like pinned comments on youtube?").
//
// Clip Factory's Group first flow: SCOUT fills the Group post with the clip,
// the creator presses Post, Facebook processes the video (minutes, sometimes
// more), and only then does the Group post have a link for the Page Reel to
// point to. The Reel used to be posted from MVP's tab, so the tab had to stay
// open through all of it. Now MVP keeps the Reel as a job (migration 435)
// with a one-time key, SCOUT 1.50.0 watches in the background and hands the
// link back with that key, and the server posts the Reel here, exactly as the
// page did: the link first, the disclaimer, #ad #sponsored, the caption, its
// hashtags (through the safety net).
//
// ONE POST PER JOB: a job moves waiting -> posting in one conditional update,
// so SCOUT's answer and a link the creator pasted can never both post.
import { createHash, randomBytes } from 'node:crypto'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { resolveSocialAccounts } from '@/lib/social-accounts'
import { normalizeTier, socialAccountCap } from '@/lib/tier'
import { publishPageReel, publishPageVideo, REEL_MAX_SEC } from '@/lib/facebook-reels'
import { facebookReelOrder } from '@/lib/reel-group-caption'
import { AFFILIATE_DISCLAIMER_DEFAULT } from '@/lib/social-disclaimer'
import { fitHashtags } from '@/lib/hashtag-engine'
import { trackPost } from '@/lib/reach-pulse'
import { isFacebookGroupPostLink, isFacebookReelLink } from '@/lib/facebook-group-link'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type ReelJobStatus = 'waiting' | 'posting' | 'posted' | 'failed' | 'needs_you' | 'cancelled' | 'expired'
export interface ReelJob {
  id: string; user_id: string; social_account_id: string | null; clip_url: string; source_video_id: string | null
  title: string | null; group_url: string | null; caption: string; clip_seconds: number | null; token_hash: string
  status: ReelJobStatus; group_post_url: string | null; page_post_url: string | null; video_id: string | null
  note: string | null; created_at: string; expires_at: string
}

export const hashKey = (token: string) => createHash('sha256').update(String(token || '')).digest('hex')
export const newKey = () => randomBytes(24).toString('hex')

/** What SCOUT's watch ended on, in words for the creator. */
export const MISSED_WORDS: Record<string, string> = {
  closed: 'The Facebook tab was closed before SCOUT saw the Group post go up.',
  not_seen: 'SCOUT did not see the post appear. If your Group approves posts first, it shows up once approved.',
  posted_no_link: 'SCOUT saw the Group post go up but could not read its link.',
  timeout: 'Facebook was still not showing the Group post after 3 hours.',
  lost: 'SCOUT stopped watching before it saw the post.',
}

/** The Page Reel's caption, as the page built it: the link first, then the
 *  creator's caption, in Seb's order (facebookReelOrder), then the safety net
 *  (each tag once, no years or spam, Facebook's three). Pure. */
export function reelDescription(link: string, caption: string, disclaimer: string | null): string {
  const raw = [`Get it here 👉 ${link}`, String(caption || '').trim()].filter(Boolean).join('\n\n')
  return fitHashtags(facebookReelOrder(raw, (disclaimer || '').trim() || AFFILIATE_DISCLAIMER_DEFAULT), 'facebook')
}

/** A link a Page Reel may point to: the Group post, its video, or the Group. */
export function reelLinkOk(link: string, groupUrl?: string | null): boolean {
  const s = String(link || '').trim()
  return isFacebookGroupPostLink(s) || isFacebookReelLink(s) || (!!groupUrl && s === groupUrl && /^https:\/\/(www\.|web\.|m\.)?facebook\.com\/groups\//i.test(s))
}

/** Post the job's Reel, linking to `link`. Claims the job first, so it posts
 *  once whoever asks. Never throws; the job row says what happened. */
export async function runReelJob(admin: Db, jobId: string, link: string, how: 'post' | 'group', claimable: ReelJobStatus[] = ['waiting', 'needs_you', 'failed', 'expired']): Promise<{ ok: boolean; status: ReelJobStatus; error?: string; pageUrl?: string | null; already?: boolean }> {
  const { data: claimed } = await admin.from('facebook_reel_jobs')
    .update({ status: 'posting', group_post_url: link, updated_at: new Date().toISOString() })
    .eq('id', jobId).in('status', claimable).select('*').maybeSingle()
  const job = claimed as ReelJob | null
  if (!job) {
    const { data: now } = await admin.from('facebook_reel_jobs').select('status,page_post_url,note').eq('id', jobId).maybeSingle()
    return { ok: now?.status === 'posted', status: (now?.status || 'failed') as ReelJobStatus, already: true, pageUrl: now?.page_post_url ?? null, error: now?.note ?? undefined }
  }
  const fail = async (note: string, status: ReelJobStatus = 'failed') => {
    await admin.from('facebook_reel_jobs').update({ status, note, updated_at: new Date().toISOString() }).eq('id', job.id)
    return { ok: false, status, error: note }
  }
  try {
    const [{ data: intRow }, { data: brand }] = await Promise.all([
      admin.from('integrations').select('facebook_page_id,facebook_page_access_token,facebook_page_name,tier').eq('user_id', job.user_id).maybeSingle(),
      admin.from('brand_profiles').select('affiliate_disclaimer').eq('user_id', job.user_id).maybeSingle(),
    ])
    const integration = decryptIntegrationRow(intRow)
    const [page] = await resolveSocialAccounts(admin, job.user_id, 'facebook', {
      socialAccountIds: job.social_account_id ? [job.social_account_id] : [], allowSelection: true,
      limit: socialAccountCap(normalizeTier(integration?.tier)),
      legacy: { externalId: integration?.facebook_page_id, accessToken: integration?.facebook_page_access_token, displayName: integration?.facebook_page_name },
    })
    if (!page) return await fail('No Facebook Page is connected. Connect one under Social Accounts, then post it from Meta Hub.')
    const description = reelDescription(link, job.caption, (brand?.affiliate_disclaimer as string | null) ?? null)
    const asVideo = Number(job.clip_seconds) > REEL_MAX_SEC
    const r = asVideo
      ? await publishPageVideo({ pageId: page.externalId, token: page.accessToken, videoUrl: job.clip_url, description })
      : await publishPageReel({ pageId: page.externalId, token: page.accessToken, videoUrl: job.clip_url, description, wait: false })
    if (!r.ok) return await fail(/permission|\(#200\)|\(#10\)|not authorized/i.test(r.error) ? `Facebook refused: ${r.error} Reconnect Facebook under Social Accounts, then post it from Meta Hub.` : `Facebook did not post the ${asVideo ? 'video' : 'Reel'}: ${r.error}`)
    await admin.from('facebook_reel_jobs').update({ status: 'posted', page_post_url: r.url || null, video_id: r.videoId || null, note: how === 'group' ? 'Linked to your Group.' : null, updated_at: new Date().toISOString() }).eq('id', job.id)
    // Meta Hub's record, as the page kept it.
    await admin.from('facebook_posts').insert({ user_id: job.user_id, kind: 'clip', source_id: job.clip_url, video_id: job.source_video_id, title: job.title, group_url: job.group_url, group_post_url: link, page_post_url: r.url || null })
    await trackPost({ userId: job.user_id, platform: 'facebook', postId: r.videoId || null, caption: description, postUrl: r.url || null })
    return { ok: true, status: 'posted', pageUrl: r.url || null }
  } catch (e) {
    return await fail(`MVP could not post it: ${e instanceof Error ? e.message : 'error'}`)
  }
}

/** A job past its time that was never posted reads as expired, with why. */
export async function expireIfDue(admin: Db, job: ReelJob): Promise<ReelJob> {
  if ((job.status === 'waiting' || job.status === 'posting') && Date.parse(job.expires_at) < Date.now()) {
    const note = job.status === 'posting' ? 'MVP started posting it but never heard back from Facebook. Check your Page before posting it again.' : MISSED_WORDS.timeout
    await admin.from('facebook_reel_jobs').update({ status: job.status === 'posting' ? 'failed' : 'expired', note, updated_at: new Date().toISOString() }).eq('id', job.id)
    return { ...job, status: job.status === 'posting' ? 'failed' : 'expired', note }
  }
  return job
}
