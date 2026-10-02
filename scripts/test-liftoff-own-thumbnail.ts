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

if (failures.length) { console.error('❌ own thumbnail guard failed:\n  - ' + failures.join('\n  - ')); process.exit(1) }
console.log('✓ own thumbnail guard passed')
