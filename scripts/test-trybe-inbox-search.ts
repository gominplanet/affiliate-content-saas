// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SEARCH YOUR TRYBE CHATS (lib/trybe-inbox-search; Seb, 2026-11-10: "we
// should have a search bar to search for the brand that we want to talk to.
// A lot of users are going to have hundreds of brands"). Held on his own
// list: "nobl" finds NOBL, NOBL Q&A and NOBL Air Tracker Group, names before
// last messages; and a search reads on past TRYBE's newest 100 chats, so an
// older brand is found too, and says how many it looked through.
import { readFileSync } from 'node:fs'
import { searchChats, chatWords, CHAT_PAGE, CHAT_PAGES_MAX } from '../lib/trybe-inbox-search'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }

const chats = [
  { id: '1', name: 'NOBL', last: 'is the 150 video challenge apply for the air', at: 10 },
  { id: '2', name: 'NOBL Q&A', last: 'Hi everyone!! Quick note for anyone doing', at: 9 },
  { id: '3', name: 'Pawever', last: 'Will come up with some content variations', at: 8 },
  { id: '4', name: 'Arterra Pet Science', last: 'Fantastic. thanks!', at: 7 },
  { id: '5', name: 'GAINS FAM', last: 'IMPORTANT: NOBL Air orders ship Monday', at: 6 },
  { id: '6', name: 'NOBL Air Tracker Group', last: 'Thanks for flagging', at: 5 },
  { id: '7', name: 'Crème Brûlée Co', last: '', at: 4 },
]
const ids = (q: string) => searchChats(chats, q).map((c) => c.id).join(',')
check('“nobl” finds every NOBL chat by name, newest first, then a chat whose last message names it', ids('nobl') === '1,2,6,5', ids('nobl'))
check('any case, and every word must be there', ids('NOBL air') === '6,5' && ids('nobl  q&a') === '2', [ids('NOBL air'), ids('nobl  q&a')])
check('part of a name finds it', ids('arter') === '4' && ids('paw') === '3')
check('accents and punctuation do not get in the way', ids('creme brulee') === '7' && chatWords('Q&A!') === 'q and a')
check('an empty search shows every chat as it was', searchChats(chats, '  ').length === chats.length && searchChats(chats, '') === chats)
check('nothing found is an empty list, never everything', searchChats(chats, 'zzz').length === 0)
check('a search reads on through TRYBE’s pages, 100 at a time, up to a thousand', CHAT_PAGE === 100 && CHAT_PAGES_MAX === 10)

const I = readFileSync('components/labs/TrybeInbox.tsx', 'utf8')
check('the search box sits at the top of the chat list', /placeholder="Search brands" aria-label="Search your TRYBE chats by brand"/.test(I) && /\{shownChats\.map\(c => \(/.test(I) && /const shownChats = useMemo\(\(\) => searchChats\(convos \|\| \[\], chatQuery\), \[convos, chatQuery\]\)/.test(I))
check('a search reads older chats from TRYBE through SCOUT and merges them in, once', /requestTrybeApi\('GET', `\/backend\/api\/channels\?page=\$\{page\}&limit=\$\{CHAT_PAGE\}`\)/.test(I) && /if \(chatQuery\.trim\(\) && olderChats === 'more'\) void loadOlderChats\(\)/.test(I) && /if \(!by\.has\(c\.id\)\) by\.set\(c\.id, c\)/.test(I))
check('it says how many chats it looked through, and when it found none', /`\$\{shownChats\.length\} of your \$\{convos\.length\.toLocaleString\(\)\} chats\.`/.test(I) && /No chat with \\u201C\$\{chatQuery\.trim\(\)\}\\u201D in your/.test(I) && /Reading your older chats on TRYBE\.\.\./.test(I))
check('Escape or the X clears it', /if \(e\.key === 'Escape'\) setChatQuery\(''\)/.test(I) && /aria-label="Clear the search"/.test(I))

if (fails.length) { console.error(`❌ trybe-inbox-search: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
console.log('✅ trybe-inbox-search: a brand found by name in the TRYBE inbox, older chats read on for it, and how many were searched said')
