'use client'

/**
 * Tells SCOUT which jobs run out of sight (lib/scout-quiet), on every
 * dashboard page and again when admin changes a try on /admin/scout-quiet.
 * Silent. An older SCOUT (before 1.50.2) is left alone: it would not know the
 * message, and its jobs work as they always did.
 */

import { useEffect } from 'react'
import { getScoutStatus, setScoutQuietJobs } from '@/lib/extension-frame'
import { SCOUT_QUIET_MIN_VERSION, scoutAtLeast } from '@/lib/scout-version'
import { QUIET_ANSWER_EVENT, QUIET_CHANGED_EVENT, quietJobsFor, readQuietTries } from '@/lib/scout-quiet'

export default function ScoutQuietSync({ isAdmin }: { isAdmin: boolean }) {
  useEffect(() => {
    let alive = true
    const sync = async () => {
      const s = await getScoutStatus().catch(() => ({ installed: false, version: null as string | null }))
      if (!alive) return
      const asked = quietJobsFor(isAdmin, readQuietTries())
      const ready = s.installed && scoutAtLeast(s.version, SCOUT_QUIET_MIN_VERSION)
      // What SCOUT holds after this, for /admin/scout-quiet to show as it is.
      const held = ready ? await setScoutQuietJobs(asked).catch(() => null) : null
      window.dispatchEvent(new CustomEvent(QUIET_ANSWER_EVENT, { detail: { version: s.version, installed: s.installed, ready, asked, held } }))
    }
    void sync()
    const onChange = () => { void sync() }
    window.addEventListener(QUIET_CHANGED_EVENT, onChange)
    return () => { alive = false; window.removeEventListener(QUIET_CHANGED_EVENT, onChange) }
  }, [isAdmin])
  return null
}
