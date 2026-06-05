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
import PageHero from '@/components/layout/PageHero'
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
        const { data } = await supabase.from('integrations').select('tier').eq('user_id', user.id).single()
        setIsAdmin(data?.tier === 'admin')
        if (data?.tier === 'admin') loadStats()
      } catch { setIsAdmin(false) }
    })()
  }, [supabase, loadStats])

  async function upload(file: File) {
    setUploading(true); setResult(null)
    try {
      // Vercel caps multipart-body POSTs at ~4.5 MB. Amazon's weekly export
      // is bigger than that, so upload to Supabase Storage first (no size
      // limit), then hand the API the public URL to fetch + parse.
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')
      const path = `${user.id}/creator-campaigns-imports/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.zip`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (supabase.storage as any)
        .from('admin-uploads')
        .upload(path, file, {
          cacheControl: '60',
          upsert: false,
          contentType: 'application/zip',
        })
      if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`)
      // Signed URL instead of public URL so this works even when the
      // bucket is private (which it is by default on new Supabase
      // projects). 10-minute TTL is plenty — the server downloads the
      // zip immediately on the next fetch call. Falls back to the
      // public URL if signing isn't allowed for some reason.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: signed, error: signErr } = await (supabase.storage as any)
        .from('admin-uploads')
        .createSignedUrl(path, 600)
      let upstreamUrl: string | null = signed?.signedUrl ?? null
      if (!upstreamUrl) {
        const { data: urlData } = supabase.storage.from('admin-uploads').getPublicUrl(path)
        upstreamUrl = urlData.publicUrl
      }
      if (!upstreamUrl) {
        throw new Error(`Could not get a download URL for the uploaded zip${signErr ? `: ${signErr.message}` : ''}`)
      }

      const r = await fetch('/api/admin/creator-campaigns/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upstreamUrl }),
      })
      // Read as text first so we can surface the real error even when
      // Vercel returns a non-JSON error page (function timeout, memory
      // overflow, uncaught throw before our outer catch). Without this,
      // the user just saw "Unexpected token 'A', 'An error o'..." which
      // is the client's JSON.parse choking on Vercel's HTML/text body.
      const raw = await r.text()
      let d: { error?: string; upserted?: number; deduped_count?: number; stale_deleted?: number }
      try {
        d = JSON.parse(raw)
      } catch {
        // Trim Vercel's verbose error page down to the first useful line.
        const snippet = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
        throw new Error(
          r.ok
            ? `Server returned a non-JSON response: ${snippet}`
            : `Server error ${r.status}: ${snippet || 'no response body'}. The function likely timed out (Amazon's export can exceed Vercel's per-function ceiling) or ran out of memory.`,
        )
      }
      if (!r.ok) throw new Error(d.error || `Import failed (${r.status})`)
      setResult({
        ok: true,
        message: `Imported ${(d.upserted ?? 0).toLocaleString()} campaigns · ${(d.deduped_count ?? 0).toLocaleString()} unique rows · ${d.stale_deleted ?? 0} stale rows pruned.`,
      })
      await loadStats()

      // Clean up the temporary zip from Storage — we have the parsed data
      // in the catalog table now, no need to retain the source.
      try {
        await supabase.storage.from('admin-uploads').remove([path])
      } catch { /* non-fatal */ }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Upload failed' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (isAdmin === null) {
    return <PageHero title="Creator Campaigns" subtitle="Loading…" />
  }
  if (!isAdmin) {
    return (
      <>
        <PageHero title="Creator Campaigns" subtitle="Admin only." />
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
      <PageHero
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
