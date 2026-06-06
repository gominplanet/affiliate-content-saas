// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// MigrationDriftBanner — sticky admin-only banner that warns when one of
// the recent feature-gating migrations hasn't been applied on the live
// database. Renders nothing for non-admin users (the /api/admin/migration-
// check route returns { notAdmin: true } in that case).
//
// Why: migration 103/104 issues took multiple bug reports to root-cause
// because nothing surfaced "your DB doesn't have the new columns yet."
// Now the very first page load tells the admin exactly what to do.
'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, X, Copy, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

interface Missing { id: string; what: string; sql: string }

export default function MigrationDriftBanner() {
  const [missing, setMissing] = useState<Missing[] | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      return new Set(JSON.parse(localStorage.getItem('mvp_migration_dismissed') || '[]'))
    } catch { return new Set() }
  })
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/admin/migration-check')
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setMissing(Array.isArray(json.missing) ? json.missing : [])
      } catch { /* non-fatal */ }
    })()
    return () => { cancelled = true }
  }, [])

  function dismiss(id: string) {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    try { localStorage.setItem('mvp_migration_dismissed', JSON.stringify([...next])) } catch { /* ignore */ }
  }

  async function copySql(sql: string) {
    try {
      await navigator.clipboard.writeText(sql)
      toast.success('SQL copied — paste in Supabase SQL Editor')
    } catch {
      toast.error('Copy failed — select the SQL and copy manually')
    }
  }

  const visible = (missing ?? []).filter(m => !dismissed.has(m.id))
  if (visible.length === 0) return null

  return (
    <div className="bg-[#ff3b30]/10 border-b border-[#ff3b30]/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        {visible.map((m) => (
          <div key={m.id} className="mb-2 last:mb-0">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="text-[#ff3b30] flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#ff3b30]">
                  Migration {m.id} not applied — {m.what}
                </p>
                <button
                  onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                  className="mt-1 text-[11px] text-[#ff3b30] underline decoration-dotted underline-offset-2 inline-flex items-center gap-1"
                >
                  {expanded === m.id ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {expanded === m.id ? 'Hide SQL' : 'Show SQL to run in Supabase'}
                </button>
                {expanded === m.id && (
                  <div className="mt-2">
                    <pre className="text-[10px] font-mono bg-black/80 text-[#7CFFAE] p-3 rounded-lg overflow-x-auto max-h-64">
{m.sql}
                    </pre>
                    <button
                      onClick={() => copySql(m.sql)}
                      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded bg-[#ff3b30] text-white hover:bg-[#d63027] transition-colors"
                    >
                      <Copy size={11} /> Copy SQL
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => dismiss(m.id)}
                className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
                title="Dismiss until next reload"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
