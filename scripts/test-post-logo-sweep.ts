// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// STORE LOGOS IN PICTURES ALREADY PUBLISHED: EVERY PICTURE, AND SAID AS FOUND.
//
// A post had Amazon's logo in the article and an AI picture of the logo next
// to it, drawn from a blocked page's share image. Its first picture was fine,
// so a check of the first picture only would have passed it. This pins that
// every picture is looked at, that an Amazon site graphic is a finding on its
// address alone, and that replacing the pictures sends the post back to be
// looked at again.
import { readFileSync } from 'node:fs'
import { postImageUrls, checkImage, AMAZON_SITE_GRAPHIC, MAX_IMAGES_PER_POST } from '../lib/post-logo-sweep'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const r = (p: string) => readFileSync(p, 'utf8')

async function main() {
  const html = [
    '<p><img src="https://ex.com/wp-content/uploads/hero.jpg" alt=""></p>',
    '<img src="https://i.ytimg.com/vi/abc/hqdefault.jpg">',
    '<img class="x" src="https://m.media-amazon.com/images/I/71abc.jpg">',
    '<figure><img src="https://m.media-amazon.com/images/G/01/social_share/amazon_logo._CB633266945_.png"></figure>',
    '<img src="https://fal.media/files/body2.jpg"><img src="https://ex.com/wp-content/uploads/hero.jpg">',
    '<img src="data:image/png;base64,AAAA">',
  ].join('\n')
  const urls = postImageUrls(html)
  check('every picture in the post, not only the first', urls.includes('https://ex.com/wp-content/uploads/hero.jpg') && urls.includes('https://fal.media/files/body2.jpg'))
  check('the Amazon site graphic is looked at', urls.some((u) => /images\/G\//.test(u)))
  check('the creator\'s own video frame, an Amazon product photo and inline data are not', !urls.some((u) => /ytimg|images\/I\/|^data:/.test(u)))
  check('each picture once', urls.length === 3)
  check('a limit per post', postImageUrls(Array.from({ length: 20 }, (_, i) => `<img src="https://ex.com/${i}.jpg">`).join('')).length === MAX_IMAGES_PER_POST)

  // No model and no network: the address alone decides this one.
  const noModel = { messages: { create: async () => { throw new Error('must not be asked') } } }
  const f = await checkImage(noModel, 'https://m.media-amazon.com/images/G/01/gno/sprites/nav-sprite.png', { userId: 'u', tier: null, feature: 't' })
  check('an Amazon site graphic is a finding on its address alone', f.verdict === 'found' && f.marks[0] === AMAZON_SITE_GRAPHIC)
  const g = await checkImage(noModel, 'https://127.0.0.1:1/nothing.jpg', { userId: 'u', tier: null, feature: 't' })
  check('a picture that cannot be opened is unchecked, never clean', g.verdict === 'unreadable' && !!g.reason)

  const LIB = r('lib/post-logo-sweep.ts')
  check('a post is only marked looked at after its findings are written', LIB.indexOf("from('post_logo_findings').insert(rows)") < LIB.indexOf("update({ logo_checked_at: at })"))
  check('a missing migration is said, not taken for an empty result', /MIGRATION_MISSING/.test(LIB) && /return \{ \.\.\.out, error:/.test(LIB))

  // OLD POSTS ARE LEFT AS THEY ARE (Seb, 2026-10-01): no background sweep;
  // every NEW picture is checked instead.
  check('old posts are not swept in the background any more', !/"\/api\/cron\/post-logo-sweep"/.test(r('vercel.json')))
  const NEWPIC = r('lib/post-logo-sweep.ts')
  check('a new picture with a store logo is refused', /export async function checkNewPicture/.test(NEWPIC) && /if \(f\.verdict === 'found'\) return \{ ok: false, marks: f\.marks \}/.test(NEWPIC))
  check('blog heroes, article pictures and YouTube thumbnails are all checked before use',
    /checkNewPicture\(\{ base64: hero\.data/.test(r('lib/blog-hero.ts'))
    && /checkNewPicture\(\{ url: falUrl \}/.test(r('app/api/blog/generate/route.ts'))
    && /checkNewPicture\(\{ url \}/.test(r('app/api/blog/refresh-images/route.ts'))
    && /const res = await withoutStoreLogos\(res0, memo\.userId\)/.test(r('app/api/youtube/generate-thumbnail/route.ts')))
  check('a thumbnail that only came back with logos says so, never ships one', /code: 'store_logo' \}, \{ status: 422 \}/.test(r('app/api/youtube/generate-thumbnail/route.ts')))

  const REFRESH = r('app/api/blog/refresh-images/route.ts')
  check('replacing the pictures also removes any Amazon site graphic in the post', /isRetailerSiteImage\(src\) \? '' : tag/.test(REFRESH))
  check('and sends the post back to be looked at again, on both paths', (REFRESH.match(/await forgetLogoScan\(createAdminClient\(\), post\.id\)/g) ?? []).length === 2)

  const ROUTE = r('app/api/thumbnails/logo-scan/route.ts')
  check('the check now reads every picture of a post', /scanPost\(admin, anthropic, p,/.test(ROUTE) && !/One image per post, the first one/.test(ROUTE))
  check('and lists what was found, with how far along it is', /export async function GET\(\)/.test(ROUTE) && /checkedPosts/.test(ROUTE) && /waitingPosts/.test(ROUTE))

  const PAGE = r('app/(dashboard)/tools/logo-check/page.tsx')
  check('the page offers to replace the pictures and says what happened', /Replace the pictures/.test(PAGE) && /\/api\/blog\/refresh-images/.test(PAGE) && /no new ones could be made/.test(PAGE))
  check('and never calls a partly checked blog clear', /not checked yet/.test(PAGE) && /None of your posts has been checked yet/.test(PAGE))

  const MIG = r('supabase/migrations/390_post_logo_findings.sql')
  check('the migration is safe to run twice', /add column if not exists logo_checked_at/.test(MIG) && /create table if not exists public\.post_logo_findings/.test(MIG) && /drop policy if exists/.test(MIG))

  if (failures.length) {
    console.error(`\n❌ post-logo-sweep: ${failures.length} failure(s)\n`)
    for (const x of failures) console.error(`   • ${x}`)
    process.exit(1)
  }
  console.log('✅ post-logo-sweep: every picture in every post, Amazon site graphics found by address, replaced posts looked at again')
}
void main()
