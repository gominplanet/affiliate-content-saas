// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AUTO-DM ON EVERY INSTAGRAM POST MVP MAKES (Seb, 2026-10-23: "anywhere a
// user can use instagram, this auto dm feature should be set up and ready to
// use"). Holds:
//   - every file that publishes to Instagram goes through lib/ig-auto-dm,
//     except the Auto-DM page's own Reel (which is a campaign already) and
//     the deal Story (Stories take no comments);
//   - the automatic link is this post's own: its Link in Bio product page, its
//     blog post, its product link, the whole shop last;
//   - the caption promises a DM only on an account that can answer, and never
//     rewrites a caption the creator wrote in a window;
//   - an unticked window sends false, so no automatic one is added behind the
//     creator's back;
//   - every posting window with Instagram shows the block, and says when a
//     Story cannot have one;
//   - a successful Auto-DM is never put in a note that screens show as a
//     warning;
//   - the creator can turn it off on the Auto-DM page (migration 454).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(f)
  }
  return out
}

;(async () => {
  const { autoDmLink } = await import('../lib/dm-link-options')
  const { captionForPlan, autoDmWords } = await import('../lib/ig-auto-dm')
  const { withDmCta } = await import('../lib/dm-caption-cta')

  // The automatic link.
  const shop = { kind: 'shop' as const, url: 'https://www.mvpaffiliate.io/shop/me/p/B000000000', label: '', note: '' }
  const blog = { kind: 'blog' as const, url: 'https://blog.example.com/review', label: '', note: '' }
  const amz = { kind: 'amazon' as const, url: 'https://mvpl.ink/a', label: '', note: '' }
  check('a known product goes to its Link in Bio page first', autoDmLink({ asin: 'B000000000', title: '', options: [amz, blog, shop] })?.kind === 'shop')
  check('with no product known, the whole shop comes last', autoDmLink({ asin: null, title: '', options: [{ ...shop, url: 'https://www.mvpaffiliate.io/shop/me' }, blog, amz] })?.kind === 'blog')
  check('nothing found means no link', autoDmLink({ asin: null, title: '', options: [] }) === null)

  // The caption.
  const plan = { keyword: 'DEAL', link: 'https://x.y', kind: null, ready: true, tile: null, chosen: false }
  check('an account that can answer gets the comment line', /Comment DEAL and I’ll DM you the link\./.test(captionForPlan('Great find.\n\nLink in bio.', plan)))
  check('one that cannot gets no promise', captionForPlan('Great find.\n\nLink in bio.', { ...plan, ready: false }) === 'Great find.\n\nLink in bio.')
  check('a caption the creator wrote in a window is left as sent', captionForPlan('Mine.\n\nLink in bio.', { ...plan, chosen: true }) === 'Mine.\n\nLink in bio.')
  check('no plan, no change', captionForPlan('x', null) === 'x')
  const amazonCaption = withDmCta('Love this.\n\n🔗 Link in bio to shop', 'LINK')
  check('"Link in bio to shop" is replaced whole, nothing left behind', /🔗 Comment LINK and I’ll DM you the link\.$/.test(amazonCaption) && !/to shop/.test(amazonCaption))
  check('the words say when it waits on Instagram', /once Instagram sends comments to MVP/.test(autoDmWords({ ok: true, keyword: 'link', link: 'https://x.y', ready: false }) || ''))
  check('and say plainly when it was not attached', /^Auto-DM was not attached: /.test(autoDmWords({ ok: false, error: 'x' }) || ''))

  // Every Instagram publish goes through lib/ig-auto-dm.
  const EXEMPT: Record<string, string> = {
    'app/api/instagram/dm-campaign/route.ts': 'the Auto-DM page posts a Reel with its own campaign',
    'lib/deal-story-publish.ts': 'Stories take no comments',
  }
  const files = [...walk('app'), ...walk('lib')].filter((f) => /\bpublishMedia\(/.test(read(f)))
  check('the publishers were found', files.length >= 6)
  for (const f of files) {
    if (EXEMPT[f]) continue
    const src = read(f)
    check(`${f} plans the post's Auto-DM`, /from '@\/lib\/ig-auto-dm'/.test(src) && /autoDmPlan\(/.test(src) && /finishAutoDm\(/.test(src))
  }
  const DEAL_STORY = read('lib/deal-story-publish.ts')
  check('the deal Story exemption still only posts Stories', !/mediaType: '(IMAGE|REELS)'/.test(DEAL_STORY))

  // Windows: the block, an explicit false when unticked, and the Story note.
  const WINDOWS = ['components/InstagramBurnedModal.tsx', 'components/TikTokDirectModal.tsx', 'components/InstagramDirectModal.tsx', 'components/content/InstagramPublishModal.tsx']
  for (const f of WINDOWS) {
    const src = read(f)
    check(`${f} shows the Auto-DM block`, /<ReelAutoDm/.test(src))
    check(`${f} sends false when it is unticked`, /\?\? false/.test(src))
  }
  check('the Short window says a Story has none', /No Auto-DM on a Story: Instagram Stories take no comments/.test(read('components/InstagramDirectModal.tsx')))
  check('the blog window says a Story has none', /No Auto-DM on a Story: Instagram Stories take no comments/.test(read('components/content/InstagramPublishModal.tsx')))
  check('the blog window no longer reports the account-wide switch as this post\'s Auto-DM', !/Auto-DM is on\.<\/strong>/.test(read('components/content/InstagramPublishModal.tsx')))
  check('the blog window passes its post for its links', /<ReelAutoDm postId=\{postId\}/.test(read('components/content/InstagramPublishModal.tsx')) && /q\.set\('postId', postId\)/.test(read('components/instagram/ReelAutoDm.tsx')))
  check('the TikTok publish page shows what the route did', /setIgDmWords\(/.test(read('app/(dashboard)/tiktok-publish/[blogPostId]/page.tsx')))

  // Notes are warnings: only a failure, or a wait, goes in one.
  const SOCIAL = read('lib/amazon-social-publish.ts')
  check('Amazon and deal posts put only a failed or waiting Auto-DM in the note', /dmOut && \(!dmOut\.ok \|\| !dmOut\.ready\) \? autoDmWords\(dmOut\) : null/.test(SOCIAL))
  check('the Amazon composer says when it is on, in green', /result\.autoDm && <p className="text-\[12\.5px\] leading-relaxed text-\[#16a34a\]">/.test(read('components/amazon/PostComposer.tsx')))
  check('no success sentence is pushed as a deal note', !/note: `Auto-DM is on/.test(read('lib/deal-quick-post.ts')))

  // The creator's switch.
  const SETTINGS = read('app/api/instagram/dm-settings/route.ts'), PAGE = read('app/(dashboard)/instagram-dm/page.tsx'), AUTO = read('lib/ig-auto-dm.ts')
  check('the switch is on unless turned off', /mvp_posts: true/.test(SETTINGS) && /mvp_posts: data\.mvp_posts !== false/.test(SETTINGS) && /if \(settings\?\.mvp_posts === false\) return null/.test(AUTO))
  check('saving it never blocks the other settings', /update\(\{ mvp_posts: body\.mvp_posts \}\)/.test(SETTINGS))
  check('the page has the switch', /Auto-DM on every post MVP makes/.test(PAGE) && /mvp_posts: mvpPosts/.test(PAGE))
  check('the page preview is the DM as it goes out', /const preview = renderMessage\(template, EXAMPLE_LINK, true\)/.test(PAGE))
  check('the migration is safe to run twice', /add column if not exists mvp_posts boolean not null default true/.test(read('supabase/migrations/454_ig_dm_mvp_posts.sql')))

  if (fails.length) { console.error('ig-auto-dm-everywhere failed:\n - ' + fails.join('\n - ')); process.exit(1) }
  console.log(`✅ ig-auto-dm-everywhere: all ${files.length - Object.keys(EXEMPT).filter((f) => files.includes(f)).length} Instagram publishers give each Reel and feed post its own Auto-DM, every window shows it, and failures read differently from success`)
})()
