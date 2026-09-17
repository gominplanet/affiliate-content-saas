// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HALF A POST'S LINKS CONVERTED, AND THE TOOL SAID IT WAS DONE.
//
// A creator ran Fix Affiliate Links on a fresh post and reported that four of
// eight links converted. His live post explains it precisely. Ten affiliate
// links, four distinct URL STRINGS, and two of those four are the same link:
//
//   https://www.amazon.com/dp/B0FWBHDFWK?tag=x&#038;ascsubtag=y   x4
//   https://www.amazon.com/dp/B0FWBHDFWK?tag=x&ascsubtag=y        x1
//
// Same destination. WordPress encodes the ampersand in what it stores, and the
// price-strip block is written by a path that does not, so the same URL sits in
// the post spelled two ways.
//
// The fixer swapped one exact string. It matched the four and walked past the
// fifth, and a reader kept clicking a plain Amazon button on a post the tool had
// reported as fixed.
//
// Invisible from every angle that matters: both links render the same, look the
// same in the editor, and differ only in the byte the swap compares.
//
// The trap in fixing it is the ORDER. A raw `&` is a substring of `&#038;`, so
// swapping the bare form first turns the encoded ones into corrupted URLs. That
// is worse than the bug: a link that went to Amazon now goes nowhere.
import { hrefVariants, sameUrl, swapUrlEverywhere, countUrl } from '../lib/html-url-swap'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const RAW = 'https://www.amazon.com/dp/B0FWBHDFWK?tag=laststopreviewshop-20&ascsubtag=Pnm7UJMnl1U'
const ENC = 'https://www.amazon.com/dp/B0FWBHDFWK?tag=laststopreviewshop-20&#038;ascsubtag=Pnm7UJMnl1U'
const AMP = 'https://www.amazon.com/dp/B0FWBHDFWK?tag=laststopreviewshop-20&amp;ascsubtag=Pnm7UJMnl1U'
const NEW = 'https://geni.us/abc123'

// ── the three spellings are one URL ───────────────────────────────────────
{
  for (const [a, b, why] of [
    [RAW, ENC, 'raw and numeric entity'],
    [RAW, AMP, 'raw and named entity'],
    [ENC, AMP, 'the two entities'],
  ] as const) {
    check(`the same URL: ${why}`, sameUrl(a, b), `${a}\n     ${b}`)
  }
  check('a different product is not the same URL',
    !sameUrl(RAW, RAW.replace('B0FWBHDFWK', 'B0OTHER1234')))
  check('a different tag is not the same URL',
    !sameUrl(RAW, RAW.replace('laststopreviewshop-20', 'someoneelse-20')))
  check('null is never the same as anything', !sameUrl(null, RAW) && !sameUrl(RAW, undefined))
}

// ── THE CASE THAT WAS REPORTED ────────────────────────────────────────────
//
// Four encoded, one raw, all in one post. Every one has to move.
{
  const post = [
    `<a class="gr-cta-btn" href="${ENC}">Buy</a>`,
    `<a class="gr-price-strip-btn" href="${RAW}">Check price</a>`,
    `<a class="gr-cta-btn" href="${ENC}">Buy</a>`,
    `<a class="mvp-sc-btn" href="${ENC}">Shop</a>`,
    `<p>See the <a href="${ENC}">Blackview DCM6</a> on Amazon.</p>`,
  ].join('\n')

  check('the post really holds both spellings', post.includes(RAW) && post.includes(ENC))
  check('and the old one-string swap would miss one',
    post.split(ENC).join(NEW).includes(RAW),
    'this is the bug, reproduced, so the fix below is measured against it')

  const out = swapUrlEverywhere(post, ENC, NEW)
  check('every copy is swapped', out.split(NEW).length - 1 === 5, String(out.split(NEW).length - 1))
  check('the encoded form is gone', !out.includes(ENC))
  check('and so is the raw one', !out.includes(RAW),
    'the raw-ampersand price strip is the link the creator reported as still plain')
  check('no Amazon link survives', !/amazon\.com\/dp/.test(out), out.slice(0, 200))

  // And from the other direction: given the RAW form, the encoded ones move too.
  const out2 = swapUrlEverywhere(post, RAW, NEW)
  check('swapping from the raw form also catches the encoded ones',
    out2.split(NEW).length - 1 === 5, String(out2.split(NEW).length - 1))
}

// ── THE TRAP: order matters, and getting it wrong corrupts the link ───────
//
// A raw `&` is a substring of `&#038;`. Replace the bare form first and the
// encoded URLs become mangled, which is worse than leaving them plain: the link
// stops working entirely.
{
  const variants = hrefVariants(RAW)
  check('the encoded forms come before the raw one',
    variants.indexOf(ENC) < variants.indexOf(RAW),
    variants.join('\n     '))
  check('and all three are offered', variants.length === 3, String(variants.length))

  const out = swapUrlEverywhere(`<a href="${ENC}">x</a>`, RAW, NEW)
  check('an encoded URL is replaced whole, not partly',
    out === `<a href="${NEW}">x</a>`, out)
  check('nothing is left behind', !out.includes('#038') && !out.includes('ascsubtag'), out)
}

// ── it never touches a link it was not asked about ────────────────────────
{
  const other = 'https://www.amazon.com/dp/B0DIFFERENT?tag=laststopreviewshop-20&#038;x=1'
  const post = `<a href="${ENC}">a</a><a href="${other}">b</a>`
  const out = swapUrlEverywhere(post, ENC, NEW)
  check('the other product is untouched', out.includes(other), out)
  check('and ours moved', out.includes(NEW))

  // A URL that is a PREFIX of another must not drag it along.
  const short = 'https://www.amazon.com/dp/B0FWBHDFWK'
  const long = 'https://www.amazon.com/dp/B0FWBHDFWK?tag=x'
  const both = `<a href="${short}">a</a><a href="${long}">b</a>`
  const swapped = swapUrlEverywhere(both, long, NEW)
  check('the longer URL swaps without eating the shorter',
    swapped.includes(short) && swapped.includes(NEW), swapped)
}

// ── nothing blows up on nothing ───────────────────────────────────────────
{
  check('empty html is returned as is', swapUrlEverywhere('', RAW, NEW) === '')
  check('an empty from changes nothing', swapUrlEverywhere('<a href="x">y</a>', '', NEW) === '<a href="x">y</a>')
  check('swapping a URL for itself changes nothing',
    swapUrlEverywhere(`<a href="${ENC}">x</a>`, ENC, ENC) === `<a href="${ENC}">x</a>`)
  check('or for its own other spelling',
    swapUrlEverywhere(`<a href="${ENC}">x</a>`, ENC, RAW) === `<a href="${ENC}">x</a>`,
    'the two are the same link, so this is not a change worth making')
}

// ── counting sees every spelling, and counts none of them twice ───────────
{
  const post = `${ENC} ${RAW} ${ENC} ${AMP}`
  check('all four copies are counted', countUrl(post, RAW) === 4, String(countUrl(post, RAW)))
  check('and a URL that is not there counts zero',
    countUrl(post, 'https://www.amazon.com/dp/B0NOTHERE') === 0)
  check('an empty needle counts zero', countUrl(post, '') === 0)
}

if (failures.length) {
  console.error(`\n❌ html-url-swap: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ html-url-swap: the same link spelled three ways is swapped every time, longest form first')
