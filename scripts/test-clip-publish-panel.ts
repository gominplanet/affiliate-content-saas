// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CLIP FACTORY: EACH PLATFORM'S DESCRIPTION IS CHOSEN, AND IS WHAT POSTS.
//
// A pill opens a panel that asks what goes in the description (product link,
// link in bio, full review, hashtags), always with the disclosure, and for
// YouTube a real title and tag set. Pinned: the defaults follow where a link
// can be clicked, nothing is placed twice, a choice that adds nothing says why,
// and the text posted is the text shown.
import { readFileSync } from 'node:fs'
import { composeClipDescription, CLIP_PLATFORM_RULES, unavailableReasons, stripHashtags } from '../lib/clip-description'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const r = (p: string) => readFileSync(p, 'utf8')

const base = {
  writeUp: 'This wallet tracker saved me twice. #wallettracker #gadgets',
  productLink: 'https://mvpl.ink/abc', amazon: true,
  videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', blogUrl: null, linkHub: 'https://linktr.ee/me',
  hashtags: ['wallettracker', '#Gadgets', 'gadgets'], disclosure: 'As an Amazon Associate I earn from qualifying purchases.',
}
const tt = composeClipDescription({ ...base, platform: 'tiktok', include: CLIP_PLATFORM_RULES.tiktok.defaults })
check('TikTok: nothing that sends people off TikTok, #ad first (Jarett, 2026-10-24)', !/link in bio/i.test(tt) && !/mvpl\.ink/.test(tt) && !/amazon/i.test(tt) && tt.startsWith('#ad'))
const fb = composeClipDescription({ ...base, platform: 'facebook', include: CLIP_PLATFORM_RULES.facebook.defaults })
check('Facebook: the product link, named as Amazon (policy 6(w)), and the full review', /Grab it on Amazon 👉 https:\/\/mvpl\.ink\/abc/.test(fb) && /full review/.test(fb))
const yt = composeClipDescription({ ...base, platform: 'youtube', include: CLIP_PLATFORM_RULES.youtube.defaults })
check('YouTube: product link and full review by default, and the note says links are not clickable on a Short',
  /mvpl\.ink/.test(yt) && /youtube\.com\/watch/.test(yt) && /plain text, not clickable/.test(CLIP_PLATFORM_RULES.youtube.linkNote))
check('YouTube: the disclosure is always there, last', yt.trim().endsWith(base.disclosure))
for (const [name, text] of [['TikTok', tt], ['Facebook', fb], ['YouTube', yt]] as const) {
  check(`${name}: each hashtag once`, (text.match(/#gadgets/gi) ?? []).length === 1 && (text.match(/#wallettracker/gi) ?? []).length === 1)
}
// Seb 2026-10-13: Facebook goes link, disclosure, write-up, full review.
const fbLines = fb.split('\n')
check('Facebook: the affiliate link is the first line and the disclosure the second',
  /^🛒 Grab it on Amazon 👉 https:\/\/mvpl\.ink\/abc$/.test(fbLines[0]) && fbLines[1] === base.disclosure)
check('Facebook: then the write-up, then the full review, then hashtags',
  fb.indexOf('This wallet tracker saved me twice.') > fb.indexOf(base.disclosure)
  && fb.indexOf('🎬 Watch the full review 👉 https://www.youtube.com/watch?v=abcdefghijk') > fb.indexOf('This wallet tracker saved me twice.')
  && fb.indexOf('#wallettracker') > fb.indexOf('Watch the full review'))
check('Facebook: the disclosure appears once', fb.split(base.disclosure).length === 2)
const none = composeClipDescription({ ...base, platform: 'facebook', include: { productLink: false, bioCta: false, review: false, hashtags: false } })
check('everything off leaves the write-up and the disclosure', none === `This wallet tracker saved me twice.\n\n${base.disclosure}`)
check('hashtags are taken out of the write-up and placed by choice', stripHashtags('Nice #a #b') === 'Nice')
const why = unavailableReasons({ productLink: null, videoUrl: null, blogUrl: null }, [])
check('a choice that adds nothing says why', !!why.productLink && /No product link found/.test(why.productLink) && !!why.review && !!why.hashtags)

// TIKTOK NEVER SENDS ANYONE OFF TIKTOK (Jarett, 2026-10-24: TikTok Shop
// flagged a post for "Link in bio to shop it" and the Amazon Associates line).
{
  const { tiktokSafeCaption, sendsOffTikTok } = require('../lib/tiktok-caption') as typeof import('../lib/tiktok-caption')
  const jarett = 'Finally sit through your workday without pain. Doctor-recommended comfort that actually lasts. As an Amazon Associate I earn from qualifying purchases.\n\n🛒 Link in bio to shop it\n\n#everlasting #ergonomic #desk #ergonomicchair\n\nAs an Amazon Associate I earn from qualifying purchases. Some links on this site are affiliate links, if you buy though them I may make a commission at no extra cost to you.'
  const out = tiktokSafeCaption(jarett)
  check('Jarett\'s caption keeps his words and tags, loses every way off TikTok, and says #ad', out === '#ad\n\nFinally sit through your workday without pain. Doctor-recommended comfort that actually lasts.\n\n#everlasting #ergonomic #desk #ergonomicchair')
  check('a store, a link or a store hashtag never reaches TikTok', !/amazon|amzn|https?:/i.test(tiktokSafeCaption('My favorite Amazon find! It cleans fast. #amazonfinds #cleaning\nShop it here: https://amzn.to/abc')) && /#cleaning/.test(tiktokSafeCaption('Nice. #amazonfinds #cleaning')))
  check('a clean caption keeps its words and gains only #ad', tiktokSafeCaption('This blender changed my mornings. #blender') === '#ad\n\nThis blender changed my mornings. #blender' && !sendsOffTikTok('This blender changed my mornings.'))
  const T = r('services/tiktok.ts')
  check('every post to TikTok goes through it', (T.match(/title: fitHashtags\(tiktokSafeCaption\(opts\.title\), 'tiktok'\)/g) || []).length === 2)
  check('the TikTok switches that would send people away say why', /TikTok Shop flags a video that sends people off TikTok/.test(unavailableReasons({ productLink: 'x', videoUrl: 'y', blogUrl: null }, ['a'], 'tiktok').bioCta || '') && /unavailableReasons\(kit, hashtags, platform\)/.test(r('components/clip-factory/PublishPanel.tsx')))
  check('the TikTok box says what MVP takes out', /sendsOffTikTok\(caption\) && <p/.test(r('components/TikTokDirectModal.tsx')))
}

const PAGE = r('components/clip-factory/ClipFactory.tsx')
check('every pill opens the panel rather than posting', ['tiktok', 'instagram', 'youtube', 'facebook'].every((p) => new RegExp(`openPanel\\('${p}'\\)`).test(PAGE)))
check('the Reel cover sits above the pills', PAGE.indexOf("'Choose Reel cover'") > 0 && PAGE.indexOf("'Choose Reel cover'") < PAGE.indexOf('<PostPill label="TikTok"'))
check('YouTube posts the panel\u2019s title, description and tags', /title: choice\.title/.test(PAGE) && /description: choice\.text/.test(PAGE) && /tags: choice\.tags/.test(PAGE))
check('TikTok and Instagram open with the panel\u2019s text', /initialCaption=\{ttCaption \?\? publishCaption\}/.test(PAGE) && /initialCaption=\{igCaption \?\? publishCaption\}/.test(PAGE))
const KIT = r('app/api/clip-factory/publish-kit/route.ts')
check('YouTube gets a written title and 12 to 15 tags, and says when it fell back', /12 to 15 search phrases/.test(KIT) && /note: `The title and tags writer did not run/.test(KIT) && /No price, no year/.test(KIT))
check('the product link is minted for the platform it posts on', /channel: platform/.test(KIT) && /source: channel/.test(r('lib/reel-caption.ts')))

if (failures.length) {
  console.error(`\n❌ clip-publish-panel: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ clip-publish-panel: each platform\u2019s description is chosen, disclosed, and posted exactly as shown')
