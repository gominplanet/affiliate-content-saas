/**
 * /admin/template-performance — usage histogram for the 10 designer text
 * templates so we can see what users are actually getting and prune the
 * pool over time.
 *
 * Data source: ai_usage rows where feature = 'yt_thumb_designer_overlay'.
 * The thumbnail orchestrator records one row per variant with the chosen
 * template baked into `model` ("designer-text:<template-id>"). No new
 * migration needed — we're just summarising existing telemetry.
 *
 * Admin-only. Future: when the YouTube Studio analytics integration is
 * wired, join template_id → published video CTR to surface which
 * templates actually drive clicks (vs. which ones the picker just happens
 * to pick most often).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { TEMPLATES } from '@/lib/thumbnail-text-templates'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface TemplateStat {
  id: string
  label: string
  whenToUse: string
  count: number
  lastUsed: string | null
  uniqueUsers: number
}

async function loadStats(): Promise<{ stats: TemplateStat[]; totalRenders: number; sampleWindow: string }> {
  const admin = createAdminClient()
  // Look at the last 30 days — enough signal without noise from a long-
  // ago snapshot of the template set.
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (admin as any)
    .from('ai_usage')
    .select('model, user_id, created_at')
    .eq('feature', 'yt_thumb_designer_overlay')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000)

  // Build per-template stats.
  const byTemplate = new Map<string, { count: number; users: Set<string>; lastUsed: string | null }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (rows ?? []) as Array<{ model: string; user_id: string; created_at: string }>) {
    // model is "designer-text:<template-id>" — strip the prefix.
    const templateId = (row.model || '').replace(/^designer-text:/, '').trim()
    if (!templateId) continue
    let bucket = byTemplate.get(templateId)
    if (!bucket) {
      bucket = { count: 0, users: new Set(), lastUsed: null }
      byTemplate.set(templateId, bucket)
    }
    bucket.count += 1
    if (row.user_id) bucket.users.add(row.user_id)
    if (!bucket.lastUsed || row.created_at > bucket.lastUsed) bucket.lastUsed = row.created_at
  }

  // Join against the template registry so templates that have NEVER been
  // picked still appear (with count=0) — important signal for pruning.
  const stats: TemplateStat[] = TEMPLATES.map(t => {
    const bucket = byTemplate.get(t.id)
    return {
      id: t.id,
      label: t.label,
      whenToUse: t.whenToUse,
      count: bucket?.count ?? 0,
      lastUsed: bucket?.lastUsed ?? null,
      uniqueUsers: bucket?.users.size ?? 0,
    }
  }).sort((a, b) => b.count - a.count)

  const totalRenders = stats.reduce((sum, s) => sum + s.count, 0)
  return { stats, totalRenders, sampleWindow: '30 days' }
}

export default async function TemplatePerformancePage() {
  // Admin gate — match the existing /admin/* pattern.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') redirect('/dashboard')

  const { stats, totalRenders, sampleWindow } = await loadStats()
  const max = stats[0]?.count ?? 0

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Template Performance</h1>
        <p className="text-sm text-gray-500 mt-1">
          Designer text overlay usage over the last <b>{sampleWindow}</b>. {totalRenders.toLocaleString()} total
          renders across {stats.filter(s => s.count > 0).length} active templates ({stats.filter(s => s.count === 0).length} unused).
        </p>
      </div>

      {totalRenders === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50">
          <p className="text-sm text-gray-600 mb-2">No template renders in the last {sampleWindow}.</p>
          <p className="text-xs text-gray-500">
            Telemetry kicks in when users generate thumbnails via the YouTube Co-Pilot on the
            wantClean path. Visit <Link href="/admin/designer-text" className="text-[#7C3AED] hover:underline">/admin/designer-text</Link> to
            exercise the system manually.
          </p>
        </div>
      ) : (
        <div className="border rounded-xl divide-y">
          {stats.map(s => {
            const pct = max > 0 ? Math.round((s.count / max) * 100) : 0
            const share = totalRenders > 0 ? Math.round((s.count / totalRenders) * 100) : 0
            return (
              <div key={s.id} className="p-4">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">{s.label}</div>
                    <code className="text-xs text-gray-500">{s.id}</code>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-sm font-semibold">{s.count.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">{share}% · {s.uniqueUsers} users</div>
                  </div>
                </div>
                {/* Histogram bar — width is THIS row's % of the leader. */}
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      background: s.count === 0 ? '#e5e5e5' : '#7C3AED',
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500 line-clamp-1 flex-1">{s.whenToUse}</p>
                  {s.lastUsed && (
                    <span className="text-xs text-gray-400 shrink-0">
                      last {new Date(s.lastUsed).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
        <b>Reading this:</b> A template at the top is the picker's favourite (or just well-suited to common
        headlines). A template at the bottom — especially with 0 renders — is a candidate for removal from
        the random pool. Once Studio analytics are wired, we'll layer a CTR column to surface which
        templates actually drive clicks, not just which ones get picked.
      </div>
    </div>
  )
}
