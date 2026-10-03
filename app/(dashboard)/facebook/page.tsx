'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE FACEBOOK HUB: everything a creator makes in MVP, pushed to their
// Facebook Page and Group, on one page. Facebook only, on purpose.
//
// One rule, said once: your Group holds the link, your Page points to it.
// A review becomes a Group post with the Amazon link and a Page post linking
// to it; a clip becomes a Group video with the link and a Page Reel linking to
// it. SCOUT fills each Group post, the creator presses Post (Facebook lets no
// app do that), and MVP does the Page part by itself. A link to Facebook is
// never one of the outside links Meta rations.
//
// The page: setup (Page, Group, SCOUT; folded away once done), then the queue
// of what is ready (Reels from clips, reviews, videos with no clip yet) with
// where each already is, then what went out, then how it works. Written for
// people who did not grow up reading Graph API docs.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, FlaskConical, Trash2, ExternalLink, ShieldCheck, Film, FileText, Youtube } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { requestFacebookAccess } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL } from '@/lib/scout-version'
import { SocialPreviewModal } from '@/components/content/SocialPreviewModal'

type Place = { status: 'none' | 'group' | 'both'; groupPostUrl: string | null; pagePostUrl: string | null; at: string | null }
type Hub = {
  on: boolean
  recorded: boolean
  reviews: Array<Place & { id: string; title: string; url: string; videoId: string | null; createdAt: string }>
  clips: Array<Place & { id: string; title: string; videoId: string; videoTitle: string | null; url: string; seconds: number; createdAt: string }>
  videos: Array<{ id: string; title: string; thumbnailUrl: string | null; publishedAt: string | null }>
  history: Array<{ kind: string; title: string | null; groupPostUrl: string | null; pagePostUrl: string | null; at: string }>
  disclaimer: string | null
}

function PlaceChip({ p }: { p: Place }) {
  if (p.status === 'both') return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold flex-wrap" style={{ color: '#10B981' }}>
      <Check size={12} /> In your Group and on your Page
      {p.groupPostUrl && <a href={p.groupPostUrl} target="_blank" rel="noopener noreferrer" className="underline font-normal">Group post</a>}
      {p.pagePostUrl && <a href={p.pagePostUrl} target="_blank" rel="noopener noreferrer" className="underline font-normal">Page</a>}
    </span>
  )
  if (p.status === 'group') return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold flex-wrap" style={{ color: '#d97706' }}>
      In your Group, not on your Page yet
      {p.groupPostUrl && <a href={p.groupPostUrl} target="_blank" rel="noopener noreferrer" className="underline font-normal">Group post</a>}
    </span>
  )
  return <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>Not on Facebook yet</span>
}

type Setup = {
  on: boolean
  page: { id: string; name: string | null } | null
  groups: Array<{ name: string; url: string }>
}

type Access = 'checking' | 'granted' | 'not-granted' | 'no-scout' | 'old'

export default function FacebookHubPage() {
  const tier = useEffectiveTier()
  const router = useRouter()
  // Admin while it is tested (lib/labs-preview facebook_setup).
  useEffect(() => { if (tier !== null && tier !== 'admin') router.replace('/dashboard') }, [tier, router])
  if (tier !== 'admin') return <div className="flex items-center justify-center py-24"><Loader2 size={18} className="animate-spin text-[#86868b]" /></div>
  return <FacebookHub />
}

function StepHead({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[13px] font-bold flex-shrink-0"
        style={done ? { background: '#10B981', color: '#fff' } : { background: 'var(--surface-2, rgba(0,0,0,0.06))', color: 'var(--text)' }}>
        {done ? <Check size={15} /> : n}
      </span>
      <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>{title}</h3>
    </div>
  )
}

function FacebookHub() {
  const [s, setS] = useState<Setup | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupUrl, setGroupUrl] = useState('')
  const [access, setAccess] = useState<Access>('checking')
  const [asking, setAsking] = useState(false)
  const [hub, setHub] = useState<Hub | null>(null)
  const [tab, setTab] = useState<'reels' | 'reviews' | 'videos'>('reels')
  const [setupOpen, setSetupOpen] = useState(false)
  const [sharing, setSharing] = useState<Hub['reviews'][number] | null>(null)
  const [fbPages, setFbPages] = useState<Array<{ id: string; name: string; isDefault?: boolean }>>([])
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
    } catch { /* the setup still shows; the queue says it could not load */ }
  }, [])

  useEffect(() => { load(); loadHub() }, [load, loadHub])
  // Several Pages (Pro): the review window offers a choice of Page.
  useEffect(() => {
    if (tier !== 'pro' && tier !== 'admin') return
    fetch('/api/social-accounts?platform=facebook').then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.accounts)) setFbPages(d.accounts.map((a: { id: string; displayName?: string; isDefault?: boolean }) => ({ id: a.id, name: a.displayName || 'Facebook Page', isDefault: a.isDefault }))) })
      .catch(() => {})
  }, [tier])
  useEffect(() => { requestFacebookAccess(false).then((r) => setAccess(r.state)).catch(() => setAccess('no-scout')) }, [])

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

  if (loadError) return <div className="max-w-2xl mx-auto py-10 px-4 text-sm" style={{ color: '#DC2626' }}>{loadError}</div>
  if (!s) return <div className="flex items-center justify-center py-24"><Loader2 size={18} className="animate-spin text-[#86868b]" /></div>
  if (!s.on) return <div className="max-w-2xl mx-auto py-10 px-4 text-sm" style={{ color: 'var(--text-soft)' }}>The Facebook hub is not open on your account yet.</div>

  const pageDone = !!s.page
  const groupDone = s.groups.length > 0
  const scoutDone = access === 'granted'
  const allDone = pageDone && groupDone && scoutDone
  const showSetup = !allDone || setupOpen
  const waiting = hub ? {
    reels: hub.clips.filter((c) => c.status !== 'both').length,
    reviews: hub.reviews.filter((r) => r.status !== 'both').length,
    videos: hub.videos.length,
  } : null

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Facebook</h1>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(220,38,38,0.12)', color: '#DC2626' }}>
            <FlaskConical size={11} /> Labs
          </span>
        </div>
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Everything you make in MVP, pushed to your Facebook Page and Group.</p>
      </div>

      {/* HOW FACEBOOK WORKS, said once, plainly. */}
      <div className="rounded-2xl border p-4 flex flex-col gap-2" style={{ borderColor: 'rgba(24,119,242,0.35)', background: 'rgba(24,119,242,0.06)' }}>
        <p className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>Your Group holds the link. Your Page points to it.</p>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          Facebook lets a Page post only a couple of outside links a month, and a link in a Reel&apos;s caption often can&apos;t be tapped.
          A link to your own Group always works. So your Amazon link goes in a Group post, and your Page sends people straight to that post: one tap, and they see the product and the link.
        </p>
      </div>

      {/* SET UP ONCE: folded into one line once all three are done. */}
      {allDone && !setupOpen ? (
        <div className="rounded-2xl border px-4 py-3 flex items-center gap-3 flex-wrap" style={{ borderColor: 'rgba(16,185,129,0.45)', background: 'rgba(16,185,129,0.06)' }}>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Set up</span>
          {[`Page: ${s.page?.name || 'connected'}`, `Group: ${s.groups[0]?.name || 'saved'}${s.groups.length > 1 ? ` +${s.groups.length - 1}` : ''}`, 'SCOUT on Facebook'].map((t) => (
            <span key={t} className="inline-flex items-center gap-1 text-[12.5px]" style={{ color: 'var(--text-soft)' }}><Check size={13} className="text-[#10B981]" /> {t}</span>
          ))}
          <button onClick={() => setSetupOpen(true)} className="ml-auto text-[12.5px] underline" style={{ color: 'var(--text-soft)' }}>Change</button>
        </div>
      ) : (
        <h2 className="text-[13px] font-bold uppercase tracking-wider pt-1" style={{ color: 'var(--text-faint)' }}>Set up once</h2>
      )}
      {showSetup && (<>

      {/* STEP 1: THE PAGE */}
      <section className="card rounded-2xl border p-4 flex flex-col gap-2.5" style={{ borderColor: 'var(--border)' }}>
        <StepHead n={1} title="Your Page" done={pageDone} />
        {s.page ? (
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Connected: <strong style={{ color: 'var(--text)' }}>{s.page.name || 'your Page'}</strong>.{' '}
            <Link href="/connect-socials" className="underline">Change it</Link>
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>MVP posts on your Facebook Page for you. Connect it first.</p>
            <div className="flex gap-2 flex-wrap">
              <Link href="/connect-socials" className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#1877F2' }}>Connect your Page</Link>
              <Link href="/social-launch-kit" className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>No Page yet? Make one</Link>
            </div>
          </div>
        )}
      </section>

      {/* STEP 2: THE GROUP */}
      <section className="card rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border)' }}>
        <StepHead n={2} title="Your deals Group" done={groupDone} />
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
          Your own Group is where people shop with you. Make it Public, so Amazon can see where your links are.
        </p>
        {s.groups.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {s.groups.map((g) => (
              <li key={g.url} className="flex items-center gap-2 text-[13px] rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                <Check size={14} className="text-[#10B981] flex-shrink-0" />
                <span className="font-semibold truncate" style={{ color: 'var(--text)' }}>{g.name || 'Group'}</span>
                <a href={g.url} target="_blank" rel="noopener noreferrer" className="text-[12px] underline truncate" style={{ color: 'var(--text-faint)' }}>open</a>
                <button disabled={saving} onClick={() => post({ removeGroup: g.url }, 'Group removed')} className="ml-auto text-[#DC2626]" aria-label={`Remove ${g.name}`}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="flex gap-2 flex-wrap" onSubmit={async (e) => {
          e.preventDefault()
          if (await post({ group: { name: groupName, url: groupUrl } }, 'Group saved')) { setGroupName(''); setGroupUrl('') }
        }}>
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name"
            className="flex-1 min-w-[140px] rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
          <input value={groupUrl} onChange={(e) => setGroupUrl(e.target.value)} placeholder="facebook.com/groups/your-group" required
            className="flex-[2] min-w-[200px] rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
          <button type="submit" disabled={saving || !groupUrl.trim()} className="px-3 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#1877F2' }}>
            {s.groups.length ? 'Add another' : 'Save Group'}
          </button>
        </form>
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          No Group yet? The <Link href="/social-launch-kit" className="underline">Social Launch Kit</Link> writes the name, rules, welcome post and cover for you.
          Before your first link, add the Group to your Amazon Associates website list.
        </p>
      </section>

      {/* STEP 3: SCOUT */}
      <section className="card rounded-2xl border p-4 flex flex-col gap-2.5" style={{ borderColor: 'var(--border)' }}>
        <StepHead n={3} title="Let SCOUT fill your Group posts" done={scoutDone} />
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
          SCOUT is MVP&apos;s Chrome helper. It opens your Group in your own Facebook and puts the post and picture in the box.
        </p>
        {access === 'checking' && <p className="text-[13px] flex items-center gap-2" style={{ color: 'var(--text-faint)' }}><Loader2 size={14} className="animate-spin" /> Checking SCOUT…</p>}
        {access === 'granted' && <p className="text-[13px] flex items-center gap-2" style={{ color: '#10B981' }}><ShieldCheck size={15} /> SCOUT is allowed on Facebook.</p>}
        {access === 'not-granted' && (
          <button onClick={allowScout} disabled={asking} className="self-start px-3 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: '#1877F2' }}>
            {asking ? 'Waiting for you to press Allow…' : 'Allow SCOUT on Facebook'}
          </button>
        )}
        {access === 'old' && (
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Your SCOUT asks for Facebook the first time it fills a Group post. Chrome updates SCOUT by itself; after that this step shows a tick here.
          </p>
        )}
        {access === 'no-scout' && (
          <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" className="self-start inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#1877F2' }}>
            Get SCOUT for Chrome <ExternalLink size={13} />
          </a>
        )}
      </section>

      </>)}

      {/* READY FOR FACEBOOK: everything made in MVP, and where it already is. */}
      <section className="card rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Ready for Facebook</h2>
          <p className="text-[12.5px]" style={{ color: 'var(--text-soft)' }}>What you have made in MVP, and where each piece already is. One button each.</p>
        </div>
        <div className="flex gap-1.5 flex-wrap" role="tablist">
          {([
            ['reels', 'Reels from your clips', Film],
            ['reviews', 'Your reviews', FileText],
            ['videos', 'Videos to turn into Reels', Youtube],
          ] as const).map(([k, label, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold border"
              style={tab === k ? { background: '#1877F2', borderColor: '#1877F2', color: '#fff' } : { borderColor: 'var(--border)', color: 'var(--text)' }}>
              <Icon size={13} /> {label}{waiting ? <span className="opacity-80">({waiting[k]})</span> : null}
            </button>
          ))}
        </div>
        {!hub && <p className="text-[13px] flex items-center gap-2" style={{ color: 'var(--text-faint)' }}><Loader2 size={14} className="animate-spin" /> Gathering your content…</p>}
        {hub && !hub.recorded && (
          <p className="text-[12px]" style={{ color: '#d97706' }}>MVP cannot show what is already on Facebook until the database is updated (migration 402), so everything reads as not posted yet.</p>
        )}
        {hub && tab === 'reels' && (
          hub.clips.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>No clips yet. Pick a video under <button onClick={() => setTab('videos')} className="underline">Videos to turn into Reels</button>, or open <Link href="/clip-factory" className="underline">Clip Factory</Link>.</p>
          ) : (
            <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
              {hub.clips.map((c) => (
                <li key={c.id} className="py-2.5 flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[220px] flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{c.title}</span>
                    <span className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>{c.seconds}s clip{c.videoTitle ? ` from "${c.videoTitle}"` : ''}</span>
                    <PlaceChip p={c} />
                  </div>
                  <Link href={`/clip-factory?video=${c.videoId}`} className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white whitespace-nowrap" style={{ background: '#1877F2' }}>
                    {c.status === 'none' ? 'Post Reel to Group + Page' : c.status === 'group' ? 'Finish on my Page' : 'Post again'}
                  </Link>
                </li>
              ))}
            </ul>
          )
        )}
        {hub && tab === 'reviews' && (
          hub.reviews.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>No published reviews yet. Write one from a video in the <Link href="/content" className="underline">Blog Post Generator</Link>.</p>
          ) : (
            <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
              {hub.reviews.map((r) => (
                <li key={r.id} className="py-2.5 flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[220px] flex flex-col gap-0.5">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold hover:underline" style={{ color: 'var(--text)' }}>{r.title}</a>
                    <PlaceChip p={r} />
                  </div>
                  <button onClick={() => setSharing(r)} disabled={!groupDone}
                    className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white whitespace-nowrap disabled:opacity-50" style={{ background: '#1877F2' }}>
                    {r.status === 'none' ? 'Post to Group + Page' : 'Post again'}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        {hub && tab === 'videos' && (
          hub.videos.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Every recent video already has clips. Find them under Reels from your clips.</p>
          ) : (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {hub.videos.map((v) => (
                <li key={v.id} className="rounded-xl border overflow-hidden flex flex-col" style={{ borderColor: 'var(--border)' }}>
                  {v.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.thumbnailUrl} alt="" className="w-full aspect-video object-cover" />
                  )}
                  <div className="p-2.5 flex flex-col gap-2">
                    <span className="text-[12.5px] font-semibold line-clamp-2" style={{ color: 'var(--text)' }}>{v.title}</span>
                    <Link href={`/clip-factory?video=${v.id}`} className="self-start px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white" style={{ background: '#1877F2' }}>Make Facebook Reels</Link>
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
        {!groupDone && hub && (
          <p className="text-[12px]" style={{ color: '#d97706' }}>Save your deals Group above first: every post here puts its link in your Group.</p>
        )}
      </section>

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
                {h.pagePostUrl ? <a href={h.pagePostUrl} target="_blank" rel="noopener noreferrer" className="underline">Page</a> : <span style={{ color: '#d97706' }}>not on Page</span>}
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
            title: 'A review or blog post',
            where: <>from Your reviews above, or <Link href="/content?tab=posts" className="underline">Social Push</Link></>,
            you: ['Press Post to Group + Page, check the post, then press the button for your Group.', 'Press Post in the Facebook tab that opens.'],
            mvp: ['SCOUT opens your Group and writes the post, with your Amazon link and picture.', 'The moment it is up, MVP posts on your Page, linking to that Group post.'],
          },
          {
            title: 'A Reel',
            where: <>from Reels from your clips above, or <Link href="/clip-factory" className="underline">Clip Factory</Link></>,
            you: ['Press Facebook Reel, check the post, then Post to my Group + Page.', 'In the Facebook tab, wait for the clip to finish uploading, then press Post.'],
            mvp: ['SCOUT opens your Group, attaches the clip and writes the post with your product link.', 'MVP posts the Reel on your Page, with "Get it here" and a link to that exact Group post on the first line.'],
          },
        ]).map((w) => (
          <div key={w.title} className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)' }}>
            <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>{w.title} <span className="font-normal text-[12.5px]" style={{ color: 'var(--text-faint)' }}>{w.where}</span></p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#1877F2' }}>You do</p>
                <ol className="text-[12.5px] leading-snug list-decimal pl-4 flex flex-col gap-0.5" style={{ color: 'var(--text-soft)' }}>{w.you.map((t) => <li key={t}>{t}</li>)}</ol>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#10B981' }}>MVP does</p>
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
        Want the why behind all this? Read <a href="/freeguide#facebook" className="underline">Module 9 of the Free Guide</a>.
      </p>

      {/* A review, posted from here: the same Group-first window as Social Push. */}
      {sharing && (
        <SocialPreviewModal
          platform="Facebook"
          platformKey="facebook"
          brandColor="#1877F2"
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
