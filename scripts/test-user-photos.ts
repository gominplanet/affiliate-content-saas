// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The creator's own photos reach a scheduled post even when scheduling runs long.
//
// Support, 2026-11-23: "Blog 'Photos' not posting again even though we add
// them." The photos lived only in the browser and were placed by a request the
// browser sent after scheduling answered; when the write ran past its budget,
// the post went live without them and nothing said so.

import { readFileSync, existsSync } from 'node:fs'
import { placeUserPhotos, readUserPhotos, MAX_USER_PHOTOS, type PhotoSite } from '../lib/place-user-photos'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const para = (n: number) => `<p>${'Real words about the product and how it holds up. '.repeat(12)}${n}</p>`
const POST = ['<p>Intro paragraph about the lights.</p>', ...Array.from({ length: 7 }, (_, i) => `<h2>Section ${i + 1}</h2>${para(i)}${para(i + 10)}`)].join('\n')
const PHOTOS = ['https://x.supabase.co/storage/v1/object/public/product-images/u/blog/v/a.jpg', 'https://x.supabase.co/storage/v1/object/public/product-images/u/blog/v/b.jpg', 'https://x.supabase.co/storage/v1/object/public/product-images/u/blog/v/c.jpg']

function site(opts: { refuse?: boolean; failUpdate?: boolean } = {}) {
  const writes: string[] = []
  const s: PhotoSite = {
    uploadImageFromUrl: async (src: string, name: string) => (opts.refuse ? null : { source_url: `https://moderndayreviews.com/wp-content/uploads/${name}` }),
    updatePost: async (_id: number, patch: { content: string }) => { if (opts.failUpdate) throw new Error('WordPress said no'); writes.push(patch.content) },
  }
  return { s, writes }
}

void (async () => {
  check('photo addresses: web addresses only, at most three', readUserPhotos([...PHOTOS, 'https://x/d.jpg', 'javascript:alert(1)', 7]).length === MAX_USER_PHOTOS && readUserPhotos(null).length === 0)

  {
    const { s, writes } = site()
    const r = await placeUserPhotos({ site: s, wordpressPostId: 1177, content: POST, title: 'Aberlite Touch 2', slug: 'aberlite', urls: PHOTOS })
    check('three photos hosted on the creator\'s site, placed in the post, written to WordPress', r.ok && r.placed === 3 && r.hosted === 3 && r.status === 'ready' && writes.length === 1 && (writes[0].match(/wp:image/g) || []).length >= 3 && writes[0].includes('/wp-content/uploads/aberlite-body1.jpg'))
    check('the photos sit between sections, never at the very start', r.ok && !r.content.startsWith('<!-- wp:image') && r.content.indexOf('wp:image') > POST.indexOf('<h2>Section 1</h2>'))
  }
  {
    const { s } = site({ refuse: true })
    const r = await placeUserPhotos({ site: s, wordpressPostId: 1177, content: POST, title: 'T', slug: 's', urls: PHOTOS })
    check('a site that refuses the upload: placed from MVP\'s copy, and said as hotlinked, not ready', r.ok && r.hosted === 0 && r.status === 'hotlinked' && r.content.includes('supabase.co'))
  }
  {
    const { s } = site({ failUpdate: true })
    const r = await placeUserPhotos({ site: s, wordpressPostId: 1177, content: POST, title: 'T', slug: 's', urls: PHOTOS })
    check('WordPress refusing the post update is a failure with its reason, never a success', !r.ok && /WordPress said no/.test(r.error))
  }
  {
    const { s, writes } = site()
    const r = await placeUserPhotos({ site: s, wordpressPostId: 1, content: '<p>One short paragraph.</p>', title: 'T', slug: 's', urls: PHOTOS })
    check('a post with nowhere to put them says so and writes nothing', !r.ok && /no place to put the photos/.test(r.error) && writes.length === 0)
  }

  // Wired in
  const MODAL = read('components/content/ScheduleModal.tsx')
  check('the Schedule window sends the photos with the request', /\.\.\.\(includeImages && localUserImages\.length \? \{ userImageUrls: localUserImages \} : \{\}\)/.test(MODAL))
  check('and does not send them a second time when the server placed them', /typeof wpImgId === 'number' && !placedPhotos\)/.test(MODAL) && /Your \$\{placedPhotos\.placed\} photo/.test(MODAL))
  const SP = read('app/api/blog/schedule-publish/route.ts')
  check('scheduling forwards them to the step that writes the post', /\.\.\.\(userImageUrls\.length \? \{ userImageUrls, placePhotosNow: true \} : \{\}\)/.test(SP) && /photos: \(genJson as \{ photos\?: unknown \}\)\.photos \?\? null/.test(SP))
  const GEN = read('app/api/blog/generate/route.ts')
  const at = GEN.indexOf('const placedNow = await placeUserPhotos(')
  check('generate places them right after saving the post and queueing the socials, before it answers', at > GEN.indexOf('cascade = await queueCascade(') && at < GEN.indexOf('// ── Shorten the blog link for social') && /body\.placePhotosNow === true && userImageUrls\.length > 0 && savedPost\?\.id && !heldForReview/.test(GEN))
  check('they are kept on the post and the outcome is the post\'s image status, pending then ready or failed', /update\(\{ user_image_urls: userImageUrls, images_status: 'pending' \}\)/.test(GEN) && /images_status: placedNow\.status/.test(GEN) && /update\(\{ images_status: 'failed' \}\)\.eq\('id', savedPost\.id\)/.test(GEN))
  check('later steps keep the photos', /content = placedNow\.content/.test(GEN))
  const RI = read('app/api/blog/refresh-images/route.ts')
  check('Retry images places the kept photos again instead of AI pictures', /userImageUrls = readUserPhotos\(keptPhotos\?\.user_image_urls\)/.test(RI))
  check('migration 472 keeps them, safe to run twice', existsSync('supabase/migrations/472_blog_post_user_photos.sql') && /add column if not exists user_image_urls jsonb/.test(read('supabase/migrations/472_blog_post_user_photos.sql')))
  check('no dashes in what the creator reads', !/[–—]/.test(MODAL.slice(MODAL.indexOf('Your ${placedPhotos.placed}'), MODAL.indexOf('Your ${placedPhotos.placed}') + 250)))

  if (failures.length) {
    console.error(`test-user-photos: ${failures.length} failed`)
    for (const f of failures) console.error(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log('test-user-photos: all checks passed')
})()
