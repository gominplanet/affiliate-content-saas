'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// META: everything for Facebook and Instagram in one place.
//
// Facebook works one way, said once: your Group gets the affiliate post, your
// Page gets a post pointing to it. In Social Push the creator presses one
// button: SCOUT opens the Group and fills in the post with the link and the
// picture, the creator presses Post (Facebook lets no app do that), and MVP
// posts on the Page by itself, linking to the Group post. A link to Facebook
// is never one of the outside links Meta rations, so no limit comes into it.
//
// So setup is three things: the Page connected, the Group saved, SCOUT
// allowed on Facebook. Instagram sits beside it with what is live and what is
// waiting on Meta. Written for people who did not grow up reading Graph API
// docs: short sentences, what it means for them, what to press.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, FlaskConical, Trash2, ExternalLink, ShieldCheck, Instagram } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { requestFacebookAccess } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL } from '@/lib/scout-version'

type Setup = {
  on: boolean
  page: { id: string; name: string | null } | null
  groups: Array<{ name: string; url: string }>
  instagram: { connected: boolean; username: string | null }
}

type Access = 'checking' | 'granted' | 'not-granted' | 'no-scout' | 'old'

export default function MetaPage() {
  const tier = useEffectiveTier()
  const router = useRouter()
  // Admin while it is tested (lib/labs-preview facebook_setup).
  useEffect(() => { if (tier !== null && tier !== 'admin') router.replace('/dashboard') }, [tier, router])
  if (tier !== 'admin') return <div className="flex items-center justify-center py-24"><Loader2 size={18} className="animate-spin text-[#86868b]" /></div>
  return <MetaSetup />
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

function MetaSetup() {
  const [s, setS] = useState<Setup | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupUrl, setGroupUrl] = useState('')
  const [access, setAccess] = useState<Access>('checking')
  const [asking, setAsking] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/facebook/setup', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `Could not load (${r.status})`)
      setS(d as Setup)
      setLoadError(null)
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load your Meta setup') }
  }, [])

  useEffect(() => { load() }, [load])
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
  if (!s.on) return <div className="max-w-2xl mx-auto py-10 px-4 text-sm" style={{ color: 'var(--text-soft)' }}>The Meta section is not open on your account yet.</div>

  const pageDone = !!s.page
  const groupDone = s.groups.length > 0
  const scoutDone = access === 'granted'
  const allDone = pageDone && groupDone && scoutDone

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Meta</h1>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(220,38,38,0.12)', color: '#DC2626' }}>
            <FlaskConical size={11} /> Labs
          </span>
        </div>
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Facebook and Instagram, set up and explained in one place.</p>
      </div>

      {/* HOW FACEBOOK WORKS, said once, plainly. */}
      <div className="rounded-2xl border p-4 flex flex-col gap-2.5" style={{ borderColor: 'rgba(24,119,242,0.35)', background: 'rgba(24,119,242,0.06)' }}>
        <p className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>On Facebook, your Group gets the links and your Page points to them.</p>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          When you push a post to Facebook from <Link href="/content?tab=posts" className="underline">Social Push</Link>, you press one button:
        </p>
        <ol className="text-[13px] leading-relaxed list-decimal pl-5 flex flex-col gap-1" style={{ color: 'var(--text-soft)' }}>
          <li><strong style={{ color: 'var(--text)' }}>Your Group.</strong> SCOUT opens your Group and fills in the post, with your Amazon link and the picture. You press Post. Facebook lets no app press it for you.</li>
          <li><strong style={{ color: 'var(--text)' }}>Your Page.</strong> The moment it is up, MVP posts on your Page by itself, linking to that Group post.</li>
        </ol>
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          Facebook limits how many outside links a Page can post, but links to your own Group never count. This way your Page never runs out.
        </p>
      </div>

      <h2 className="text-[13px] font-bold uppercase tracking-wider pt-1" style={{ color: 'var(--text-faint)' }}>Facebook setup</h2>

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

      {allDone && (
        <div className="rounded-2xl border p-4 text-[13px]" style={{ borderColor: 'rgba(16,185,129,0.45)', background: 'rgba(16,185,129,0.06)', color: 'var(--text-soft)' }}>
          <strong style={{ color: 'var(--text)' }}>Facebook is set.</strong> Go to <Link href="/content?tab=posts" className="underline">Social Push</Link>, press Facebook on any post, then press <strong style={{ color: 'var(--text)' }}>Post to your Group + Page</strong>.
        </div>
      )}

      {/* INSTAGRAM */}
      <h2 className="text-[13px] font-bold uppercase tracking-wider pt-2" style={{ color: 'var(--text-faint)' }}>Instagram</h2>
      <section className="card rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <Instagram size={17} className="text-[#E1306C]" />
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Your Instagram</h3>
        </div>
        {s.instagram.connected ? (
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Connected{s.instagram.username ? <>: <strong style={{ color: 'var(--text)' }}>@{s.instagram.username}</strong></> : ''}. MVP can post your Reels and Stories.{' '}
            <Link href="/connect-socials" className="underline">Change it</Link>
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Connect your Instagram business or creator account, and MVP can post your Reels and Stories.</p>
            <Link href="/connect-socials" className="self-start px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#E1306C' }}>Connect Instagram</Link>
          </div>
        )}
        <div className="rounded-xl px-3 py-2.5 text-[13px]" style={{ background: 'rgba(255,149,0,0.08)', color: 'var(--text-soft)' }}>
          <strong style={{ color: 'var(--text)' }}>Comment to DM: waiting for Meta.</strong> Someone comments a keyword, and gets your link in a private message.
          It is built, and it switches on once Meta approves MVP for messages. Nothing to set up yet.
        </div>
      </section>

      <p className="text-[12px] pb-4" style={{ color: 'var(--text-faint)' }}>
        Want the why behind all this? Read <a href="/freeguide#facebook" className="underline">Module 9 of the Free Guide</a>.
      </p>
    </div>
  )
}
