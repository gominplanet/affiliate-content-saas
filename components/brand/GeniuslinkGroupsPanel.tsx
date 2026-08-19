// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Manage the Geniuslink groups on the connected account: see every group MVP
// (and you) have created, and create new ones. Geniuslink's API has no
// rename/delete, so this is view + create — assign a group to a blog from the
// per-site "Geniuslink group name" field in Set Up. Rendered inside the Brand
// page's Geniuslink card, only when credentials are connected.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, RefreshCw } from 'lucide-react'

interface Group { id: number; name: string; enabled: boolean }

export default function GeniuslinkGroupsPanel() {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/geniuslink/groups')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Couldn’t load your groups.'); setGroups([]); return }
      setGroups((data.groups as Group[]) ?? [])
    } catch { toast.error('Couldn’t load your groups.'); setGroups([]) } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (open && groups === null) void load() }, [open, groups, load])

  async function create() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/geniuslink/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Couldn’t create that group.'); return }
      toast.success(`Group “${data.group?.name ?? name}” is ready. Assign it to a blog in Set Up → your site → settings.`)
      setNewName('')
      await load()
    } catch { toast.error('Couldn’t create that group.') } finally { setCreating(false) }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-white/10">
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your Geniuslink groups</p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] font-medium text-[#7C3AED] hover:underline"
        >
          {open ? 'Hide' : 'Manage groups'}
        </button>
      </div>

      {open && (
        <div className="space-y-3">
          <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
            Every group on your Geniuslink account. Create a new one here, then point a blog at it from
            <span className="whitespace-nowrap"> Set Up → your site → settings</span>. (Geniuslink has no rename/delete — do that in the Geniuslink dashboard.)
          </p>
          <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ background: 'rgba(124,58,237,0.06)', color: 'var(--text-3, #6e6e73)' }}>
            <span className="font-semibold text-[#7C3AED]">Automatic per-channel tracking.</span> When you publish, MVP routes each place&apos;s link into its own group so your Geniuslink dashboard shows clicks by source — your blog to a group named after your domain, plus <span className="font-mono">MVP-YOUTUBE</span>, <span className="font-mono">MVP-FACEBOOK</span>, <span className="font-mono">MVP-PINTEREST</span>, <span className="font-mono">MVP-TWITTER</span>, and one per social channel. MVP creates these for you on first use. This works with Geniuslink only — an Amazon tag alone can&apos;t split clicks by source.
          </div>

          {/* Create */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create() } }}
              disabled={creating}
              maxLength={20}
              placeholder="New group name (e.g. gomindeals)"
              className="flex-1 rounded-lg border border-gray-200 dark:border-white/10 bg-transparent px-2.5 py-1.5 text-xs text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
            <button
              type="button"
              onClick={() => void create()}
              disabled={creating || !newName.trim()}
              className="inline-flex items-center gap-1 text-[11px] font-medium px-3 py-1.5 rounded-md bg-[#7C3AED] text-white hover:bg-[#6D28D9] disabled:opacity-60 flex-shrink-0"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create
            </button>
          </div>

          {/* List */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-[#86868b]">
                {groups === null ? '' : `${groups.length} group${groups.length === 1 ? '' : 's'}`}
              </span>
              <button type="button" onClick={() => void load()} disabled={loading}
                className="inline-flex items-center gap-1 text-[11px] text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-white disabled:opacity-60">
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
            {loading && groups === null ? (
              <div className="flex items-center gap-2 text-[11px] text-[#86868b] py-2"><Loader2 size={12} className="animate-spin" /> Loading your groups…</div>
            ) : groups && groups.length > 0 ? (
              <ul className="rounded-lg border border-gray-200 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/5 max-h-56 overflow-y-auto">
                {groups.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px]">
                    <span className="font-mono text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{g.name}</span>
                    <span className="text-[#86868b] flex-shrink-0">#{g.id}{g.enabled ? '' : ' · disabled'}</span>
                  </li>
                ))}
              </ul>
            ) : groups ? (
              <p className="text-[11px] text-[#86868b] py-1">No groups yet — create your first above.</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
