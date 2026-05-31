'use client'

/**
 * Admin: Creator Connections catalog manager.
 *
 * Upload the weekly Amazon Creator Connections export .zip. Server-side
 * parser populates the shared catalog table. All users then see the
 * imported campaigns on their /campaigns page without having to upload
 * the zip themselves.
 *
 * Admin-only — the route gates on integrations.tier === 'admin'. This
 * page just throws up a friendly error if a non-admin lands here.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import Header from '@/components/layout/Header'
import { Upload, Loader2, CheckCircle2, AlertCircle, Database, Clock } from 'lucide-react'

interface Stats {
  total: number
  actionable: number
  most_recent_import: string | null
}

export default function CreatorCampaignsAdminPage() {
  const supabase = createBrowserClient()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/creator-campaigns/status')
      const d = await r.json()
      if (r.ok) setStats(d as Stats)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setIsAdmin(false); return }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).single()
        setIsAdmin(data?.tier === 'admin')
        if (data?.tier === 'admin') loadStats()
      } catch { setIsAdmin(false) }
    })()
  }, [supabase, loadStats])

  async function upload(file: File) {
    setUploading(true); setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/admin/creator-campaigns/import', { method: 'POST', body: fd })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Upload failed')
      setResult({
        ok: true,
        message: `Imported ${d.upserted.toLocaleString()} campaigns · ${d.deduped_count.toLocaleString()} unique rows · ${d.stale_deleted ?? 0} stale rows pruned.`,
      })
      await loadStats()
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Upload failed' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (isAdmin === null) {
    return <Header title="Creator Campaigns" subtitle="Loading…" />
  }
  if (!isAdmin) {
    return (
      <>
        <Header title="Creator Campaigns" subtitle="Admin only." />
        <div className="card p-6 text-sm text-[#6e6e73]">
          This page is restricted to admin accounts.
        </div>
      </>
    )
  }

  const lastImport = stats?.most_recent_import
    ? new Date(stats.most_recent_import).toLocaleString()
    : 'Never'

  return (
    <>
      <Header
        title="Creator Campaigns catalog"
        subtitle="Upload the weekly Amazon Creator Connections export here. Every user instantly searches the result on their /campaigns page — no per-user upload."
      />

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center gap-2 text-xs text-[#86868b] mb-1">
            <Database size={14} /> Total in catalog
          </div>
          <div className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {stats?.total?.toLocaleString() ?? '—'}
          </div>
          <div className="text-xs text-[#86868b] mt-1">All imported rows</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-xs text-[#86868b] mb-1">
            <CheckCircle2 size={14} /> Actionable
          </div>
          <div className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {stats?.actionable?.toLocaleString() ?? '—'}
          </div>
          <div className="text-xs text-[#86868b] mt-1">Budget + slots remaining</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-xs text-[#86868b] mb-1">
            <Clock size={14} /> Last refresh
          </div>
          <div className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
            {lastImport}
          </div>
          <div className="text-xs text-[#86868b] mt-1">Most recent import_at</div>
        </div>
      </div>

      {/* Upload card */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
          Upload weekly export
        </h2>
        <ol className="text-xs text-[#6e6e73] dark:text-[#ebebf0] flex flex-col gap-1 list-decimal list-inside mb-4">
          <li>Go to Amazon Creator Connections → click <strong>Download all available campaigns</strong></li>
          <li>Drop the resulting .zip below — server parses every .csv inside and replaces the catalog</li>
          <li>Rows from your previous upload that aren&apos;t in this one get cleaned up automatically</li>
        </ol>

        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          disabled={uploading}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) upload(f)
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn-primary text-sm"
        >
          {uploading
            ? <><Loader2 size={14} className="animate-spin" /> Parsing &amp; importing…</>
            : <><Upload size={14} /> Choose .zip</>}
        </button>

        {result && (
          <div className={`mt-4 flex items-start gap-2 text-sm ${result.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
            {result.ok
              ? <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
              : <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />}
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </>
  )
}
