// Link in Bio editor — claim a handle, pick a theme, import your posted
// products as tiles (+ add manual links), reorder/hide/delete, and publish. The
// public page lives at /s/<handle>. Open to all paid tiers.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Link2, Loader2, ExternalLink, Copy, Plus, Trash2, Eye, EyeOff,
  ArrowUp, ArrowDown, Sparkles, Check, Globe,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { createBrowserClient } from '@/lib/supabase/client'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import { type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { LINK_THEMES, type LinkPage, type LinkPageItem } from '@/lib/link-in-bio'

export default function LinkInBioPage() {
  const [tier, setTier] = useState<Tier | null>(null)
  useEffect(() => {
    let cancelled = false
    let realTier: string = 'trial'
    const apply = () => { if (!cancelled) setTier(effectiveTier(realTier) as Tier) }
    ;(async () => {
      try {
        const supabase = createBrowserClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { realTier = 'trial'; apply(); return }
        const { data } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        realTier = (data as { tier?: string } | null)?.tier ?? 'trial'
        apply()
      } catch { realTier = 'trial'; apply() }
    })()
    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => { cancelled = true; window.removeEventListener(VIEW_AS_EVENT, apply) }
  }, [])

  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState<LinkPage | null>(null)
  const [items, setItems] = useState<LinkPageItem[]>([])
  const [origin, setOrigin] = useState('')
  const [brand, setBrand] = useState<{ name: string | null; logoUrl: string | null; headshotUrl: string | null }>({ name: null, logoUrl: null, headshotUrl: null })
  const [avatarUrl, setAvatarUrl] = useState('')
  const [handleInput, setHandleInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newImg, setNewImg] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/link-in-bio')
      const data = await res.json()
      if (res.ok) {
        setPage(data.page || null)
        setItems(Array.isArray(data.items) ? data.items : [])
        setOrigin(data.origin || (typeof window !== 'undefined' ? window.location.origin : ''))
        setAvatarUrl(data.page?.avatar_url || '')
        if (data.brand) setBrand(data.brand)
      }
    } catch { /* leave empty */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const savePage = async (patch: Partial<LinkPage> & { handle?: string }) => {
    setBusy(true)
    try {
      const res = await fetch('/api/link-in-bio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not save.'); return false }
      setPage(data.page)
      return true
    } catch { toast.error('Could not save.'); return false } finally { setBusy(false) }
  }

  const createPage = async () => {
    if (!handleInput.trim()) { toast.error('Pick a handle first.'); return }
    const ok = await savePage({ handle: handleInput, published: false })
    if (ok) toast.success('Page created — now add some products.')
  }

  const importProducts = async () => {
    setImporting(true)
    try {
      const res = await fetch('/api/link-in-bio/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Import failed.'); return }
      if (data.added > 0) { toast.success(`Added ${data.added} product${data.added === 1 ? '' : 's'}.`); await load() }
      else toast.message(data.message || 'Nothing new to import — your posted products are already here.')
    } catch { toast.error('Import failed.') } finally { setImporting(false) }
  }

  const addManual = async () => {
    if (!newTitle.trim() || !newUrl.trim()) { toast.error('A title and a link are required.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/link-in-bio/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle, url: newUrl, image_url: newImg }) })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not add.'); return }
      setItems((x) => [...x, data.item]); setNewTitle(''); setNewUrl(''); setNewImg('')
      toast.success('Link added.')
    } catch { toast.error('Could not add.') } finally { setBusy(false) }
  }

  const patchItem = async (id: string, patch: Partial<LinkPageItem>) => {
    setItems((x) => x.map((it) => (it.id === id ? { ...it, ...patch } : it))) // optimistic
    try { await fetch('/api/link-in-bio/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) }) } catch { /* revert on reload */ }
  }
  const deleteItem = async (id: string) => {
    setItems((x) => x.filter((it) => it.id !== id))
    try { await fetch('/api/link-in-bio/items', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }) } catch { /* no-op */ }
  }
  const move = async (idx: number, dir: -1 | 1) => {
    const next = [...items]
    const j = idx + dir
    if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setItems(next)
    try { await fetch('/api/link-in-bio/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: next.map((it) => it.id) }) }) } catch { /* no-op */ }
  }

  const publicUrl = page ? `${origin}/s/${page.handle}` : ''
  const copyUrl = () => { navigator.clipboard?.writeText(publicUrl); toast.success('Link copied — paste it in your bio.') }

  if (tier === null || loading) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  }
  if (!canUseDealRadar(tier)) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <FeatureLockedCard
          icon={<Link2 size={28} />}
          feature="Link in Bio"
          description="A shoppable link-in-bio page for Instagram, TikTok & more — a grid of your product picks, each carrying your affiliate link. Auto-fills from the products you've posted."
          bullets={[
            'One link for your bio; a clean grid of shoppable picks',
            'Auto-imports the products you post through Deal Radar',
            'Every tile carries your Amazon Associates tag',
          ]}
          requiredTier="creator"
          currentTier={tier}
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><Link2 size={20} /></div>
            <h1 className="text-2xl font-bold">Link in Bio</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">A shoppable grid of your product picks — one link for your Instagram / TikTok bio.</p>
        </div>
        {page && (
          <div className="flex items-center gap-2">
            {page.published
              ? <a href={publicUrl} target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm"><ExternalLink className="h-4 w-4 mr-1.5" /> View</Button></a>
              : <span className="text-xs text-amber-600 font-medium inline-flex items-center gap-1">Draft — not public yet</span>}
          </div>
        )}
      </div>

      {!page ? (
        /* Claim a handle */
        <div className="rounded-2xl border bg-card p-6">
          <div className="text-base font-semibold mb-1">Claim your link</div>
          <p className="text-sm text-muted-foreground mb-4">Pick a handle. Your page will live at <span className="font-mono">{origin}/s/<span className="text-foreground font-semibold">your-handle</span></span>.</p>
          <div className="flex items-center gap-2 max-w-md">
            <div className="flex items-center flex-1 rounded-lg border overflow-hidden">
              <span className="px-2.5 py-2 text-sm text-muted-foreground bg-muted whitespace-nowrap">/s/</span>
              <input value={handleInput} onChange={(e) => setHandleInput(e.target.value)} placeholder="your-brand"
                className="flex-1 px-2.5 py-2 text-sm bg-transparent outline-none" />
            </div>
            <Button onClick={createPage} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create page'}</Button>
          </div>
        </div>
      ) : (
        <>
          {/* Public link bar */}
          <div className="rounded-xl border bg-card p-3 flex items-center gap-2 flex-wrap">
            <Globe size={15} className="text-muted-foreground shrink-0" />
            <span className="font-mono text-sm flex-1 min-w-0 truncate">{publicUrl}</span>
            <button onClick={copyUrl} className="inline-flex items-center gap-1 text-xs font-medium rounded-lg border px-2.5 py-1.5 hover:bg-accent"><Copy size={12} /> Copy</button>
            <button onClick={() => savePage({ published: !page.published })} disabled={busy}
              className={`inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1.5 text-white ${page.published ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-violet-600 hover:bg-violet-700'}`}>
              {page.published ? <><Check size={12} /> Published</> : 'Publish'}
            </button>
          </div>

          {/* Settings */}
          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <div className="text-sm font-semibold">Page details</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-muted-foreground">Display name
                <input defaultValue={page.title || ''} onBlur={(e) => e.target.value !== (page.title || '') && savePage({ title: e.target.value })}
                  placeholder="Your name or brand" className="mt-1 w-full px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
              </label>
              <div className="text-xs font-medium text-muted-foreground">
                <div className="flex items-center justify-between gap-2">
                  <span>Avatar / logo</span>
                  <span className="flex items-center gap-1.5">
                    {brand.logoUrl && <button type="button" onClick={() => { setAvatarUrl(brand.logoUrl!); savePage({ avatar_url: brand.logoUrl! }) }} className="text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:underline">Use my logo</button>}
                    {brand.headshotUrl && <button type="button" onClick={() => { setAvatarUrl(brand.headshotUrl!); savePage({ avatar_url: brand.headshotUrl! }) }} className="text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:underline">Use headshot</button>}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {avatarUrl && <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover border shrink-0" />}
                  <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} onBlur={() => avatarUrl !== (page.avatar_url || '') && savePage({ avatar_url: avatarUrl })}
                    placeholder="https://… or use your logo →" className="flex-1 px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
                </div>
              </div>
            </div>
            <label className="text-xs font-medium text-muted-foreground block">Bio
              <textarea defaultValue={page.bio || ''} onBlur={(e) => e.target.value !== (page.bio || '') && savePage({ bio: e.target.value })}
                placeholder="One line about what you share." rows={2} className="mt-1 w-full px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground resize-none" />
            </label>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">Theme</div>
              <div className="flex flex-wrap gap-2">
                {LINK_THEMES.map((th) => (
                  <button key={th.key} onClick={() => savePage({ theme: th.key })} title={th.label}
                    className={`h-9 w-9 rounded-full border-2 transition ${page.theme === th.key ? 'border-violet-500 scale-110' : 'border-transparent'}`}
                    style={{ background: th.bg }} />
                ))}
              </div>
            </div>
          </div>

          {/* Tiles */}
          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-semibold">Your picks <span className="text-muted-foreground font-normal">· {items.length}</span></div>
              <Button size="sm" variant="outline" onClick={importProducts} disabled={importing}>
                {importing ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Importing…</> : <><Sparkles className="h-4 w-4 mr-1.5" /> Import my posted products</>}
              </Button>
            </div>

            {/* Add manual link */}
            <div className="rounded-xl border bg-background p-3 grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <label className="text-[11px] font-medium text-muted-foreground">Title
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Product name" className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border bg-background" />
              </label>
              <label className="text-[11px] font-medium text-muted-foreground">Link (any URL — paste your Geniuslink here)
                <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://…" className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border bg-background" />
              </label>
              <Button size="sm" onClick={addManual} disabled={busy}><Plus className="h-4 w-4 mr-1" /> Add</Button>
              <label className="text-[11px] font-medium text-muted-foreground sm:col-span-3">Image URL (optional)
                <input value={newImg} onChange={(e) => setNewImg(e.target.value)} placeholder="https://… (leave blank for a plain tile)" className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border bg-background" />
              </label>
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No picks yet. Import your posted products, or add a link above.</p>
            ) : (
              <ul className="divide-y">
                {items.map((it, i) => (
                  <li key={it.id} className={`flex items-center gap-3 py-2.5 ${it.hidden ? 'opacity-50' : ''}`}>
                    <div className="flex flex-col">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp size={14} /></button>
                      <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown size={14} /></button>
                    </div>
                    {it.image_url
                      ? <img src={it.image_url} alt="" className="h-11 w-11 rounded-lg object-contain bg-white border shrink-0" />
                      : <div className="h-11 w-11 rounded-lg bg-muted border shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{it.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{it.url}</div>
                    </div>
                    {it.clicks > 0 && <span className="text-[11px] text-muted-foreground shrink-0">{it.clicks} clicks</span>}
                    <button onClick={() => patchItem(it.id, { hidden: !it.hidden })} title={it.hidden ? 'Show' : 'Hide'} className="text-muted-foreground hover:text-foreground shrink-0">
                      {it.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <button onClick={() => deleteItem(it.id)} title="Delete" className="text-muted-foreground hover:text-red-500 shrink-0"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
