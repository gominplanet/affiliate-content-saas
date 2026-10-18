// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WATCH IT WORK ON THE SALES PAGE (components/landing/islands SalesVideosSection;
// Seb, 2026-10-17: "change the mvp affiliate sales page to add some youtube
// videos in there so people have more knowledge of what is being offered").
//
// What it holds: the walkthrough first, then one video per feature, each a
// real MVP Affiliate channel video; nothing from YouTube loads until a visitor
// presses play; the captions are ours, plain, with no dashes or year; the
// section is on the page and in its navigation.
import { readFileSync } from 'node:fs'
import { SALES_VIDEOS } from '../components/landing/islands'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

check('the walkthrough first, then six feature videos', SALES_VIDEOS.length === 7 && SALES_VIDEOS[0].tag === 'Start here' && /walkthrough/i.test(SALES_VIDEOS[0].caption))
check('every video is a YouTube id, used once', SALES_VIDEOS.every(v => /^[A-Za-z0-9_-]{11}$/.test(v.id)) && new Set(SALES_VIDEOS.map(v => v.id)).size === SALES_VIDEOS.length)
check('captions and tags are plain words: no dashes, no year', SALES_VIDEOS.every(v => !/[–—|]| - /.test(v.caption + v.tag) && !/\b20\d\d\b/.test(v.caption)))
const ISL = read('components/landing/islands.tsx')
const SEC = ISL.slice(ISL.indexOf('/** WATCH IT WORK'))
check('nothing from YouTube loads until play is pressed, then from youtube-nocookie', /\{playing \? \(\s*<iframe/.test(SEC) && /youtube-nocookie\.com\/embed\/\$\{id\}/.test(SEC) && /'lazy'/.test(SEC))
const PAGE = read('app/page.tsx')
check('the section is on the sales page, after the features, and in its navigation', PAGE.indexOf('<SalesVideosSection />') > PAGE.indexOf('<FeaturesGridCondensed />') && PAGE.indexOf('<FeaturesGridCondensed />') > 0 && /\{ label: 'Videos', href: '#videos' \}/.test(PAGE) && /id="videos"/.test(SEC))
// The walkthrough moved to the hero (Seb, 2026-10-18), so the section below
// holds the six feature videos and does not show it a second time.
check('the walkthrough plays in the hero, its cover loaded with the page',
  /export function HeroVideo\(\) \{\s*return <SalesVideo \{\.\.\.SALES_VIDEOS\[0\]\} big eager \/>/.test(ISL) && /<HeroVideo \/>/.test(PAGE)
    && /loading=\{eager \? 'eager' : 'lazy'\}/.test(ISL))
check('and the section below does not repeat it', /const rest = SALES_VIDEOS\.slice\(1\)/.test(SEC) && !/SALES_VIDEOS\[0\]\} big \/>|\{\.\.\.first\} big/.test(SEC.slice(SEC.indexOf('export function SalesVideosSection'))))
check('a link to the whole channel', /https:\/\/www\.youtube\.com\/@MVPaffiliate\/videos/.test(SEC) && /More on the MVP Affiliate channel/.test(SEC))

if (fails.length) { console.error('sales-videos failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ sales-videos: the walkthrough in the hero and six feature videos below, click to play, nothing from YouTube loaded before')
