// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SIDEBAR'S RED NUMBER ON THE TRYBE MENU TOO (Seb, 2026-11-06: "the
// little number 2 should also be duplicated where it says get brands ... so
// people know where to go to clear that number"). Held on the traps: the
// same red pill, on the job that holds the Inbox and on the Inbox page
// button, and the same number as the sidebar before the page has read the
// inbox itself (the sidebar showed 2 while the menu said nothing).
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const nav = readFileSync('components/labs/TrybeNav.tsx', 'utf8')
const page = readFileSync('components/labs/TrybeOutreach.tsx', 'utf8')
const shell = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')

check('the Inbox lives under Get brands', /\{ id: 'get', label: 'Get brands'[\s\S]{0,300}\{ label: 'Inbox', icon: Inbox, tabs: \['inbox'\], count: 'unread' \}/.test(nav))
check('the job holding the Inbox shows the red number', /\{g\.items\.some\(\(it\) => it\.count === 'unread'\) && unread > 0 && <UnreadDot n=\{unread\} \/>\}/.test(nav))
check('the Inbox page button shows it in red too', /\{n > 0 && \(it\.count === 'unread' \? <UnreadDot n=\{n\} \/>/.test(nav))
check('the same red as the sidebar', /backgroundColor: '#ff3b30'/.test(shell) && /function UnreadDot[\s\S]*backgroundColor: '#ff3b30'/.test(nav))
check('before the page reads the inbox, the menu shows the number the sidebar shows', /const savedUnread = useTrybeAlerts\(!preview, '\/trybe'\)/.test(page) && /const navUnread = inbox \? unread : savedUnread/.test(page) && /<TrybeNav tab=\{tab\} queue=\{queue\.length\} unread=\{navUnread\}/.test(page))
check('the saved count is read before the page can return early (hooks in order)', page.indexOf("const savedUnread = useTrybeAlerts(") < page.indexOf('if (loading) return'))

if (fails.length) { console.error(`✗ ${fails.length} unread dot check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ TRYBE menu: the sidebar’s red unread number on Get brands and Inbox, the same number')
