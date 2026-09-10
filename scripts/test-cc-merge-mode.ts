// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The catalogue merge must not delete campaigns nobody asked it to delete.
//
// Amazon's Creator Connections dashboard reported 928,250 campaigns. The export
// it produced, re-downloaded to rule out a truncated transfer, held 379,181 of
// them. The merge's purge deletes every catalogue row absent from the upload, so
// running it against that export would have removed 539,567 rows. 514,994 of
// those (95.4%) were still inside their own run dates, and every removed row
// loses its Keepa enrichment permanently.
//
// So add-only exists, and these tests pin the two things that make it worth
// having: the destructive mode requires an explicit choice, and a finished merge
// says on screen which of the two actually ran.
import { ccMergeMode, ccShouldPurge, ccNeedsPurgeGuards, describeCcMergeOutcome } from '../lib/cc-merge-mode'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── reading the mode ────────────────────────────────────────────────────────
{
  check('addOnly: true is add-only', ccMergeMode(true) === 'add-only')
  check('addOnly: false is a full replace', ccMergeMode(false) === 'replace',
    'unticking the box has to still work, or the destructive mode is unreachable')

  // The whole safety argument rests on this one. SCOUT's auto-load arms the
  // background drain with { mode: 'background' } and no addOnly field, then
  // walks away. If an absent field meant replace, the unattended path would be
  // the destructive one.
  check('a caller that says nothing gets add-only', ccMergeMode(undefined) === 'add-only')
  check('null is add-only', ccMergeMode(null) === 'add-only')
  check('a typo is add-only, not replace', ccMergeMode('add_onlyy') === 'add-only',
    'a misspelled field must cost a stale row, never a deletion')

  // The mode round-trips through system_flags as a string.
  check('the stored string round-trips', ccMergeMode('replace') === 'replace' && ccMergeMode('add-only') === 'add-only')
}

// ── what each mode does ─────────────────────────────────────────────────────
{
  check('replace purges', ccShouldPurge('replace'))
  check('add-only never purges', !ccShouldPurge('add-only'))

  // Both pre-merge guards (staging much smaller than live, staged ids barely
  // overlapping) exist only to warn about the purge. Asking "remove ~539,567
  // campaigns?" when the answer is zero teaches the admin to click through.
  check('the purge guards run for replace', ccNeedsPurgeGuards('replace'))
  check('the purge guards are skipped for add-only', !ccNeedsPurgeGuards('add-only'))
}

// ── reporting what happened, not what was planned ───────────────────────────
{
  const skipped = describeCcMergeOutcome({ mode: 'add-only', upserted: 379181, purged: 0 })
  const swept = describeCcMergeOutcome({ mode: 'replace', upserted: 379181, purged: 0 })

  // These two used to render identically as "purged 0", so an admin who ticked
  // add-only had no way to see on screen that the tick had taken effect.
  check('"nothing was removed" reads differently from "nothing to remove"', skipped !== swept)
  check('add-only says nothing was removed', /nothing was removed/i.test(skipped), skipped)
  check('add-only names the reason', /add-only/i.test(skipped), skipped)
  check('a clean replace says the sweep ran', /sweep ran/i.test(swept), swept)

  const removed = describeCcMergeOutcome({ mode: 'replace', upserted: 379181, purged: 539567 })
  check('a replace reports the count it deleted', removed.includes('539,567'), removed)
  check('the upsert count is reported in every mode',
    skipped.includes('379,181') && swept.includes('379,181') && removed.includes('379,181'))

  // Negative / NaN counts come from a chunk that failed mid-flight. They must
  // not render as "-1" or "NaN" in a sentence an admin reads to decide whether
  // the import worked.
  check('a broken count never renders as NaN',
    !/NaN|-\d/.test(describeCcMergeOutcome({ mode: 'replace', upserted: Number('x'), purged: -3 })))
}

// ── house style ─────────────────────────────────────────────────────────────
{
  const all = [
    describeCcMergeOutcome({ mode: 'add-only', upserted: 10, purged: 0 }),
    describeCcMergeOutcome({ mode: 'replace', upserted: 10, purged: 0 }),
    describeCcMergeOutcome({ mode: 'replace', upserted: 10, purged: 5 }),
  ]
  for (const s of all) {
    check('no em-dash or en-dash in admin-facing copy', !/[—–]/.test(s), s)
    check('no spaced-hyphen sentence break', !/ - /.test(s), s)
  }
}

if (failures.length) {
  console.error(`\n❌ cc-merge-mode: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ cc-merge-mode: add-only is the default, replace is an explicit choice, and the result says which ran')
