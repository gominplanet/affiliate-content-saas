'use client'

/**
 * ReconnectCheckup — the "please reconnect your accounts" notice, shown once.
 *
 * It exists because the plain version of this notice does not work. "A lot has
 * been upgraded, please reconnect everything" leaves the creator to guess which
 * of their accounts needs anything, gives them no way to tell whether it helped,
 * and sends the people who are already fine to redo work for nothing.
 *
 * So the notice carries their own list: every connection, what state it is
 * actually in, and a link straight to the one that needs redoing. Reconnect and
 * reopen it and the row has changed, which is the part a blanket notice can
 * never do.
 *
 * THREE OUTCOMES, KEPT APART. Something is wrong. Something could not be
 * checked. Everything is current. A checkup that cannot tell the second from the
 * third is the exact failure it was built to catch, so a failed read says "we
 * could not check" and never renders as a clean bill of health.
 *
 * Shown once per browser, keyed to a version so a future round of upgrades can
 * show it again by bumping the constant.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PlugZap, X, ArrowRight, CircleCheck, CircleAlert, CircleHelp } from 'lucide-react'

type CheckupState = 'action' | 'unknown' | 'ok'

interface CheckupItem {
  key: string
  label: string
  state: CheckupState
  detail: string
  href?: string
  actionLabel?: string
}

interface CheckupResponse {
  ok?: boolean
  items?: CheckupItem[]
  summary?: { actions: number; unknowns: number; headline: string }
}

/** Bump to show the notice again after the next round of upgrades. */
const STORAGE_KEY = 'mvp_reconnect_checkup_v1'

const TONE: Record<CheckupState, { color: string; Icon: typeof CircleCheck }> = {
  action: { color: '#dc2626', Icon: CircleAlert },
  unknown: { color: '#f59e0b', Icon: CircleHelp },
  ok: { color: '#16a34a', Icon: CircleCheck },
}

export default function ReconnectCheckup() {
  const [data, setData] = useState<CheckupResponse | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let seen = false
    try { seen = localStorage.getItem(STORAGE_KEY) === '1' } catch { seen = false }
    if (seen) return

    let alive = true
    fetch('/api/connections/checkup')
      .then(r => (r.ok ? r.json() : { ok: false }))
      .then((d: CheckupResponse) => {
        if (!alive) return
        setData(d ?? { ok: false })
        setOpen(true)
      })
      .catch(() => {
        // A failed read is still worth showing, as itself. Staying silent here
        // would be the product deciding on the creator's behalf that there is
        // nothing to see, which is precisely what it does not know.
        if (!alive) return
        setData({ ok: false })
        setOpen(true)
      })
    return () => { alive = false }
  }, [])

  if (!open || !data) return null

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* private mode */ }
    setOpen(false)
  }

  const items = data.items ?? []
  const couldNotCheck = data.ok === false
  const headline = couldNotCheck
    ? 'We could not read your connections just now.'
    : data.summary?.headline ?? ''

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={dismiss}>
      <div
        className="card w-full max-w-lg p-6 bg-white dark:bg-[#18181b] relative max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reconnect-checkup-title"
      >
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#7C3AED]/10">
            <PlugZap size={18} className="text-[#7C3AED]" />
          </div>
          <div className="flex-1 min-w-0 pr-4">
            <p id="reconnect-checkup-title" className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              A quick check on your connections
            </p>
            <p className="text-[13px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
              MVP has had a run of upgrades. A few of them need a fresh connection before they can work on your
              account, because some of what an app is allowed to do is fixed at the moment you connect it. A
              connection made before an upgrade keeps working, it just quietly runs without the new part.
            </p>
            <p className="text-[13px] font-medium mt-2 text-[#1d1d1f] dark:text-[#f5f5f7]">{headline}</p>
          </div>
        </div>

        {couldNotCheck ? (
          <p className="mt-4 text-[13px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
            Nothing is necessarily wrong. We simply could not reach your settings to look. If anything has been
            publishing oddly, reconnecting the account it publishes to is the fix worth trying first.
          </p>
        ) : items.length > 0 ? (
          <ul className="mt-4 space-y-2.5">
            {items.map(item => {
              const tone = TONE[item.state] ?? TONE.unknown
              const Icon = tone.Icon
              return (
                <li
                  key={item.key}
                  className="flex items-start gap-2.5 rounded-lg p-3"
                  style={{ backgroundColor: `${tone.color}0d` }}
                >
                  <Icon size={15} style={{ color: tone.color }} className="flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{item.label}</p>
                    <p className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mt-0.5">
                      {item.detail}
                    </p>
                    {item.href && item.actionLabel && (
                      <Link
                        href={item.href}
                        onClick={dismiss}
                        className="inline-flex items-center gap-1 text-[12px] font-semibold mt-1.5"
                        style={{ color: tone.color }}
                      >
                        {item.actionLabel} <ArrowRight size={11} />
                      </Link>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            onClick={dismiss}
            className="px-3 py-2 rounded-lg text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] hover:bg-black/[0.03] dark:hover:bg-white/5"
          >
            Got it
          </button>
          <Link
            href="/connect-socials"
            onClick={dismiss}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9]"
          >
            Manage connections <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </div>
  )
}
