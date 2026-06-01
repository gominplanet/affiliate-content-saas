'use client'

/**
 * <SitePicker /> — multi-site WordPress dropdown.
 *
 * Renders a dropdown when the user has 2+ connected WordPress sites
 * (Pro tier). Renders NOTHING when the user has 0–1 sites — Creator
 * users and single-site Pro users should never see a UI affordance for
 * picking a site because they don't have a choice.
 *
 * The selected siteId should be threaded through the parent's request
 * body (e.g. body.siteId in /api/blog/generate) so the corresponding
 * route routes to the right WordPress install.
 *
 * USAGE
 * -----
 *   const [siteId, setSiteId] = useState<string | null>(null)
 *   ...
 *   <SitePicker value={siteId} onChange={setSiteId} />
 *   ...
 *   fetch('/api/blog/generate', {
 *     method: 'POST',
 *     body: JSON.stringify({ videoId, siteId }),
 *   })
 *
 * The component handles its own fetch — parents don't pre-load. This
 * keeps callsites a single line and matches the rest of the dashboard
 * (per-component fetches over a centralised store).
 */
import { useEffect, useState } from 'react'

interface Site {
  id: string
  label: string
  url: string
  isDefault: boolean
}

interface Props {
  value: string | null
  onChange: (siteId: string | null) => void
  /** Optional label rendered above the dropdown (e.g. "Publish to"). */
  label?: string
  /** Show even when there's only one site — useful for "where did this go?"
   *  read-only displays. Default false (the common case). */
  alwaysShow?: boolean
  /** Compact (smaller) variant for inline use. Default false. */
  compact?: boolean
  className?: string
}

export function SitePicker({
  value,
  onChange,
  label,
  alwaysShow = false,
  compact = false,
  className = '',
}: Props) {
  const [sites, setSites] = useState<Site[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/wordpress/sites')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((data: { sites?: Site[] }) => {
        if (cancelled) return
        const list = Array.isArray(data?.sites) ? data.sites : []
        setSites(list)
        // Auto-select the default site if no value is set. Parent can override.
        if (!value && list.length > 0) {
          const def = list.find(s => s.isDefault) || list[0]
          onChange(def.id)
        }
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setSites([])
        setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Render nothing while loading (no flash) or for single-site users.
  if (loading) return null
  if (!sites || (sites.length < 2 && !alwaysShow)) return null

  // ── Rendered dropdown ─────────────────────────────────────────────────
  // Dark-mode aware: matches the rest of the dashboard's inputs (white card
  // on light theme, slightly translucent dark slab on dark theme) so the
  // picker doesn't look like an alien element in either palette.
  const inputClasses = compact
    ? 'rounded-md border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 px-2 py-1 text-sm text-gray-900 dark:text-[#f5f5f7] focus:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-600'
    : 'rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-[#f5f5f7] focus:border-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-600'

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className={compact ? 'text-xs text-gray-600 dark:text-[#ebebf0]' : 'text-sm font-medium text-gray-700 dark:text-[#f5f5f7]'}>
          {label}
        </label>
      )}
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputClasses}
      >
        {sites.map(s => (
          <option key={s.id} value={s.id}>
            {s.label} {s.isDefault ? '(default)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

export default SitePicker
