/**
 * Multi-site WordPress manager — slots into the existing /setup → WordPress
 * section once the user has at least one site connected. Shows the connected
 * site(s), per-row actions (rename, set as default, disconnect), and an
 * "+ Add another site" button gated to Pro.
 *
 * Backed by /api/wordpress/sites (list + create) and
 * /api/wordpress/sites/[id] (rename / set-default / disconnect).
 *
 * PHASE 2 LIMITATION: this component lets a Pro user add up to 5 sites to
 * the wordpress_sites table, but the rest of the app (blog/generate,
 * publish-to-WP, customize, etc.) still reads from the legacy
 * integrations.wordpress_* columns. Phase 3 migrates every route. Until
 * then we surface a small banner so multi-site Pros don't think a
 * non-default site will receive publishes yet.
 */

'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Plus, Loader2, Star, Pencil, Trash2, ExternalLink, Globe,
  Check, X, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Tier } from '@/lib/tier'

interface Site {
  id: string
  label: string
  url: string
  username: string
  appPassword: string  // not displayed; here for type completeness
  apiToken: string | null
  isDefault: boolean
}

interface SitesPayload {
  sites: Site[]
  cap: { current: number; max: number; canAddMore: boolean }
  tier: Tier
}

export default function WordPressSitesManager() {
  const [data, setData] = useState<SitesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/wordpress/sites')
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 size={16} className="animate-spin text-[#86868b]" />
      </div>
    )
  }

  // No sites yet — let the existing single-site connect flow handle it.
  // This component only renders for users with at least one connected site.
  if (!data || data.sites.length === 0) return null

  const isPro = data.tier === 'pro' || data.tier === 'admin'
  const showAddCTA = isPro || data.sites.length < data.cap.max

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            Connected WordPress sites
          </p>
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-0.5">
            {data.cap.current} of {data.cap.max} site{data.cap.max === 1 ? '' : 's'} connected
            {!isPro && data.cap.max === 1 && ' · Upgrade to Pro for up to 5 sites'}
          </p>
        </div>
        {showAddCTA && data.cap.canAddMore && (
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={12} />}
            onClick={() => setAddOpen(true)}
          >
            Add another site
          </Button>
        )}
        {!data.cap.canAddMore && isPro && (
          <span className="text-xs text-[#86868b]">
            Pro limit reached (5 sites). Remove one to add another.
          </span>
        )}
      </div>

      {/* How routing works — informational banner for multi-site users.
          The publish pipeline is fully per-site as of Phase 3.1: rewrites
          stay on the post's original site automatically; fresh generations
          go to whichever site is marked DEFAULT below; Compare & Guides
          has an explicit "Publish to" picker. */}
      {data.sites.length > 1 && (
        <div className="rounded-xl bg-[#7C3AED]/10 border border-[#7C3AED]/30 p-3 mb-4 flex items-start gap-2">
          <AlertCircle size={14} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#3a3a3c] dark:text-[#ebebf0] leading-relaxed">
            <strong>How routing works:</strong> rewriting an existing post stays on its
            original site. Fresh generations publish to the site marked <strong>default</strong>
            {' '}below — change the default with the star button. Compare & Guides has its
            own &ldquo;Publish to&rdquo; picker.
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {data.sites.map(site => (
          <SiteRow
            key={site.id}
            site={site}
            isRenaming={renamingId === site.id}
            onStartRename={() => setRenamingId(site.id)}
            onCancelRename={() => setRenamingId(null)}
            onRenamed={async () => { setRenamingId(null); await load() }}
            onSetDefault={async () => {
              const res = await fetch(`/api/wordpress/sites/${site.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ makeDefault: true }),
              })
              if (res.ok) {
                toast.success(`${site.label} is now your default site.`)
                await load()
              } else {
                const j = await res.json().catch(() => ({}))
                toast.error(j.error || 'Could not change default site.')
              }
            }}
            onDelete={async () => {
              if (!confirm(`Disconnect ${site.label}? Posts published to this site stay live on WordPress, but you won't be able to publish or refresh them from MVP anymore.`)) return
              const res = await fetch(`/api/wordpress/sites/${site.id}`, { method: 'DELETE' })
              if (res.ok) {
                toast.success(`${site.label} disconnected.`)
                await load()
              } else {
                const j = await res.json().catch(() => ({}))
                toast.error(j.error || 'Could not disconnect site.')
              }
            }}
          />
        ))}
      </ul>

      {addOpen && (
        <AddSiteModal
          onClose={() => setAddOpen(false)}
          onAdded={async () => { setAddOpen(false); await load() }}
        />
      )}
    </div>
  )
}

// ─── Per-row renderer (incl. inline rename) ─────────────────────────────────

function SiteRow({
  site, isRenaming, onStartRename, onCancelRename, onRenamed,
  onSetDefault, onDelete,
}: {
  site: Site
  isRenaming: boolean
  onStartRename: () => void
  onCancelRename: () => void
  onRenamed: () => void
  onSetDefault: () => void
  onDelete: () => void
}) {
  const [label, setLabel] = useState(site.label)
  const [saving, setSaving] = useState(false)

  async function save() {
    const trimmed = label.trim()
    if (!trimmed) { toast.error('Label cannot be empty.'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/wordpress/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      })
      if (res.ok) {
        toast.success('Site renamed.')
        onRenamed()
      } else {
        const j = await res.json().catch(() => ({}))
        toast.error(j.error || 'Rename failed.')
      }
    } finally { setSaving(false) }
  }

  return (
    <li className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface)] border border-[var(--border-2)]">
      <div className="w-8 h-8 rounded-lg bg-[#7C3AED]/10 flex items-center justify-center flex-shrink-0">
        <Globe size={14} className="text-[#7C3AED]" />
      </div>
      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') onCancelRename()
              }}
              maxLength={60}
              className="input-field h-7 px-2 text-sm flex-1"
              placeholder="Site label"
            />
            <Button variant="primary" size="sm" onClick={save} loading={saving} aria-label="Save">
              <Check size={12} />
            </Button>
            <Button variant="secondary" size="sm" onClick={onCancelRename} aria-label="Cancel">
              <X size={12} />
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                {site.label}
              </p>
              {site.isDefault && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-[#7C3AED]/15 text-[#7C3AED]">
                  <Star size={9} /> Default
                </span>
              )}
            </div>
            <a
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#86868b] hover:text-[#7C3AED] inline-flex items-center gap-1"
            >
              {site.url.replace(/^https?:\/\//, '')} <ExternalLink size={10} />
            </a>
          </>
        )}
      </div>

      {!isRenaming && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {!site.isDefault && (
            <Button variant="ghost" size="sm" onClick={onSetDefault} title="Set as default">
              <Star size={12} />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onStartRename} title="Rename">
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            title="Disconnect this site"
            className="text-[#86868b] hover:text-[#ff3b30]"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      )}
    </li>
  )
}

// ─── "Add another site" modal ─────────────────────────────────────────────

function AddSiteModal({
  onClose, onAdded,
}: {
  onClose: () => void
  onAdded: () => void
}) {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!url || !username || !appPassword) {
      toast.error('Fill out URL, username, and application password.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/wordpress/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          url: url.trim(),
          username: username.trim(),
          appPassword: appPassword.trim(),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`${label || 'Site'} connected.`)
        onAdded()
      } else if (res.status === 402) {
        toast.error(j.error || 'Pro plan required to connect additional sites.')
      } else {
        toast.error(j.error || 'Could not connect site.')
      }
    } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="card p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Add another WordPress site</p>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-4 leading-relaxed">
          Generate an Application Password in your site&apos;s <code className="px-1 py-0.5 rounded bg-[var(--surface-2)] text-[10px]">wp-admin → Users → Profile → Application Passwords</code>, then paste it here.
        </p>

        <div className="flex flex-col gap-3">
          <Field
            label="Label"
            placeholder="e.g. Wine Reviews"
            value={label}
            onChange={setLabel}
            hint="Just for you — shown in the site picker."
          />
          <Field
            label="Site URL"
            placeholder="https://your-site.com"
            value={url}
            onChange={setUrl}
            hint="Full URL with https://. No trailing slash."
          />
          <Field
            label="WordPress username"
            placeholder="admin"
            value={username}
            onChange={setUsername}
          />
          <Field
            label="Application password"
            placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
            value={appPassword}
            onChange={setAppPassword}
            hint="The 24-character password WordPress shows you ONCE. Spaces are stripped automatically."
            type="password"
          />
        </div>

        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[var(--border-2)]">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={submitting}>Connect site</Button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, hint, type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  type?: 'text' | 'password'
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-[#3a3a3c] dark:text-[#ebebf0]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-field h-9 px-3 text-sm"
      />
      {hint && <span className="text-[11px] text-[#86868b] leading-snug">{hint}</span>}
    </label>
  )
}
