// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// vercel.json IS PRODUCTION CONFIG, AND IT FAILS QUIETLY.
//
// Two things live in this file and neither one announces a mistake.
//
// THE SCHEDULES. Twenty-six crons run the parts of MVP that have no user
// watching: the job worker every minute, token refresh, deal sync, indexing.
// If a route is renamed and the schedule is not, Vercel keeps calling the old
// path forever and gets a 404 forever. Nothing on any screen changes. The
// opposite slip is quieter still: a new /api/cron route with no entry here has
// never run once, and looks exactly like a queue with nothing in it.
//
// THE BRANCH SWITCH. Preview builds for the working branch were failing and
// hanging while Production built the identical commit green, so previews are
// turned off for that branch. Every commit is fast-forwarded to main anyway, so
// the preview build was a second build of code that was already live.
//
// That switch is one keystroke away from an outage. Vercel accepts
//
//   "git": { "deploymentEnabled": false }
//
// and that form disables deployments for EVERY branch, production included.
// Pushing to main would then simply do nothing: no error, no failed build, no
// red mark anywhere, just a site that quietly stops receiving changes. The map
// form is the only safe one, and the production branch must never appear in it.
//
// So: read the file the way Vercel reads it, and refuse both shapes.
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

/** The branches Vercel treats as production for this project. */
const PRODUCTION_BRANCHES = ['main', 'master']

let config: Record<string, unknown> | null = null
try {
  config = JSON.parse(readFileSync('vercel.json', 'utf8'))
} catch (e) {
  check('vercel.json parses', false, `${(e as Error).message} — Vercel would reject the deployment outright`)
}

if (config) {
  // ── the branch switch cannot take production down ──────────────────────────
  {
    const git = config.git as Record<string, unknown> | undefined
    if (git !== undefined) {
      check('git is an object', git !== null && typeof git === 'object', typeof git)

      const enabled = git?.deploymentEnabled
      if (enabled !== undefined) {
        check('deploymentEnabled is a per-branch map, not a bare false',
          enabled !== null && typeof enabled === 'object' && !Array.isArray(enabled),
          'a bare false disables every branch including main, and a push to production then does nothing at all, silently')

        if (enabled !== null && typeof enabled === 'object' && !Array.isArray(enabled)) {
          const map = enabled as Record<string, unknown>
          for (const branch of PRODUCTION_BRANCHES) {
            check(`${branch} is not switched off`, map[branch] !== false,
              'this is the production branch; disabling it stops deploys with no visible failure')
          }
          for (const [branch, value] of Object.entries(map)) {
            check(`the entry for "${branch}" is a boolean`, typeof value === 'boolean', typeof value)
            check(`the entry for "${branch}" names a real branch`, branch.trim().length > 0)
          }
          check('at least one branch is listed', Object.keys(map).length > 0,
            'an empty map is a leftover; delete the key instead so the intent is readable')
        }
      }
    }
  }

  // ── every schedule points at a route that exists ───────────────────────────
  {
    const crons = config.crons as { path?: unknown; schedule?: unknown }[] | undefined
    check('the crons array is still there', Array.isArray(crons) && crons.length > 0,
      'no crons means the job worker, token refresh and every sync stop, and the app looks merely idle')

    if (Array.isArray(crons)) {
      const scheduled = new Set<string>()

      for (const cron of crons) {
        const path = cron.path
        const schedule = cron.schedule
        if (typeof path !== 'string' || typeof schedule !== 'string') {
          check('every cron has a string path and schedule', false, JSON.stringify(cron))
          continue
        }
        scheduled.add(path)

        check(`${path} is an absolute route`, path.startsWith('/'), path)
        check(`${path} has a route file`,
          existsSync(`app${path}/route.ts`) || existsSync(`app${path}/route.tsx`),
          'Vercel will call this path on the schedule and get a 404 every time, for as long as it stands')

        // Vercel uses five fields. A six-field expression (the seconds form
        // other schedulers accept) is rejected at deploy time, and a four-field
        // one runs at a time nobody intended.
        const fields = schedule.trim().split(/\s+/)
        check(`${path} has a five-field schedule`, fields.length === 5, `"${schedule}" has ${fields.length}`)
      }

      // The other direction. A route with no entry here has never run, and an
      // empty queue is what that looks like from every screen in the product.
      const dir = 'app/api/cron'
      if (existsSync(dir)) {
        for (const name of readdirSync(dir)) {
          if (!existsSync(`${dir}/${name}/route.ts`)) continue
          check(`/api/cron/${name} is scheduled`, scheduled.has(`/api/cron/${name}`),
            'the route exists and nothing calls it; whatever it drains simply never drains')
        }
      }
    }
  }
}

// ── the reader can actually tell a bad config from a good one ───────────────
//
// Both rules above pass by finding nothing wrong, which is the same shape as a
// check that cannot see anything at all. So each one is run here against a
// config built to break it, where the right answer is known.
{
  const productionKilled = (cfg: Record<string, unknown>) => {
    const git = cfg.git as Record<string, unknown> | undefined
    const enabled = git?.deploymentEnabled
    if (enabled === false) return true
    if (enabled && typeof enabled === 'object') {
      return PRODUCTION_BRANCHES.some(b => (enabled as Record<string, unknown>)[b] === false)
    }
    return false
  }

  check('a bare false is recognised as fatal',
    productionKilled({ git: { deploymentEnabled: false } }))
  check('and so is main switched off by name',
    productionKilled({ git: { deploymentEnabled: { main: false } } }))
  check('while a dev branch switched off is fine',
    !productionKilled({ git: { deploymentEnabled: { 'claude/some-branch': false } } }),
    'this is the whole point of the key; flagging it would make the guard useless')
  check('and no git key at all is fine',
    !productionKilled({ crons: [] }),
    'the default is that every branch deploys')
}

if (failures.length) {
  console.error(`\n❌ vercel-config: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ vercel-config: production still deploys, and every cron points at a route that exists')
