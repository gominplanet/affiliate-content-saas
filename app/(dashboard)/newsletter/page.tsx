'use client'

/**
 * Newsletter dashboard — Milestone 1.
 *
 * Renders:
 *   * Header strip with subscriber counts (active / pending / unsubscribed)
 *     and the tier cap, so the creator always sees room remaining.
 *   * Enable toggle + sender display-name + (US) mailing address fields,
 *     all auto-saving on blur (no Save button to forget). Mailing address is
 *     CAN-SPAM required for any commercial email — we warn but don't block.
 *   * "Embed on your blog" code block — the [mvp-newsletter] shortcode the
 *     creator pastes into any WordPress page/post. Pre-filled with their
 *     user_id so they don't have to think.
 *   * Subscribers list with import CSV + export CSV + per-row delete (GDPR).
 *
 * Milestone 2 will add a "Sender domain" card (Resend domain verify + DKIM
 * record display) above the embed snippet. Milestone 3 will add a
 * "Compose newsletter" CTA + recent-broadcasts table.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import {
  Loader2, Mail, CheckCircle, AlertCircle, Upload, Download,
  Copy, Trash2, RefreshCw,
} from 'lucide-react'

interface Settings {
  user_id: string
  sender_domain: string | null
  sender_local_part: string | null
  sender_name: string | null
  domain_status: string | null
  enabled: boolean
  mailing_address: string | null
}
interface SubscriberRow {
  id: string
  email: string
  status: string
  source: string | null
  source_url: string | null
  confirmed_at: string | null
  unsubscribed_at: string | null
  created_at: string
}
interface Counts { active: number; pending: number; unsubscribed: number }

export default function NewsletterPage() {
  const [loading, setLoading] = useState(true)
  const [savingField, setSavingField] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [subs, setSubs] = useState<SubscriberRow[]>([])
  const [counts, setCounts] = useState<Counts>({ active: 0, pending: 0, unsubscribed: 0 })
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sRes, lRes] = await Promise.all([
        fetch('/api/newsletter/settings'),
        fetch('/api/newsletter/subscribers'),
      ])
      const sData = await sRes.json()
      const lData = await lRes.json()
      if (!sRes.ok) throw new Error(sData.error || 'Failed to load settings')
      if (!lRes.ok) throw new Error(lData.error || 'Failed to load subscribers')
      setSettings(sData.settings)
      setSubs(lData.subscribers || [])
      setCounts(lData.counts || { active: 0, pending: 0, unsubscribed: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function saveSetting(patch: Partial<Settings>, fieldLabel: string) {
    if (!settings) return
    setSavingField(fieldLabel)
    try {
      const r = await fetch('/api/newsletter/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      setSettings(d.settings)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingField(null)
    }
  }

  async function deleteSubscriber(id: string) {
    if (!confirm('Permanently delete this subscriber? They\'ll lose any subscription state. Use the unsubscribe link in the email if you want them in the "unsubscribed" bucket instead.')) return
    const r = await fetch(`/api/newsletter/subscribers?id=${id}`, { method: 'DELETE' })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setError(d.error || 'Delete failed')
      return
    }
    setSubs(prev => prev.filter(s => s.id !== id))
  }

  async function handleImport(file: File) {
    setImporting(true)
    setImportMsg(null)
    try {
      const csv = await file.text()
      const r = await fetch('/api/newsletter/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      })
      const d = await r.json()
      if (!r.ok) {
        setImportMsg({ ok: false, text: d.error || 'Import failed' })
      } else {
        const parts: string[] = []
        parts.push(`Imported ${d.imported}`)
        if (d.skipped) parts.push(`${d.skipped} already on your list`)
        if (d.overCap) parts.push(`${d.overCap} skipped (tier cap)`)
        if (d.malformed) parts.push(`${d.malformed} malformed`)
        setImportMsg({ ok: true, text: parts.join(' · ') })
        void load()
      }
    } catch (err) {
      setImportMsg({ ok: false, text: err instanceof Error ? err.message : 'Import failed' })
    } finally {
      setImporting(false)
    }
  }

  function copyShortcode() {
    if (!settings) return
    const code = `[mvp-newsletter user="${settings.user_id}"]`
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => { /* ignore */ })
  }

  if (loading) {
    return (
      <>
        <Header title="Newsletter" subtitle="Capture emails on your blog and send curated issues to your list." />
        <div className="flex items-center gap-2 text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      </>
    )
  }

  return (
    <>
      <Header
        title="Newsletter"
        subtitle="Capture emails on your blog, then send curated issues that link back to your reviews."
      />

      {error && (
        <div className="mb-4 card p-3 border-[#ff3b30]/20 bg-[#ff3b30]/5">
          <p className="text-xs text-[#ff3b30] flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Subscriber counts */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-[#0071e3]/10 flex items-center justify-center">
              <Mail size={16} className="text-[#0071e3]" />
            </div>
            <div>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide">Your audience</p>
              <p className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{counts.active.toLocaleString()} subscribers</p>
            </div>
          </div>
          <div className="flex gap-6 text-xs">
            <span className="text-[#34c759]">✓ {counts.active} active</span>
            <span className="text-[#ff9500]">⌛ {counts.pending} pending confirm</span>
            <span className="text-[#86868b] dark:text-[#8e8e93]">⊘ {counts.unsubscribed} unsubscribed</span>
          </div>
        </div>

        {/* Enable toggle */}
        <div className="card p-5">
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] uppercase tracking-wide mb-2">Newsletter status</p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!settings?.enabled}
              onChange={(e) => saveSetting({ enabled: e.target.checked }, 'enabled')}
              disabled={savingField === 'enabled'}
              className="accent-[#0071e3] w-4 h-4"
            />
            <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
              {settings?.enabled ? 'Enabled — accepting signups' : 'Disabled'}
            </span>
            {savingField === 'enabled' && <Loader2 size={12} className="animate-spin text-[#86868b]" />}
          </label>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2 leading-relaxed">
            When off, the embed form returns a polite &quot;not accepting signups&quot; message.
          </p>
        </div>
      </div>

      {/* Brand display name + mailing address */}
      <div className="card p-5 mb-6">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Brand &amp; compliance</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Sender display name</label>
            <input
              type="text"
              defaultValue={settings?.sender_name || ''}
              onBlur={(e) => saveSetting({ sender_name: e.target.value }, 'sender_name')}
              maxLength={120}
              placeholder="e.g. Gomin Reviews"
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">Shows on the From line — e.g. &quot;Gomin Reviews &lt;newsletter@…&gt;&quot;.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Mailing address <span className="text-[#ff9500]">(US CAN-SPAM)</span></label>
            <input
              type="text"
              defaultValue={settings?.mailing_address || ''}
              onBlur={(e) => saveSetting({ mailing_address: e.target.value }, 'mailing_address')}
              maxLength={400}
              placeholder="e.g. 123 Main St, Austin TX 78701"
              className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
            <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">Required by US law in every commercial email. A PO box works.</p>
          </div>
        </div>
      </div>

      {/* Embed snippet */}
      <div className="card p-5 mb-6">
        <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Embed the signup form</p>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3 leading-relaxed">
          Paste this shortcode into any WordPress page or post (the MVP plugin renders the styled form).
          For the form to actually save signups, the toggle above must be on.
        </p>
        <div className="flex items-center gap-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-md px-3 py-2 border border-gray-200 dark:border-white/10">
          <code className="text-xs flex-1 text-[#1d1d1f] dark:text-[#f5f5f7] font-mono overflow-x-auto whitespace-nowrap">
            [mvp-newsletter user=&quot;{settings?.user_id}&quot;]
          </code>
          <button
            onClick={copyShortcode}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:bg-white dark:hover:bg-[#1c1c1e] text-[#0071e3] flex-shrink-0"
          >
            {copied ? <><CheckCircle size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
          </button>
        </div>
      </div>

      {/* Subscribers table */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Subscribers</p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void load()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-200 dark:border-white/10 hover:border-[#0071e3] text-[#3a3a3c] dark:text-[#d2d2d7]"
              title="Refresh the list"
            >
              <RefreshCw size={11} /> Refresh
            </button>
            <a
              href="/api/newsletter/subscribers?format=csv"
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-200 dark:border-white/10 hover:border-[#0071e3] text-[#3a3a3c] dark:text-[#d2d2d7]"
            >
              <Download size={11} /> Export CSV
            </a>
            <label className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border cursor-pointer ${importing ? 'opacity-60 cursor-wait' : 'hover:border-[#0071e3]'}`}
              style={{ borderColor: '#d2d2d7', color: '#1d1d1f', background: 'white' }}>
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleImport(f)
                  e.target.value = ''
                }}
              />
              {importing ? <><Loader2 size={11} className="animate-spin" /> Importing…</> : <><Upload size={11} /> Import CSV</>}
            </label>
          </div>
        </div>

        {importMsg && (
          <div className={`mb-3 text-xs rounded-md px-3 py-2 ${importMsg.ok ? 'bg-[#34c759]/10 text-[#34c759]' : 'bg-[#ff3b30]/10 text-[#ff3b30]'}`}>
            {importMsg.text}
          </div>
        )}

        {subs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-[#86868b] dark:text-[#8e8e93] mb-3">No subscribers yet. Once you paste the shortcode on your blog and someone signs up, they&apos;ll show here.</p>
            <Link href="/setup" className="text-xs text-[#0071e3] hover:underline">Go to Setup → embed the form →</Link>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93] border-b border-gray-200 dark:border-white/10">
                  <th className="font-medium px-5 py-2">Email</th>
                  <th className="font-medium px-3 py-2">Status</th>
                  <th className="font-medium px-3 py-2">Joined</th>
                  <th className="font-medium px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subs.map(s => (
                  <tr key={s.id} className="border-b border-gray-100 dark:border-white/5 hover:bg-[#f5f5f7]/50 dark:hover:bg-white/5">
                    <td className="px-5 py-2 text-[#1d1d1f] dark:text-[#f5f5f7]">{s.email}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-md ${s.status === 'active' ? 'bg-[#34c759]/10 text-[#34c759]' : s.status === 'pending' ? 'bg-[#ff9500]/10 text-[#ff9500]' : 'bg-gray-200 text-[#6e6e73]'}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[#6e6e73] dark:text-[#ebebf0] text-xs">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <button
                        onClick={() => void deleteSubscriber(s.id)}
                        className="text-[#86868b] hover:text-[#ff3b30] transition-colors"
                        title="Permanently delete (GDPR)"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
