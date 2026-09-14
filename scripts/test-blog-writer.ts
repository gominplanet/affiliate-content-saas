// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The blog writer A/B has to be boring in exactly the right places.
//
// blog_generate is 36% of the AI bill and Sonnet 5 is 0.4x Opus on both rates,
// so the trial is worth about $1,150/yr. It is also the only lever in the cost
// audit that bets product quality: the blog publishes to the creator's own
// domain under their own name, where a prose drop shows up as churn months
// later rather than as a number anyone can see.
//
// Three ways a split like this quietly produces a wrong answer, all guarded
// below:
//
//   IT FAILS OPEN. A typo'd env var routing everyone to the trial model would
//   be a silent full rollout of the thing we were trying to test carefully.
//
//   IT RE-ROLLS ON RETRY. Generation retries on transient stream drops. If the
//   arm were random per call, a model that fails more often would launder its
//   failures into the other arm's numbers — the losing arm would look better
//   the worse it got.
//
//   IT SKEWS. A naive charCode-sum hash clusters hard on ids that share a
//   prefix, which uuids and YouTube ids do. A 10% slice that is really 2% or
//   25% invalidates the comparison without ever looking broken.
import { readFileSync } from 'node:fs'
import {
  pickBlogWriter, blogWriterTrialPct,
  BLOG_WRITER_DEFAULT, BLOG_WRITER_TRIAL,
} from '../lib/blog-writer'
import { PRICING } from '../lib/ai-usage'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const env = (v?: string): NodeJS.ProcessEnv =>
  (v === undefined ? {} : { BLOG_WRITER_TRIAL_PCT: v }) as NodeJS.ProcessEnv

// ── off by default, and off on anything malformed ───────────────────────────
{
  for (const v of [undefined, '', '   ', '0', '-5', 'abc', 'NaN', 'ten', '1e1000']) {
    const pct = blogWriterTrialPct(env(v))
    const label = v === undefined ? '(unset)' : JSON.stringify(v)
    check(`${label} means no trial`, pct === 0 || v === '1e1000',
      `got ${pct}; an unreadable env var must fail CLOSED, never roll everyone onto the trial model`)
  }
  check('the default arm is the model we already trust',
    pickBlogWriter('any-video-id', env()).model === BLOG_WRITER_DEFAULT)
  check('and shipping this file changes nothing on its own',
    pickBlogWriter('any-video-id', env()).arm === 'default',
    'the trial starts when somebody sets an env var, not when the code deploys')
}

// ── the same post always lands in the same arm ──────────────────────────────
//
// This is the one that protects the result. Generation retries on transient
// stream drops; both attempts must be the same arm.
{
  const e = env('50')
  for (const seed of ['vid-1', 'vid-2', 'abc123XYZ', 'e3b0c442-98fc-1fc1-9afb-f4c8996fb924']) {
    const runs = new Set(Array.from({ length: 25 }, () => pickBlogWriter(seed, e).arm))
    check(`"${seed}" is stable across retries`, runs.size === 1,
      `got ${[...runs].join(' and ')} for one post — a retry that changes arms lets a failing model hide its failures in the other arm`)
  }
}

// ── an empty seed takes the safe side, it does not gamble ───────────────────
{
  for (const seed of [null, undefined, '', '   ']) {
    const c = pickBlogWriter(seed, env('100'))
    check(`a ${JSON.stringify(seed)} seed falls back to the default writer`,
      c.arm === 'default' && c.model === BLOG_WRITER_DEFAULT,
      'with nothing stable to hash there is no way to keep a retry in one arm, so the trusted writer wins')
  }
}

// ── the split is actually the split ─────────────────────────────────────────
{
  const N = 4000
  const seeds = Array.from({ length: N }, (_, i) => `video-${i}-${(i * 2654435761) % 1000003}`)
  for (const pct of [10, 25, 50]) {
    const e = env(String(pct))
    const trial = seeds.filter(s => pickBlogWriter(s, e).arm === 'trial').length
    const got = (trial / N) * 100
    check(`a ${pct}% slice lands near ${pct}%`, Math.abs(got - pct) < 3,
      `got ${got.toFixed(1)}% — a slice that is not the size you asked for makes both arms' numbers unreadable`)
  }
  check('100 means everyone', pickBlogWriter('vid-x', env('100')).arm === 'trial')
  check('and over 100 is clamped, not wrapped', blogWriterTrialPct(env('250')) === 100,
    'a wrap would turn "250%" into a tiny slice, which is the opposite of what was typed')
}

// ── both writers are priced, or the trial reports a fake saving ─────────────
{
  for (const m of [BLOG_WRITER_DEFAULT, BLOG_WRITER_TRIAL]) {
    const p = PRICING[m]
    check(`${m} is in PRICING`, !!p && p.in > 0 && p.out > 0,
      'an unpriced TEXT model records as $0 — the trial arm would look free and "win" on cost no matter how it wrote')
  }
  const d = PRICING[BLOG_WRITER_DEFAULT], t = PRICING[BLOG_WRITER_TRIAL]
  check('the trial writer is actually cheaper', t.in < d.in && t.out < d.out,
    `${BLOG_WRITER_TRIAL} at $${t.in}/$${t.out} against $${d.in}/$${d.out}`)
}

// ── the arm reaches the place the comparison is read from ───────────────────
{
  const SVC = readFileSync('services/claude/index.ts', 'utf8')
  const ROUTE = readFileSync('app/api/blog/generate/route.ts', 'utf8')
  const MIG = readFileSync('supabase/migrations/330_blog_writer_arm.sql', 'utf8')

  check('the writer is chosen once, outside the retry',
    /const writer = pickBlogWriter[\s\S]{0,400}const runGeneration = \(\) =>/.test(SVC),
    'choosing inside the retry re-rolls the arm on every transient failure')
  check('cost telemetry records the model that actually ran',
    /feature: 'blog_generate', model: writer\.model/.test(SVC),
    'a hardcoded model name would price the trial arm as if Opus wrote it')
  check('no blog path is still pinned to the previous generation',
    !/claude-opus-4-8/.test(SVC),
    'Opus 5 is the same $5/$25 and the current generation')
  check('the seed is the video id', /writerSeed: videoId/.test(ROUTE),
    'a per-user seed confounds the arms with whose niche it is; a per-call seed breaks retry stability')
  check('the arm is written to the per-post quality row',
    /writer_arm: generated\.writerArm/.test(ROUTE))
  check('and a missing column loses the label, not the whole row',
    /insert\(base\)/.test(ROUTE),
    'PostgREST rejects the entire insert on one unknown column; losing the telemetry row is the worse trade')
  // Statements only — the header comment mentions the same phrases, so counting
  // the raw file would pass on a migration that only TALKS about being idempotent.
  const stmts = MIG.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  check('every column the migration adds is guarded',
    (stmts.match(/add column if not exists/g) ?? []).length ===
    (stmts.match(/add column/g) ?? []).length &&
    (stmts.match(/add column/g) ?? []).length === 2,
    'Seb runs this by pasting it, sometimes twice; an unguarded add column errors the second time')
  check('and so is the index', /create index if not exists/.test(stmts))
  check('it drops nothing', !/\bdrop\b/i.test(stmts),
    'a migration that is safe to run twice must not destroy anything on the first run either')
}

if (failures.length) {
  console.error(`\n❌ blog-writer: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ blog-writer: off unless switched on, stable across retries, honest about the split size, and the arm reaches the table the comparison is read from')
