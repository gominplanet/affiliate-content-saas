// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AUTO-DM ON EVERY REEL CLIP FACTORY POSTS, WITH THE DM SHOWN (Seb,
// 2026-10-23: "if you're in Clip Factory, you should be able to create the
// shorts and then have automatically the auto DM function within that. So
// showing the users the actual link, the actual affiliate link that will be
// sent out if someone says the word that the user chooses").
//
// Holds:
//   - both windows that post a Reel (Post to Instagram, and the TikTok
//     window's "Also post to Instagram") carry the same Auto-DM block;
//   - the block shows the DM word for word, built by the code the webhook
//     sends with, and a link to what it sends that names where it goes;
//   - the keyword box keeps one word, as it is saved and matched;
//   - after posting, the window says whether Auto-DM was attached, from the
//     route's answer, never assumed;
//   - a member is told before posting when their Instagram cannot answer
//     comments, and never shown Meta's App Review page.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

;(async () => {
  const { oneWordKeyword, dmLinkWords, renderMessage } = await import('../lib/ig-dm-message')
  const { matchesKeyword } = await import('../lib/ig-dm')
  const { grantedPermissions } = await import('../services/instagram')

  // The keyword, as saved and matched.
  check('one word is kept as typed', oneWordKeyword('DEAL') === 'DEAL')
  check('a second word is dropped, as the routes always did', oneWordKeyword('send me') === 'send')
  check('empty means LINK', oneWordKeyword('  ') === 'LINK' && oneWordKeyword(undefined) === 'LINK')
  check('at most 30 characters', oneWordKeyword('x'.repeat(40)).length === 30)
  check('the hint is true: "Link!" and "LINK please" both match LINK', matchesKeyword('Link!', 'LINK') && matchesKeyword('LINK please', 'LINK') && !matchesKeyword('links', 'LINK'))

  // The link's words name where it goes.
  check('a Link in Bio choice says so', dmLinkWords('shop', 'https://www.mvpaffiliate.io/shop/x') === 'Open your Link in Bio page')
  check('a blog choice says so', dmLinkWords('blog', 'https://blog.example.com/p') === 'Open your blog post')
  check('an Amazon address names Amazon', /Amazon/.test(dmLinkWords('amazon', 'https://www.amazon.com/dp/B000000000')))
  check('a cloaked link names the store MVP followed it to', dmLinkWords('amazon', 'https://geni.us/abc', 'Amazon') === 'Open the link on Amazon')
  check('a cloaked link MVP could not follow guesses no store', dmLinkWords('custom', 'https://geni.us/abc') === 'Open the link they get')

  // The DM names a store MVP confirmed by following the link.
  const walmart = renderMessage('', 'https://geni.us/w', false, 'Walmart')
  check('a cloaked Walmart link says Walmart in the DM', /This link goes to Walmart\./.test(walmart))
  check('an unconfirmed cloaked link names no store', !/This link goes to/.test(renderMessage('', 'https://geni.us/w', false, null)))
  check('the DM always carries the disclosure', /#ad/i.test(walmart))

  // The permissions granted on connect, in each shape Meta answers with.
  check('a flat list is read', JSON.stringify(grantedPermissions({ permissions: ['instagram_business_basic', 'instagram_business_manage_messages'] })) === JSON.stringify(['instagram_business_basic', 'instagram_business_manage_messages']))
  check('a comma string inside data[0] is read', grantedPermissions({ data: [{ permissions: 'instagram_business_basic, instagram_business_manage_comments' }] })?.[1] === 'instagram_business_manage_comments')
  check('no permissions listed is not known, never an empty grant', grantedPermissions({ access_token: 'x' }) === null)

  const BLOCK = read('components/instagram/ReelAutoDm.tsx')
  const IG = read('components/InstagramBurnedModal.tsx')
  const TT = read('components/TikTokDirectModal.tsx')
  const CF = read('components/clip-factory/ClipFactory.tsx')
  check('the Post to Instagram window uses the shared block', /<ReelAutoDm/.test(IG) && !/dmKeyword/.test(IG))
  check('the TikTok window offers it with "Also post to Instagram"', /\{alsoIg && igDmAvailable && \(/.test(TT) && /<ReelAutoDm/.test(TT) && /autoDm: dm/.test(TT))
  check('the "Comment LINK" caption goes on the Instagram copy only', /const igCaption = dm \? withDmCta\(caption, dm\.keyword\) : caption/.test(TT) && /caption: igCaption/.test(TT))
  check('Clip Factory passes the source video for the blog post and product links', /dmVideoId=\{clip\?\.sourceVideoId \|\| selectedVideo\?\.id \|\| undefined\}/.test(CF))
  check('the block keeps the keyword to one word as it is typed', /replace\(\/\\s\+\/g, ''\)\.slice\(0, 30\)/.test(BLOCK))
  check('the block shows the DM from the preview route', /\/api\/instagram\/dm-preview\?link=/.test(BLOCK) && /preview\.message/.test(BLOCK))
  check('the link to what it sends names where it goes', /dmLinkWords\(kind, link, preview\.store\)/.test(BLOCK))
  check('the block says when Instagram cannot answer comments, and why', /\/api\/instagram\/dm-debug/.test(BLOCK) && /Comments on this Reel will not get the DM yet\. \{ready\.why\}/.test(BLOCK))

  const PREVIEW = read('app/api/instagram/dm-preview/route.ts'), ENGINE = read('lib/ig-dm.ts')
  check('the preview and the webhook build the DM with the same code', /dmMessageFor\(user\.id, settings\?\.message_template, link, false\)/.test(PREVIEW) && /const \{ message \} = await dmMessageFor\(userId as string, settings\?\.message_template, link, amazonDest\)/.test(ENGINE))
  check('the preview is for members who can use Auto-DM', /if \(!canUseIgDm\(integ\?\.tier\)\)/.test(PREVIEW))
  check('a hidden store is followed before the DM names it', /confirmLinkStores\(userId, link\)/.test(ENGINE))

  for (const f of ['app/api/instagram/publish-burned/route.ts', 'app/api/instagram/post-direct-video/route.ts']) {
    const R = read(f)
    check(`${f} attaches Auto-DM through the shared helper`, /autoDmPlan\(sb, \{/.test(R) && /finishAutoDm\(sb, dmPlan/.test(R))
    check(`${f} says what happened to it`, /autoDmError/.test(R) && /autoDmKeyword/.test(R))
  }
  check('no route cuts the keyword on its own any more', !/split\(\/\\s\+\/\)\[0\]/.test(read('app/api/instagram/publish-burned/route.ts')))
  check('the Post to Instagram window reports the route\'s answer', /setDmResult\(json\.autoDm/.test(IG) && /Auto-DM was not attached: \{dmResult\.error\}/.test(IG))
  check('the TikTok window reports it too', /setIgDmResult\(igJson\.autoDm/.test(TT) && /Auto-DM was not attached: \{igDmResult\.error\}/.test(TT))

  const DBG = read('app/api/instagram/dm-debug/route.ts'), STATUS = read('components/instagram/InstagramDmStatus.tsx')
  check('the status says a Reel can or cannot answer, apart from the account-wide switch', /reel: \{ ok: !blocker, why: blocker \}/.test(DBG))
  check('a connection without the messaging permissions is told to reconnect', /permission to \$\{missing\.includes\('instagram_business_manage_messages'\)/.test(DBG))
  check('Meta\'s App Review page is the team\'s only', /appReviewUrl: team \? appReviewUrl\(\) : null/.test(DBG) && /\{data\.team && data\.appReviewUrl && \(/.test(STATUS))
  check('permissions not recorded show as not known, never as allowed', /state: c\.permissionsKnown \? /.test(STATUS))
  check('connecting records what was granted', /permissions: tokens\.permissions/.test(read('app/api/auth/instagram/callback/route.ts')) && /permissions: account\.permissions/.test(read('lib/social-accounts.ts')))

  if (fails.length) { console.error('reel-auto-dm failed:\n - ' + fails.join('\n - ')); process.exit(1) }
  console.log('✅ reel-auto-dm: every Reel window offers Auto-DM with the DM shown word for word, says whether it was attached, and warns when Instagram cannot answer')
})()
