// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The blog quality fixes (research, September): posts Google and AI answer
// engines treat as helpful, and that never claim experience nobody had.
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }

// ── Fix 2: one set of instructions, and the answer first ──
{
  const W = read('services/claude/index.ts')
  check('length obeys the ceiling and the source, with no "keep going to the top"',
    !/keep going to the top of it/.test(W) && /the HARD CEILING and the source\s+material always win/.test(W))
  check('no FAQ minimum left to contradict the computed count', !/7-10 question minimum/.test(W))
  check('no prices in the good examples of a prompt that bans prices', !/again at \$80|\$82 buys|best \$80 grinder/.test(W))
  check('no reference to a section that no longer exists', !/Section [CD]\b/.test(W))
  check('with no first-hand source, the experience block beats "first person always"',
    /WHEN THE EXPERIENCE BLOCK SAYS THERE IS NO FIRST-HAND SOURCE, THAT BLOCK WINS/.test(W))
  check('the post opens with a 40 to 60 word direct answer, before the disclaimer, naming the exact product, with no link or price',
    /\[0\] THE DIRECT ANSWER/.test(W) && W.indexOf('[0] THE DIRECT ANSWER') < W.indexOf('[1] AFFILIATE DISCLAIMER BLOCK')
    && /40 to 60\s+words/.test(W) && /No link in it, no price/.test(W) && /class="mvp-answer"/.test(W))
}

if (failures.length) {
  console.error(`\n❌ blog-quality: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ blog-quality: one consistent set of instructions, the answer first, and no experience nobody had')
