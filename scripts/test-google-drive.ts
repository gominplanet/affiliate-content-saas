// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GOOGLE DRIVE FOR THE REVIEW EDITOR (Seb, 2026-10-30). Pinned: the connect
// asks for drive.file only (the files the creator picks, nothing else) and
// comes back through the registered callback after its state check; the
// lasting access is encrypted and readable by the server alone; a picked
// file is checked with Google before it is queued; every step mints a fresh
// token; MVP never copies or deletes a Drive take; Google's reasons are said
// in plain words.
import { readFileSync } from 'node:fs'
import { driveAppId, driveMediaUrl, isDriveId, driveWords, DRIVE_SCOPES } from '../lib/google-drive'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

check('the picker gets the project number from the client id', driveAppId('123456789012-abcdef.apps.googleusercontent.com') === '123456789012' && driveAppId('nonsense') === null)
check('a picked file is read from Google’s Drive address', driveMediaUrl('1AbC_dEf-ghIJ') === 'https://www.googleapis.com/drive/v3/files/1AbC_dEf-ghIJ?alt=media&supportsAllDrives=true')
check('only a real Drive id is accepted', isDriveId('1AbC_dEf-ghIJklmn') && !isDriveId('../../etc') && !isDriveId('short') && !isDriveId(42))
check('Google’s reasons are said plainly', /switched off/.test(driveWords(403, 'accessNotConfigured')) && /Pick it again/.test(driveWords(404, '')) && /Connect Google Drive again/.test(driveWords(401, 'invalid_grant')))
check('only drive.file and the email address are asked for', DRIVE_SCOPES.length === 2 && DRIVE_SCOPES.includes('https://www.googleapis.com/auth/drive.file') && !DRIVE_SCOPES.some((s) => /drive\.readonly|auth\/drive$/.test(s)))

const S = read('app/api/auth/google-drive/route.ts')
check('the connect is Labs only, offline, and never merges the YouTube grant', /canUsePreview\('review_edit'/.test(S) && /access_type', 'offline'/.test(S) && !/include_granted_scopes', 'true'/.test(S) && /\{ drive: true, rt: '\/review-editor' \}/.test(S))
check('it comes back through the address registered with Google', /\$\{appUrl\}\/api\/auth\/youtube\/callback/.test(S))
const C = read('app/api/auth/youtube/callback/route.ts')
const stateCheck = C.indexOf('userId !== user.id')
const driveBranch = C.indexOf('verified?.data.drive === true')
check('the Drive branch runs only after the state is checked against the signed-in user', stateCheck > 0 && driveBranch > stateCheck && driveBranch < C.indexOf("let step = 'token_exchange'"))
const L = read('lib/google-drive.ts')
check('the lasting access is encrypted, and the box being ticked is checked', /refresh_token: maybeEncrypt\(t\.refresh_token\)/.test(L) && /includes\(DRIVE_SCOPE\)/.test(L))
check('access Google took back is forgotten, so the page asks to connect', /invalid_grant[\s\S]{0,80}delete\(\)\.eq\('user_id', userId\)/.test(L))
check('disconnect also takes the access back at Google', /oauth2\.googleapis\.com\/revoke/.test(L))
const M = read('supabase/migrations/460_google_drive_links.sql')
check('no one can read the token through the API: RLS on, no policy', /enable row level security/.test(M) && !/create policy/i.test(M))

const R = read('app/api/review-edit/route.ts')
check('a Drive take is checked with Google before it is queued', /isDriveId\(o\.driveId\)/.test(R) && /await driveFile\(token, o\.driveId\)/.test(R))
const W = read('lib/review-edit-server.ts')
check('each step mints a fresh token for the video server', /driveAccessToken\(db, row\.user_id\)/.test(W) && /mainAuth: src\.review\.auth/.test(W))
check('MVP never deletes a Drive take', /s\?\.kind === 'upload' \? ownPath/.test(W))
check('a Drive video can be made again any time: only uploads can be gone', /row\.raw_deleted_at && hasUpload\(row\)/.test(W))

const U = read('components/review-editor/ReviewEditor.tsx')
const P = read('components/review-editor/drive-picker.ts')
check('the page offers Connect Google Drive, then From Google Drive on each take', /href="\/api\/auth\/google-drive"/.test(U) && /'From Google Drive'/.test(U) && /takeBox\('review', /.test(U) && /takeBox\('broll', /.test(U))
check('the picker opens with a fresh token and MVP’s project, so the file is opened for MVP', /const st = await loadDrive\(\)/.test(U) && /\.setAppId\(o\.appId\)/.test(P) && /\.setOAuthToken\(o\.token\)/.test(P))
check('a Drive take says it stays in the creator’s Drive', /It stays in your Drive/.test(U) && /MVP kept no copy/.test(U))

check('the picker shows the creator\u2019s own Drive, never everything shared with them', /setParent\('root'\)/.test(P) && /setOwnedByMe\(true\)/.test(P) && !/DOCS_VIDEOS\)\.setIncludeFolders/.test(P))

if (fails.length) { console.error(`\n❌ google-drive: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
console.log('✅ google-drive: drive.file only, back through the checked callback, token encrypted, files checked, never copied or deleted')
