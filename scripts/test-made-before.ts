/**
 * MVP RECALLS WHAT IT ALREADY MADE (Seb, 2026-10-05).
 *
 * Before a generator spends, it offers what exists for the same product, video
 * or brand (lib/made-before): reuse a thumbnail as is, open a post, load a
 * script or a collab email. Liftoff reuses a saved thumbnail instead of a new
 * plain render. A repeat article topic is handed back before the writer runs.
 * And the product's remembered image is only ever its real 16:9 thumbnail.
 *
 * Run: npx tsx scripts/test-made-before.ts
 */
import { readFileSync } from 'node:fs'
import { tidyMade, madeLabel, type MadeItem } from '../lib/made-before'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

const it = (kind: MadeItem['kind'], at: string, url: string | null = null): MadeItem => ({ kind, label: kind, url, imageUrl: null, at, id: null })
const t = tidyMade([it('blog', '2026-09-01', 'a'), it('blog', '2026-09-05', 'a'), it('script', '2026-09-10')])
check('newest first', t[0].kind === 'script')
check('the same post is listed once', t.filter((x) => x.kind === 'blog').length === 1)
check('a label names the kind and the title', madeLabel('blog', 'Best steam brush') === 'Blog post: Best steam brush')
check('a label never needs a title', madeLabel('script') === 'Script')

const L = read('lib/made-before.ts')
for (const table of ['product_images', 'youtube_videos', 'blog_posts', 'campaigns', 'launch_items', 'video_scripts', 'collaborations']) {
  check(`the lookup reads ${table}`, L.includes(`from('${table}')`))
}
check('every read is on its own, so one missing table costs only its row', (L.match(/tryRead\(async/g) ?? []).length >= 7)
check('only MVP-hosted video thumbnails count as made by MVP', /supabase\|mvpaffiliate\|fal\\\.media\|cloudinary/.test(L))

const T = read('app/api/youtube/generate-thumbnail/route.ts')
check('only the 16:9 thumbnail becomes the product\'s remembered image', /if \(format !== 'landscape'\) return res/.test(T))
check('the memory is filed under where it was made, not always Co-Pilot', /surface,\n\s*modelUsed/.test(T) && !/surface: 'YouTube Co-Pilot'/.test(T))

const D = read('app/api/cron/launch-drain/route.ts')
const reuse = D.indexOf('await recallProductImage(sb, it.user_id, asin)')
check('Liftoff reuses a saved thumbnail before rendering a plain one', reuse > 0 && reuse < D.indexOf('const basic = await buildProductThumbnail'))
check('and says so on the row', /thumbnail_source = usedSaved \? 'saved'/.test(D) && /reused your earlier thumbnail/.test(read('components/launch/LaunchBoard.tsx')))

const A = read('app/api/articles/generate/route.ts')
check('a topic already written is handed back before the writer runs', /alreadyMade: true/.test(A) && A.indexOf('alreadyMade: true') < A.indexOf('Build the writer prompt'))
check('and the creator can still ask for a new one', /if \(!body\.again && !sendsOwnHtml/.test(A) && /run\(publish, true\)/.test(read('app/(dashboard)/articles/page.tsx')))

const PAGES: Array<[string, RegExp]> = [
  ['app/(dashboard)/amazon/thumbnails/page.tsx', /<MadeBefore asin=\{normalizeAsinInput\(product\)\}[\s\S]{0,200}onUseImage=/],
  ['app/(dashboard)/script/page.tsx', /<MadeBefore asin=\{normalizeAsinInput\(input\)\} only=\{\['script'\]\}/],
  ['app/(dashboard)/collaborations/page.tsx', /<MadeBefore brand=\{brandName\} only=\{\['collab'\]\}/],
  ['app/(dashboard)/content/page.tsx', /<MadeBefore asin=[\s\S]{0,200}only=\{\['blog', 'deal', 'campaign'\]\}/],
]
for (const [f, re] of PAGES) check(`${f}: offers what MVP already made`, re.test(read(f)))

if (failures.length) {
  console.error('❌ made-before guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ made-before guard passed (thumbnails, posts, scripts, emails and articles are offered back before a new one is paid for)')
