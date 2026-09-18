// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The "Post to" row, once, for all three Quick post modals.
//
// Deal Radar, Walmart and Wayward each had their own copy of this markup and
// their own `new Set(ALL_PLATFORMS)`, which is why all three had the same bug
// and why fixing it in one place would have left two of them broken. The state
// lives in useConnectedPlatforms; this draws it.
//
// WHAT AN UNCONNECTED PLATFORM LOOKS LIKE, and it is the part worth being
// deliberate about. It is dimmed, dashed, labelled "not connected", and still
// clickable. Not hidden, because a creator who cannot find Threads will ask
// where it went. Not disabled, because if the connection check is ever wrong
// about their account, being wrong should cost them one click rather than lock
// them out of a channel that works.

'use client'

export interface PlatformOption { key: string; label: string }

export default function PlatformPicker({
  options, selected, onToggle, known, connected, connectHref = '/connect-socials',
}: {
  options: PlatformOption[]
  selected: Set<string>
  onToggle: (key: string) => void
  /** false while the connection lookup is in flight or after it failed. */
  known: boolean
  connected: Set<string>
  connectHref?: string
}) {
  const nothingConnected = known && options.every((p) => !connected.has(p.key))
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground mb-1.5">Post to</div>
      <div className="flex flex-wrap gap-2">
        {options.map((p) => {
          const off = known && !connected.has(p.key)
          const on = selected.has(p.key)
          return (
            <button key={p.key} onClick={() => onToggle(p.key)}
              title={off ? `${p.label} is not connected yet. Tap to post anyway, or connect it first.` : undefined}
              className={`text-sm rounded-lg border px-3 py-1.5 ${
                on ? 'bg-primary text-primary-foreground border-primary'
                  : off ? 'bg-background border-dashed text-muted-foreground/60' : 'bg-background'
              }`}>
              {p.label}
              {off && !on && <span className="ml-1.5 text-[10px] opacity-70">not connected</span>}
            </button>
          )
        })}
      </div>
      {/* Three states, three different sentences. A lookup that has not landed
          says nothing at all rather than claiming everything is connected. */}
      {nothingConnected ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1.5">
          None of these are connected yet, so nothing is selected.{' '}
          <a href={connectHref} className="underline font-medium">Connect a social</a> and it will tick itself next time.
        </p>
      ) : known ? (
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Only your connected socials are ticked. The dashed ones are not connected yet.
        </p>
      ) : null}
    </div>
  )
}
