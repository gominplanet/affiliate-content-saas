// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A VIDEO PIN ALWAYS GETS A COVER (Seb, 2026-10-16). A clip went live on
// TikTok and failed on Pinterest: "Pinterest video pins need a cover image".
// The clip was not on Cloudinary and Cloudinary's remote fetch of it was
// refused, so there was no cover. The route now tries, in order: the cover
// passed in, a Cloudinary frame, a remote-fetch frame, a frame from uploading
// the clip, then the thumbnail of the YouTube video the clip came from.
import { readFileSync } from 'node:fs'
const fails: string[] = []
const check = (n: string, ok: boolean) => { if (!ok) fails.push(n) }
const R = readFileSync('app/api/pinterest/video-pin/route.ts', 'utf8')
const C = readFileSync('services/cloudinary/index.ts', 'utf8')
const M = readFileSync('components/TikTokDirectModal.tsx', 'utf8')
const at = (s: string) => R.indexOf(s)
check('the clip is uploaded for a frame when remote fetch is refused', /export async function uploadedVideoPosterUrl/.test(C) && /resource_type: 'video', folder: 'pin-covers'/.test(C))
check('the order: remote fetch, then upload, then the YouTube thumbnail', at('remoteVideoPosterUrl(videoUrl)') > 0 && at('remoteVideoPosterUrl(videoUrl)') < at('uploadedVideoPosterUrl(videoUrl)') && at('uploadedVideoPosterUrl(videoUrl)') < at('i.ytimg.com/vi/${coverYt}/hqdefault.jpg'))
check('the clip screen sends the source video for the last fallback', /youtubeVideoId: ytForLink \|\| undefined/.test(M) && /const ytForLink = youtubeId \|\| sourceYoutubeVideoId/.test(M))
check('the error no longer tells a creator to pass coverImageUrl', !/pass coverImageUrl/.test(R))
if (fails.length) { console.error('pin-cover failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ pin-cover: a video pin always gets a cover, from the clip itself first')
