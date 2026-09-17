// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Do two creators who pick different looks actually get different images?
//
// Twenty presets now. Eight was small enough to eyeball for near-duplicates;
// twenty is not, so every pair is compared here instead.
//
// A user asked whether MVP's thumbnails could be customised: they look good,
// but every account produces the same ones. The cause was not a missing settings
// screen. It was one hardcoded aesthetic in the image prompt, handed to every
// account on the platform:
//
//   "Design a UNIQUE, scroll-stopping, VIRAL YouTube thumbnail ... (MrBeast-era
//    energy) ... vibrant, modern and high-contrast ... bright coloured
//    CHECKMARKS or small circular ICON chips ... a vivid studio colour gradient"
//
// The word UNIQUE appears in there twice. It never stood a chance against the
// detail around it.
//
// So the test that matters is not "does a preset exist", it is "does picking one
// change the instruction the image model receives, and does a quiet look stay
// quiet". A preset that gets appended to the old direction produces MrBeast
// energy with a serif.
import {
  VISUAL_PRESETS, DEFAULT_PRESET_ID, resolvePreset, presetToPrompt, presetToBriefRules,
} from '../lib/visual-presets'
import { creativeHead } from '../lib/thumbnail-prompt'
import { readFileSync } from 'fs'
import { join } from 'path'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

/** The required fields of a ThumbnailPromptInput, held constant so the only
 *  thing varying between calls is the preset. */
const base = {
  line1: 'THE ONE', line2: 'TO BUY',
  creatorRefLabel: 'IMAGE 1', identityInstruction: 'Match the person in IMAGE 1.',
  productLabel: 'IMAGE 2',
}

const head = (presetId: string | null, extra: Record<string, unknown> = {}) =>
  creativeHead({ ...base, presetId, ...extra } as Parameters<typeof creativeHead>[0]).join('\n')

// ── the failure this file exists for ────────────────────────────────────────
// Every preset must produce a genuinely different instruction, not the same
// paragraph with one adjective swapped.
{
  const prompts = new Map<string, string>()
  for (const p of VISUAL_PRESETS) prompts.set(p.id, head(p.id))
  check('every preset produces a distinct prompt',
    new Set(prompts.values()).size === VISUAL_PRESETS.length,
    `${new Set(prompts.values()).size} distinct from ${VISUAL_PRESETS.length} presets`)

  // Not merely distinct: substantially different. Two prompts sharing almost
  // every word would pass a set comparison and produce identical images.
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? [])
  const bold = words(prompts.get('bold')!)
  const editorial = words(prompts.get('editorial')!)
  const shared = [...editorial].filter(w => bold.has(w)).length
  check('two different looks share little vocabulary',
    shared / editorial.size < 0.5, `${Math.round((shared / editorial.size) * 100)}% shared`)
}

// ── no two of the twenty are near-duplicates ────────────────────────────────
// The check that matters most once there are twenty. Eight was small enough to
// eyeball; twenty is not, and two presets differing only in adjective produce
// the same image while passing every other test in this file.
{
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? [])
  const bags = new Map(VISUAL_PRESETS.map(p =>
    [p.id, words(`${p.direction} ${p.typography} ${p.background} ${p.fallbackPalette}`)]))

  let worst = { a: '', b: '', overlap: 0 }
  for (let i = 0; i < VISUAL_PRESETS.length; i++) {
    for (let j = i + 1; j < VISUAL_PRESETS.length; j++) {
      const a = VISUAL_PRESETS[i], b = VISUAL_PRESETS[j]
      const A = bags.get(a.id)!, B = bags.get(b.id)!
      const shared = [...A].filter(w => B.has(w)).length
      // Jaccard: shared over the union, so a long description is not penalised
      // for simply having more words than a short one.
      const overlap = shared / (A.size + B.size - shared)
      if (overlap > worst.overlap) worst = { a: a.id, b: b.id, overlap }
    }
  }
  check('no two presets describe the same look',
    worst.overlap < 0.3,
    `${worst.a} and ${worst.b} overlap ${Math.round(worst.overlap * 100)}%`)

  check('twenty presets, all with distinct ids',
    new Set(VISUAL_PRESETS.map(p => p.id)).size === VISUAL_PRESETS.length
    && VISUAL_PRESETS.length === 20,
    `${VISUAL_PRESETS.length} presets`)
  check('and distinct names, since that is what a creator picks by',
    new Set(VISUAL_PRESETS.map(p => p.name)).size === VISUAL_PRESETS.length)

  // Swatches are how the picker communicates. Two identical ones make two tiles
  // that look the same, whatever the prompts behind them say.
  check('every preset has its own preview swatch',
    new Set(VISUAL_PRESETS.map(p => p.swatch.join())).size === VISUAL_PRESETS.length)
  check('and every family is populated',
    new Set(VISUAL_PRESETS.map(p => p.family)).size === 4,
    [...new Set(VISUAL_PRESETS.map(p => p.family))].join(', '))
  check('with more than one preview shape in use',
    new Set(VISUAL_PRESETS.map(p => p.previewShape)).size >= 4)
}

// ── the loud house style is gone from the quiet looks ───────────────────────
// This is the actual bug. If any of this survives into a restrained preset, the
// preset is decoration.
{
  const LOUD = [/MrBeast/i, /\bVIRAL\b/, /scroll-stopping/i, /high-contrast/i, /vivid studio colour gradient/i]
  for (const p of VISUAL_PRESETS.filter(x => !x.badges)) {
    const text = head(p.id)
    const leaked = LOUD.filter(re => re.test(text)).map(String)
    if (leaked.length) {
      check(`"${p.name}" carries no loud house-style language`, false, leaked.join(' '))
      break
    }
  }
  check('no restrained preset carries the loud house style', true)
}

// ── badges are the difference between a look and an advert ──────────────────
// One checkmark chip on an editorial layout collapses it straight back into the
// style the creator was trying to leave.
{
  for (const p of VISUAL_PRESETS.filter(x => !x.badges)) {
    const text = presetToPrompt(p, { surface: 'thumbnail' })
    if (!/NO BADGES/.test(text)) {
      check(`"${p.name}" forbids badges explicitly`, false, text.slice(0, 120))
      break
    }
  }
  check('every no-badge preset forbids them explicitly', true)
  check('and says why, so the model does not treat it as a style note',
    /turns it back into an advert/.test(presetToPrompt(resolvePreset('editorial'), { surface: 'thumbnail' })))

  const loud = presetToPrompt(resolvePreset('bold'), { surface: 'thumbnail' })
  check('a loud preset still allows them', /CALLOUTS/.test(loud) && !/NO BADGES/.test(loud))
}

// ── a per-variant vibe must not re-loud a quiet look ────────────────────────
// fallbackVibe exists to vary the loud look across variants. Applied to a quiet
// one it is precisely how a restrained composition drifts back to loud.
{
  const quiet = head('premium', { fallbackVibe: 'bold and colourful' })
  check('a quiet look ignores a loud per-variant vibe',
    !/bold and colourful/.test(quiet), quiet.slice(0, 200))

  const loud = head('bold', { fallbackVibe: 'bold and colourful' })
  check('but the loud look still takes it', /bold and colourful/.test(loud))
}

// ── the default is what everybody already had ───────────────────────────────
// Nobody's thumbnails change underneath them without being asked.
{
  check('an unset preset resolves to the loud default',
    resolvePreset(null).id === DEFAULT_PRESET_ID)
  check('so does an unknown id', resolvePreset('nonsense-look').id === DEFAULT_PRESET_ID)
  check('and blank', resolvePreset('   ').id === DEFAULT_PRESET_ID)
  check('the default is the loud one, not a quiet one',
    resolvePreset(null).badges === true,
    'switching every existing account to a restrained look is not a default, it is a change')
}

// ── one look, every surface ─────────────────────────────────────────────────
// A creator with three different brands across blog, YouTube and Pinterest does
// not have a brand.
{
  const p = resolvePreset('editorial')
  const t = presetToPrompt(p, { surface: 'thumbnail' })
  const pin = presetToPrompt(p, { surface: 'pin' })
  const hero = presetToPrompt(p, { surface: 'hero' })
  check('the frame differs per surface',
    /1536x864/.test(t) && /1024x1536/.test(pin) && /1536x864/.test(hero))
  check('but the direction does not', [t, pin, hero].every(x => x.includes(p.direction)))
  check('and neither does the typography', [t, pin, hero].every(x => x.includes(p.typography)))
}

// ── brand colours are used, and only as colours ─────────────────────────────
{
  const withBrand = presetToPrompt(resolvePreset('studio'), { surface: 'thumbnail', palette: 'teal and bone' })
  check('a brand palette is used when set', /teal and bone/.test(withBrand))
  const without = presetToPrompt(resolvePreset('studio'), { surface: 'thumbnail', palette: null })
  check('and the preset has its own when not', /warm neutrals/.test(without), without)
  check('a palette never changes the direction',
    withBrand.includes(resolvePreset('studio').direction))
}

// ── the CONCEPT path is the normal one ──────────────────────────────────────
// The first version of this steered only the fallback, which runs when the art
// director fails. The route's own comment says so: "empty concept => fell back
// to the plain copy generator, so we use the generic design menu below". A
// creator could have picked Editorial, tested it, and seen no change at all.
{
  const brief = 'A vivid purple studio gradient with the blender centre frame, hot-pink type, a starburst badge top right.'
  const quiet = head('editorial', { concept: brief, banner: 'GAME CHANGER!', callouts: ['144Hz', 'QUIET'] })

  check('the chosen look frames the brief on the concept path',
    quiet.includes(resolvePreset('editorial').direction), quiet.slice(0, 200))
  check('and its typography is stated there too',
    quiet.includes(resolvePreset('editorial').typography))
  check('a loud banner from a drifting brief is dropped',
    !/GAME CHANGER/.test(quiet), quiet)
  check('so are its callout chips', !/144Hz/.test(quiet), quiet)
  check('and the render is told why', /turns this look back into a generic advert/.test(quiet))
  check('no loud execution note survives',
    !/vibrant, modern, high-contrast and layered/.test(quiet))

  // The loud look keeps all of it, because there the brief furniture belongs.
  const loud = head('bold', { concept: brief, banner: 'GAME CHANGER!', callouts: ['144Hz', 'QUIET'] })
  check('the loud look still renders the banner', /GAME CHANGER/.test(loud))
  check('and the callouts', /144Hz/.test(loud))
}

// ── the art director writes inside the look ─────────────────────────────────
// A brief written loud cannot be rendered quiet, so the look has to reach the
// brief first rather than only the renderer.
{
  const rules = presetToBriefRules(resolvePreset('premium'))
  check('the brief rules carry the direction', rules.includes(resolvePreset('premium').direction))
  check('and forbid badge fields outright',
    /THIS LOOK CARRIES NO BADGES/.test(rules)
    && /Return "" for banner and "" for badge/.test(rules)
    && /empty array for callouts/.test(rules),
    rules)
  check('the prohibition is stated as a rule, not an option',
    !/optional|if you like|where they fit/i.test(rules.split('THIS LOOK CARRIES NO BADGES')[1] ?? ''),
    'a softened rule is how a starburst ends up on an editorial layout')
  check('and forbid the loud vocabulary by name',
    /scroll-stopping/.test(rules) && /vibrant/.test(rules), rules)

  const loudRules = presetToBriefRules(resolvePreset('bold'))
  check('while the loud look invites them',
    /Banners, starburst badges and callout chips all belong/.test(loudRules))
}

// ── the wiring ──────────────────────────────────────────────────────────────
{
  const strip = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  const read = (f: string) => strip(readFileSync(join(__dirname, '..', f), 'utf8'))

  const PROMPT = read('lib/thumbnail-prompt.ts')
  check('the comment stripper works',
    strip('  // MrBeast-era\nreal code').indexOf('MrBeast') === -1,
    'if this fails the check below proves nothing')
  check('the hardcoded house style is gone from the module entirely',
    !/MrBeast/.test(PROMPT),
    'one aesthetic for every account on the platform is the whole bug')
  check('the fallback path renders the preset',
    /presetToPrompt\(preset, \{/.test(PROMPT))

  const ROUTE = read('app/api/youtube/generate-thumbnail/route.ts')
  check('the route reads the chosen look', /select\('thumbnail_brand_style,visual_preset'\)/.test(ROUTE))
  check('and passes it to the renderer', /presetId: visualPreset/.test(ROUTE))
  check('and to the art director, which is the path that normally runs',
    /\.replace\('__PRESET_RULES__', presetToBriefRules/.test(ROUTE),
    'steering only the renderer leaves the brief loud')
  check('at every brief call site',
    (ROUTE.match(/presetId: visualPreset/g) || []).length >= 3,
    'one renderer call and both brief calls')
  check('the art director no longer hardcodes one aesthetic',
    !/impossible to scroll past/.test(ROUTE),
    'it wrote loud briefs whatever the creator picked')

  const BRAND = read('app/(dashboard)/brand/page.tsx')
  check('the picker is on the brand page', /<VisualPresetPicker/.test(BRAND))
  check('and saves to the column', /set\('visual_preset', id\)/.test(BRAND))

  const PICKER = read('components/brand/VisualPresetPicker.tsx')
  check('the picker shows each look rather than naming it',
    /function Preview/.test(PICKER) && /preset\.swatch/.test(PICKER),
    'you cannot describe a visual style in words to someone who has not seen it')
  check('and the preview shows badges only where the preset has them',
    /preset\.badges \?/.test(PICKER),
    'that is the most visible difference between the loud looks and the quiet ones')
  check('the ground says what KIND of image each look is',
    /previewShape === 'gradient'/.test(PICKER) && /previewShape === 'grid'/.test(PICKER),
    'twenty coloured rectangles communicate almost nothing')
  check('and twenty tiles are grouped rather than stacked in one wall',
    /FAMILIES\.map\(family/.test(PICKER))

  const MIGRATION = readFileSync(
    join(__dirname, '..', 'supabase/migrations/342_brand_visual_preset.sql'), 'utf8')
  check('the migration is safe to run twice', /add column if not exists/i.test(MIGRATION))
  check('and leaves existing accounts on the look they already had',
    !/update .*brand_profiles.*set .*visual_preset/i.test(MIGRATION))
}

// ── every surface the picker names is actually wired ────────────────────────
// The presets shipped wired to YouTube thumbnails only, while the picker said
// they set "blog headers, YouTube thumbnails and Pinterest pins". That sentence
// was written before the wiring and was wrong the moment it went out: pick
// Editorial and you got it on YouTube and the old loud house style on every pin
// and every article header.
//
// A claim in UI copy about which surfaces a setting reaches is exactly the kind
// of thing nobody re-checks, so it is checked here.
{
  const strip = (x: string) => x.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  const read = (f: string) => strip(readFileSync(join(__dirname, '..', f), 'utf8'))

  const AD = read('lib/art-director-pin.ts')
  check('all four pin and hero generators take a preset',
    (AD.match(/presetId\?: string \| null/g) || []).length === 4,
    'Pinterest pins and blog heroes carried the same hardcoded loud aesthetic')
  check('and every one of them renders it',
    (AD.match(/presetToPrompt\(/g) || []).length >= 4)
  check('the pin uses the vertical frame and the hero the wide one',
    /surface: 'pin'/.test(AD) && /surface: 'hero'/.test(AD))
  check('the loud house style is gone from the pin and hero prompts',
    !/Vibrant, modern, high-contrast, layered/.test(AD)
    && !/Vibrant and modern, never flat/.test(AD),
    'one look handed to every account, exactly as the thumbnail prompt did')
  check('callout chips are gated on the look carrying them',
    /badges && callouts\.length/.test(AD),
    'a chip on a quiet pin collapses it the same way it does on a thumbnail')

  // Every call site must pass one. A generator that accepts a preset and is
  // called without one renders the default while looking wired.
  const CALLERS = [
    'app/api/blog/generate/route.ts',
    'app/api/idea-list/generate/route.ts',
    'lib/pin-assets.ts',
    'lib/deal-pin.ts',
    'lib/post-hero.ts',
  ]
  for (const f of CALLERS) {
    const src = read(f)
    const calls = (src.match(/generateArtDirector(Pin|BlogHero|CollagePin|RoundupHero)\(\{/g) || []).length
    const passes = (src.match(/presetId: await getBrandPresetId\(/g) || []).length
    if (calls !== passes) {
      check(`${f} passes a preset at every call site`, false, `${calls} calls, ${passes} pass one`)
      break
    }
  }
  check('every art-director call site passes the chosen look', true)

  const HELPER = read('lib/brand-preset.ts')
  check('an unreadable preset falls back rather than failing the image',
    /catch \{/.test(HELPER) && /return null/.test(HELPER))

  // And the copy itself: it may only name surfaces that are wired.
  const PICKER = read('components/brand/VisualPresetPicker.tsx')
  const claimsPins = /Pinterest/i.test(PICKER)
  const claimsHeroes = /blog header/i.test(PICKER)
  check('if the copy claims Pinterest, Pinterest is wired',
    !claimsPins || /surface: 'pin'/.test(AD))
  check('if the copy claims blog headers, they are wired',
    !claimsHeroes || /surface: 'hero'/.test(AD))
}

// ── break tests ─────────────────────────────────────────────────────────────
{
  const breaks: string[] = []
  const broke = (name: string, cond: boolean) => { if (!cond) breaks.push(name) }

  // Break 1: the original bug. One house style for every account.
  broke('every preset producing the same prompt is caught',
    new Set(VISUAL_PRESETS.map(p => head(p.id))).size === VISUAL_PRESETS.length)

  // Break 2: the preset decorating the house style rather than replacing it.
  broke('loud language surviving into a quiet look is caught',
    !/MrBeast|VIRAL|scroll-stopping/i.test(head('editorial')))

  // Break 3: badges leaking onto a restrained look, which is what collapses it.
  broke('a quiet preset that does not forbid badges is caught',
    VISUAL_PRESETS.filter(p => !p.badges)
      .every(p => /NO BADGES/.test(presetToPrompt(p, { surface: 'thumbnail' }))))

  // Break 4: a per-variant vibe re-louding a quiet look.
  broke('a loud vibe applied to a quiet preset is caught',
    !/bold and colourful/.test(head('premium', { fallbackVibe: 'bold and colourful' })))

  // Break 5: defaulting existing accounts to a new look without being asked.
  broke('a changed default is caught', resolvePreset(null).id === DEFAULT_PRESET_ID
    && resolvePreset(null).badges === true)

  // Break 6: two presets that are the same look under two names, which twenty
  // entries makes easy to do by accident and impossible to spot by eye.
  {
    const words = (x: string) => new Set(x.toLowerCase().match(/[a-z]{4,}/g) ?? [])
    let worst = 0
    for (let i = 0; i < VISUAL_PRESETS.length; i++) {
      for (let j = i + 1; j < VISUAL_PRESETS.length; j++) {
        const A = words(VISUAL_PRESETS[i].direction + VISUAL_PRESETS[i].background)
        const B = words(VISUAL_PRESETS[j].direction + VISUAL_PRESETS[j].background)
        const shared = [...A].filter(w => B.has(w)).length
        worst = Math.max(worst, shared / (A.size + B.size - shared))
      }
    }
    broke('two near-identical presets are caught', worst < 0.4)
  }

  // Break 7: the preset reaching only the fallback path, which is what the
  // first version did. A creator could pick a look and see no change.
  const conceptQuiet = head('editorial', { concept: 'A vivid gradient.', banner: 'GAME CHANGER!' })
  broke('a preset that misses the concept path is caught',
    conceptQuiet.includes(resolvePreset('editorial').direction) && !/GAME CHANGER/.test(conceptQuiet))

  // Break 8: the art director's badge prohibition softened into a suggestion.
  const quietRules = presetToBriefRules(resolvePreset('editorial'))
  broke('a softened badge rule is caught',
    /THIS LOOK CARRIES NO BADGES/.test(quietRules)
    && /Return "" for banner/.test(quietRules))

  // Break 9: a generator that takes a preset but is called without one, which
  // is how Pinterest and blog heroes shipped rendering the default while the
  // picker told creators they were covered.
  {
    const strip2 = (x: string) => x.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    const src = strip2(readFileSync(join(__dirname, '..', 'lib/post-hero.ts'), 'utf8'))
    const calls = (src.match(/generateArtDirector\w+\(\{/g) || []).length
    const passes = (src.match(/presetId: await getBrandPresetId\(/g) || []).length
    broke('a call site that drops the preset is caught', calls > 0 && calls === passes)
  }

  // Break 10: one surface drifting from the others, which gives a creator three
  // brands across three places they publish.
  const p = resolvePreset('retro')
  broke('a surface dropping the direction is caught',
    (['thumbnail', 'pin', 'hero'] as const)
      .every(s => presetToPrompt(p, { surface: s }).includes(p.direction)))

  for (const b of breaks) failures.push(`BREAK TEST MISSED ${b}`)
}

if (failures.length) {
  console.error(`\n❌ visual-presets: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('✅ visual-presets: twenty looks, none a duplicate of another, and a quiet one stays quiet')
