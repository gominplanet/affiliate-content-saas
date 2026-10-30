// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR'S TITLE LOOKS (Seb, 2026-10-30: "different fonts,
// different ways to write those titles"). Pinned: every look draws, each in
// its own font (a missing font fails here, not on a member's video); a boxed
// look's text reads on its box; dark text gets a light edge; the fonts ship
// with every route that draws a title; the page's preview is the same drawing.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { drawTitle, titleStyle, inkOn, TITLE_FONTS } from '../lib/title-looks'
import { TITLE_LOOKS, TITLE_COLORS, type TitleColor } from '../lib/review-edit'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }

async function main() {
  // ── What each look comes to ────────────────────────────────────────────────
  check('black or white, whichever reads', inkOn('#FFD400') === '#111111' && inkOn('#7C3AED') === '#FFFFFF' && inkOn('#FFFFFF') === '#111111' && inkOn('#111111') === '#FFFFFF')
  const plain = titleStyle('clean', 'white')
  check('the clean look in white is MVP’s first title: white on a dark see-through box', plain.box === '#000000' && plain.boxAlpha === 0.62 && plain.text === '#FFFFFF' && plain.font.name === 'Arimo')
  check('a boxed look takes the colour as its box, with text that reads on it', titleStyle('highlight', 'yellow').box === TITLE_COLORS.yellow && titleStyle('highlight', 'yellow').text === '#111111' && titleStyle('tech', 'purple').text === '#FFFFFF')
  check('an unboxed look takes the colour as its text', titleStyle('caps', 'red').box === null && titleStyle('caps', 'red').text === TITLE_COLORS.red)
  check('dark text gets a light edge and shadow, so it reads on a dark video', titleStyle('bold', 'black').outline === '#FFFFFF' && titleStyle('bold', 'white').outline === '#000000' && /255,255,255/.test(titleStyle('marker', 'black').shadow || ''))
  check('the looks use different fonts', new Set(TITLE_LOOKS.map((l) => titleStyle(l, 'white').font.name)).size >= 6)

  // ── Every look draws, in its own font ──────────────────────────────────────
  const disclosure = 'PROVIDED SAMPLE IN EXCHANGE FOR VIDEO REVIEW #AD'
  const widths: Record<string, number> = {}
  for (const look of TITLE_LOOKS) {
    for (const color of ['white', 'yellow', 'black'] as TitleColor[]) {
      try {
        const t = await drawTitle(disclosure, { look, color, size: 'medium', position: 'lower-left' })
        const meta = await sharp(t.png).metadata()
        check(`${look} ${color}: a transparent PNG of the text`, meta.format === 'png' && meta.hasAlpha === true && t.width > 200 && t.height > 30 && t.width <= 1500 + 60, [t.width, t.height])
        if (color === 'white') widths[look] = t.width
      } catch (e) { fails.push(`${look} ${color} did not draw: ${e instanceof Error ? e.message : e}`) }
    }
  }
  check('each font sets the same words at its own width', new Set(Object.values(widths)).size >= 6, widths)
  const small = await drawTitle('Sun hoodie, honest review', { look: 'clean', size: 'small' })
  const large = await drawTitle('Sun hoodie, honest review', { look: 'clean', size: 'large' })
  check('large is larger than small', large.width > small.width * 1.4 && large.height > small.height * 1.4, [small.width, large.width])
  let empty = ''
  try { await drawTitle('   ', {}) } catch (e) { empty = e instanceof Error ? e.message : String(e) }
  check('no text is refused, never drawn as an empty box', /no text/.test(empty))

  // ── The fonts ship where titles are drawn ──────────────────────────────────
  const cfg = readFileSync('next.config.ts', 'utf8')
  const shipped = Object.values(TITLE_FONTS).filter((f) => f.pkg !== 'arimo')
  check('every title font file is in node_modules', Object.values(TITLE_FONTS).every((f) => existsSync(join('node_modules', '@fontsource', f.pkg, 'files', f.file))))
  check('next.config ships each title font', shipped.every((f) => cfg.includes(`'${f.pkg}'`)) && /\/\$\{f\}-latin-400-normal\.woff/.test(cfg) && shipped.every((f) => f.file === `${f.pkg}-latin-400-normal.woff`))
  check('with the editor’s routes and its cron, where videos are sent to be made', /'\/api\/review-edit': TITLE_FONTS/.test(cfg) && /'\/api\/review-edit\/\*\*': TITLE_FONTS/.test(cfg) && /'\/api\/cron\/review-edits': TITLE_FONTS/.test(cfg))

  // ── The preview is the same drawing ────────────────────────────────────────
  const preview = readFileSync('app/api/review-edit/title/route.ts', 'utf8')
  const server = readFileSync('lib/review-edit-server.ts', 'utf8')
  check('the page’s preview and the video draw the title the same way', /drawTitle\(/.test(preview) && /canUsePreview\('review_edit'/.test(preview) && /drawTitle\(t\.text, \{ look: t\.look, color: t\.color, size: t\.size, position: t\.position \}\)/.test(server))

  if (fails.length) { console.error(`\n❌ title-looks: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
  console.log(`✅ title-looks: ${TITLE_LOOKS.length} looks draw, each in its own font, text that reads on its box, fonts shipped with the routes that draw them`)
}
main().catch((e) => { console.error(e); process.exit(1) })
