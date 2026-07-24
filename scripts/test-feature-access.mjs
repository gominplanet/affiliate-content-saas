#!/usr/bin/env node
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guards the nav-vs-enforcement boundary described in lib/feature-access.ts.
//
// Why this exists: Buying Guides hid its sidebar entry on a rule the enforcing
// route didn't share, so paying Pro users lost a feature and it took a customer
// asking to find it (2026-07-20). lib/feature-access.ts made the rules readable
// in one place; this makes them CHECKED, so the next drift fails a command
// instead of waiting for a support ticket.
//
// Zero dependencies on purpose — this repo has no test runner, and a drift
// check that needs a framework install is a drift check nobody runs.
//
//   node scripts/test-feature-access.mjs      → exits 1 on any failure
//
// What it asserts, per entry in NAV_ACCESS:
//   1. every route named in `enforcedBy` EXISTS (catches renames; a stale path
//      silently greps clean, which is exactly how I mis-called this earlier)
//   2. that route actually contains a tier check (catches an unguarded route
//      behind a nav gate = a paying-tier feature reachable by URL)
//   3. where the route's allowed tiers are statically readable, they MATCH the
//      table (catches someone changing a route and forgetting the nav)
// Plus two structural invariants: tiers are valid, and admin sees everything
// (otherwise the admin "view as" preview silently breaks).

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VALID_TIERS = ['trial', 'creator', 'studio', 'pro', 'admin']

const failures = []
const warnings = []
const fail = (m) => failures.push(m)
const warn = (m) => warnings.push(m)

// ── Read NAV_ACCESS out of the TS source ────────────────────────────────────
// Parsed rather than imported: the file is TypeScript and this script runs on
// bare node. The shape is a hand-maintained literal, so a tolerant parse is
// fine — and if the shape changes enough to break parsing, that's a failure
// worth surfacing rather than skipping.
const srcPath = join(ROOT, 'lib/feature-access.ts')
if (!existsSync(srcPath)) {
  console.error('✖ lib/feature-access.ts not found — did it move?')
  process.exit(1)
}
const src = readFileSync(srcPath, 'utf8')

const aliases = {}
for (const [, name, body] of src.matchAll(/^const (PAID|PRO|STUDIO_UP) = \[([^\]]+)\]/gm)) {
  aliases[name] = [...body.matchAll(/'([a-z]+)'/g)].map(m => m[1])
}

const table = {}
const blockRe = /^\s{2}([a-zA-Z]+):\s*\{([\s\S]*?)^\s{2}\},/gm
for (const [, key, block] of src.matchAll(blockRe)) {
  const tiersRaw = block.match(/tiers:\s*([A-Z_]+|\[[^\]]*\])/)?.[1] ?? ''
  const tiers = aliases[tiersRaw] ?? [...tiersRaw.matchAll(/'([a-z]+)'/g)].map(m => m[1])
  const enforcedBy = block.match(/enforcedBy:\s*'([^']+)'/)?.[1] ?? ''
  table[key] = { tiers, enforcedBy }
}

// A parse that silently drops a feature is the worst failure this script can
// have: the dropped feature is never checked and the run still reports green.
// Caught while drift-testing this very script — a reformatted `tiers:` line
// took the count 5 → 4 and it still printed ✓. Every feature declares exactly
// one `enforcedBy:`, so that count is an independent ground truth.
// Only entries with a string VALUE — `enforcedBy: string` in the NavAccessRule
// interface is a type declaration, not a feature.
const declaredCount = (src.match(/^\s+enforcedBy:\s*'/gm) ?? []).length
const parsedCount = Object.keys(table).length
if (parsedCount === 0) {
  console.error('✖ parsed 0 features out of NAV_ACCESS — the file shape changed, update this script')
  process.exit(1)
}
if (parsedCount !== declaredCount) {
  console.error(
    `✖ parsed ${parsedCount} features but the file declares ${declaredCount} enforcedBy entries.\n` +
    `  This script's parser missed one, so it would have been checked by NOTHING.\n` +
    `  Fix the parser (or the file's formatting) — do not ignore this.`,
  )
  process.exit(1)
}

// ── Per-feature checks ──────────────────────────────────────────────────────
for (const [key, { tiers, enforcedBy }] of Object.entries(table)) {
  // Structural: tiers valid + non-empty.
  if (!tiers.length) fail(`${key}: no tiers listed`)
  for (const t of tiers) {
    if (!VALID_TIERS.includes(t)) fail(`${key}: unknown tier "${t}"`)
  }
  // Admin must see everything, or "view as" previews go blind.
  if (tiers.length && !tiers.includes('admin')) {
    fail(`${key}: admin missing from tiers — breaks the admin view-as preview`)
  }

  // Resolve every /api/... path mentioned in enforcedBy.
  const paths = [...enforcedBy.matchAll(/\/api\/[a-z0-9/-]+/g)].map(m => m[0])
  if (!paths.length) {
    // Some entries describe a family of routes in prose ("each finder route
    // rejects trial"). Can't resolve those to a file — flag, don't fail.
    warn(`${key}: enforcedBy names no concrete /api path — cannot verify mechanically`)
    continue
  }

  for (const p of paths) {
    const candidates = [
      join(ROOT, 'app', p, 'route.ts'),
      join(ROOT, 'app', p, 'route.tsx'),
    ]
    const file = candidates.find(existsSync)
    if (!file) {
      fail(`${key}: enforcedBy points at ${p} but no route file exists there`)
      continue
    }
    const body = readFileSync(file, 'utf8')

    // 2. Does the route gate on tier at all?
    const gates = /tierAllows|normalizeTier|tier !== |tier ===|checkGenerationLimit|spendGate|tier_not_allowed/.test(body)
    if (!gates) {
      fail(`${key}: ${p} has NO tier/quota check — a nav-gated feature must enforce server-side`)
      continue
    }

    // 3. Where the allowed set is statically readable, compare it to the table.
    // Matches the codebase's dominant idiom: `tier !== 'a' && tier !== 'b'`
    // guarding a 403.
    const denyClause = body.match(/tier !== '([a-z]+)'(?:\s*&&\s*tier !== '([a-z]+)')*/)
    if (denyClause) {
      const allowed = [...denyClause[0].matchAll(/'([a-z]+)'/g)].map(m => m[1]).sort()
      const declared = [...tiers].sort()
      // Only compare when the route names a subset of real tiers; routes that
      // deny only 'trial' express "all paid", which is PAID in the table.
      const isTrialOnly = allowed.length === 1 && allowed[0] === 'trial'
      const expected = isTrialOnly ? VALID_TIERS.filter(t => t !== 'trial').sort() : allowed
      if (JSON.stringify(expected) !== JSON.stringify(declared)) {
        fail(
          `${key}: nav table says [${declared.join(', ')}] but ${p} allows [${expected.join(', ')}] — ` +
          `one of them is wrong (the route is the law; fix the table unless the route is the bug)`,
        )
      }
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const n = Object.keys(table).length
for (const w of warnings) console.log(`  ! ${w}`)
if (failures.length) {
  console.error(`\n✖ feature-access: ${failures.length} problem(s) across ${n} features\n`)
  for (const f of failures) console.error(`  ✖ ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✓ feature-access: ${n} features, nav table agrees with every enforcing route\n`)
