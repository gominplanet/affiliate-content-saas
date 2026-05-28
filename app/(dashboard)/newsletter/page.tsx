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
  Copy, Trash2, RefreshCw, ShieldCheck, Globe,
} from 'lucide-react'

interface DkimRecord {
  record: string
  type: string
  name: string
  value: string
  priority?: number
  ttl?: string
  status?: string
}
interface Settings {
  user_id: string
  sender_domain: string | null
  sender_local_part: string | null
  sender_name: string | null
  domain_status: string | null
  domain_checked_at?: string | null
  dkim_records?: DkimRecord[] | null
  enabled: boolean
  mailing_address: string | null
  resend_domain_id?: string | null
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
  // Sender-domain card state (Milestone 2)
  const [domainInput, setDomainInput] = useState('')
  const [domainBusy, setDomainBusy] = useState<'add' | 'verify' | 'remove' | null>(null)
  const [domainMsg, setDomainMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Per-record copy feedback — keyed by `${type}:${name}` so each "Copy"
  // button can flash its own "Copied!" independently.
  const [copiedRecord, setCopiedRecord] = useState<string | null>(null)

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

  // ── Sender-domain handlers (Milestone 2) ────────────────────────────────
  async function addDomain() {
    const raw = domainInput.trim().toLowerCase()
    if (!raw) { setDomainMsg({ ok: false, text: 'Enter a domain first.' }); return }
    setDomainBusy('add')
    setDomainMsg(null)
    try {
      const r = await fetch('/api/newsletter/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: raw }),
      })
      const d = await r.json()
      if (!r.ok) {
        setDomainMsg({ ok: false, text: d.error || 'Failed to register domain.' })
      } else {
        setSettings(d.settings)
        setDomainInput('')
        setDomainMsg({ ok: true, text: 'Domain added. Now paste the DNS records below into your DNS host, then click Verify.' })
      }
    } catch (e) {
      setDomainMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to register domain.' })
    } finally {
      setDomainBusy(null)
    }
  }

  async function verifyDomain() {
    setDomainBusy('verify')
    setDomainMsg(null)
    try {
      const r = await fetch('/api/newsletter/domain', { method: 'GET' })
      const d = await r.json()
      if (!r.ok) {
        setDomainMsg({ ok: false, text: d.error || 'Verification failed.' })
      } else {
        setSettings(d.settings)
        const s = d.settings?.domain_status
        if (s === 'verified') setDomainMsg({ ok: true, text: 'Verified! Your newsletter will now send from your own domain.' })
        else if (s === 'failed') setDomainMsg({ ok: false, text: "Records didn't match. Double-check the DNS values below and give it a few more minutes — DNS can take up to an hour to propagate." })
        else setDomainMsg({ ok: true, text: 'Still pending — DNS propagation usually finishes within an hour. Try again shortly.' })
      }
    } catch (e) {
      setDomainMsg({ ok: false, text: e instanceof Error ? e.message : 'Verification failed.' })
    } finally {
      setDomainBusy(null)
    }
  }

  async function removeDomain() {
    if (!confirm('Remove the sender domain? You\'ll need to add and verify a domain again before you can send newsletters from your own address.')) return
    setDomainBusy('remove')
    setDomainMsg(null)
    try {
      const r = await fetch('/api/newsletter/domain', { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setDomainMsg({ ok: false, text: d.error || 'Removal failed.' })
      } else {
        await load()
        setDomainMsg({ ok: true, text: 'Domain removed.' })
      }
    } catch (e) {
      setDomainMsg({ ok: false, text: e instanceof Error ? e.message : 'Removal failed.' })
    } finally {
      setDomainBusy(null)
    }
  }

  function copyRecord(key: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedRecord(key)
      setTimeout(() => setCopiedRecord(null), 1800)
    }).catch(() => { /* ignore */ })
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

      {/* Sender domain — Milestone 2.
          Three visual states:
          (a) No domain set → empty input + "Add" button + explainer
          (b) Domain set, status pending/failed → show the DNS records to
              paste, a "Verify" button, a status badge, and the remove option
          (c) Verified → green badge + the from-address + remove option */}
      <div className="card p-5 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Globe size={14} className="text-[#0071e3]" />
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Sender domain</p>
          {settings?.sender_domain && settings.domain_status === 'verified' && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-[#34c759]/10 text-[#34c759]">
              <ShieldCheck size={11} /> Verified
            </span>
          )}
          {settings?.sender_domain && settings.domain_status === 'pending' && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-[#ff9500]/10 text-[#ff9500]">
              Pending
            </span>
          )}
          {settings?.sender_domain && settings.domain_status === 'failed' && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-[#ff3b30]/10 text-[#ff3b30]">
              <AlertCircle size={11} /> Records not found
            </span>
          )}
        </div>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-3 leading-relaxed">
          Send newsletters from your own domain (e.g. <code className="font-mono text-[11px]">newsletter@mail.yourdomain.com</code>) so subscribers recognise the sender and inboxes trust the email. Until verified, MVP sends from a shared address.
        </p>

        {/* State (a): no domain set yet → input + add button */}
        {!settings?.sender_domain && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-[11px] font-medium text-[#3a3a3c] dark:text-[#d2d2d7] mb-1">Pick a sender subdomain</label>
              <input
                type="text"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="mail.yourdomain.com"
                disabled={domainBusy === 'add'}
                className="w-full text-sm px-3 py-2 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-1">A subdomain like <code className="font-mono">mail.</code> is recommended — it keeps your root domain&apos;s reputation isolated.</p>
            </div>
            <button
              onClick={() => void addDomain()}
              disabled={domainBusy === 'add' || !domainInput.trim()}
              className="px-3 py-2 rounded-md text-xs font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50 transition-colors"
            >
              {domainBusy === 'add' ? <><Loader2 size={11} className="animate-spin inline mr-1" /> Adding…</> : 'Add domain'}
            </button>
          </div>
        )}

        {/* State (b)+(c): domain is set → show records (always, in case the
            user wants to copy again) + verify + remove */}
        {settings?.sender_domain && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <code className="text-sm font-mono text-[#1d1d1f] dark:text-[#f5f5f7] px-2 py-1 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-md">
                newsletter@{settings.sender_domain}
              </code>
              {settings.domain_status !== 'verified' && (
                <button
                  onClick={() => void verifyDomain()}
                  disabled={domainBusy === 'verify'}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] disabled:opacity-50 transition-colors"
                >
                  {domainBusy === 'verify' ? <><Loader2 size={11} className="animate-spin inline mr-1" /> Checking…</> : <>Verify</>}
                </button>
              )}
              <button
                onClick={() => void removeDomain()}
                disabled={domainBusy === 'remove'}
                className="px-2 py-1 rounded-md text-[11px] font-medium text-[#86868b] hover:text-[#ff3b30] transition-colors"
              >
                {domainBusy === 'remove' ? 'Removing…' : 'Remove'}
              </button>
            </div>

            {/* DNS records — only show until verified */}
            {settings.domain_status !== 'verified' && Array.isArray(settings.dkim_records) && settings.dkim_records.length > 0 && (
              <div className="mt-3 border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-[#f5f5f7] dark:bg-[#1c1c1e] border-b border-gray-200 dark:border-white/10">
                  <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Add these {settings.dkim_records.length} DNS records to your domain</p>
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-0.5 leading-relaxed">
                    In your DNS host (Hostinger / Cloudflare / Namecheap), add each row exactly. If the Name column already appends your root domain, paste just the prefix part shown here.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-[#86868b] dark:text-[#8e8e93] border-b border-gray-200 dark:border-white/10">
                        <th className="font-medium px-3 py-2">Type</th>
                        <th className="font-medium px-3 py-2">Name</th>
                        <th className="font-medium px-3 py-2">Value</th>
                        <th className="font-medium px-3 py-2">TTL</th>
                        <th className="font-medium px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {settings.dkim_records.map((r, i) => {
                        const key = `${r.type}:${r.name}:${i}`
                        return (
                          <tr key={key} className="border-b border-gray-100 dark:border-white/5">
                            <td className="px-3 py-2 font-mono text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {r.type}
                              {r.type === 'MX' && r.priority != null && <span className="text-[#86868b]"> (prio {r.priority})</span>}
                            </td>
                            <td className="px-3 py-2 font-mono text-[#1d1d1f] dark:text-[#f5f5f7] break-all">{r.name}</td>
                            <td className="px-3 py-2 font-mono text-[#1d1d1f] dark:text-[#f5f5f7] break-all max-w-[280px]">{r.value}</td>
                            <td className="px-3 py-2 text-[#86868b] dark:text-[#8e8e93]">{r.ttl || 'Auto'}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <button
                                onClick={() => copyRecord(key, r.value)}
                                className="inline-flex items-center gap-1 text-[11px] text-[#0071e3] hover:underline"
                              >
                                {copiedRecord === key ? <><CheckCircle size={11} /> Copied</> : <><Copy size={11} /> Copy value</>}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-3 py-2 bg-[#f5f5f7] dark:bg-[#1c1c1e] border-t border-gray-200 dark:border-white/10">
                  <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                    DNS can take a few minutes to an hour to propagate. Add the records, then come back and hit Verify.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {domainMsg && (
          <div className={`mt-3 text-xs rounded-md px-3 py-2 ${domainMsg.ok ? 'bg-[#34c759]/10 text-[#34c759]' : 'bg-[#ff3b30]/10 text-[#ff3b30]'}`}>
            {domainMsg.text}
          </div>
        )}
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
