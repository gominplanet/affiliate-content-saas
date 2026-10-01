// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Facebook Reels from Clip Factory: the three Meta steps in order, the answer
// read back rather than assumed, and the whole thing behind Labs.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }

const LIB = readFileSync('lib/facebook-reels.ts', 'utf8')
const ROUTE = readFileSync('app/api/clip-factory/facebook-reel/route.ts', 'utf8')
const PAGE = readFileSync('app/(dashboard)/clip-factory/page.tsx', 'utf8')
const LABS = readFileSync('lib/labs-preview.ts', 'utf8')

check('start, upload by URL, then finish as published, in that order',
  LIB.indexOf("upload_phase: 'start'") < LIB.indexOf('rupload.facebook.com') && LIB.indexOf('rupload.facebook.com') < LIB.indexOf("upload_phase: 'finish'")
  && /file_url: opts\.videoUrl/.test(LIB) && /video_state: 'PUBLISHED'/.test(LIB))
check('the status is read back, and "still processing" is never called live',
  /fields=status/.test(LIB) && /state: 'processing'/.test(LIB) && /step: 'processing'/.test(LIB))
check('the route is Labs and Meta-gated', /canUsePreview\('facebook_reels', tier\)/.test(ROUTE) && /metaEnabledForUser/.test(ROUTE))
check('a refused permission tells the creator to reconnect', /Reconnect Facebook under Social Accounts/.test(ROUTE))
check('the button shows only to who may use it', /\{canUsePreview\('facebook_reels', tier\) && [^\n]*<PostPill label="Facebook Reel"/.test(PAGE) || /canUsePreview\('facebook_reels', tier\) && !\(clip\?\.durationSec/.test(PAGE))
check('the toast says live or processing from what Facebook reported', /data\.state === 'published'/.test(PAGE))
check('it is open to Pro', /facebook_reels: 'labs'/.test(LABS))

// THE WHOLE VIDEO as one clip (Labs whole_video).
const PLAN = readFileSync('app/api/youtube/shorts/plan/route.ts', 'utf8')
const PANEL = readFileSync('components/vertical/ShortsCreatePanel.tsx', 'utf8')
check('whole mode makes one clip from the first second to the last, with no AI picking',
  /if \(body\.whole === true\)/.test(PLAN) && /start_sec: 0, end_sec: total/.test(PLAN)
  && PLAN.indexOf('if (body.whole === true)') < PLAN.indexOf('await planShorts('))
check('whole mode is Labs, on the server and on the button',
  /canUsePreview\('whole_video', tier\)/.test(PLAN) && /allowWhole=\{canUsePreview\('whole_video', tier\)\}/.test(PAGE) && /whole_video: 'labs'/.test(LABS))
check('a clip too long for Facebook Reels does not offer Facebook', /!\(clip\?\.durationSec && clip\.durationSec > 90\)/.test(PAGE))
check('the platform limits are said before posting', /Facebook Reels take up to 90 seconds/.test(PAGE) && /over 3 minutes as a regular video/.test(PAGE))
check('the whole clip joins the list instead of wiping rendered clips', /prev\.filter\(c => c\.status !== 'suggested' && !got\.some/.test(PANEL))
check('pressing it again reuses the whole-video clip', /eq\('reason', 'The whole video, as you asked\.'\)/.test(PLAN) && PLAN.indexOf("eq('reason', 'The whole video") < PLAN.indexOf("start_sec: 0, end_sec: total"))

// When YouTube refuses the download, the way out is on the page.
const RENDER = readFileSync('app/api/youtube/shorts/render/route.ts', 'utf8')
check('a refused download shows the upload box, even for a video from YouTube',
  /setNeedsUpload\(true\)/.test(PANEL) && /!hasSource && \(!youtubeVideoId \|\| youtubeRefused\)/.test(PANEL))
check('no message names a button that is not on the page', !/Upload or pick a short/.test(PANEL + RENDER))
check('the whole video is labelled, not scored 0/100', /'Whole video'/.test(PANEL) && /clip\.score > 0 \?/.test(PANEL))

const SHORTS = readFileSync('app/api/youtube/shorts/route.ts', 'utf8')
check('a clip can be removed, the creator\'s own only', /export async function DELETE/.test(SHORTS) && /\.delete\(\)\.eq\('id', shortId\)\.eq\('user_id', user\.id\)/.test(SHORTS) && /removeClip\(clip\)/.test(PANEL))
check('the upload box survives a reload while a clip still says YouTube refused',
  /clips\.some\(c => c\.status === 'failed' && \/YouTube\/i\.test/.test(PANEL) && /!hasSource && \(!youtubeVideoId \|\| youtubeRefused\)/.test(PANEL))

// THE FILE, WITHOUT MVP DOWNLOADING FROM YOUTUBE.
const PURGE = readFileSync('app/api/cron/purge-shorts-sources/route.ts', 'utf8')
const SHORTS_GET = readFileSync('app/api/youtube/shorts/route.ts', 'utf8')
const UPV = readFileSync('app/api/youtube/upload-video/route.ts', 'utf8')
const DRAIN = readFileSync('app/api/cron/launch-drain/route.ts', 'utf8')
const SF = readFileSync('app/api/youtube/shorts/studio-file/route.ts', 'utf8')
const BGJ = readFileSync('extension/background.js', 'utf8')
check('the original of a Co-Pilot or Liftoff upload is kept',
  /from\('video_masters'\)\.upsert\(\{ user_id: user\.id, youtube_video_id: id/.test(UPV)
  && /from\('video_masters'\)\.upsert\(\{ user_id: it\.user_id, youtube_video_id: videoId, file_url: it\.clean_url/.test(DRAIN))
check('the clean-up never deletes a kept original', /const isKept = kept\.has\(r\.source_video_url as string\)/.test(PURGE) && /isKept \? null :/.test(PURGE))
check('Clip Factory renders from the kept original, checked to exist first',
  /from\('video_masters'\)\.select\('file_url'\)/.test(SHORTS_GET) && /method: 'HEAD'/.test(SHORTS_GET) && /if \(head\?\.ok\)/.test(SHORTS_GET))
check('a Studio upload lands only in the creator\'s own folder, under the name MVP issued',
  /\$\{o\.user\.id\}\/source-\$\{crypto\.randomUUID\(\)\}\.mp4/.test(SF) && /\^\$\{o\.user\.id\}\/source-\[0-9a-f-\]\{36\}/.test(SF))
check('it is attached only after the file is really in storage', SF.indexOf("method: 'HEAD'") < SF.indexOf("update({ source_video_url: pub.publicUrl"))
check('SCOUT fetches it in the creator\'s Studio session and never hands the download link back',
  /msg\.type === 'MVP_STUDIO_VIDEO_FILE'/.test(BGJ) && /get_creator_videos/.test(BGJ) && /delete r\.dl/.test(BGJ))
check('the button says what went wrong in words', /YouTube Studio did not offer a download for this video/.test(PANEL) && /Update SCOUT to 1\.21\.22/.test(PANEL))

check('Clip Factory lists only videos that are out, and counts the scheduled ones',
  /new Date\(v\.published_at\)\.getTime\(\) <= nowMs/.test(PAGE) && /setScheduledCount\(all\.length - live\.length\)/.test(PAGE) && /scheduled video\{scheduledCount === 1/.test(PAGE))

check('Find Shorts without captions shows the way in, not just names it', /if \(data\.needsUpload\) setNeedsUpload\(true\)/.test(PANEL))

check('Enhance offers Facebook, Labs-gated, with link-in-description badges and no in-app shop',
  /canUsePreview\('facebook_reels', tier\) && \(\s*<button onClick=\{\(\) => applyDestMode\('facebook', 'bio'\)\}/.test(PAGE)
  && /const FACEBOOK_BADGE_IDS = \['link-in-desc-2'/.test(PAGE) && /Facebook Reels have no in-app shop/.test(PAGE))

// THE DESCRIPTION. The first Reel went out as its hook alone, no link.
const REEL = readFileSync('lib/reel-caption.ts', 'utf8')
check('the Reel description is built on the server from the source video, its blog post and product',
  /buildReelCaption\(supabase, user\.id/.test(ROUTE) && /\.eq\('video_id', video\.id\)/.test(REEL)
  && /resolvePostAffiliateLink\(post/.test(REEL) && /amazonDestination\(asin, tag\)/.test(REEL))
check('the product link is always in a Reel, in the creator\'s link style, with the disclosure',
  /product: true, content/.test(REEL) && /ensureAffiliateShareLink\(/.test(REEL) && /resolveCloakedLinkDetailed\(/.test(REEL) && /effectiveDisclosure\(/.test(REEL))
// Since 2026-10-01 the Facebook pill opens the shared publish panel
// (components/clip-factory/PublishPanel), which shows the description and
// says when no product link was found.
check('the page shows the description first, says when no product link was found, and posts exactly that text',
  /openPanel\('facebook'\)/.test(PAGE) && /postFacebookReel\(c\.text\)/.test(PAGE) && /body: JSON\.stringify\(\{ videoUrl: publishUrl, description: text,/.test(PAGE)
  && /No product link found/.test(readFileSync('lib/clip-description.ts', 'utf8')))
check('the clip remembers its source video on both ways in',
  /sourceVideoId: selectedVideo\.id/.test(PAGE) && /sourceVideoId: id \}/.test(PAGE))
check('an empty description is refused rather than posted', /The Reel has no description/.test(ROUTE))

// WHERE IT GOES: the Page is named (and picked when there are several) before
// posting, and after posting the Reel can be shared into the creator's Groups
// with SCOUT, the Reel's link first so the Group shows the playable Reel.
const DEST = readFileSync('components/clip-factory/ReelDestinations.tsx', 'utf8')
check('the Reel route lists the Pages and the saved Groups', /export async function GET\(\)/.test(ROUTE) && /facebook_groups/.test(ROUTE))
check('the picked Page is the one posted to', /socialAccountId: fbPageId/.test(PAGE))
check('the panel names the Page before posting', /<ReelPagePicker/.test(PAGE) && /Posts as a Reel on/.test(DEST))
check('a posted Reel can be shared to Groups, link first, and the creator presses Post', /<ShareReelToGroups/.test(PAGE) && /\[p\.reelUrl, p\.text\.trim\(\)\]/.test(DEST) && /requestFacebookGroupPrefill\(g\.url, post, null\)/.test(DEST))

if (failures.length) {
  console.error(`\n❌ facebook-reels: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ facebook-reels: a clip goes to the Page in Meta\'s three steps, the screen says whether it is live, and a whole video posts as one clip')
