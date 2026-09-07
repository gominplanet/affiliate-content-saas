// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One bad account must not take the shared domain down for everyone.
//
// Every creator's Passport links sit on one domain, so they share one
// reputation. The controls under test exist so a problem lands on one account
// instead of all of them.
//
// Two ways to get this wrong, and they fail in opposite directions:
//
//   too tight  → a real creator running Deal Radar hard gets cut off mid-day by
//                their own tool, which is a worse outage than the one we are
//                preventing
//   too loose  → someone mints ten thousand links at a spam destination and the
//                domain is blocklisted, silently breaking every link every
//                creator has ever published
//
// So the cases below are the shapes of a real busy day, and the shapes of abuse.
import { mintAllowance, mintVerdict, linkIsLive } from '../lib/passport-abuse'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── a real creator never meets this ─────────────────────────────────────────
// The numbers that matter. A busy day is a roundup, a batch of deals and a push
// to every channel. If any of these trip, the control is the bug.
{
  const busyDay = { lastHour: 60, lastDay: 400 }
  for (const tier of ['creator', 'amazon', 'studio', 'pro', 'admin'] as const) {
    check(`${tier}: a busy day is allowed`, mintVerdict(busyDay, tier).allowed,
      JSON.stringify(mintVerdict(busyDay, tier)))
  }
  const heavyDay = { lastHour: 200, lastDay: 1200 }
  for (const tier of ['studio', 'pro', 'admin'] as const) {
    check(`${tier}: a heavy day is still allowed`, mintVerdict(heavyDay, tier).allowed)
  }
}

// ── abuse is stopped ────────────────────────────────────────────────────────
{
  const runaway = { lastHour: 5000, lastDay: 5000 }
  for (const tier of ['creator', 'amazon', 'studio', 'pro'] as const) {
    const v = mintVerdict(runaway, tier)
    check(`${tier}: a runaway loop is stopped`, !v.allowed, JSON.stringify(v))
    check(`${tier}: and the window is named for the log`, v.window === 'hour', String(v.window))
    check(`${tier}: and the creator is told existing links still work`,
      /Existing links keep working/.test(v.reason || ''), v.reason || 'null')
  }

  // Slow and steady still poisons the domain by tomorrow, which is why there
  // are two windows rather than one.
  const slowBulk = { lastHour: 100, lastDay: 4000 }
  const v = mintVerdict(slowBulk, 'pro')
  check('a slow bulk import is caught by the daily window', !v.allowed && v.window === 'day', JSON.stringify(v))
}

// ── admin is never rate limited ─────────────────────────────────────────────
// The account that has to clean up an incident cannot be the one that gets
// blocked doing it.
{
  const v = mintVerdict({ lastHour: 1e6, lastDay: 1e6 }, 'admin')
  check('admin has no ceiling', v.allowed, JSON.stringify(v))
  check('and the allowance says so', mintAllowance('admin').perHour === Infinity)
}

// ── the tiers are ordered, which is the property that survives edits ────────
// Stated as a relationship rather than exact numbers, so tuning the thresholds
// later cannot accidentally give a smaller plan a bigger allowance.
{
  const order = ['creator', 'studio', 'admin'] as const
  for (let i = 1; i < order.length; i++) {
    const lower = mintAllowance(order[i - 1])
    const higher = mintAllowance(order[i])
    check(`${order[i]} allows at least as much as ${order[i - 1]} per hour`, higher.perHour >= lower.perHour)
    check(`${order[i]} allows at least as much as ${order[i - 1]} per day`, higher.perDay >= lower.perDay)
  }
  for (const tier of ['creator', 'amazon', 'studio', 'pro'] as const) {
    const a = mintAllowance(tier)
    check(`${tier}: a day allows more than an hour`, a.perDay > a.perHour,
      'otherwise the hourly limit is unreachable and only one window is real')
  }
}

// ── nothing about the counts can crash a mint ───────────────────────────────
// This runs inside link creation. A malformed count must fall on "allowed",
// because refusing to mint over a bad number breaks a working feature to
// prevent an abuse that is not happening.
{
  for (const counts of [
    { lastHour: -5, lastDay: -5 },
    { lastHour: NaN as number, lastDay: NaN as number },
    { lastHour: 0.5, lastDay: 0.5 },
    { lastHour: 0, lastDay: 0 },
  ]) {
    check(`odd counts do not block a real creator: ${JSON.stringify(counts)}`,
      mintVerdict(counts, 'pro').allowed, JSON.stringify(mintVerdict(counts, 'pro')))
  }
  check('an unknown tier still gets a floor, not a crash',
    mintAllowance(undefined).perHour > 0 && mintAllowance(null as never).perDay > 0)
}

// ── a link can be switched off one at a time ────────────────────────────────
// The point of a per-row switch: without it, the only lever against one bad
// link is taking the domain down for every creator on it.
{
  check('a normal link is live', linkIsLive({ disabled: false }))
  check('a link with no flag is live', linkIsLive({}), 'existing rows predate the column')
  check('a disabled link is not', !linkIsLive({ disabled: true }))
  check('a missing row is not live', !linkIsLive(null) && !linkIsLive(undefined))
  check('and null is treated as live, not disabled',
    linkIsLive({ disabled: null }),
    'a nullable column defaulting to "off" would silently kill every existing link')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
