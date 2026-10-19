// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guard: a video hidden from Co-Pilot stays off the list (Seb, 2026-10-19: "be
// able to delete (or dismiss an entry) so that particular video is not being
// recalled on the list again").
//
// What would make it look done while broken: hiding only in the page's memory
// (back on the next reload), hiding from one tab but not the counts or search,
// a save that failed while the card stayed gone, and no way back.
import { readFileSync, existsSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const MIG = 'supabase/migrations/443_copilot_hidden_videos.sql'
check('the migration exists and is safe to run twice',
  existsSync(MIG) && /add column if not exists copilot_hidden_videos text\[\] not null default '\{\}'/.test(read(MIG)))

const API = read('app/api/youtube/drafts/hidden/route.ts')
check('the list is kept on the server, per creator', /\.from\('integrations'\)[\s\S]{0,80}\.update\(\{ copilot_hidden_videos: next \}\)\.eq\('user_id', user\.id\)/.test(API))
check('only a YouTube id can be hidden', /VIDEO_ID\.test\(id\)/.test(API))
check('a hidden video can be brought back, one or all', /body\.hidden !== false/.test(API) && /body\.clearAll === true/.test(API))
check('a database without migration 443 says which migration', /Hiding videos needs migration 443 in Supabase first\./.test(API) && /status: missing\(error\.message\) \? 503/.test(API))

const P = read('app/(dashboard)/co-pilot/page.tsx')
check('every card has a Hide button', /onHide && \(\s*<button type="button" onClick=\{\(\) => onHide\(video\.youtubeVideoId\)\}/.test(P) && /onHide=\{hideVideo\}/.test(P))
check('the hidden list is read from the server on load', /fetch\('\/api\/youtube\/drafts\/hidden'\)/.test(P))
check('hidden videos leave every tab, count and search', /const shownDrafts = useMemo/.test(P) && /for \(const v of shownDrafts\) buckets/.test(P) && /\? \[\.\.\.shownDrafts\]\.sort/.test(P))
check('a save that failed puts the video back and says why',
  /const why = await saveHidden\(\{ videoId, hidden: true \}\)[\s\S]{0,200}n\.delete\(videoId\)[\s\S]{0,80}toast\.error\(why\)/.test(P))
check('hiding offers Undo', /action: \{ label: 'Undo', onClick: \(\) => \{ void unhideVideo\(videoId\) \} \}/.test(P))
check('what is hidden is said, with a way back, even on an empty tab', (P.match(/hidden from this list\./g) || []).length >= 2 && /unhideAll\(\)/.test(P))
check('digging for to-do videos skips the hidden ones', /classifyVideo\(v\) === 'todo' && !hiddenRef\.current\.has\(v\.youtubeVideoId\)/.test(P))

if (fails.length) { console.error('copilot-hide failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ copilot-hide: a hidden video stays off Co-Pilot on every reload, with Undo and a way back')
