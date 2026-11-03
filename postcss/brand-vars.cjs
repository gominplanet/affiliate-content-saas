// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BRAND COLOUR IS A VARIABLE, IN EVERY CLASS (the Teal Pop look, Seb,
// 2026-11-03: "I like A").
//
// About 1,800 places across the app name MVP's violet by value: text-[#7C3AED],
// bg-[#7C3AED]/10, hover:bg-[#6D28D9], violet-600 and so on. Rewriting every
// one of them to change the look would touch 285 files that other work is
// also changing. Instead this runs after Tailwind and rewrites the compiled
// CSS: every violet in a declaration becomes rgb(var(--brand-...)), and
// globals.css gives those variables their violet values by default. Nothing
// looks different until a look changes the variables ([data-look="teal"]).
//
// Only CSS is rewritten. A violet written into an inline style in a component
// stays violet in every look; those are changed page by page as each page is
// redesigned.
//
// Variable names are kept to the shades MVP actually uses. A declaration of
// one of these variables is never rewritten (it would point at itself).

const SHADES = [
  // [r, g, b, variable]
  [124, 58, 237, '--brand-rgb'],          // #7C3AED violet-600, the brand
  [109, 40, 217, '--brand-strong-rgb'],   // #6D28D9 violet-700, hover
  [91, 33, 182, '--brand-deep-rgb'],      // #5B21B6 violet-800
  [139, 92, 246, '--brand-mid-rgb'],      // #8B5CF6 violet-500
  [167, 139, 250, '--brand-soft-rgb'],    // #A78BFA violet-400, text on dark
  [196, 181, 253, '--brand-softer-rgb'],  // #C4B5FD violet-300
  [221, 214, 254, '--brand-pale-rgb'],    // #DDD6FE violet-200
  [237, 233, 254, '--brand-tint-rgb'],    // #EDE9FE violet-100
  [245, 243, 255, '--brand-wash-rgb'],    // #F5F3FF violet-50
  [192, 38, 211, '--brand-2-rgb'],        // #C026D3 fuchsia-600, the gradient's end
]

const hex2 = (n) => n.toString(16).padStart(2, '0')

/** Rewrite every brand shade in one CSS value. Pure, exported for the test. */
function rewriteBrand(value) {
  let v = value
  for (const [r, g, b, name] of SHADES) {
    const hex = `#${hex2(r)}${hex2(g)}${hex2(b)}`
    // #7c3aed, not followed by more hex (an 8 digit #7c3aed20 is left alone).
    v = v.replace(new RegExp(`${hex}(?![0-9a-f])`, 'gi'), `rgb(var(${name}))`)
    // rgb(124 58 237 / 0.1), rgb(124 58 237 / var(--tw-bg-opacity)), rgb(124 58 237)
    v = v.replace(new RegExp(`rgb\\(\\s*${r}\\s+${g}\\s+${b}\\s*(\\/\\s*[^)]+)?\\)`, 'g'),
      (_m, alpha) => (alpha ? `rgb(var(${name}) ${alpha.trim()})` : `rgb(var(${name}))`))
    // rgba(124, 58, 237, 0.1) and rgb(124, 58, 237)
    v = v.replace(new RegExp(`rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*(?:,\\s*([^)]+))?\\)`, 'g'),
      (_m, alpha) => (alpha ? `rgb(var(${name}) / ${alpha.trim()})` : `rgb(var(${name}))`))
  }
  return v
}

function plugin() {
  return {
    postcssPlugin: 'mvp-brand-vars',
    Declaration(decl) {
      if (decl.prop.startsWith('--brand')) return
      const next = rewriteBrand(decl.value)
      if (next !== decl.value) decl.value = next
    },
  }
}
plugin.postcss = true

module.exports = plugin
module.exports.rewriteBrand = rewriteBrand
module.exports.SHADES = SHADES
