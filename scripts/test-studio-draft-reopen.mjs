// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A DRAFT THAT REOPENS ON A LATER PAGE GETS BACK TO DETAILS (Lisa, 2026-11-12,
// two Drop videos left as drafts on her channel):
//   IMG_9224: "The draft opened on its visibility page and SCOUT could not get
//             back to Details."
//   IMG_9223: "It stopped at paid promotion and AI use: The draft's Details
//             page is not open." (straight after it had opened on Details)
//
// Studio reopens a draft on the page it was left on, and can show Details
// first and jump there a moment later. SCOUT looked once, clicked the Details
// tab once, and gave up. This builds a small stand-in for Studio's draft
// window in Chromium (Edit draft, the stepper, Back, the six pages) and runs
// SCOUT's own Studio code (studioKitInstallInPage, studioDraftStepInPage) on:
//   A. Details first, then a jump to Visibility (IMG_9223)
//   B. Visibility, with a Details tab that does nothing (IMG_9224): Back works
//   C. Visibility, with a working Details tab
//   D. Visibility, nothing works: it says what it tried, in words
//   E. The paid promotion step finds the window moved since it opened
// Where Chromium is not installed (the build machine), only the code checks run.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const fails = []
const check = (name, ok, detail) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail).slice(0, 500)}` : ''}`) }
const BG = readFileSync('extension/background.js', 'utf8')

// ── The code ────────────────────────────────────────────────────────────────
const kitAt = BG.indexOf('function studioKitInstallInPage()')
const stepAt = BG.indexOf('function studioDraftStepInPage(step, opts)')
const stepEnd = BG.indexOf('\nlet _studioBusy', stepAt)
check('the Studio kit and its step runner are where this test reads them', kitAt > 0 && stepAt > kitAt && stepEnd > stepAt)
const kitSrc = BG.slice(kitAt, stepAt)
const stepSrc = BG.slice(stepAt, stepEnd)
check('the kit version moved on, so a Studio tab with the old kit installs this one', /const KIT_VERSION = (\d+)/.test(kitSrc) && Number(kitSrc.match(/const KIT_VERSION = (\d+)/)[1]) >= 23)
const open = kitSrc.slice(kitSrc.indexOf('K.steps.open = async'), kitSrc.indexOf('K.steps.where = async'))
const details = kitSrc.slice(kitSrc.indexOf('K.steps.details = async'), kitSrc.indexOf('K.steps.details = async') + 1200)
check('opening a draft waits for the page to hold still and goes back to Details', /const g = await toDetails\(dlg\)/.test(open) && /SCOUT could not get back to Details \(it tried ' \+ g\.words/.test(open))
check('the paid promotion step goes back to Details too before it gives up', /if \(page\(dlg\) !== 'details'\) \{\s*const g = await toDetails\(dlg\)/.test(details) && /and SCOUT could not get back \(it tried ' \+ g\.words/.test(details))
check('getting back uses the Details tab, then Back a page at a time', /add\(byId\('step-badge-0', dlg\)\)/.test(kitSrc) && /byId\('back-button', dlg\)/.test(kitSrc) && /for \(let i = 0; i < 7 && p !== 'details'; i\+\+\)/.test(kitSrc))
check('it never presses Escape (that closes the whole draft window)', !/key: 'Escape'/.test(kitSrc))

// ── A stand-in for Studio's draft window ───────────────────────────────────
const PAGES = {
  details: '<h1 style="font-size:28px">Details</h1><div>Title (required)</div><div>Audience</div><div>Is this video made for kids?</div>'
    + '<div class="sec"><div>Paid promotion</div><div role="radio" data-g="paid" aria-checked="false">Yes</div><div role="radio" data-g="paid" aria-checked="true">No</div></div>'
    + '<div class="sec"><div>Altered content</div><div role="radio" data-g="alt" aria-checked="false">Yes</div><div role="radio" data-g="alt" aria-checked="false">No</div></div>'
    + '<div class="sec"><div role="checkbox" aria-checked="false">Publish to subscriptions feed and notify subscribers</div></div>',
  elements: '<h1 style="font-size:28px">Video elements</h1><div>End screen</div><div>Cards</div>',
  checks: '<h1 style="font-size:28px">Checks</h1><div>Copyright</div><div>Community Guidelines</div>',
  visibility: '<h1 style="font-size:28px">Visibility</h1><div>Save or publish</div><div>Private</div><div>Unlisted</div><div>Public</div>',
}
const ORDER = ['details', 'elements', 'checks', 'visibility']
const html = (cfg) => `<!doctype html><html><body style="font-family:sans-serif">
<button id="edit">Edit draft</button>
<ytcp-uploads-dialog id="dlg" style="display:none;width:900px;min-height:600px;border:1px solid #888">
  <div id="stepper">${ORDER.map((p, i) => `<button id="step-badge-${i}">${p === 'elements' ? 'Video elements' : p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
  ${ORDER.map((p) => `<div class="pg" data-p="${p}" style="display:none">${PAGES[p]}</div>`).join('')}
  <div><button id="back-button">Back</button><button id="next-button">Next</button></div>
</ytcp-uploads-dialog>
<script>
  const cfg = ${JSON.stringify(cfg)}
  let at = 'details'
  const show = (p) => { at = p; for (const el of document.querySelectorAll('.pg')) el.style.display = el.dataset.p === p ? 'block' : 'none'; document.getElementById('back-button').style.display = p === 'details' ? 'none' : 'inline-block' }
  window.__show = show
  window.__at = () => at
  document.getElementById('edit').addEventListener('click', () => {
    document.getElementById('dlg').style.display = 'block'
    document.getElementById('edit').style.display = 'none'
    show(cfg.firstShows || cfg.leftOn)
    if (cfg.firstShows && cfg.firstShows !== cfg.leftOn) setTimeout(() => show(cfg.leftOn), cfg.jumpAfterMs || 700)
  })
  ORDER_ = ${JSON.stringify(ORDER)}
  ORDER_.forEach((p, i) => document.getElementById('step-badge-' + i).addEventListener('click', () => { if (!cfg.tabDead) show(p) }))
  document.getElementById('back-button').addEventListener('click', () => { if (cfg.backDead) return; const i = ORDER_.indexOf(at); if (i > 0) setTimeout(() => show(ORDER_[i - 1]), 300) })
  document.getElementById('next-button').addEventListener('click', () => { const i = ORDER_.indexOf(at); if (i < ORDER_.length - 1) show(ORDER_[i + 1]) })
  document.addEventListener('click', (e) => {
    const r = e.target.closest && e.target.closest('[role=radio]')
    if (r) { for (const o of document.querySelectorAll('[role=radio][data-g="' + r.dataset.g + '"]')) o.setAttribute('aria-checked', o === r ? 'true' : 'false') }
    const c = e.target.closest && e.target.closest('[role=checkbox]')
    if (c) c.setAttribute('aria-checked', c.getAttribute('aria-checked') === 'true' ? 'false' : 'true')
  })
</script></body></html>`

let chromium = null
try { chromium = createRequire(import.meta.url)('playwright').chromium } catch { chromium = null }
let browser = null
if (chromium) { try { browser = await chromium.launch() } catch { browser = null } }

if (browser) {
  const run = async (cfg, then) => {
    const t0 = Date.now()
    const page = await browser.newPage()
    await page.setContent(html(cfg))
    await page.addScriptTag({ content: `${kitSrc}\n${stepSrc}` })
    await page.evaluate(() => studioKitInstallInPage())
    const opened = await page.evaluate(() => studioDraftStepInPage('open', {}))
    const ms = Date.now() - t0
    let after = null
    if (then) after = await then(page, opened)
    const at = await page.evaluate(() => window.__at())
    await page.close()
    return { opened, after, at, ms }
  }
  const ask = { paid: true, aiNo: true, notify: false }

  // All five side by side, each in its own tab.
  const [a, b, c, d, e] = await Promise.all([
    // A. IMG_9223: Details first, then Visibility a moment later.
    run({ firstShows: 'details', leftOn: 'visibility', jumpAfterMs: 700 }, (page) => page.evaluate((o) => studioDraftStepInPage('details', o), ask)),
    // B. IMG_9224: Visibility, and the Details tab does nothing. Back does.
    run({ leftOn: 'visibility', tabDead: true }, (page) => page.evaluate((o) => studioDraftStepInPage('details', o), ask)),
    // C. Visibility, with a Details tab that works: one press, no Back.
    run({ leftOn: 'visibility' }),
    // D. Nothing works: it stops, and says where it is and what it tried.
    run({ leftOn: 'visibility', tabDead: true, backDead: true }),
    // E. Opened on Details, then moved before the paid promotion step.
    run({ leftOn: 'details' }, async (page) => { await page.evaluate(() => window.__show('checks')); return page.evaluate((o) => studioDraftStepInPage('details', o), ask) }),
  ])
  check('A. a draft that shows Details and then jumps to Visibility is brought back and opened', a.opened.ok === true && a.opened.isDraft === true, a.opened)
  check('A. and its paid promotion and AI use are answered on Details', a.after && a.after.ok === true && a.after.readBack.paidPromotion === true && a.after.readBack.aiUseNo === true && a.at === 'details', a.after)
  check('B. a draft on Visibility whose Details tab does nothing gets back with Back', b.opened.ok === true && (b.opened.debug.toDetails || []).includes('Back'), b.opened)
  check('B. and its answers are made on Details', b.after && b.after.ok === true && b.at === 'details', b.after)
  check('C. a working Details tab is enough', c.opened.ok === true && c.at === 'details' && !(c.opened.debug.toDetails || []).includes('Back'), c.opened)
  check('D. when nothing brings Details back, it stops and says what it tried', d.opened.ok === false && /opened on its visibility page and SCOUT could not get back to Details \(it tried the Details tab and Back\)/.test(d.opened.detail), d.opened)
  check('D. and gives up within a minute, not after pressing a dead Back again and again', d.ms < 60_000, d.ms)
  check('E. the paid promotion step goes back to Details when the window moved after opening', e.opened.ok === true && e.after && e.after.ok === true && e.at === 'details', e.after)
  await browser.close()
}

if (fails.length) {
  console.error(`❌ studio-draft-reopen: ${fails.length} failure(s)`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log(`✅ studio-draft-reopen: a draft that reopens on a later page, or jumps there, gets back to Details before anything is answered${browser ? '' : ' (no Chromium here: code checks only)'}`)
