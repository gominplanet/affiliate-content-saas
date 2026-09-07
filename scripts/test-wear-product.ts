// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does "make me wear it" put the product in the right place, and keep it the
// same product?
//
// Two ways this feature goes wrong, and they are the two things asserted here.
//
// It puts the thing somewhere absurd. "Wearing" is not one instruction: a t-shirt
// goes on the torso, a watch on a wrist, a bag over a shoulder. An image model
// told to wear a handbag will put it on someone's head, and a design like that
// reaches a brand who is paying for it.
//
// It shows a different product. An image model handed "a person wearing a
// jacket" produces a jacket, not THE jacket, and the whole value of an apparel
// design is that the viewer is looking at the thing they can buy.
//
// And one thing it must not do: turn itself on for something nobody wears. A
// shoe cleaning kit is not a shoe.
import { detectWearable, mightBeWearable, wearDirective, WEAR_CAVEAT } from '../lib/wear-product'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── it goes where it goes ───────────────────────────────────────────────────
{
  const cases: [string, string, RegExp][] = [
    ['Levi’s 501 Original Fit Jeans, Dark Wash', 'bottom', /lower body/i],
    ['Carhartt Men’s Duck Detroit Jacket', 'outerwear', /upper body/i],
    ['Hanes Men’s ComfortSoft Short Sleeve T-Shirt', 'top', /torso/i],
    ['Nike Air Zoom Pegasus 41 Running Shoes', 'shoes', /feet/i],
    ['Casio G-Shock Digital Watch', 'watch', /wrist/i],
    ['Ray-Ban Aviator Classic Sunglasses', 'eyewear', /face/i],
    ['JanSport SuperBreak Backpack', 'bag', /shoulder|carried/i],
    ['Sterling Silver Pendant Necklace', 'jewelry', /neck/i],
    ['New Era 59FIFTY Fitted Cap', 'hat', /head/i],
    ['Summer Floral Midi Dress', 'dress', /full outfit/i],
  ]
  for (const [title, kind, where] of cases) {
    const w = detectWearable({ title })
    check(`"${title}" is wearable`, w.wearable, JSON.stringify(w))
    check(`and is a ${kind}`, w.kind === kind, `${w.kind}`)
    check(`and goes in the right place`, where.test(w.on || ''), `${w.on}`)
  }
}

// ── a bag is carried, not worn on the head ──────────────────────────────────
// The exact absurdity this exists to prevent.
{
  const w = detectWearable({ title: 'Coach Leather Tote Handbag' })
  const d = wearDirective(w) || ''
  check('a bag is carried', /carried|shoulder|hand/i.test(w.on || ''), `${w.on}`)
  check('and the directive never says to wear it on the head', !/head/i.test(d), d)
}

// ── things nobody wears ─────────────────────────────────────────────────────
{
  const no = [
    'Crep Protect Shoe Cleaning Kit',
    'Jewelry Cleaner Solution for Rings',
    'Watch Band Replacement Strap Tool Kit',
    'Clothes Hanger Organizer Rack, 20 Pack',
    'Laundry Detergent Pods, 120 Count',
    'iPhone 15 Case, Clear',
    'Anker 737 Power Bank',
    'Levoit Classic 36-Inch Tower Fan',
    'FORGEBODY Beef Organ Complex',
  ]
  for (const title of no) {
    check(`"${title}" is not treated as something to wear`, !detectWearable({ title }).wearable, title)
  }
}

// ── a category alone never turns it on ──────────────────────────────────────
// Amazon files phone cases under accessories and watch straps under watches.
{
  const w = detectWearable({ title: 'Screen Protector, 3 Pack', category: 'Clothing, Shoes & Jewelry' })
  check('an apparel category does not make a screen protector wearable', !w.wearable, JSON.stringify(w))
  check('but it is still worth offering the toggle for',
    mightBeWearable({ title: 'Screen Protector, 3 Pack', category: 'Clothing, Shoes & Jewelry' }))
  check('and a fan in Home & Kitchen is not',
    !mightBeWearable({ title: 'Levoit Tower Fan', category: 'Home & Kitchen' }))
}

// ── the directive is mostly about fidelity ──────────────────────────────────
// The wearing is one sentence. Which garment is the whole risk.
{
  const w = detectWearable({ title: 'Carhartt Men’s Duck Detroit Jacket' })
  const d = wearDirective(w) || ''
  check('it says worn rather than held', /worn/i.test(d) && /Do NOT show them holding it/i.test(d), d)
  check('it forbids a second copy in the frame', /second copy/i.test(d), d)
  check('it demands the same item as the reference', /SAME ITEM as the product reference/i.test(d), d)
  check('it names what has to match', /colour, cut, length, collar/i.test(d), d)
  check('it forbids restyling and recolouring', /do not change its colour/i.test(d) && /do not restyle/i.test(d), d)
  check('it forbids moving a logo', /reinvent a logo/i.test(d), d)
  check('it forbids inventing an unseen part',
    /frame the shot so that part is not shown rather than inventing it/i.test(d), d)
  check('and the person stays the person', /same face, the same identity/i.test(d), d)
}

// ── nothing to wear, nothing to say ─────────────────────────────────────────
{
  check('a product nobody wears gets no directive at all',
    wearDirective(detectWearable({ title: 'Anker 737 Power Bank' })) === null)
}

// ── the creator is told it is a recreation ──────────────────────────────────
// A brand paying for the campaign is the one who notices a logo in the wrong
// place, so this is never presented as a photograph of their garment.
{
  check('the caveat says it is recreated', /recreated from the product photo/i.test(WEAR_CAVEAT), WEAR_CAVEAT)
  check('and names what tends to go wrong', /print or a brand logo/i.test(WEAR_CAVEAT), WEAR_CAVEAT)
  check('and says to look before publishing', /Look at it before/i.test(WEAR_CAVEAT), WEAR_CAVEAT)
  check('without promising it will be exact', !/exactly|guaranteed|perfect/i.test(WEAR_CAVEAT), WEAR_CAVEAT)
}

// ── nothing in the wear path may call the product plain ─────────────────────
// This shipped and regressed a real design. The wardrobe line read "anything
// else on them is plain and neutral", the image model attached "plain" to the
// garment, and a navy cable-knit polo with a white contrast collar came back as
// a plain pale polo. Any sentence that can be read as describing the product
// must never contain a word that flattens it.
{
  const w = detectWearable({ title: 'Gracyoga Men\u2019s Polo Shirts Casual Knit Texture Collared Golf Shirt' })
  check('a knit-texture polo is wearable', w.wearable, JSON.stringify(w))
  const d = wearDirective(w) || ''
  check('the directive never calls anything plain', !/\bplain\b/i.test(d), d)
  check('the directive never calls anything neutral', !/\bneutral\b/i.test(d), d)
  check('the directive never invites simplifying it', !/\bsimplif|clean it up\b/i.test(d), d)
  check('and it names the pattern as something to keep', /print|pattern|colour/i.test(d), d)
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
