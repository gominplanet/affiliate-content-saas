// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A CREATOR'S OWN LIFTOFF THUMBNAIL is used as given and never built over.
import { readFileSync } from 'node:fs'
const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const route = read('app/api/launch/items/[id]/thumbnail/route.ts')
check('marked as the creator\'s, for YouTube and Amazon both', /thumbnail_url: url, thumbnail_clean_url: url, thumbnail_source: 'creator'/.test(route))
check('refused once the video is on YouTube', /\.is\('youtube_video_id', null\)/.test(route) && /already on YouTube/.test(route))
check('checked against YouTube\'s limits now, not at publish', /width < 640/.test(route) && /YT_MAX = 2 \* 1024 \* 1024/.test(route))
const item = read('app/api/launch/items/[id]/route.ts')
check('a new face does not build over it', /const rebuild = !ownThumb && /.test(item))
check('a new product does not clear it', /if \(!ownThumb\) \{\s*patch\.thumbnail_url = null/.test(item))
const batch = read('app/api/launch/batches/[id]/route.ts')
check('a new batch look does not build over it', /if \(own && !ctaChanged\) continue/.test(batch) && /lookChanged && !own/.test(batch))
const drain = read('app/api/cron/launch-drain/route.ts')
check('the drain builds only when there is no thumbnail', /const need = it\.thumbnail_url \? 0 : 1/.test(drain))
check('the board offers it', /function ItemThumbnail\(/.test(read('components/launch/LaunchBoard.tsx')))
check('and offers it in step 3, where thumbnails are chosen', /<OwnThumbnails items=\{items\}[\s\S]{0,200}<ThumbnailPicker/.test(read('components/launch/LaunchBoard.tsx')))

// MVP'S THUMBNAIL REACHES AMAZON (Seb, 2026-10-08: three Amazon uploads went
// up with a plain video frame while YouTube showed the designed thumbnail).
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const T = require('../lib/own-thumbnail') as typeof import('../lib/own-thumbnail')
  const mine = 'https://x.supabase.co/storage/v1/object/public/instagram-videos/u/thumb.png'
  const yt = 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg'
  check('YouTube\'s own images are told apart from MVP\'s', T.isYouTubeImage(yt) && T.isYouTubeImage('https://yt3.ggpht.com/x') && !T.isYouTubeImage(mine) && !T.isYouTubeImage(null))
  check('MVP\'s own thumbnail is kept over YouTube\'s, and YouTube\'s fills a gap', T.keepOwnThumbnail(mine, yt) === mine && T.keepOwnThumbnail(null, yt) === yt && T.keepOwnThumbnail(yt, 'https://i.ytimg.com/vi/abcdefghijk/hq.jpg') === 'https://i.ytimg.com/vi/abcdefghijk/hq.jpg')
  const RET = read('lib/youtube-retention.ts'), SYNC = read('app/api/youtube/sync/route.ts'), Q = read('app/api/global-sync/deliver/queue/route.ts')
  check('the hourly refresh does not write over MVP\'s thumbnail', /if \(!had\?\.thumbnail_url \|\| isYouTubeImage\(had\.thumbnail_url\)\) patch\.thumbnail_url = f\.thumb/.test(RET) && !/thumbnail_url: f\.thumb/.test(RET))
  check('nor does the channel sync', /keepOwnThumbnail\(ownThumb\.get\(row\.youtube_video_id\), row\.thumbnail_url\)/.test(SYNC))
  check('the Amazon upload takes the thumbnail Liftoff made first', /from\('launch_items'\)\.select\('video_id,thumbnail_url'\)/.test(Q) && Q.indexOf("from('launch_items').select('video_id,thumbnail_url')") < Q.indexOf('const textThumb = thumbByVideo.get(vidId)'))
}

if (failures.length) { console.error('❌ own thumbnail guard failed:\n  - ' + failures.join('\n  - ')); process.exit(1) }
console.log('✓ own thumbnail guard passed')
