'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FACEBOOK SETUP: one page, three steps, one rule.
//
// "Your Page gets the content. Your Group gets the links." Meta limits many
// Pages to about 2 outside-link posts a month, and past that a link shows as
// plain text nobody can tap. Groups have no reported limit. So the creator
// connects the Page, says whether it is limited, saves their deals Group, and
// lets SCOUT fill Group posts. MVP then counts the Page's outside-link posts
// and stops one that would go past the limit (lib/facebook-link-budget).
//
// Written for people who did not grow up reading Graph API docs: short
// sentences, what it means for them, what to press.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, FlaskConical, Trash2, ExternalLink, Users, Link2, ShieldCheck } from 'lucide-react'
import { useEffectiveTier } from '@/lib/useEffectiveTier'
import { requestFacebookAccess } from '@/lib/extension-frame'
import { SCOUT_STORE_LISTING_URL } from '@/lib/scout-version'

type Setup = {
  on: boolean
  page: { id: string; name: string | null } | null
  linkLimit: 'limited' | 'unlimited' | 'unsure' | null
  allowance: number | null
  used: number
  left: number | null
  counted: boolean
  enforced: boolean
  windowDays: number
  groups: Array<{ name: string; url: string }>
}

type Access = 'checking' | 'granted' | 'not-granted' | 'no-scout' | 'old'

export default function FacebookSetupPage() {
  const tier = useEffectiveTier()
  const router = useRouter()
  // Admin while it is tested (lib/labs-preview facebook_setup).
  useEffect(() => { if (tier !== null && tier !== 'admin') router.replace('/dashboard') }, [tier, router])
  if (tier !== 'admin') return <div className="flex items-center justify-center py-24"><Loader2 size={18} className="animate-spin text-[#86868b]" /></div>
  return <FacebookSetup />
}

function StepHead({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[13px] font-bold flex-shrink-0"
        style={done ? { background: '#10B981', color: '#fff' } : { background: 'var(--surface-2, rgba(0,0,0,0.06))', color: 'var(--text)' }}>
        {done ? <Check size={15} /> : n}
      </span>
      <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>{title}</h2>
    </div>
  )
}

function FacebookSetup() {
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
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load your Facebook setup') }
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
  if (!s.on) return <div className="max-w-2xl mx-auto py-10 px-4 text-sm" style={{ color: 'var(--text-soft)' }}>Facebook setup is not open on your account yet.</div>

  const pageDone = !!s.page && s.linkLimit !== null
  const groupDone = s.groups.length > 0
  const scoutDone = access === 'granted'
  const allDone = pageDone && groupDone && scoutDone
  const limited = s.linkLimit !== 'unlimited'

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 flex flex-col gap-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Users size={20} className="text-[#1877F2]" />
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Facebook Setup</h1>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(220,38,38,0.12)', color: '#DC2626' }}>
          <FlaskConical size={11} /> Labs
        </span>
      </div>

      {/* THE RULE, said once, plainly. */}
      <div className="rounded-2xl border p-4 flex flex-col gap-2" style={{ borderColor: 'rgba(24,119,242,0.35)', background: 'rgba(24,119,242,0.06)' }}>
        <p className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>Your Page gets the content. Your Group gets the links.</p>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          Facebook now limits most Pages to about 2 posts a month with an outside link, like an Amazon link.
          After that, the link still shows, but as plain text nobody can tap. Groups have no reported limit.
          So your videos and reviews go on your Page, and your Amazon links go in your own Group.
        </p>
      </div>

      {/* STEP 1: THE PAGE */}
      <section className="card rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border)' }}>
        <StepHead n={1} title="Your Page" done={pageDone} />
        {s.page ? (
          <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            Connected: <strong style={{ color: 'var(--text)' }}>{s.page.name || 'your Page'}</strong>.{' '}
            <Link href="/connect-socials" className="underline">Change it</Link>
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>MVP posts your content to your Facebook Page. Connect it first.</p>
            <div className="flex gap-2 flex-wrap">
              <Link href="/connect-socials" className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#1877F2' }}>Connect your Page</Link>
              <Link href="/social-launch-kit" className="px-3 py-1.5 rounded-lg text-[13px] font-semibold border" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>No Page yet? Make one</Link>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Does Facebook limit your Page&apos;s links?</p>
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Check your Page&apos;s Professional Dashboard on Facebook. If it is limited, Facebook says so there.
          </p>
          <div className="grid gap-2">
            {([
              { v: 'limited', t: 'Yes, it is limited', d: 'MVP counts your link posts and stops before one would be wasted.' },
              { v: 'unsure', t: 'Not sure', d: 'MVP plays it safe and counts 2 a month. You can change this any time.' },
              { v: 'unlimited', t: 'No, my Page has no limit', d: 'For example, you pay for Meta One Max. MVP counts, but never stops a post.' },
            ] as const).map((o) => (
              <button key={o.v} disabled={saving} onClick={() => post({ linkLimit: o.v, allowance: o.v === 'limited' ? (s.allowance ?? 2) : null }, 'Saved')}
                className="text-left rounded-xl border px-3 py-2.5 transition-colors"
                style={s.linkLimit === o.v ? { borderColor: '#1877F2', background: 'rgba(24,119,242,0.07)' } : { borderColor: 'var(--border)' }}>
                <span className="block text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{s.linkLimit === o.v ? '● ' : '○ '}{o.t}</span>
                <span className="block text-[12px]" style={{ color: 'var(--text-soft)' }}>{o.d}</span>
              </button>
            ))}
          </div>
          {s.linkLimit === 'limited' && (
            <div className="flex items-center gap-2 flex-wrap text-[12px]" style={{ color: 'var(--text-soft)' }}>
              Links a month:
              {[2, 8, 20].map((n) => (
                <button key={n} disabled={saving} onClick={() => post({ linkLimit: 'limited', allowance: n }, `Set to ${n} a month`)}
                  className="px-2.5 py-1 rounded-lg border font-semibold"
                  style={s.allowance === n ? { borderColor: '#1877F2', color: '#1877F2' } : { borderColor: 'var(--border)', color: 'var(--text)' }}>
                  {n}
                </button>
              ))}
              <span>(2 free or Meta One Essential, 8 Advanced, 20 Expert)</span>
            </div>
          )}

          {/* THE COUNT, with what it can and cannot see. */}
          {s.page && (
            <div className="rounded-xl px-3 py-2.5 text-[13px] flex items-start gap-2"
              style={{ background: 'var(--surface-2, rgba(0,0,0,0.04))', color: 'var(--text-soft)' }}>
              <Link2 size={15} className="flex-shrink-0 mt-0.5" />
              {!s.counted ? (
                <span>MVP cannot count your Page&apos;s link posts yet, so it is not stopping any. (The database needs an update.)</span>
              ) : (
                <span>
                  <strong style={{ color: s.enforced && s.left === 0 ? '#DC2626' : 'var(--text)' }}>
                    Page links used: {s.used}{s.allowance != null && limited ? ` of ${s.allowance}` : ''}
                  </strong>{' '}
                  in the last {s.windowDays} days. This counts only posts MVP made; posts you put up yourself are not seen.
                  {s.linkLimit === null ? ' Answer the question above and MVP starts protecting your links.' : ''}
                </span>
              )}
            </div>
          )}
        </div>
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
        <form className="flex flex-col gap-2" onSubmit={async (e) => {
          e.preventDefault()
          if (await post({ group: { name: groupName, url: groupUrl } }, 'Group saved')) { setGroupName(''); setGroupUrl('') }
        }}>
          <div className="flex gap-2 flex-wrap">
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name"
              className="flex-1 min-w-[140px] rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            <input value={groupUrl} onChange={(e) => setGroupUrl(e.target.value)} placeholder="facebook.com/groups/your-group" required
              className="flex-[2] min-w-[200px] rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            <button type="submit" disabled={saving || !groupUrl.trim()} className="px-3 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#1877F2' }}>
              {s.groups.length ? 'Add another' : 'Save Group'}
            </button>
          </div>
        </form>
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          No Group yet? The <Link href="/social-launch-kit" className="underline">Social Launch Kit</Link> writes the name, rules, welcome post and cover for you.
          Before your first link, add the Group to your Amazon Associates website list.
        </p>
      </section>

      {/* STEP 3: SCOUT */}
      <section className="card rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border)' }}>
        <StepHead n={3} title="Let SCOUT fill your Group posts" done={scoutDone} />
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
          Facebook lets no app post in a Group. SCOUT opens your Group, puts the post and picture in the box, and you press Post.
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
            Your SCOUT asks for Facebook the first time you fill a Group post. Chrome updates SCOUT by itself; after that this step shows a tick here.
          </p>
        )}
        {access === 'no-scout' && (
          <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" className="self-start inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#1877F2' }}>
            Get SCOUT for Chrome <ExternalLink size={13} />
          </a>
        )}
      </section>

      {/* WHAT HAPPENS FROM NOW ON */}
      <section className="rounded-2xl border p-4 flex flex-col gap-2" style={allDone ? { borderColor: 'rgba(16,185,129,0.45)', background: 'rgba(16,185,129,0.06)' } : { borderColor: 'var(--border)' }}>
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>{allDone ? 'You are set. Here is how MVP posts for you:' : 'Once all three are ticked, MVP posts like this:'}</h2>
        <ul className="text-[13px] leading-relaxed list-disc pl-5" style={{ color: 'var(--text-soft)' }}>
          <li>Your Page gets your videos, reviews and Reels.</li>
          <li>Your Group gets the Amazon links: press Fill with SCOUT on any post, then press Post.</li>
          <li>After you post in the Group, MVP offers a short Page post that links to it. A link to your own Group never counts toward the limit.</li>
          <li>{limited ? 'If a Page post would go past your link limit, MVP stops it and tells you, instead of posting a link nobody can tap.' : 'MVP keeps counting your Page links, so you can see them here.'}</li>
        </ul>
      </section>
    </div>
  )
}
