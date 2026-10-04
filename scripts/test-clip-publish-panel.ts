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
check('TikTok: link in bio, no unclickable product link, by default', /Link in bio/.test(tt) && !/mvpl\.ink/.test(tt))
const fb = composeClipDescription({ ...base, platform: 'facebook', include: CLIP_PLATFORM_RULES.facebook.defaults })
check('Facebook: the product link, named as Amazon (policy 6(w)), and the full review', /Grab it on Amazon 👉 https:\/\/mvpl\.ink\/abc/.test(fb) && /full review/.test(fb))
const yt = composeClipDescription({ ...base, platform: 'youtube', include: CLIP_PLATFORM_RULES.youtube.defaults })
check('YouTube: product link and full review by default, and the note says links are not clickable on a Short',
  /mvpl\.ink/.test(yt) && /youtube\.com\/watch/.test(yt) && /plain text, not clickable/.test(CLIP_PLATFORM_RULES.youtube.linkNote))
for (const [name, text] of [['TikTok', tt], ['Facebook', fb], ['YouTube', yt]] as const) {
  check(`${name}: the disclosure is always there, last`, text.trim().endsWith(base.disclosure))
  check(`${name}: each hashtag once`, (text.match(/#gadgets/gi) ?? []).length === 1 && (text.match(/#wallettracker/gi) ?? []).length === 1)
}
const none = composeClipDescription({ ...base, platform: 'facebook', include: { productLink: false, bioCta: false, review: false, hashtags: false } })
check('everything off leaves the write-up and the disclosure', none === `This wallet tracker saved me twice.\n\n${base.disclosure}`)
check('hashtags are taken out of the write-up and placed by choice', stripHashtags('Nice #a #b') === 'Nice')
const why = unavailableReasons({ productLink: null, videoUrl: null, blogUrl: null }, [])
check('a choice that adds nothing says why', !!why.productLink && /No product link found/.test(why.productLink) && !!why.review && !!why.hashtags)

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
