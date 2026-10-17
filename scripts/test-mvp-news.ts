// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT'S NEW IN MVP, ONCE A DAY (lib/whats-new, components/dashboard/MvpNews;
// Seb, 2026-10-17: "we need to have this pop up for anyone using MVP once a
// day when they use the tools.. list the new things we offer or have updated
// from the past 7 days ... with the updates on the left.. and the latest
// youtube videos on the right.. with the Join Trybe button link (with our
// affiliate), with the Subscribe button for youtube channel and join MVP's
// facebook group").
//
// What it holds: every entry is dated and only the last 7 days show; a member
// sees only what their plan has; it opens by itself once a day when there is
// news, and whenever SCOUT has news not yet seen; one card, so the SCOUT news
// and the daily news never stack; the three buttons and MVP's referral link.
import { readFileSync } from 'node:fs'
import { WHATS_NEW, recentNews, NEWS_DAYS, opensToday } from '../lib/whats-new'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

// ── The entries ──
check('every entry has a real date, a title and words, no dashes, no year in the copy', WHATS_NEW.every(u => /^\d{4}-\d\d-\d\d$/.test(u.date) && Number.isFinite(Date.parse(u.date)) && u.title.length > 5 && u.desc.length > 20 && !/[–—]| - /.test(u.title + u.desc) && !/\b20\d\d\b/.test(u.title + u.desc)))
const at = (s: string) => new Date(s)
check(`the last ${NEWS_DAYS} days only`, NEWS_DAYS === 7 && recentNews('pro', at('2026-10-17T12:00:00Z')).length === WHATS_NEW.filter(u => u.date >= '2026-10-10').length && recentNews('pro', at('2026-10-30T12:00:00Z')).every(u => u.date >= '2026-10-23'))
const pro = recentNews('pro', at('2026-10-17T12:00:00Z'))
check('newest first', pro.every((u, i) => i === 0 || pro[i - 1].date >= u.date))
const trial = recentNews('trial', at('2026-10-17T12:00:00Z'))
check('a plan without TRYBE does not see TRYBE news', !trial.some(u => u.gate === 'trybe') && pro.some(u => u.gate === 'trybe'))

// ── When it opens ──
const POP = read('components/dashboard/MvpNews.tsx')
check('once a day when there is news', opensToday({ today: '2026-10-17', shownDay: null, updates: 5, scout: false, force: false }) && !opensToday({ today: '2026-10-17', shownDay: '2026-10-17', updates: 5, scout: false, force: false }) && opensToday({ today: '2026-10-18', shownDay: '2026-10-17', updates: 5, scout: false, force: false }))
check('no news, no card', !opensToday({ today: '2026-10-17', shownDay: null, updates: 0, scout: false, force: false }))
check('SCOUT news not yet seen opens it even after the day’s card', opensToday({ today: '2026-10-17', shownDay: '2026-10-17', updates: 0, scout: true, force: false }))
check('?whatsnew opens it any time', opensToday({ today: '2026-10-17', shownDay: '2026-10-17', updates: 0, scout: false, force: true }) && /const FORCE_PARAMS = \['whatsnew', 'scoutnews'\]/.test(POP))
check('opening counts as the day’s, and Got it records the SCOUT release too', /setOpen\(true\)\s*\/\/[^\n]*\n\s*localSet\(DAY_KEY, today\)/.test(POP) && /localSet\(DAY_KEY, localDay\(\)\)\s*if \(plan\) \{ localSet\(SEEN_KEY, plan\.seenTo\)/.test(POP))
check('the day is the member’s own day', /d\.getFullYear\(\)\}-\$\{String\(d\.getMonth\(\) \+ 1\)/.test(read('lib/whats-new.ts')))

// ── What it shows ──
check('updates on the left, SCOUT news on top of them, videos on the right', /md:grid-cols-\[1\.05fr_1fr\]/.test(POP) && POP.indexOf('{plan && scoutWords && (') < POP.indexOf('{updates.map(') && POP.indexOf('{updates.map(') < POP.indexOf('Latest from MVP Affiliate'))
check('the updates list scrolls by itself so the videos stay in view', /md:max-h-\[64vh\] md:overflow-y-auto/.test(POP))
check('Join TRYBE goes through MVP’s referral link, marked sponsored', /export const TRYBE_JOIN_URL = 'https:\/\/jointrybe\.com\/r\/HTLEJE47'/.test(POP) && /href=\{TRYBE_JOIN_URL\} target="_blank" rel="sponsored noopener noreferrer"/.test(POP) && /'https:\/\/jointrybe\.com\/r\/HTLEJE47'/.test(read('components/labs/TrybeOutreach.tsx')))
check('Subscribe on YouTube and Join the Facebook group', /href=\{MVP_SUBSCRIBE_URL\}/.test(POP) && /href=\{FACEBOOK_GROUP_URL\}/.test(POP) && /Subscribe on YouTube/.test(POP) && /Join the Facebook group/.test(POP))
check('each update opens its page', /<Link key=\{i\} href=\{u\.href\} onClick=\{gotIt\}/.test(POP))
const PILL = read('components/dashboard/WhatsNewCard.tsx')
check('the What’s new pill opens this card, and no longer opens a card of its own', /window\.dispatchEvent\(new Event\(OPEN_EVENT\)\)/.test(PILL) && !/createPortal|RELEASE_ID|localStorage/.test(PILL) && /window\.addEventListener\(OPEN_EVENT, onOpen\)/.test(POP))
check('one card on every dashboard page, by the plan being looked at', /<MvpNews tier=\{String\(effectiveTier\)\} \/>/.test(read('components/layout/DashboardShellV2.tsx')) && !/ScoutNewsPopup/.test(read('components/layout/DashboardShellV2.tsx')))
const words = (POP.match(/>[^<>{}\n]{3,}</g) || []).join(' ') + (POP.match(/'[^'\n]{12,}'/g) || []).join(' ') + (POP.match(/`[^`\n]{12,}`/g) || []).join(' ')
check('the words on the card have no dashes', !/[–—]| - /.test(words))

if (fails.length) { console.error('mvp-news failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ mvp-news: once a day, the last 7 days of updates for this plan on the left and the latest videos on the right, with Join TRYBE, Subscribe and the Facebook group')
