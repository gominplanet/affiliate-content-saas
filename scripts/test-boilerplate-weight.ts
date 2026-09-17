// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// How much of a post is the same as every other post, and is the number real?
//
// This exists because the answer was being guessed at, including by me. The
// first estimate said 400 to 800 words per post and counted a 61 line inline
// <style> block toward it. That was wrong in a way worth keeping a test for:
// search engines strip the CONTENTS of <style> and <script> before extracting
// text, so repeated CSS is page weight and nothing else. Measured properly the
// real figure is about 166 words, and 60 of those were one disclaimer sentence
// emitted three times on the same page.
//
// The measurement matters more than the number, because the padding fix made
// posts SHORTER. The same fixed furniture is a much larger share of a 600 word
// post than a 2,500 word one, so this got worse the moment that shipped, and a
// guess could not have told anyone that.
import { boilerplateWeight, visibleText, describeBoilerplate } from '../lib/boilerplate-weight'
import { readFileSync } from 'fs'
import { join } from 'path'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const prose = (n: number) => '<p>' + Array.from({ length: n }, (_, i) => `sentence${i}`).join(' ') + '</p>'

// ── the mistake this file exists to stop ────────────────────────────────────
// Stripping only the <style> TAG leaves raw CSS sitting in the extracted text,
// which is exactly how a stylesheet came to be counted as prose.
{
  const html = '<style>.gr-video-wrap{margin:0 0 32px;width:100%;padding:4px}</style><p>real words here</p>'
  const text = visibleText(html)
  check('style CONTENTS are removed, not just the tag',
    !/gr-video-wrap|margin|padding/.test(text), text)
  check('and the real prose survives', /real words here/.test(text), text)

  const w = boilerplateWeight(html)
  check('a stylesheet does not inflate the word count', w.totalWords <= 4, `${w.totalWords}`)
}
{
  const html = '<script>var x = "Quick Verdict Quick Verdict";</script><p>real words</p>'
  check('script contents are removed too',
    !/Quick Verdict/.test(visibleText(html)), visibleText(html))
}

// ── the disclaimer was the single biggest item ──────────────────────────────
{
  const d = 'This post contains affiliate links. As an Amazon Associate, we earn from qualifying purchases at no extra cost to you.'
  const thrice = `<p>${d}</p>${prose(500)}<p>${d}</p><p>${d}</p>`
  const once = `<p>${d}</p>${prose(500)}`
  const a = boilerplateWeight(thrice)
  const b = boilerplateWeight(once)
  check('a repeated sentence is counted every time it appears',
    a.boilerplateWords - b.boilerplateWords === 40,
    `${a.boilerplateWords} vs ${b.boilerplateWords}`)
  const top = a.found.find(f => f.phrase.startsWith('This post contains'))
  check('and the repetition is reported, not just the total', top?.times === 3, `${top?.times}`)
}

// ── short posts carry the same furniture, so it costs them more ─────────────
// The padding fix made posts shorter. This is the interaction it created.
{
  const chrome = '<p>This post contains affiliate links. As an Amazon Associate, we earn from qualifying purchases at no extra cost to you.</p>'
    + '<div>Watch Our Review</div><h3>Quick Verdict</h3><h4>Buy if you:</h4><h4>Skip if you:</h4>'
    + '<h2>Frequently Asked Questions</h2><h2>Also worth considering</h2>'
  const short = boilerplateWeight(chrome + prose(600))
  const long = boilerplateWeight(chrome + prose(2500))
  check('the same furniture is a bigger share of a short post', short.ratio > long.ratio * 2,
    `${(short.ratio * 100).toFixed(1)}% vs ${(long.ratio * 100).toFixed(1)}%`)
  check('and the word count is identical either way',
    short.boilerplateWords === long.boilerplateWords,
    `${short.boilerplateWords} vs ${long.boilerplateWords}`)
}

// ── the ratio is a measurement, not an artefact ─────────────────────────────
{
  // Overlapping phrases are the case that produces a ratio above 1. A long
  // disclaimer that contains a shorter matched fragment gets counted twice, and
  // the sum runs past the word total. That is an artefact, not a measurement.
  const overlap = boilerplateWeight('<p>Watch Our Review</p>', ['Our Review', 'Watch Our'])
  check('overlapping matches cannot push the ratio above 1', overlap.ratio <= 1, `${overlap.ratio}`)
  check('and boilerplate is clamped to the words that exist',
    overlap.boilerplateWords === overlap.totalWords,
    `${overlap.boilerplateWords} of ${overlap.totalWords}`)

  const w = boilerplateWeight('<p>Quick Verdict</p>')
  check('a post that is entirely chrome never exceeds 100%', w.ratio <= 1, `${w.ratio}`)
  check('and boilerplate never exceeds the total',
    w.boilerplateWords <= w.totalWords, `${w.boilerplateWords} > ${w.totalWords}`)
  const empty = boilerplateWeight('')
  check('an empty post is zero, not a division by zero',
    empty.ratio === 0 && empty.totalWords === 0, JSON.stringify(empty))
  check('and produces no advice', describeBoilerplate(empty) === null)
}

// ── a creator repeating their own subject is not boilerplate ────────────────
// Calling that boilerplate would be an accusation invented out of a vocabulary.
{
  const w = boilerplateWeight('<p>' + 'cordless drill battery adapter '.repeat(60) + '</p>')
  check('repeated subject words are not counted as chrome', w.boilerplateWords === 0,
    JSON.stringify(w.found))
}

// ── Pros and Cons only count as headings ────────────────────────────────────
{
  const heading = boilerplateWeight('<h2>Pros</h2><h2>Cons</h2>' + prose(200))
  check('the Pros and Cons headings are counted', heading.boilerplateWords >= 2,
    `${heading.boilerplateWords}`)
  // Capitalised, so only a word boundary tells these apart from the headings.
  // "Consider" contains "Cons" and "Prospective" contains "Pros".
  const inProse = boilerplateWeight('<p>Consider the Prospective buyer before Consolidating</p>')
  check('but "Consider" and "Prospective" are not Cons and Pros headings',
    inProse.boilerplateWords === 0, JSON.stringify(inProse.found))
}

// ── a creator's own disclosure wording is counted when supplied ─────────────
{
  const custom = 'Heads up, I get a small cut if you buy through my links.'
  const bare = boilerplateWeight(`<p>${custom}</p>${prose(200)}`)
  const told = boilerplateWeight(`<p>${custom}</p>${prose(200)}`, [custom])
  check('an unknown disclosure is invisible until declared', bare.boilerplateWords === 0)
  check('and counted once the site tells us what it uses', told.boilerplateWords === 13,
    `${told.boilerplateWords}`)
  check('a junk extra phrase cannot be used to inflate the count',
    boilerplateWeight(prose(100), ['a', '', '  ']).boilerplateWords === 0)
}

// ── the advice names the repetition, not just a percentage ──────────────────
{
  const d = 'This post contains affiliate links. As an Amazon Associate, we earn from qualifying purchases at no extra cost to you.'
  const note = describeBoilerplate(boilerplateWeight(`<p>${d}</p><p>${d}</p>${prose(60)}`))
  check('a heavy post gets told', !!note, 'no note')
  check('and the note says which line is repeated', !!note && /appears 2 times/.test(note), note ?? '')
  check('a clean post is left alone',
    describeBoilerplate(boilerplateWeight(prose(2000))) === null)
}

// ── the duplicate CTA disclaimer is gone from the writer prompt ─────────────
{
  const strip = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const PROMPT = strip(readFileSync(join(__dirname, '..', 'services/claude/index.ts'), 'utf8'))
  check('the comment stripper works',
    strip('  // gr-cta-disclaimer\nreal code').indexOf('gr-cta-disclaimer') === -1)
  check('the CTA card no longer restates the full disclaimer',
    !/gr-cta-disclaimer[^>]*>\$\{disclaimer\}/.test(PROMPT),
    'the same 20 word sentence three times was the largest single item')
  check('but the card still discloses at the point of click',
    /const ctaDisclaimer = 'Affiliate link\./.test(PROMPT),
    'removing disclosure entirely is not the fix')
  check('the FTC disclosure at the top of the post is untouched',
    /<p style="font-size:13px">\$\{disclaimer\}<\/p>/.test(PROMPT),
    'this one has to be before the first affiliate link')
}

// ── the price strip keeps the wording Amazon requires next to a price ───────
{
  const STRIP = readFileSync(join(__dirname, '..', 'lib/price-strip.ts'), 'utf8')
  check('the price strip still carries the Amazon Operating Agreement wording',
    /pricing and availability subject to change/.test(STRIP),
    'this sits next to a displayed price and is not optional')
}

// ── the plugin serves the CSS and strips the inline copy ────────────────────
{
  const PLUGIN = readFileSync(
    join(__dirname, '..', 'wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php'), 'utf8')
  check('the plugin prints the post CSS once, in the head',
    /wp_head[\s\S]{0,400}mvp-affiliate-post-css/.test(PLUGIN))
  check('and strips the generator\'s inline copy from the body',
    /<style\\b\[\^>\]\*>\(\.\*\?\)<\\\/style>/.test(PLUGIN) || /mvp_affiliate_post_css/.test(PLUGIN))
  check('only when the block is one of ours',
    /strpos\(\$css, '\.gr-video-wrap'\)/.test(PLUGIN)
    && /return \$ours \? '' : \$m\[0\];/.test(PLUGIN),
    'an unconditional strip would eat CSS a creator pasted into their own post')
  check('a regex blowout returns the article rather than blanking it',
    /is_string\(\$out\) \? \$out : \$content/.test(PLUGIN),
    'preg_replace_callback returns null on a backtrack limit')
  check('the strip runs before any filter that injects markup',
    /\}\), 1\);/.test(PLUGIN),
    'otherwise it could eat a block another MVP filter just added')
  check('the plugin version was bumped so sites pick it up',
    /Version: 1\.0\.9[6-9]|Version: 1\.[1-9]/.test(PLUGIN))
}

// ── break tests ─────────────────────────────────────────────────────────────
{
  const breaks: string[] = []
  const broke = (name: string, cond: boolean) => { if (!cond) breaks.push(name) }

  // Break 1: the original mistake. Strip the tag, keep the CSS as text.
  broke('CSS counted as prose is caught',
    boilerplateWeight('<style>.gr-cta-card{display:flex;margin:0 auto;padding:4px}</style><p>a b</p>').totalWords <= 4)

  // Break 2: counting a repeated sentence once instead of every time.
  const d = 'This post contains affiliate links. We may earn a commission on purchases made through links on this site, at no extra cost to you.'
  broke('under-counting repetition is caught',
    boilerplateWeight(`<p>${d}</p><p>${d}</p>`).found.some(f => f.times === 2))

  // Break 3: a ratio above 1, which is an artefact rather than a measurement.
  broke('a ratio above 1 is caught', boilerplateWeight('<p>Quick Verdict</p>').ratio <= 1)

  // Break 4: counting a creator's own repeated subject words as chrome.
  broke('accusing a creator of boilerplate for their own vocabulary is caught',
    boilerplateWeight('<p>' + 'drill battery adapter '.repeat(50) + '</p>').boilerplateWords === 0)

  // Break 5: matching Cons inside an ordinary capitalised word.
  broke('a substring match on Cons is caught',
    boilerplateWeight('<p>Consider the Prospective buyer</p>').boilerplateWords === 0)

  // Break 6: dropping the clamp, so overlapping phrases report more boilerplate
  // than the post has words.
  broke('a ratio above 1 from overlapping phrases is caught',
    boilerplateWeight('<p>Watch Our Review</p>', ['Our Review', 'Watch Our']).ratio <= 1)

  for (const b of breaks) failures.push(`BREAK TEST MISSED ${b}`)
}

if (failures.length) {
  console.error(`\n❌ boilerplate-weight: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('✅ boilerplate-weight: the repeated text on every post is measured, not estimated')
