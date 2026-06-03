'use client'

/**
 * /developers — API access management for Pro users.
 *
 *   - List existing API keys (name, key prefix, last used, created)
 *   - Mint a new key (shows plaintext ONCE — copy-or-lose)
 *   - Revoke a key
 *   - Link to /docs/api for usage instructions
 *
 * Non-Pro users see a paywall card with an upgrade CTA. The API itself
 * also gates by tier (lib/api-keys.ts authenticateApiKey), so a user who
 * mints a key on Pro then downgrades will get 403 the next time they
 * call — preserves the "tier change immediately takes effect" guarantee.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Copy, Key, Plus, Trash2, ExternalLink, Lock, Check } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { useConfirm } from '@/components/ui/useConfirm'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

export default function DevelopersPage() {
  const { confirm, ConfirmHost } = useConfirm()
  const [tier, setTier] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [creating, setCreating] = useState(false)
  // The plaintext is returned ONCE on POST. We hold it in component state
  // until the user dismisses the reveal card — there is no way to recover
  // it after that.
  const [revealedPlaintext, setRevealedPlaintext] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Load tier + keys on mount.
  useEffect(() => {
    (async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: integ } = await supabase
          .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        setTier((integ?.tier as string | undefined) ?? 'trial')

        await refreshKeys()
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function refreshKeys() {
    const res = await fetch('/api/api-keys')
    if (!res.ok) return
    const { keys: list } = await res.json()
    setKeys(list || [])
  }

  async function handleCreate() {
    if (!newKeyName.trim()) {
      toast.error('Name your key first (e.g. "Zapier", "n8n", "internal automation")')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to create key')
        return
      }
      setRevealedPlaintext(data.plaintext)
      setNewKeyName('')
      await refreshKeys()
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (!(await confirm({
      title: `Revoke "${name}"?`,
      description: 'Any integration using this key will stop working immediately. You can mint a new key any time.',
      confirmLabel: 'Revoke key',
      destructive: true,
    }))) return
    const res = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Failed to revoke key')
      return
    }
    toast.success(`Revoked "${name}"`)
    await refreshKeys()
  }

  async function copyPlaintext() {
    if (!revealedPlaintext) return
    try {
      await navigator.clipboard.writeText(revealedPlaintext)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed — select the text manually')
    }
  }

  // ── Loading / paywall states ──────────────────────────────────────────────
  if (loading) {
    return <div className="max-w-3xl mx-auto p-8 text-sm text-gray-500">Loading…</div>
  }

  const isPro = tier === 'pro' || tier === 'admin'
  if (!isPro) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Key size={22} /> API Access
        </h1>
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50">
          <Lock size={32} className="mx-auto text-gray-400 mb-3" />
          <h2 className="text-lg font-semibold mb-2">API access is a Pro feature</h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto mb-5">
            Mint API keys to wire MVP into Zapier, n8n, your own scripts, or any other automation. List
            blog posts, fetch their content, and (soon) trigger generation programmatically.
          </p>
          <Link
            href="/billing"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-white"
            style={{ background: '#7C3AED' }}
          >
            Upgrade to Pro
          </Link>
        </div>
      </div>
    )
  }

  // ── Pro user UI ───────────────────────────────────────────────────────────
  const activeKeys = keys.filter(k => !k.revoked_at)
  const revokedKeys = keys.filter(k => k.revoked_at)

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Key size={22} /> API Access
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Mint API keys for Zapier, n8n, custom scripts, or any integration. Keys are shown ONCE on
            creation — copy them somewhere safe immediately. Lost keys can be revoked and replaced.
          </p>
        </div>
        <Link
          href="/docs/api"
          className="inline-flex items-center gap-1.5 text-sm text-[#7C3AED] hover:underline whitespace-nowrap"
        >
          API docs <ExternalLink size={14} />
        </Link>
      </div>

      {/* The one-time reveal card — shown for ~the next render after POST */}
      {revealedPlaintext && (
        <div className="border-2 border-amber-300 bg-amber-50 rounded-xl p-5 space-y-3">
          <div className="font-semibold text-amber-900">⚠️ Copy this now — you won't see it again</div>
          <div className="flex items-center gap-2 bg-white rounded-lg p-3 border border-amber-200">
            <code className="flex-1 text-sm font-mono truncate">{revealedPlaintext}</code>
            <button
              onClick={copyPlaintext}
              className="px-3 py-1.5 rounded-md text-sm font-semibold text-white inline-flex items-center gap-1.5"
              style={{ background: copied ? '#34c759' : '#7C3AED' }}
            >
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>
          <button
            onClick={() => { setRevealedPlaintext(null); setCopied(false) }}
            className="text-sm text-amber-900 underline"
          >
            I've copied it, dismiss
          </button>
        </div>
      )}

      {/* Mint */}
      <div className="border rounded-xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Create new key
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={e => setNewKeyName(e.target.value)}
            placeholder='Name (e.g. "Zapier", "n8n production")'
            maxLength={80}
            className="flex-1 px-3 py-2 border rounded-lg text-sm"
            onKeyDown={e => { if (e.key === 'Enter') void handleCreate() }}
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newKeyName.trim()}
            className="px-4 py-2 rounded-lg font-semibold text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: '#7C3AED' }}
          >
            <Plus size={14} /> {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>

      {/* Active keys */}
      <div className="border rounded-xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Active keys ({activeKeys.length})
        </h2>
        {activeKeys.length === 0 ? (
          <p className="text-sm text-gray-500">No active keys yet. Create one above to get started.</p>
        ) : (
          <ul className="divide-y">
            {activeKeys.map(k => (
              <li key={k.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{k.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{k.key_prefix}…</div>
                </div>
                <div className="text-xs text-gray-400 whitespace-nowrap">
                  {k.last_used_at
                    ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}`
                    : 'Never used'}
                </div>
                <button
                  onClick={() => void handleRevoke(k.id, k.name)}
                  className="text-red-600 hover:bg-red-50 rounded p-1.5"
                  aria-label={`Revoke ${k.name}`}
                  title="Revoke key"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Revoked — audit trail */}
      {revokedKeys.length > 0 && (
        <details className="border rounded-xl p-5">
          <summary className="text-sm font-semibold uppercase tracking-wider text-gray-500 cursor-pointer">
            Revoked keys ({revokedKeys.length})
          </summary>
          <ul className="divide-y mt-3">
            {revokedKeys.map(k => (
              <li key={k.id} className="py-2 flex items-center gap-3 opacity-60">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{k.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{k.key_prefix}…</div>
                </div>
                <div className="text-xs text-gray-400 whitespace-nowrap">
                  Revoked {k.revoked_at ? new Date(k.revoked_at).toLocaleDateString() : '—'}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ConfirmHost />
    </div>
  )
}
