// Link in Bio editor — claim a handle, pick a theme, import your posted
// products as tiles (+ add manual links), reorder/hide/delete, and publish. The
// public page lives at /shop/<handle>. Open to all paid tiers.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Link2, Loader2, ExternalLink, Copy, Plus, Trash2, Eye, EyeOff,
  ArrowUp, ArrowDown, Sparkles, Check, Globe, Zap, Send,
  Youtube, Instagram, Facebook, Twitter, Music2, AtSign, ShoppingBag,
  HelpCircle, X as CloseIcon, Palette, MousePointerClick,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { createBrowserClient } from '@/lib/supabase/client'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'
import { type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { LINK_THEMES, LINK_PRESETS, presetFor, type LinkPage, type LinkPageItem } from '@/lib/link-in-bio'

// Brand glyph for a link icon slug — used in the editor list + preset chips.
function LinkGlyph({ slug, size = 15 }: { slug: string | null; size?: number }) {
  const map: Record<string, React.ReactNode> = {
    youtube: <Youtube size={size} />, instagram: <Instagram size={size} />, facebook: <Facebook size={size} />,
    x: <Twitter size={size} />, tiktok: <Music2 size={size} />, threads: <AtSign size={size} />,
    pinterest: <Globe size={size} />, website: <Globe size={size} />,
  }
  return <>{map[slug || ''] || <Link2 size={size} />}</>
}

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

  // First-time walkthrough — opens automatically the first visit (localStorage
  // 'link_in_bio_guide_seen'), reopenable anytime from the "Guide" link.
  const [showGuide, setShowGuide] = useState(false)
  useEffect(() => {
    try { if (!localStorage.getItem('link_in_bio_guide_seen')) setShowGuide(true) } catch { /* no-op */ }
  }, [])
  const closeGuide = () => { setShowGuide(false); try { localStorage.setItem('link_in_bio_guide_seen', '1') } catch { /* no-op */ } }

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
  const [blogUrl, setBlogUrl] = useState<string | null>(null)
  const [knownLinks, setKnownLinks] = useState<Record<string, string>>({})
  // Add-a-link (Linktree-style brand link) draft.
  const [linkIcon, setLinkIcon] = useState('link')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')

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
        setBlogUrl(data.blogUrl || null)
        setKnownLinks(data.knownLinks || {})
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
      const added = data.added || 0, relinked = data.relinked || 0
      if (added || relinked) {
        await load()
        const parts: string[] = []
        if (added) parts.push(`added ${added} product${added === 1 ? '' : 's'}`)
        if (relinked) parts.push(`re-linked ${relinked} to Geniuslink`)
        toast.success(parts.join(' · '))
      } else toast.message(data.message || 'Nothing new — your products are already here (and already Geniuslinked).')
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

  const postLink = async (icon: string, title: string, url: string): Promise<boolean> => {
    if (!title.trim() || !url.trim()) { toast.error('Pick a platform and paste its link.'); return false }
    setBusy(true)
    try {
      const res = await fetch('/api/link-in-bio/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'link', icon, title, url }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not add.'); return false }
      setItems((x) => [...x, data.item]); return true
    } catch { toast.error('Could not add.'); return false } finally { setBusy(false) }
  }
  // Click a platform: if MVP already knows that profile URL, PORT it in one tap;
  // otherwise prefill the form so they can paste it.
  const pickPreset = async (slug: string) => {
    const p = presetFor(slug)
    const known = knownLinks[slug]
    const already = items.some((it) => it.kind === 'link' && it.icon === slug)
    if (already) { toast.message(`${p.label} is already on your page.`); return }
    if (known) {
      const ok = await postLink(slug, p.label, known)
      if (ok) toast.success(`Ported your ${p.label}.`)
      return
    }
    setLinkIcon(p.slug); setLinkTitle(p.label)
    setLinkUrl(slug === 'website' && blogUrl ? blogUrl : '')
  }
  const addLink = async () => {
    const ok = await postLink(linkIcon, linkTitle, linkUrl)
    if (ok) { setLinkTitle(''); setLinkUrl(''); setLinkIcon('link'); toast.success('Link added.') }
  }

  // Advertisement tabs (kind='ad'): a clickable sponsor card with icon/thumb,
  // title, optional discount badge, subtitle, and optional promo code.
  const [adTitle, setAdTitle] = useState('')
  const [adSubtitle, setAdSubtitle] = useState('')
  const [adImg, setAdImg] = useState('')
  const [adUrl, setAdUrl] = useState('')
  const [adBadge, setAdBadge] = useState('')
  const [adCode, setAdCode] = useState('')
  const addAd = async () => {
    if (!adTitle.trim() || !adUrl.trim()) { toast.error('An ad needs a title and a link.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/link-in-bio/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'ad', title: adTitle, subtitle: adSubtitle, url: adUrl, image_url: adImg, badge: adBadge, code: adCode }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not add ad.'); return }
      setItems((x) => [...x, data.item])
      setAdTitle(''); setAdSubtitle(''); setAdImg(''); setAdUrl(''); setAdBadge(''); setAdCode('')
      toast.success('Ad added.')
    } catch { toast.error('Could not add ad.') } finally { setBusy(false) }
  }

  // Post an IG Story for each "current deal" (ticked product with an ASIN).
  // Two steps: "Create IG Stories" opens a review modal (which deals go out),
  // then the user confirms — never a blind fire-and-post.
  const [creatingStories, setCreatingStories] = useState(false)
  const [storiesOpen, setStoriesOpen] = useState(false)
  const [storyPick, setStoryPick] = useState<Set<string>>(new Set())
  const storyTargets = items.filter((it) => it.kind !== 'link' && it.in_story && it.asin)
  const openStories = () => {
    if (!storyTargets.length) { toast.error('Tick the imported deals that are in your story first.'); return }
    setStoryPick(new Set(storyTargets.map((t) => t.id))) // default: all selected
    setStoriesOpen(true)
  }
  const createStories = async () => {
    const targets = storyTargets.filter((it) => storyPick.has(it.id))
    if (!targets.length) { toast.error('Pick at least one deal to post.'); return }
    setStoriesOpen(false)
    setCreatingStories(true)
    let ok = 0, fail = 0
    let firstError = ''
    for (const t of targets) {
      try {
        const res = await fetch('/api/deal-radar/social-post', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin: t.asin, story: true, title: t.title, imageUrl: t.image_url }),
        })
        const d = await res.json().catch(() => ({}))
        const s = Array.isArray(d.results) ? d.results.find((r: { platform: string; ok: boolean; error?: string }) => r.platform === 'instagram_story') : null
        if (res.ok && s?.ok) { ok++ } else { fail++; if (!firstError) firstError = s?.error || d.error || 'Unknown error' }
      } catch { fail++; if (!firstError) firstError = 'Network error' }
    }
    setCreatingStories(false)
    if (ok) toast.success(`Posted ${ok} IG stor${ok === 1 ? 'y' : 'ies'}${fail ? ` · ${fail} failed` : ''}.`)
    else toast.error(`Story failed: ${firstError}`)
  }
  const clearStory = async () => {
    setItems((x) => x.map((it) => (it.kind !== 'link' && it.in_story ? { ...it, in_story: false } : it))) // optimistic
    try { await fetch('/api/link-in-bio/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clearStory: true }) }) } catch { /* no-op */ }
    toast.success('Story section cleared.')
  }

  const patchItem = async (id: string, patch: Partial<LinkPageItem>) => {
    setItems((x) => x.map((it) => (it.id === id ? { ...it, ...patch } : it))) // optimistic
    try { await fetch('/api/link-in-bio/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) }) } catch { /* revert on reload */ }
  }
  const deleteItem = async (id: string) => {
    setItems((x) => x.filter((it) => it.id !== id))
    try { await fetch('/api/link-in-bio/items', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }) } catch { /* no-op */ }
  }
  // Reorder within a kind (links reorder among links, products among products).
  const move = async (item: LinkPageItem, dir: -1 | 1) => {
    const isLink = item.kind === 'link'
    const same = items.filter((x) => (x.kind === 'link') === isLink)
    const idx = same.findIndex((x) => x.id === item.id)
    const j = idx + dir
    if (j < 0 || j >= same.length) return
    const s = [...same]; ;[s[idx], s[j]] = [s[j], s[idx]]
    const others = items.filter((x) => (x.kind === 'link') !== isLink)
    const next = [...s, ...others]
    setItems(next)
    try { await fetch('/api/link-in-bio/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: next.map((it) => it.id) }) }) } catch { /* no-op */ }
  }

  const renderItem = (it: LinkPageItem, i: number, list: LinkPageItem[]) => (
    <li key={it.id} className={`flex items-center gap-3 py-2.5 ${it.hidden ? 'opacity-50' : ''}`}>
      <div className="flex flex-col">
        <button onClick={() => move(it, -1)} disabled={i === 0} aria-label="Move up" title="Move up" className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp size={14} /></button>
        <button onClick={() => move(it, 1)} disabled={i === list.length - 1} aria-label="Move down" title="Move down" className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown size={14} /></button>
      </div>
      {it.kind !== 'link' && (
        <button onClick={() => patchItem(it.id, { in_story: !it.in_story })}
          title={it.in_story ? 'In your story right now — untick to move to “More sales”' : 'Tick if this deal is live in your IG/TikTok story'}
          className={`shrink-0 inline-flex h-5 w-5 items-center justify-center rounded border transition ${it.in_story ? 'bg-orange-500 border-orange-500 text-white' : 'hover:bg-accent'}`}>
          {it.in_story && <Check size={12} />}
        </button>
      )}
      {it.kind === 'link'
        ? <span className="h-11 w-11 rounded-lg border shrink-0 flex items-center justify-center" style={{ color: presetFor(it.icon).color }}><LinkGlyph slug={it.icon} size={18} /></span>
        : (it.image_url
            ? <img src={it.image_url} alt="" className="h-11 w-11 rounded-lg object-contain bg-white border shrink-0" />
            : <div className="h-11 w-11 rounded-lg bg-muted border shrink-0 flex items-center justify-center text-muted-foreground"><ShoppingBag size={16} /></div>)}
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
  )

  const publicUrl = page ? `${origin}/shop/${page.handle}` : ''
  const copyUrl = async () => {
    if (!navigator.clipboard) { toast.error('Couldn’t copy automatically — select and copy the link manually.'); return }
    try {
      await navigator.clipboard.writeText(publicUrl)
      toast.success('Link copied — paste it in your bio.')
    } catch {
      toast.error('Couldn’t copy automatically — select and copy the link manually.')
    }
  }

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
          <button onClick={() => setShowGuide(true)} className="mt-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 underline inline-flex items-center gap-1">
            <HelpCircle size={13} /> How the Shop page works
          </button>
        </div>
        {page && (
          <div className="flex items-center gap-2">
            {page.published
              ? <a href={publicUrl} target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm"><ExternalLink className="h-4 w-4 mr-1.5" /> View</Button></a>
              : <span className="text-xs text-amber-600 font-medium inline-flex items-center gap-1">Draft — not public yet</span>}
          </div>
        )}
      </div>

      {showGuide && <ShopPageGuide onClose={closeGuide} />}

      {/* IG Stories review modal — pick which deals go out before posting,
          instead of firing them all blindly. */}
      {storiesOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="Create IG Stories">
          <div className="absolute inset-0 bg-black/50" onClick={() => setStoriesOpen(false)} />
          <div className="relative w-full sm:max-w-md max-h-full sm:max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl border bg-white dark:bg-[#16161a] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><Send size={18} /></div>
                <div>
                  <div className="text-base font-bold leading-tight">Post to IG Stories</div>
                  <div className="text-xs text-muted-foreground">Pick which deals go out. Each posts as a Story with a “link in bio” CTA back to your page.</div>
                </div>
              </div>
              <button onClick={() => setStoriesOpen(false)} className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" title="Close"><CloseIcon size={18} /></button>
            </div>
            <div className="overflow-y-auto px-3 py-2 divide-y">
              {storyTargets.map((t) => {
                const on = storyPick.has(t.id)
                return (
                  <label key={t.id} className="flex items-center gap-3 px-2 py-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setStoryPick((prev) => { const n = new Set(prev); if (on) n.delete(t.id); else n.add(t.id); return n })}
                      className="h-4 w-4 rounded accent-orange-500 shrink-0"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {t.image_url ? <img src={t.image_url} alt="" className="h-10 w-10 rounded-md object-contain bg-white border shrink-0" /> : <div className="h-10 w-10 rounded-md bg-muted shrink-0" />}
                    <span className="text-sm leading-snug line-clamp-2">{t.title}</span>
                  </label>
                )
              })}
            </div>
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t shrink-0">
              <button onClick={() => setStoriesOpen(false)} className="text-sm font-medium text-muted-foreground hover:text-foreground">Cancel</button>
              <Button size="sm" onClick={createStories} disabled={storyPick.size === 0}>
                <Send className="h-4 w-4 mr-1.5" /> Post {storyPick.size} stor{storyPick.size === 1 ? 'y' : 'ies'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {!page ? (
        /* Claim a handle */
        <div className="rounded-2xl border bg-card p-6">
          <div className="text-base font-semibold mb-1">Claim your link</div>
          <p className="text-sm text-muted-foreground mb-4">Pick a handle. Your page will live at <span className="font-mono">{origin}/shop/<span className="text-foreground font-semibold">your-handle</span></span>.</p>
          <div className="flex items-center gap-2 max-w-md">
            <div className="flex items-center flex-1 rounded-lg border overflow-hidden">
              <span className="px-2.5 py-2 text-sm text-muted-foreground bg-muted whitespace-nowrap">/shop/</span>
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
              <div className="flex flex-wrap items-center gap-2">
                {LINK_THEMES.map((th) => (
                  <button key={th.key} onClick={() => savePage({ theme: th.key })} title={th.label}
                    className={`h-9 w-9 rounded-full border-2 transition ${page.theme === th.key ? 'border-violet-500 scale-110' : 'border-transparent'}`}
                    style={{ background: th.bg }} />
                ))}
              </div>
              {/* Custom accent — any color for buttons, badges & highlights. */}
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs font-medium text-muted-foreground">Accent color</span>
                <label className="relative inline-flex items-center">
                  <input type="color" defaultValue={page.accent || '#7C3AED'}
                    onChange={(e) => savePage({ accent: e.target.value })}
                    className="h-8 w-10 rounded-md border cursor-pointer bg-transparent p-0.5" title="Pick any accent color" />
                </label>
                {page.accent && (
                  <>
                    <code className="text-[11px] text-muted-foreground">{page.accent}</code>
                    <button onClick={() => savePage({ accent: '' })} className="text-[11px] text-muted-foreground hover:underline">Reset to theme</button>
                  </>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Pick a swatch for the whole look, or set a custom accent for buttons, badges & the “Shop now” color.</p>
            </div>
          </div>

          {/* Main button + Advertisement */}
          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <div>
              <div className="text-sm font-semibold">Main button <span className="text-muted-foreground font-normal">· a big CTA under your name + tagline</span></div>
              <div className="grid sm:grid-cols-2 gap-3 mt-2">
                <label className="text-xs font-medium text-muted-foreground">Button label
                  <input defaultValue={page.cta_label || ''} onBlur={(e) => e.target.value !== (page.cta_label || '') && savePage({ cta_label: e.target.value })}
                    placeholder="e.g. Shop My Amazon Storefront" className="mt-1 w-full px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
                </label>
                <label className="text-xs font-medium text-muted-foreground">Button link
                  <input defaultValue={page.cta_url || ''} onBlur={(e) => e.target.value !== (page.cta_url || '') && savePage({ cta_url: e.target.value })}
                    placeholder="https://…" className="mt-1 w-full px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Leave both blank to hide the button.</p>
            </div>

            <div className="border-t pt-4">
              <div className="text-sm font-semibold">Advertisements <span className="text-muted-foreground font-normal">· sponsor tabs shown between your two product sections</span></div>
              <div className="grid sm:grid-cols-2 gap-2 mt-3">
                <input value={adTitle} onChange={(e) => setAdTitle(e.target.value)} placeholder="Title (e.g. Function Health)" className="px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
                <input value={adSubtitle} onChange={(e) => setAdSubtitle(e.target.value)} placeholder="Subtitle (e.g. One Year Membership)" className="px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
                <input value={adImg} onChange={(e) => setAdImg(e.target.value)} placeholder="Icon / thumbnail URL" className="px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
                <input value={adUrl} onChange={(e) => setAdUrl(e.target.value)} placeholder="Link (where the tab goes)" className="px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
                <input value={adBadge} onChange={(e) => setAdBadge(e.target.value)} placeholder="Badge (optional, e.g. $20 Off)" className="px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
                <input value={adCode} onChange={(e) => setAdCode(e.target.value)} placeholder="Promo code (optional, e.g. Cameron20)" className="px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
              </div>
              <Button size="sm" className="mt-2" onClick={addAd} disabled={busy}><Plus className="h-4 w-4 mr-1" /> Add advertisement</Button>
              {items.filter((it) => it.kind === 'ad').length > 0 && (
                <ul className="divide-y mt-2">
                  {items.filter((it) => it.kind === 'ad').map((it, i, list) => renderItem(it, i, list))}
                </ul>
              )}
            </div>
          </div>

          {/* Section headings — all editable (blank = default). */}
          <div className="rounded-2xl border bg-card p-5 space-y-3">
            <div className="text-sm font-semibold">Section headings <span className="text-muted-foreground font-normal">· leave blank for the defaults</span></div>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="text-xs font-medium text-muted-foreground">Stories strip
                <input defaultValue={page.heading_stories || ''} onBlur={(e) => e.target.value !== (page.heading_stories || '') && savePage({ heading_stories: e.target.value })}
                  placeholder="🔥 In my Stories currently" className="mt-1 w-full px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
              </label>
              <label className="text-xs font-medium text-muted-foreground">Ads strip
                <input defaultValue={page.heading_ads ?? ''} onBlur={(e) => e.target.value !== (page.heading_ads ?? '') && savePage({ heading_ads: e.target.value })}
                  placeholder="Featured" className="mt-1 w-full px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
              </label>
              <label className="text-xs font-medium text-muted-foreground">Products strip
                <input defaultValue={page.heading_more || ''} onBlur={(e) => e.target.value !== (page.heading_more || '') && savePage({ heading_more: e.target.value })}
                  placeholder="More Products We Love" className="mt-1 w-full px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground" />
              </label>
            </div>
          </div>

          {/* Brand links (Linktree-style) */}
          <div className="rounded-2xl border bg-card p-5 space-y-3">
            <div className="text-sm font-semibold">Brand links <span className="text-muted-foreground font-normal">· tap a platform to port your link, or add your own below</span></div>
            <div className="flex flex-wrap gap-1.5">
              {LINK_PRESETS.map((p) => {
                const portable = !!knownLinks[p.slug] && !items.some((it) => it.kind === 'link' && it.icon === p.slug)
                return (
                  <button key={p.slug} type="button" onClick={() => pickPreset(p.slug)} disabled={busy}
                    title={portable ? `Add your ${p.label} (we have it on file)` : `Add a ${p.label} link`}
                    className={`inline-flex items-center gap-1.5 text-xs rounded-full border px-2.5 py-1.5 transition disabled:opacity-60 ${linkIcon === p.slug ? 'border-foreground/40 bg-accent' : portable ? 'border-emerald-500/40 hover:bg-accent' : 'hover:bg-accent'}`}>
                    <span style={{ color: p.color }}><LinkGlyph slug={p.slug} size={13} /></span> {p.label}
                    {portable && <Check size={11} className="text-emerald-500" />}
                  </button>
                )
              })}
            </div>
            <div className="grid sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-end">
              <label className="text-[11px] font-medium text-muted-foreground">Label
                <input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="e.g. YouTube" className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border bg-background" />
              </label>
              <label className="text-[11px] font-medium text-muted-foreground">URL
                <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder={presetFor(linkIcon).placeholder} className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border bg-background" />
              </label>
              <Button size="sm" onClick={addLink} disabled={busy}><Plus className="h-4 w-4 mr-1" /> Add link</Button>
            </div>
            {items.filter((it) => it.kind === 'link').length > 0 && (
              <ul className="divide-y">
                {items.filter((it) => it.kind === 'link').map((it, i, list) => renderItem(it, i, list))}
              </ul>
            )}
          </div>

          {/* Products */}
          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-semibold">Products <span className="text-muted-foreground font-normal">· {items.filter((it) => it.kind !== 'link').length}</span></div>
              <Button size="sm" variant="outline" onClick={importProducts} disabled={importing}>
                {importing ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Importing…</> : <><Sparkles className="h-4 w-4 mr-1.5" /> Import my posted products</>}
              </Button>
            </div>

            {/* Add a product manually */}
            <div className="rounded-xl border bg-background p-3 grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <label className="text-[11px] font-medium text-muted-foreground">Title
                <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Product name" className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border bg-background" />
              </label>
              <label className="text-[11px] font-medium text-muted-foreground">Link (paste any Amazon or product link — we&rsquo;ll make it your affiliate link)
                <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://… (Amazon, geni.us, any product link)" className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border bg-background" />
              </label>
              <Button size="sm" onClick={addManual} disabled={busy}><Plus className="h-4 w-4 mr-1" /> Add</Button>
              <label className="text-[11px] font-medium text-muted-foreground sm:col-span-3">Image URL (optional)
                <input value={newImg} onChange={(e) => setNewImg(e.target.value)} placeholder="https://… (leave blank for a plain tile)" className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border bg-background" />
              </label>
            </div>

            {/* Current deals — live in the creator's story (24h). */}
            {items.filter((it) => it.kind !== 'link' && it.in_story).length > 0 && (
              <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs font-semibold text-orange-600 dark:text-orange-400 inline-flex items-center gap-1"><Zap size={13} /> Current deals · live in your story</div>
                  <div className="flex items-center gap-2">
                    <button onClick={clearStory} className="text-xs font-medium text-muted-foreground hover:text-foreground underline">Clear all</button>
                    <Button size="sm" onClick={openStories} disabled={creatingStories}>
                      {creatingStories ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Posting…</> : <><Send className="h-4 w-4 mr-1.5" /> Create IG Stories</>}
                    </Button>
                  </div>
                </div>
                <ul className="divide-y">
                  {items.filter((it) => it.kind !== 'link' && it.in_story).map((it, i, list) => renderItem(it, i, list))}
                </ul>
              </div>
            )}

            {/* Everything else. */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">More sales I found <span className="font-normal">· tick the ones that are in your story</span></div>
              {items.filter((it) => it.kind !== 'link' && !it.in_story).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No products here. Import your posted products, or add one above.</p>
              ) : (
                <ul className="divide-y">
                  {items.filter((it) => it.kind !== 'link' && !it.in_story).map((it, i, list) => renderItem(it, i, list))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// First-time walkthrough for the shoppable Shop page. Opens automatically the
// first visit (localStorage 'link_in_bio_guide_seen') and is reopenable anytime
// from "How the Shop page works" in the header. Mirrors the Deal Radar guide.
function ShopPageGuide({ onClose }: { onClose: () => void }) {
  const sections: { icon: React.ReactNode; title: string; body: React.ReactNode }[] = [
    {
      icon: <ShoppingBag size={18} />,
      title: 'What your Shop page is',
      body: <>It’s one clean, branded page at <span className="font-mono">/shop/your-handle</span> — the single link you put in your Instagram, TikTok, and every other bio. Think Linktree, but every tile is <strong>shoppable</strong> and carries your affiliate link. It’s where your Stories, posts, and profile all send people to buy.</>,
    },
    {
      icon: <Check size={18} />,
      title: 'Claim your handle & go live',
      body: <>Pick a handle once (that’s your permanent URL), then flip <strong>Publish</strong> when you’re ready. Until then it stays a private draft. Hit <strong>Copy link</strong> and paste it into your bios — the same link works everywhere and never changes.</>,
    },
    {
      icon: <Palette size={18} />,
      title: 'Make it yours',
      body: <>Your <strong>logo or headshot imports straight from your blog</strong> — no re-uploading. Pick a theme, add a short bio line, and your connected social accounts show up automatically as a tidy row of icon pills under your name. Your other brand links (YouTube, newsletter, site) sit right below.</>,
    },
    {
      icon: <Link2 size={18} />,
      title: 'Product tiles carry your link automatically',
      body: <>Import the products you’ve already posted with one tap, or add tiles by hand. Every tile links out through <strong>Geniuslink</strong> when you use it (your Amazon tag otherwise) — so you never paste a raw link, and every click is properly attributed to you.</>,
    },
    {
      icon: <Zap size={18} />,
      title: 'Two shelves: Current Deals vs. Other Sales',
      body: <>Because Stories only last 24 hours, your page splits in two. Tick a product’s <strong>“in my story”</strong> box and it jumps into the <strong>Current Deals</strong> row at the top — matching what’s live in your Stories right now. Everything else sits under <strong>Other Sales I found</strong> as your evergreen picks.</>,
    },
    {
      icon: <Instagram size={18} />,
      title: 'Build Instagram Stories from here',
      body: <>Tick the deals that are live in your Stories, hit <strong>Create IG Stories</strong>, and we compose and post them for you — each with a “link in bio” call-to-action that points back to this page. When the 24 hours are up, <strong>Clear all</strong> resets the shelf in one tap.</>,
    },
    {
      icon: <MousePointerClick size={18} />,
      title: 'Share it & watch the clicks',
      body: <>One link in every bio, every Story, every caption. Your page tracks clicks per tile so you can see what your audience actually taps — and double down on the picks that convert.</>,
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="Shop page guide">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl max-h-full sm:max-h-[85vh] flex flex-col rounded-none sm:rounded-2xl border bg-white dark:bg-[#16161a] shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><ShoppingBag size={20} /></div>
            <div>
              <div className="text-base font-bold leading-tight">Your shoppable Shop page</div>
              <div className="text-xs text-muted-foreground">One link for every bio — a storefront that turns followers into buyers.</div>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" title="Close"><CloseIcon size={18} /></button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {sections.map((s, i) => (
            <div key={i} className="flex gap-3">
              <div className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground/80">{s.icon}</div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">{s.body}</div>
              </div>
            </div>
          ))}
          <div className="rounded-lg bg-muted/60 px-3.5 py-3 text-[12px] text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Pairs with Amazon Deal Radar.</strong> Post a deal from Deal Radar and it can flow straight onto this page and into your Stories — find the deal, post it, drive traffic here, convert. The whole loop in one place.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t shrink-0">
          <span className="text-xs text-muted-foreground">Reopen this anytime from <span className="font-medium text-foreground">How the Shop page works</span> at the top.</span>
          <Button size="sm" onClick={onClose}>Got it — let’s build it</Button>
        </div>
      </div>
    </div>
  )
}
