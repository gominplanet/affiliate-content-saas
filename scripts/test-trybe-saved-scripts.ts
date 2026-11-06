// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR SAVED SCRIPTS (Seb, 2026-11-06: "make sure that under brand scripts
// ... we actually save them, even if we refresh or leave, and then just let
// users delete it manually ... or if they've actually shot it, maybe a tick
// box and it deletes it"). Held on the traps: every plan is kept (a sample's
// too), the list is read from MVP's server so a refresh keeps it, a clear
// touches only your own set and only the script pressed, the last script
// clears the set, undo writes back only that script, a failed read or clear
// is said and never looks like an empty list, and a cleared script never
// comes back from an older copy.
import { readFileSync } from 'node:fs'
import { TRYBE_PREVIEW_ACTIONS } from '../lib/labs-preview'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')
const route = read('app/api/labs/trybe/route.ts')
const slice = (from: string, to: string) => { const a = route.indexOf(from); return route.slice(a, route.indexOf(to, a + from.length)) }

// KEPT
const plan = slice("if (action === 'video_plan')", "// ── MY TOP 100")
check('every plan is kept in the saved ideas, a sample’s too, and says which set it is', /const keepIdea = async/.test(plan) && /const ideaId = await keepIdea\(\{ \.\.\.plan, onSale/.test(plan) && /const ideaId = await keepIdea\(keptPlan\)/.test(plan) && (plan.match(/ideaId, onList:/g) || []).length === 2)
check('a sample plan is said as saved when either place kept it', /saved: kept \|\| !!ideaId/.test(plan))

// LISTED, CLEARED, PUT BACK
const list = slice("if (action === 'saved_scripts')", "if (action === 'script_done')")
check('the list is your own sets, newest first, and an emptied set is not listed', /\.eq\('user_id', ownerId\)\.order\('created_at', \{ ascending: false \}\)\.limit\(SAVED_SCRIPTS_MAX\)/.test(list) && /\.filter\(r => Array\.isArray\(r\.plan\?\.videos\) && r\.plan!\.videos!\.length > 0\)/.test(list))
check('a list that could not be read is an error, never an empty list', /return NextResponse\.json\(\{ error:[\s\S]*\}, \{ status: 500 \}\)/.test(list))
const done = slice("if (action === 'script_done')", "if (action === 'idea_delete')")
check('a clear reads only your own set', /\.eq\('user_id', ownerId\)\.eq\('id', ideaId\)\.maybeSingle\(\)/.test(done))
check('it clears the script pressed: by place when its hook still matches, else by its hook', /index >= 0 && index < videos\.length && \(!hook \|\| videos\[index\]\?\.hook === hook\) \? index : videos\.findIndex\(v => v\?\.hook === hook\)/.test(done) && /videos\.splice\(at, 1\)/.test(done))
check('the last script clears the set', /if \(!videos\.length\) \{\s*const \{ error: de \} = await admin\.from\('trybe_ideas'\)\.delete\(\)\.eq\('user_id', ownerId\)\.eq\('id', ideaId\)/.test(done))
check('a clear that failed is said', /Not cleared: \$\{ue\.message\}/.test(done) && /Not cleared: \$\{de\.message\}/.test(done))
const restore = slice("if (action === 'idea_restore')", "if (action === 'home')")
check('undo writes back only your own set, of a sensible size', /if \(there && there\.user_id !== ownerId\) return NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404 \}\)/.test(restore) && /JSON\.stringify\(plan\)\.length > 400_000/.test(restore))
check('the new actions are not open to the TRYBE preview', ['saved_scripts', 'script_done', 'idea_delete', 'idea_restore'].every(a => !TRYBE_PREVIEW_ACTIONS.has(a)))

// A CLEARED SCRIPT NEVER COMES BACK FROM AN OLDER COPY
const ideas = slice("if (action === 'ideas')", "// ── YOUR SAVED SCRIPTS")
check('the script pages read the saved ideas alone; the copies only for the brief checklist or a failed read', /const copies = body\.withCopies === true \|\| !!ideasRead\.error/.test(ideas) && /withCopies: true/.test(read('components/labs/TrybeBriefCheck.tsx')))

// ON SCREEN
const ui = read('components/labs/TrybeSavedScripts.tsx')
check('Your saved scripts is read from MVP when the page opens', /api\(\{ action: 'saved_scripts' \}\)/.test(ui) && /useEffect\(\(\) => \{ void load\(\) \}, \[load, refreshKey\]\)/.test(ui))
check('a failed read says the scripts are not lost, with Try again', /MVP could not read your saved scripts:/.test(ui) && /They are not lost\./.test(ui) && /Try again<\/button>/.test(ui))
check('each script has a Shot it tick and a Delete, and each set a Delete all', /Shot it\n/.test(ui) && /<Trash2 size=\{12\} \/> Delete\n/.test(ui) && /Delete all \{n\}/.test(ui))
check('a clear can be undone, putting back only that script', /action: \{ label: 'Undo', onClick: \(\) => void undoOne\(s, i, v\) \}/.test(ui) && /videos\.splice\(Math\.min\(i, videos\.length\), 0, v\)/.test(ui))
check('a failed clear leaves the script and says so', /It is still on your list\./.test(ui))
const create = read('components/labs/TrybeCreate.tsx')
check('Brand scripts shows them first, and without SCOUT too', /\{step === 1 && <TrybeSavedScripts \/>\}/.test(create) && /<TrybeSavedScripts \/>\n\s*<\/div>\n\s*\)\n\s*\}/.test(create))
const ideasUi = read('components/labs/TrybeVideoIdeas.tsx')
check('freshly written scripts get Shot it and Delete too, on their saved set', /setSavedId\(!sampleId && isSavedId\(d\.ideaId\) \? d\.ideaId : null\)/.test(ideasUi) && /\{savedId && <ScriptDoneBar busy=\{clearing === i\}/.test(ideasUi))
check('a set cleared to the last script says so', /Every script in this set is cleared\./.test(ideasUi))
check('no dashes in what the creator reads', ![ui.split('\n').slice(2).join('\n'), ideasUi.slice(ideasUi.indexOf('async function clearHere'), ideasUi.indexOf('const copyText'))].some(t => /[–—]/.test(t)))

if (fails.length) { console.error(`✗ ${fails.length} saved scripts check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ Saved scripts: every set kept until you clear it, Shot it or Delete with undo, said when a read or clear fails')
