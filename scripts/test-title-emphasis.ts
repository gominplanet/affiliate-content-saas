// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE WORD IN CAPITALS in every YouTube title Co-Pilot and Liftoff write
// (lib/clickable-titles emphasizeOneWord). Seb's examples are the spec.
import { readFileSync } from 'node:fs'
import { emphasizeOneWord as e, clickableTitleRulesForYouTube } from '../lib/clickable-titles'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const caps = (t: string) => t.split(/\s+/).map((w) => w.replace(/[^A-Za-z']/g, '')).filter((w) => w.length >= 2 && w === w.toUpperCase())

check('a title that already stresses a word is left alone', e('Can You HEAR the Difference in Sound?') === 'Can You HEAR the Difference in Sound?')
check('two words that are one idea are left alone', e('It Did NOT WORK the First Time? Why?') === 'It Did NOT WORK the First Time? Why?')
check('a title with none gets one', e('Home Blood Pressure Monitor but Is It Easy to Use?', 'Home Blood Pressure Monitor') === 'Home Blood Pressure Monitor but Is It EASY to Use?')
check('acronyms are not emphasis', caps(e('Is This LED Strip Light Actually Worth It?', 'LED Strip Light')).length === 2)
check('never the product name', !/NINJA|BLENDER/.test(e('Ninja Blender Survived My Kitchen', 'Ninja Blender')))
check('a shouted title calms down to one word', caps(e('THIS CHAIR IS SO COMFORTABLE I CANNOT BELIEVE IT')).length === 1)
check('the words themselves never change', e('Which One Survived My Kitchen?').toLowerCase() === 'which one survived my kitchen?')
check('the prompt asks for it', /ONE WORD IN CAPITALS/.test(clickableTitleRulesForYouTube(5)))
const meta = readFileSync('app/api/youtube/generate-metadata/route.ts', 'utf8')
check('Co-Pilot and Liftoff titles go through it (best and every alternative)', (meta.match(/emphasizeOneWord\(scrubTitle\(/g) ?? []).length >= 3)

if (failures.length) {
  console.error('❌ title emphasis guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ title emphasis guard passed')
