// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BRAND'S PRODUCTS, GROUPED IN THE TRYBE UPLOAD (Seb, 2026-10-29: "the list
// is too messy like this"). Pinned on the Bassdash list he showed: every
// product lands in the group a person would put it in, read from what it is
// (a wader with a boot foot is a wader, a hoodie with a neck gaiter is a top),
// who it is for is read even with a curly apostrophe, nothing is ever hidden
// (no rule means Other), and a short list stays one list.
import { readFileSync } from 'node:fs'
import { productGroup, productAudience, groupProducts, worthGrouping, mainPart } from '../lib/trybe-product-groups'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }

const is = (name: string, group: string) => check(`"${name}" is ${group}`, productGroup(name) === group)
is('Men’s Fleece Hoodie with Neck Gaiter FS18M', 'Shirts and hoodies')
is('TrueStalk Men’s UPF 50+ Hunting Hooded T-Shirt Sweatshirt with Face Mask', 'Shirts and hoodies')
is('Men’s Fish Graphic Long Sleeve T-Shirts', 'Shirts and hoodies')
is("Men's 3D PVC Game Wader (Heather Grey) - Boot Foot", 'Waders')
is('Men’s Breathable Chest Waders Boot Foot FW08', 'Waders')
is('Men’s Explorer-DG 6 inch Waterproof Deck Boots', 'Boots and shoes')
is('Men’s 7" Inseam Fishing Shorts with 3 Pockets FP12M', 'Pants and shorts')
is('Walker-LW Breathable Waterproof Hunting Pants for men', 'Pants and shorts')
is('Men’s Walker-LW Breathable Waterproof Hunting Fishing Jacket', 'Jackets and rain gear')
is('Men’s Waterproof Breathable Rain Suit FW12', 'Jackets and rain gear')
is('Unisex 3D Leafy Ghillie Suit for Hunting', 'Jackets and rain gear')
is('Bassdash Foldable UPF 50+ Fishing Hats with Removable Neck Flap FH12', 'Hats')
is('Men’s Insulated Mittens Winter Hunting Gloves HG04M', 'Gloves')
is('Camo Netting for Hunting Blind', 'Outdoor gear')
is('Something Nobody Has A Rule For', 'Other')
check('the main part stops before with, for, a dash or brackets', mainPart('Hoodie with Mask') === 'Hoodie' && mainPart("Wader (Grey) - Boot Foot") === 'Wader' && mainPart('Pants for men') === 'Pants')

check('who it is for, curly apostrophes too', productAudience('Women’s Explorer-DG Boots') === "Women's" && productAudience("Men's Shirt") === "Men's" && productAudience('M’s UPF Shirts') === "Men's"
  && productAudience('Youth 5in Shorts') === 'Youth' && productAudience('Unisex Bucket Hat') === 'Unisex' && productAudience('Camo Netting') === null && productAudience('Womens Hoodie') === "Women's")

const list = ['Hoodie A', 'Hoodie B', 'Shorts A', 'Boots A', 'Wader A', 'Hat A', 'Gloves A', 'Netting A', 'Mystery A'].map((name) => ({ name }))
const groups = groupProducts(list)
check('every product appears exactly once, in the fixed order', groups.flatMap((g) => g.items).length === list.length && groups[0].group === 'Shirts and hoodies' && groups[groups.length - 1].group === 'Other')
check('a short or single-kind list stays one list', !worthGrouping(list.slice(0, 5)) && !worthGrouping(Array.from({ length: 10 }, (_, i) => ({ name: `Hoodie ${i}` }))) && worthGrouping(list))

const P = readFileSync('components/labs/DropTrybePicker.tsx', 'utf8')
check('the picker groups a long list, with search, who-it-is-for filters and the picks on top', /const grouped = worthGrouping\(opts\.products\)/.test(P) && /placeholder=\{`Search \$\{opts\.products\.length\} products`\}/.test(P)
  && /Picked:/.test(P) && /groupProducts\(shown\)\.map/.test(P) && /\[audience, 'Unisex', null\]\.includes\(productAudience\(p\.name\)\)/.test(P))
check('a group with a picked product, or any search, is open', /open=\{!!q \|\| !!audience \|\| g\.items\.some\(\(p\) => value\.productIds\.includes\(p\.id\)\)\}/.test(P))

if (fails.length) { console.error('FAIL trybe product groups:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('✅ trybe-product-groups: a brand\'s products are grouped, searchable and filtered, none hidden')
