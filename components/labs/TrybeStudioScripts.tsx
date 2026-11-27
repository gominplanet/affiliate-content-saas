'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE VIDEO BUILDER'S SCRIPTS (Seb, 2026-11-27: "create these different
// unique scripts that now users can use to shoot their videos ... The
// different hooks, the different bodies, and the different CTAs and the
// different B-roll"; "an option here for only voiceover type videos, and then
// also videos that have talking head"). Modular scripts from the brand's
// rules (lib/studio-scripts), checked against them, with a shoot sheet to
// print or save as a PDF.

import { useState } from 'react'
import { Loader2, AlertTriangle, Check, Printer, RefreshCw, Mic, Video } from 'lucide-react'
import { VIDEO_TYPES, MAX_PARTS, secondsOf, bodyText, type ModularScripts, type VideoType, type ScriptCheck } from '@/lib/studio-scripts'

const ACCENT = 'var(--accent)'
const GREEN = '#16A34A'
const RED = '#DC2626'
const AMBER = '#B45309'
const soft = { color: 'var(--text-3)' }
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-50'

export interface BuilderProject { id: string; brandId: string; product: string; videoType: VideoType; scripts: ModularScripts | null; check: ScriptCheck | null; options: { settings?: unknown; music?: { bedId: string; label: string } | null } | null; updatedAt: string }

const esc = (s: string) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** A plain page to print or save as a PDF: every part, what to say and what to film. */
function printSheet(brand: string, product: string, s: ModularScripts) {
  const w = window.open('', '_blank')
  if (!w) return false
  const part = (id: string, title: string, rows: string) => `<section><h3>${esc(id)}${title ? ` <span>${esc(title)}</span>` : ''}</h3>${rows}</section>`
  const line = (say: string, show: string) => `<p><b>Say:</b> ${esc(say)}</p>${show ? `<p class="show"><b>Film:</b> ${esc(show)}</p>` : ''}`
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(brand)} ${esc(product)} shoot sheet</title><style>body{font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px;max-width:760px}h1{font-size:22px;margin:0}h2{font-size:16px;margin:24px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}h3{font-size:14px;margin:12px 0 2px}h3 span{font-weight:400;color:#555}p{margin:2px 0}.show{color:#555}section{break-inside:avoid}</style></head><body>
<h1>${esc(brand)}: ${esc(product)}</h1><p class="show">${esc(VIDEO_TYPES[s.type].label)}. Any hook works with any body and any CTA.</p>
<h2>Hooks</h2>${s.hooks.map((h) => part(h.id, h.style, line(h.say, h.show) + (h.onScreen ? `<p class="show"><b>On screen:</b> ${esc(h.onScreen)}</p>` : ''))).join('')}
<h2>Bodies</h2>${s.bodies.map((b) => part(b.id, b.angle, b.lines.map((l) => line(l.say, l.show)).join(''))).join('')}
${s.ctas.length ? `<h2>CTAs</h2>${s.ctas.map((c) => part(c.id, '', line(c.say, c.show) + (c.onScreen ? `<p class="show"><b>On screen:</b> ${esc(c.onScreen)}</p>` : ''))).join('')}` : ''}
${s.broll.length ? `<h2>B-roll to film</h2>${s.broll.map((r) => `<p><b>${esc(r.shot)}</b>: ${esc(r.shows)}${r.forBodies.length ? ` <span class="show">(for ${esc(r.forBodies.join(', '))})</span>` : ''}</p>`).join('')}` : ''}
</body></html>`)
  w.document.close()
  setTimeout(() => { try { w.focus(); w.print() } catch { /* the page is open to print by hand */ } }, 300)
  return true
}

export default function TrybeStudioScripts({ brand, project, hasRules, onProject }: {
  brand: { id: string; name: string }
  project: BuilderProject
  hasRules: boolean
  onProject: (p: BuilderProject) => void
}) {
  const [type, setType] = useState<VideoType>(project.videoType)
  const [counts, setCounts] = useState({ hooks: project.scripts?.hooks.length || 3, bodies: project.scripts?.bodies.length || 3, ctas: project.scripts ? project.scripts.ctas.length : 3 })
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const s = project.scripts
  const c = project.check

  async function write() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/labs/trybe-studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scripts', projectId: project.id, videoType: type, ...counts, context }), signal: AbortSignal.timeout(290_000) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `MVP answered ${r.status}`)
      onProject(j.project as BuilderProject)
    } catch (e) { setErr(e instanceof Error ? (/timeout|abort/i.test(e.message) ? 'No answer in five minutes. Try again.' : e.message) : 'No answer') } finally { setBusy(false) }
  }

  const sel = (k: keyof typeof counts, label: string, min: number) => (
    <label className="inline-flex items-center gap-1.5 text-[13px]"><span className="font-semibold">{label}</span>
      <select value={counts[k]} onChange={(e) => setCounts({ ...counts, [k]: Number(e.target.value) })} className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)' }}>
        {Array.from({ length: MAX_PARTS - min + 1 }, (_, i) => i + min).map((n) => <option key={n} value={n}>{n}</option>)}
      </select></label>
  )
  const total = counts.hooks * counts.bodies * Math.max(1, counts.ctas)

  return (
    <section className="rounded-2xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} aria-label="Scripts">
      <div>
        <h3 className="text-[17px] font-bold">Scripts for {project.product}</h3>
        <p className="text-[12.5px]" style={soft}>Hooks, bodies and CTAs where any hook works with any body and any CTA, plus the B-roll to film, written from {brand.name}&rsquo;s rules and checked against them.</p>
      </div>
      {!hasRules && <p className="text-[12.5px] inline-flex items-start gap-1.5" style={{ color: AMBER }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Read {brand.name}&rsquo;s rules first, in the step before: the scripts are written from them.</p>}

      <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Video type">
        {(Object.keys(VIDEO_TYPES) as VideoType[]).map((t) => (
          <button key={t} role="radio" aria-checked={type === t} onClick={() => setType(t)} className="rounded-xl px-3 py-2.5 text-left" style={type === t ? { border: `2px solid ${ACCENT}`, background: 'rgb(var(--brand-rgb) / 0.06)' } : { border: '1px solid var(--border)' }}>
            <span className="text-[14px] font-bold inline-flex items-center gap-1.5">{t === 'talking' ? <Video size={15} /> : <Mic size={15} />} {VIDEO_TYPES[t].label}</span>
            <span className="text-[12px] block mt-0.5" style={soft}>{VIDEO_TYPES[t].says}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {sel('hooks', 'Hooks', 1)}{sel('bodies', 'Bodies', 1)}{sel('ctas', 'CTAs', 0)}
        <span className="text-[12.5px]" style={soft}>Up to {total} different videos from one shoot.</span>
      </div>
      <label className="block text-[12.5px]"><span className="font-semibold">Context</span> <span style={soft}>(optional: who is on camera, where you film, what is true about you)</span>
        <textarea rows={2} value={context} onChange={(e) => setContext(e.target.value.slice(0, 2000))} placeholder="e.g. Michelle films in the kitchen; Walter, our French bulldog, can be in the B-roll." className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)' }} /></label>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => void write()} disabled={busy || !hasRules} className={btn} style={{ background: ACCENT, color: '#fff', padding: '10px 16px', fontSize: 14 }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {s ? 'Write new scripts' : 'Write the scripts'}
        </button>
        <span className="text-[12.5px]" style={soft}>{busy ? 'Writing and checking them against the rules. Usually 30 to 90 seconds.' : s ? 'Writing new ones replaces these.' : ''}</span>
        {s && <button onClick={() => { if (!printSheet(brand.name, project.product, s)) setErr('Your browser blocked the shoot sheet window. Allow pop-ups for MVP and try again.') }} className={btn} style={{ border: '1px solid var(--border)', color: 'var(--text)' }}><Printer size={14} /> Shoot sheet (print or PDF)</button>}
      </div>
      {err && <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: RED }}><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}</p>}

      {s && (
        <>
          {c && (
            <ul className="space-y-1">
              {c.items.map((it) => <li key={it.text} className="text-[12.5px] inline-flex items-start gap-1.5 w-full" style={{ color: it.tone === 'ok' ? GREEN : it.tone === 'bad' ? RED : AMBER }}>{it.tone === 'ok' ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />} {it.text}</li>)}
            </ul>
          )}
          {s.type !== type && <p className="text-[12.5px]" style={{ color: AMBER }}>These were written as {VIDEO_TYPES[s.type].label.toLowerCase()}. Write new scripts for {VIDEO_TYPES[type].label.toLowerCase()}.</p>}
          <div className="grid lg:grid-cols-3 gap-3">
            <div className="space-y-2">
              <p className="text-[11.5px] font-bold uppercase" style={{ ...soft, letterSpacing: '0.07em' }}>Hooks</p>
              {s.hooks.map((h) => (
                <div key={h.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[12px] font-bold" style={{ color: ACCENT }}>{h.id}{h.style ? ` · ${h.style}` : ''} <span className="font-normal" style={soft}>about {Math.round(secondsOf(h.say))}s</span></p>
                  <p className="text-[13.5px] font-semibold mt-0.5">&ldquo;{h.say}&rdquo;</p>
                  {h.show && <p className="text-[12px] mt-0.5" style={soft}>Film: {h.show}</p>}
                  {h.onScreen && <p className="text-[12px]" style={soft}>On screen: {h.onScreen}</p>}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-[11.5px] font-bold uppercase" style={{ ...soft, letterSpacing: '0.07em' }}>Bodies</p>
              {s.bodies.map((b) => (
                <div key={b.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[12px] font-bold" style={{ color: ACCENT }}>{b.id}{b.angle ? ` · ${b.angle}` : ''} <span className="font-normal" style={soft}>about {Math.round(secondsOf(bodyText(b)))}s</span></p>
                  {b.lines.map((l, i) => <div key={i} className="mt-1"><p className="text-[13px]">&ldquo;{l.say}&rdquo;</p>{l.show && <p className="text-[12px]" style={soft}>Film: {l.show}</p>}</div>)}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-[11.5px] font-bold uppercase" style={{ ...soft, letterSpacing: '0.07em' }}>CTAs</p>
              {s.ctas.length === 0 && <p className="text-[12.5px]" style={soft}>None: each body ends the video.</p>}
              {s.ctas.map((x) => (
                <div key={x.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[12px] font-bold" style={{ color: ACCENT }}>{x.id} <span className="font-normal" style={soft}>about {Math.round(secondsOf(x.say))}s</span></p>
                  <p className="text-[13px] mt-0.5">&ldquo;{x.say}&rdquo;</p>
                  {x.show && <p className="text-[12px] mt-0.5" style={soft}>Film: {x.show}</p>}
                  {x.onScreen && <p className="text-[12px]" style={soft}>On screen: {x.onScreen}</p>}
                </div>
              ))}
              {s.broll.length > 0 && (
                <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[11.5px] font-bold uppercase mb-1" style={{ ...soft, letterSpacing: '0.07em' }}>B-roll to film</p>
                  <ul className="space-y-1">{s.broll.map((r) => <li key={r.shot} className="text-[12.5px]"><b>{r.shot}</b>: {r.shows}{r.forBodies.length ? <span style={soft}> ({r.forBodies.join(', ')})</span> : null}</li>)}</ul>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
