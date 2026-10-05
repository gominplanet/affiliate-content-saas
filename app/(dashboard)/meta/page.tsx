'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// META HUB: the whole Facebook side of MVP under one umbrella, step by step.
// Facebook only, on purpose: no other platform appears on this page.
//
//   1. Your Page          the one Page everything is posted on
//   2. Your niche Groups  a Group per niche (Kitchen, Automotive...), each
//                         holding the links for its products
//   3. SCOUT on Facebook  fills each Group post; the creator presses Post
//   4. Make Reels         Clip Factory, right here, Facebook only
//   5. Share reviews      a review becomes a Group post plus a Page post
//
// Each step ticks itself once it is done and can be opened again. Then what
// went out, and who does what, for people opening a Page for the first time.
//
// One rule, said once: your Group holds the link, your Page points to it. A
// clip becomes a Group video with the Amazon link in the matching niche Group,
// and a Page Reel whose first line is "Get it here" and that Group post.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, FlaskConical, Trash2, ExternalLink, ShieldCheck, ChevronDown, Pencil } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { canUsePreview } from '@/lib/labs-preview'
import { requestFacebookAccess } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL } from '@/lib/scout-version'
import { SocialPreviewModal } from '@/components/content/SocialPreviewModal'
import ClipFactory from '@/components/clip-factory/ClipFactory'
import LaunchKit from '@/components/launch-kit/LaunchKit'
import UnfinishedGroupPosts, { type UnfinishedPost } from '@/components/meta/UnfinishedGroupPosts'
import { NICHE_PRESETS as NICHES, nicheWords, type NicheGroup } from '@/lib/facebook-niche'

type Place = { status: 'none' | 'group' | 'both'; groupPostUrl: string | null; pagePostUrl: string | null; at: string | null }
type Hub = {
  on: boolean
  recorded: boolean
  reviews: Array<Place & { id: string; title: string; url: string; videoId: string | null; createdAt: string }>
  clips: Array<Place & { id: string; title: string; videoId: string; videoTitle: string | null; url: string; seconds: number; createdAt: string }>
  videos: Array<{ id: string; title: string; thumbnailUrl: string | null; publishedAt: string | null }>
  history: Array<{ kind: string; title: string | null; groupPostUrl: string | null; pagePostUrl: string | null; at: string }>
  /** Group posts whose Page post never went out (app/api/facebook/hub). */
  unfinished?: UnfinishedPost[]
  disclaimer: string | null
}

type Setup = {
  on: boolean
  page: { id: string; name: string | null } | null
  groups: NicheGroup[]
}

type Access = 'checking' | 'granted' | 'not-granted' | 'no-scout' | 'old'
type StepKey = 'page' | 'groups' | 'scout' | 'reels' | 'reviews'


const FB = '#1877F2'
const OK = '#10B981'
const WARN = '#d97706'

function PlaceChip({ p }: { p: Place }) {
  if (p.status === 'both') return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold flex-wrap" style={{ color: OK }}>
      <Check size={12} /> In your Group and on your Page
      {p.groupPostUrl && <a href={p.groupPostUrl} target="_blank" rel="noopener noreferrer" className="underline font-normal">Group post</a>}
      {p.pagePostUrl && <a href={p.pagePostUrl} target="_blank" rel="noopener noreferrer" className="underline font-normal">Page</a>}
    </span>
  )
  if (p.status === 'group') return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold flex-wrap" style={{ color: WARN }}>
      In your Group, not on your Page yet
      {p.groupPostUrl && <a href={p.groupPostUrl} target="_blank" rel="noopener noreferrer" className="underline font-normal">Group post</a>}
    </span>
  )
  return <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>Not on Facebook yet</span>
}

/** One numbered step: ticks when done, opens and closes on a tap. */
function Step({ n, title, done, summary, open, onToggle, children }: {
  n: number; title: string; done: boolean; summary?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode
}) {
  return (
    <section className="card rounded-2xl border" style={{ borderColor: done ? 'rgba(16,185,129,0.45)' : 'var(--border)' }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 p-4 text-left">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[13px] font-bold flex-shrink-0"
          style={done ? { background: OK, color: '#fff' } : { background: 'var(--surface-2, rgba(0,0,0,0.06))', color: 'var(--text)' }}>
          {done ? <Check size={15} /> : n}
        </span>
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>{title}</span>
          {summary && !open && <span className="text-[12.5px] truncate" style={{ color: 'var(--text-soft)' }}>{summary}</span>}
        </span>
        <ChevronDown size={16} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--text-faint)' }} />
      </button>
      {open && <div className="px-4 pb-4 flex flex-col gap-3">{children}</div>}
    </section>
  )
}

export default function MetaHubPage() {
  const tier = useEffectiveTier()
  const router = useRouter()
  // Pro and admin (lib/labs-preview facebook_setup, the same switch as the
  // Group-first post in Social Push).
  const open = tier !== null && canUsePreview('facebook_setup', tier)
  useEffect(() => { if (tier !== null && !canUsePreview('facebook_setup', tier)) router.replace('/dashboard') }, [tier, router])
  if (!open) return <div className="flex items-center justify-center py-24"><Loader2 size={18} className="animate-spin text-[#86868b]" /></div>
  return <MetaHub />
}

function NicheChips({ value, onPick }: { value: string; onPick: (niche: string) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {NICHES.map(([k]) => (
        <button key={k} type="button" onClick={() => onPick(k)}
          className="rounded-full px-2.5 py-1 text-[12px] font-semibold border"
          style={value.trim().toLowerCase() === k.toLowerCase() ? { background: FB, borderColor: FB, color: '#fff' } : { borderColor: 'var(--border)', color: 'var(--text)' }}>
          {k}
        </button>
      ))}
    </div>
  )
}

const inputCls = 'rounded-lg border px-3 py-2 text-[13px] bg-transparent'
const inputStyle = { borderColor: 'var(--border)', color: 'var(--text)' }

function MetaHub() {
  const [s, setS] = useState<Setup | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [add, setAdd] = useState({ name: '', url: '', niche: '', keywords: '' })
  const [editing, setEditing] = useState<{ url: string; name: string; niche: string; keywords: string } | null>(null)
  const [howTo, setHowTo] = useState(false)
  // The Launch Kit, inside Meta Hub: make the Page (step 1) or a niche Group (step 2).
  const [makePage, setMakePage] = useState(false)
  const [makeGroup, setMakeGroup] = useState(false)
  const [access, setAccess] = useState<Access>('checking')
  const [asking, setAsking] = useState(false)
  const [hub, setHub] = useState<Hub | null>(null)
  const [sharing, setSharing] = useState<Hub['reviews'][number] | null>(null)
  const [fbPages, setFbPages] = useState<Array<{ id: string; name: string; isDefault?: boolean }>>([])
  const [open, setOpen] = useState<Set<StepKey> | null>(null)
  const [reelVideo, setReelVideo] = useState<string | null>(null)
  const factoryRef = useRef<HTMLDivElement>(null)
  const tier = useEffectiveTier()

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/facebook/setup', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Could not load (${r.status})`)
      setS(d as Setup)
      setLoadError(null)
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load your Facebook setup') }
  }, [])

  const loadHub = useCallback(async () => {
    try {
      const r = await fetch('/api/facebook/hub', { cache: 'no-store' })
      const d = await r.json()
      if (r.ok && d.on) setHub(d as Hub)
    } catch { /* the steps still show; steps 4 and 5 say they could not load */ }
  }, [])

  useEffect(() => { load(); loadHub() }, [load, loadHub])
  // Back from the Facebook tab: show where the new post landed.
  // STAY IN META HUB: anything opened in another tab (Facebook, the SCOUT
  // store, Connect Socials, the Blog Post Generator) shows up here the moment
  // the creator comes back: the Page, the Groups, SCOUT and what got posted.
  useEffect(() => {
    const onFocus = () => {
      void load(); void loadHub()
      requestFacebookAccess(false).then((r) => setAccess(r.state)).catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load, loadHub])
  // Back from connecting the Page on Facebook (/api/auth/facebook?return=meta).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      if (q.get('fb_connected') !== '1') return
      toast.success('Your Page is connected')
      q.delete('fb_connected')
      window.history.replaceState(null, '', `/meta${q.toString() ? `?${q}` : ''}`)
    } catch { /* fine */ }
  }, [])
  // Several Pages (Pro): the review window offers a choice of Page.
  useEffect(() => {
    if (tier !== 'pro' && tier !== 'admin') return
    fetch('/api/social-accounts?platform=facebook').then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.accounts)) setFbPages(d.accounts.map((a: { id: string; displayName?: string; isDefault?: boolean }) => ({ id: a.id, name: a.displayName || 'Facebook Page', isDefault: a.isDefault }))) })
      .catch(() => {})
  }, [tier])
  useEffect(() => { requestFacebookAccess(false).then((r) => setAccess(r.state)).catch(() => setAccess('no-scout')) }, [])
  // /meta?video=<id> (an old Clip Factory link, or a reload) opens step 4 on it.
  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('video')
      if (v && /^[0-9a-f-]{36}$/i.test(v)) setReelVideo(v)
    } catch { /* opens as usual */ }
  }, [])

  const pageDone = !!s?.page
  const groupDone = (s?.groups.length ?? 0) > 0
  const scoutDone = access === 'granted'
  const reelsDone = !!hub?.clips.some((c) => c.status === 'both')
  const reviewsDone = !!hub?.reviews.some((r) => r.status === 'both')

  // First visit: open the first step not done yet (or Make Reels once set up).
  // After that the creator opens and closes steps as they like.
  useEffect(() => {
    if (open || !s || access === 'checking') return
    const first: StepKey = !pageDone ? 'page' : !groupDone ? 'groups' : !scoutDone ? 'scout' : 'reels'
    setOpen(new Set<StepKey>(reelVideo ? ['reels'] : [first]))
  }, [open, s, access, pageDone, groupDone, scoutDone, reelVideo])

  const isOpen = (k: StepKey) => !!open?.has(k)
  const toggle = (k: StepKey) => setOpen((o) => { const n = new Set(o ?? []); if (n.has(k)) n.delete(k); else n.add(k); return n })

  function makeReels(videoId: string) {
    setReelVideo(videoId)
    setOpen((o) => new Set([...(o ?? []), 'reels']))
    try { window.history.replaceState(null, '', `/meta?video=${videoId}`) } catch { /* fine */ }
    setTimeout(() => factoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  async function post(body: Record<string, unknown>, ok: string) {
    setSaving(true)
    try {
      const r = await fetch('/api/facebook/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Could not save (${r.status})`)
      toast.success(d.already ? 'That Group is already saved' : ok)
      await load()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
      return false
    } finally { setSaving(false) }
  }

  async function allowScout() {
    setAsking(true)
    const r = await requestFacebookAccess(true).catch(() => ({ state: 'no-scout' as const }))
    setAccess(r.state)
    setAsking(false)
    if (r.state === 'granted') toast.success('SCOUT can now fill your Group posts')
    else if (r.state === 'not-granted') toast.error('SCOUT was not allowed. Press the button again and choose Allow.')
  }

  if (loadError) return <div className="max-w-3xl mx-auto py-10 px-4 text-sm" style={{ color: '#DC2626' }}>{loadError}</div>
  if (!s) return <div className="flex items-center justify-center py-24"><Loader2 size={18} className="animate-spin text-[#86868b]" /></div>
  if (!s.on) return <div className="max-w-3xl mx-auto py-10 px-4 text-sm" style={{ color: 'var(--text-soft)' }}>Meta Hub is not open on your account yet.</div>

  const doneCount = [pageDone, groupDone, scoutDone, reelsDone, reviewsDone].filter(Boolean).length
  // Clip Factory reloads its Groups when they change here.
  const groupsSig = s.groups.map((g) => `${g.url}|${g.niche ?? ''}|${g.keywords ?? ''}`).join(';')
  const clipsWaiting = hub ? hub.clips.filter((c) => c.status !== 'both') : []
  const reviewsWaiting = hub ? hub.reviews.filter((r) => r.status !== 'both').length : 0

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Meta Hub</h1>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(220,38,38,0.12)', color: '#DC2626' }}>
            <FlaskConical size={11} /> Labs
          </span>
          <span className="ml-auto text-[12.5px] font-semibold" style={{ color: doneCount === 5 ? OK : 'var(--text-soft)' }}>{doneCount} of 5 done</span>
        </div>
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Your Facebook Page and niche Groups, set up and posting from one place.</p>
      </div>

      {/* HOW FACEBOOK WORKS, said once, plainly. */}
      <div className="rounded-2xl border p-4 flex flex-col gap-2" style={{ borderColor: 'rgba(24,119,242,0.35)', background: 'rgba(24,119,242,0.06)' }}>
        <p className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>Your Group holds the link. Your Page points to it.</p>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          You run one Page, where your Reels reach new people, and one Group per niche, like Kitchen or Automotive, where your Amazon links live.
          Every Reel on your Page starts with &quot;Get it here&quot; and a link to the exact Group post with that product. One tap, and they see the product and the link.
        </p>
      </div>

      {/* STEP 1: THE PAGE */}
      <Step n={1} title="Your Page" done={pageDone} open={isOpen('page')} onToggle={() => toggle('page')}
        summary={s.page ? `Connected: ${s.page.name || 'your Page'}` : 'Connect the Page MVP posts your Reels on'}>
        {s.page ? (
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Connected: <strong style={{ color: 'var(--text)' }}>{s.page.name || 'your Page'}</strong>. Every Reel goes on this one Page, whatever its niche.{' '}
            <a href="/connect-socials" target="_blank" rel="noopener noreferrer" className="underline">Change it</a>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
              One Page is enough for all your niches. MVP posts your Reels on it for you. Connect it first: Facebook asks you to allow MVP, then brings you straight back here.
            </p>
            <div className="flex gap-2 flex-wrap">
              <a href="/api/auth/facebook?return=meta" className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white" style={{ background: FB }}>Connect your Page</a>
              <button type="button" onClick={() => setMakePage((v) => !v)} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                {makePage ? 'Hide the Page kit' : 'No Page yet? Make one here'}
              </button>
            </div>
            {makePage && (
              <div className="flex flex-col gap-2">
                <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>MVP writes your Page&apos;s name, bio, category, first post, cover and profile picture. Create the Page on Facebook with them, then press Connect your Page above.</p>
                <LaunchKit only={['facebook']} embedded />
              </div>
            )}
          </div>
        )}
      </Step>

      {/* STEP 2: NICHE GROUPS */}
      <Step n={2} title="Your niche Groups" done={groupDone} open={isOpen('groups')} onToggle={() => toggle('groups')}
        summary={groupDone ? s.groups.map((g) => g.niche ? `${g.niche}: ${g.name}` : g.name).join(' · ') : 'A Group per niche holds your Amazon links'}>
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
          A Group per niche, all pointed to by your one Page. A clip goes to the Group whose words match its title and caption, so a kitchen Reel lands in your Kitchen Group. You can always pick another Group before you post.
        </p>
        {s.groups.length > 0 && (
          <ul className="flex flex-col gap-2">
            {s.groups.map((g) => editing?.url === g.url ? (
              <li key={g.url} className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: FB }}>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Group name" className={inputCls} style={inputStyle} />
                <NicheChips value={editing.niche} onPick={(n) => setEditing({ ...editing, niche: n, keywords: editing.keywords.trim() ? editing.keywords : nicheWords(n) })} />
                <input value={editing.niche} onChange={(e) => setEditing({ ...editing, niche: e.target.value })} placeholder="Niche, like Kitchen" className={inputCls} style={inputStyle} />
                <input value={editing.keywords} onChange={(e) => setEditing({ ...editing, keywords: e.target.value })} placeholder="Words that mean this niche, with commas: air fryer, blender, knife" className={inputCls} style={inputStyle} />
                <div className="flex gap-2">
                  <button disabled={saving} onClick={async () => { if (await post({ updateGroup: editing }, 'Group updated')) setEditing(null) }}
                    className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: FB }}>Save</button>
                  <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg text-[13px] border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Cancel</button>
                </div>
              </li>
            ) : (
              <li key={g.url} className="rounded-lg border px-3 py-2 flex flex-col gap-1" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 text-[13px]">
                  <Check size={14} className="flex-shrink-0" style={{ color: OK }} />
                  {g.niche
                    ? <span className="text-[11px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'rgba(24,119,242,0.12)', color: FB }}>{g.niche}</span>
                    : <span className="text-[11px] font-semibold" style={{ color: WARN }}>No niche yet</span>}
                  <span className="font-semibold truncate" style={{ color: 'var(--text)' }}>{g.name || 'Group'}</span>
                  <a href={g.url} target="_blank" rel="noopener noreferrer" className="text-[12px] underline" style={{ color: 'var(--text-faint)' }}>open</a>
                  <button onClick={() => setEditing({ url: g.url, name: g.name || '', niche: g.niche || '', keywords: g.keywords || '' })} className="ml-auto" style={{ color: 'var(--text-soft)' }} aria-label={`Edit ${g.name}`}>
                    <Pencil size={14} />
                  </button>
                  <button disabled={saving} onClick={() => post({ removeGroup: g.url }, 'Group removed')} className="text-[#DC2626]" aria-label={`Remove ${g.name}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-[12px] pl-6" style={{ color: 'var(--text-faint)' }}>
                  {g.keywords ? `Matches: ${g.keywords}` : s.groups.length > 1 ? 'No words yet, so clips only land here when you pick it. Press the pencil to add some.' : 'Your only Group, so every clip goes here.'}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => setMakeGroup((v) => !v)} className="px-3 py-2 rounded-lg text-[13px] font-semibold text-white" style={{ background: FB }}>
            {makeGroup ? 'Hide the Group kit' : 'Make a new niche Group'}
          </button>
        </div>
        {makeGroup && (
          <div className="flex flex-col gap-2">
            <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>
              Pick the niche. MVP writes the Group&apos;s name, web address, rules, welcome post and cover. Create it on Facebook from your Page, set it to Public, then paste its link at the bottom of the kit and it lands in your list above.
            </p>
            <LaunchKit only={['facebook_group']} embedded onGroupSaved={() => { void load() }} />
          </div>
        )}
        <form className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }} onSubmit={async (e) => {
          e.preventDefault()
          if (await post({ group: add }, 'Group saved')) setAdd({ name: '', url: '', niche: '', keywords: '' })
        }}>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Already have a Group? Add it</p>
          <NicheChips value={add.niche} onPick={(n) => setAdd({ ...add, niche: n, keywords: add.keywords.trim() ? add.keywords : nicheWords(n) })} />
          <div className="flex gap-2 flex-wrap">
            <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="Group name"
              className={`flex-1 min-w-[140px] ${inputCls}`} style={inputStyle} />
            <input value={add.url} onChange={(e) => setAdd({ ...add, url: e.target.value })} placeholder="facebook.com/groups/your-group" required
              className={`flex-[2] min-w-[200px] ${inputCls}`} style={inputStyle} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <input value={add.niche} onChange={(e) => setAdd({ ...add, niche: e.target.value })} placeholder="Niche, like Kitchen"
              className={`flex-1 min-w-[140px] ${inputCls}`} style={inputStyle} />
            <input value={add.keywords} onChange={(e) => setAdd({ ...add, keywords: e.target.value })} placeholder="Words that mean this niche, with commas"
              className={`flex-[2] min-w-[200px] ${inputCls}`} style={inputStyle} />
          </div>
          <button type="submit" disabled={saving || !add.url.trim()} className="self-start px-3 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: FB }}>
            Save Group
          </button>
        </form>
        <button type="button" onClick={() => setHowTo((v) => !v)} className="self-start text-[12.5px] font-semibold underline" style={{ color: FB }}>
          {howTo ? 'Hide' : 'No Group yet? How to make a niche Group'}
        </button>
        {howTo && (
          <ol className="text-[12.5px] leading-relaxed list-decimal pl-5 flex flex-col gap-1" style={{ color: 'var(--text-soft)' }}>
            <li>Open your Page on Facebook, go to <strong>Groups</strong> and press <strong>Create group</strong>, so the Group belongs to your Page.</li>
            <li>Name it after the niche, like &quot;Kitchen Deals and Finds&quot;. Or press <button type="button" onClick={() => setMakeGroup(true)} className="underline font-semibold">Make a new niche Group</button> and MVP writes the name, rules, welcome post and cover for you.</li>
            <li>Set privacy to <strong>Public</strong>. Amazon has to be able to see where your links are.</li>
            <li>Add the Group&apos;s address to your website list in Amazon Associates before your first link.</li>
            <li>Paste the Group&apos;s address in the kit (or under Already have a Group), and it is saved with its niche. Repeat for each niche.</li>
          </ol>
        )}
      </Step>

      {/* STEP 3: SCOUT */}
      <Step n={3} title="SCOUT on Facebook" done={scoutDone} open={isOpen('scout')} onToggle={() => toggle('scout')}
        summary={scoutDone ? 'SCOUT is allowed on Facebook' : 'Let SCOUT fill your Group posts'}>
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
          SCOUT is MVP&apos;s Chrome helper. It opens your Group in your own Facebook and puts the post, the clip and the link in the box. You press Post: Facebook lets no app do that.
        </p>
        {access === 'checking' && <p className="text-[13px] flex items-center gap-2" style={{ color: 'var(--text-faint)' }}><Loader2 size={14} className="animate-spin" /> Checking SCOUT…</p>}
        {access === 'granted' && <p className="text-[13px] flex items-center gap-2" style={{ color: OK }}><ShieldCheck size={15} /> SCOUT is allowed on Facebook.</p>}
        {access === 'not-granted' && (
          <button onClick={allowScout} disabled={asking} className="self-start px-3 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: FB }}>
            {asking ? 'Waiting for you to press Allow…' : 'Allow SCOUT on Facebook'}
          </button>
        )}
        {access === 'old' && (
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Your SCOUT asks for Facebook the first time it fills a Group post. Chrome updates SCOUT by itself; after that this step ticks itself.
          </p>
        )}
        {access === 'no-scout' && (
          <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" className="self-start inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-white" style={{ background: FB }}>
            Get SCOUT for Chrome <ExternalLink size={13} />
          </a>
        )}
      </Step>

      {hub && !hub.recorded && (
        <p className="text-[12px] px-1" style={{ color: WARN }}>MVP cannot show what is already on Facebook until the database is updated (migration 402), so everything below reads as not posted yet, and steps 4 and 5 cannot tick.</p>
      )}

      {/* STEP 4: MAKE REELS, with Clip Factory right here. */}
      <Step n={4} title="Make Reels" done={reelsDone} open={isOpen('reels')} onToggle={() => toggle('reels')}
        summary={!hub ? 'Clip Factory, right here' : reelsDone ? `${hub.clips.length - clipsWaiting.length} posted · ${clipsWaiting.length} clips waiting` : 'Ticks once your first Reel is in a Group and on your Page'}>
        {!groupDone && <p className="text-[12.5px]" style={{ color: WARN }}>Save a Group in step 2 first: the clip and its link go there, and the Reel points to it.</p>}
        {!hub && <p className="text-[13px] flex items-center gap-2" style={{ color: 'var(--text-faint)' }}><Loader2 size={14} className="animate-spin" /> Gathering your clips…</p>}
        {hub && clipsWaiting.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Clips not on Facebook yet</p>
            <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
              {clipsWaiting.slice(0, 8).map((c) => (
                <li key={c.id} className="py-2 flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px] flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{c.title}</span>
                    <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>{c.seconds}s clip{c.videoTitle ? ` from "${c.videoTitle}"` : ''}</span>
                    <PlaceChip p={c} />
                  </div>
                  <button onClick={() => makeReels(c.videoId)} className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white whitespace-nowrap" style={{ background: FB }}>
                    {c.status === 'group' ? 'Finish on my Page' : 'Post this Reel'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {hub && hub.videos.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Videos with no clips yet</p>
            <ul className="flex gap-2.5 overflow-x-auto pb-1">
              {hub.videos.map((v) => (
                <li key={v.id} className="w-[170px] flex-shrink-0">
                  <button onClick={() => makeReels(v.id)} className="w-full text-left rounded-xl border overflow-hidden flex flex-col"
                    style={{ borderColor: reelVideo === v.id ? FB : 'var(--border)' }}>
                    {v.thumbnailUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={v.thumbnailUrl} alt="" className="w-full aspect-video object-cover" />
                      : <span className="w-full aspect-video" style={{ background: 'var(--surface-2, rgba(0,0,0,0.06))' }} />}
                    <span className="p-2 text-[12px] font-semibold line-clamp-2" style={{ color: 'var(--text)' }}>{v.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div ref={factoryRef} className="rounded-xl border p-3 scroll-mt-4" style={{ borderColor: 'var(--border)' }}>
          {isOpen('reels') && <ClipFactory facebookOnly key={`${reelVideo ?? 'pick'}:${groupsSig}`} />}
        </div>
      </Step>

      {/* STEP 5: SHARE REVIEWS */}
      <Step n={5} title="Share your reviews" done={reviewsDone} open={isOpen('reviews')} onToggle={() => toggle('reviews')}
        summary={!hub ? 'A review becomes a Group post and a Page post' : hub.reviews.length === 0 ? 'No published reviews yet' : `${reviewsWaiting} of ${hub.reviews.length} not on Facebook yet`}>
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
          A review goes to the niche Group you pick, with your Amazon link,, and MVP posts on your Page linking to that Group post.
        </p>
        {!hub && <p className="text-[13px] flex items-center gap-2" style={{ color: 'var(--text-faint)' }}><Loader2 size={14} className="animate-spin" /> Gathering your reviews…</p>}
        {hub && (hub.reviews.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>No published reviews yet. Write one from a video in the <a href="/content" target="_blank" rel="noopener noreferrer" className="underline">Blog Post Generator</a>; it opens in a new tab and shows up here when you come back.</p>
        ) : (
          <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
            {hub.reviews.map((r) => (
              <li key={r.id} className="py-2.5 flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px] flex flex-col gap-0.5">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold hover:underline" style={{ color: 'var(--text)' }}>{r.title}</a>
                  <PlaceChip p={r} />
                </div>
                <button onClick={() => setSharing(r)} disabled={!groupDone}
                  className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white whitespace-nowrap disabled:opacity-50" style={{ background: FB }}>
                  {r.status === 'none' ? 'Post to Group + Page' : 'Post again'}
                </button>
              </li>
            ))}
          </ul>
        ))}
        {!groupDone && hub && <p className="text-[12px]" style={{ color: WARN }}>Save a Group in step 2 first: every review puts its link in a Group.</p>}
      </Step>

      {/* IN THE GROUP, NOT ON THE PAGE YET: finish each in one press. */}
      {hub && hub.recorded && (
        <UnfinishedGroupPosts items={hub.unfinished ?? []} groups={s.groups} pageName={s.page?.name ?? null} onDone={() => { void loadHub() }} />
      )}

      {/* WHAT WENT OUT */}
      {hub && hub.history.length > 0 && (
        <section className="card rounded-2xl border p-4 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Posted to Facebook</h2>
          <ul className="flex flex-col gap-1.5">
            {hub.history.map((h, i) => (
              <li key={i} className="text-[12.5px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-soft)' }}>
                <span className="font-semibold" style={{ color: 'var(--text)' }}>{h.kind === 'clip' ? 'Reel' : 'Review'}</span>
                <span className="truncate max-w-[280px]">{h.title || ''}</span>
                {h.groupPostUrl && <a href={h.groupPostUrl} target="_blank" rel="noopener noreferrer" className="underline">Group post</a>}
                {h.pagePostUrl ? <a href={h.pagePostUrl} target="_blank" rel="noopener noreferrer" className="underline">Page</a> : <span style={{ color: WARN }}>not on Page</span>}
                <span style={{ color: 'var(--text-faint)' }}>{new Date(h.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* EVERY TIME YOU POST: who does what, for posts and for Reels. */}
      <section className="card rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>How each post works</h2>
        {([
          {
            title: 'A Reel',
            where: 'from step 4',
            you: ['Pick a clip, press Facebook Reel, check the post, then Post to my Group + Page.', 'In the Facebook tab, wait for the clip to finish uploading, then press Post.'],
            mvp: ['SCOUT opens the matching niche Group, attaches the clip and writes the post with your product link.', 'MVP posts the Reel on your Page, with "Get it here" and a link to that exact Group post on the first line.'],
          },
          {
            title: 'A review or blog post',
            where: 'from step 5',
            you: ['Press Post to Group + Page, check the post, then press the button for your Group.', 'Press Post in the Facebook tab that opens.'],
            mvp: ['SCOUT opens your Group and writes the post, with your Amazon link and picture.', 'The moment it is up, MVP posts on your Page, linking to that Group post.'],
          },
        ]).map((w) => (
          <div key={w.title} className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
            <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>{w.title} <span className="font-normal text-[12.5px]" style={{ color: 'var(--text-faint)' }}>{w.where}</span></p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: FB }}>You do</p>
                <ol className="text-[12.5px] leading-snug list-decimal pl-4 flex flex-col gap-0.5" style={{ color: 'var(--text-soft)' }}>{w.you.map((t) => <li key={t}>{t}</li>)}</ol>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: OK }}>MVP does</p>
                <ol className="text-[12.5px] leading-snug list-decimal pl-4 flex flex-col gap-0.5" style={{ color: 'var(--text-soft)' }}>{w.mvp.map((t) => <li key={t}>{t}</li>)}</ol>
              </div>
            </div>
          </div>
        ))}
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          The one click that stays yours is Post in your Group: Facebook lets no app press it. Keep the MVP tab open until it says Done.
        </p>
      </section>

      <p className="text-[12px] pb-4" style={{ color: 'var(--text-faint)' }}>
        Want the why behind all this? Read <a href="/freeguide#facebook" target="_blank" rel="noopener noreferrer" className="underline">Module 9 of the Free Guide</a>.
      </p>

      {/* A review, posted from here: the same Group-first window as Social Push. */}
      {sharing && (
        <SocialPreviewModal
          platform="Facebook"
          platformKey="facebook"
          brandColor={FB}
          endpoint="/api/blog/facebook-post"
          postId={sharing.id}
          onClose={() => { setSharing(null); void loadHub() }}
          onPublished={() => { void loadHub() }}
          shareUrl={sharing.url}
          shareDisclaimer={hub?.disclaimer || '#ad #sponsored'}
          facebookGroups={s.groups}
          publishTargetLabel={s.page?.name || undefined}
          facebookPages={fbPages.length > 1 ? fbPages : undefined}
          groupFirst
        />
      )}
    </div>
  )
}
