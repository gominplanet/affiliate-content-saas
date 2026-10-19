// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TEAM'S TOP 100 COLLECTION, one pass, for two callers: the Collect press
// on the Top 100 words tab, and the run that happens by itself on the team's
// first TRYBE visit of the day (Seb, 2026-10-18: "could we not do this
// automatically once a day?").
//
// Reads today's Top 100 through SCOUT, files every entry, then fills the
// words: TRYBE's own script first because it is free, and only then a
// transcription, which costs. The press listens itself; the daily run leaves
// listening to the server's job (app/api/cron/trybe-top-hear), which needs no
// SCOUT and keeps to its daily cap. Every count that comes back as zero is
// reported with the reason it was zero.
'use client'

import { requestTrybeApi } from '@/lib/extension-frame'
import { readScript } from '@/lib/trybe-mybrands'
import { readTopEntries, topEntryFields } from '@/lib/trybe-working'

export interface CollectReport { tone: 'ok' | 'warn'; lines: string[]; filed: number; shared: number; heard: number }

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  try {
    const r = await fetch('/api/labs/trybe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
    })
    const json = await r.json().catch(() => ({}))
    return { ok: r.ok, json: (json && typeof json === 'object' ? json : {}) as Record<string, unknown> }
  } catch (e) {
    return { ok: false, json: { error: e instanceof Error ? e.message : 'No answer.' } }
  }
}

export async function collectTop100(o: { listen: boolean; onStep?: (s: string) => void; shouldStop?: () => boolean }): Promise<{ ok: true; report: CollectReport } | { ok: false; error: string }> {
  const step = o.onStep ?? (() => {})
  const stopped = o.shouldStop ?? (() => false)
  step('Reading TRYBE’s Top 100')
  const top = await requestTrybeApi('GET', '/backend/api/creator/v2/top-creatives')
  if (!top.ok) return { ok: false, error: `MVP could not read the Top 100: ${top.error || 'SCOUT did not answer.'}` }
  const entries = readTopEntries(top.json)
  if (!entries.length) return { ok: false, error: 'TRYBE answered, but MVP could not read the Top 100 from it.' }
  const withFile = entries.filter((e) => e.video).length

  // The entry's id goes as submissionId, the name the route files it under.
  const seen = await post({ action: 'top_scripts_seen', entries: entries.map((e) => ({ ...e, submissionId: e.id })) })
  if (!seen.ok) return { ok: false, error: String(seen.json.error || 'MVP could not file the Top 100.') }
  // FILED IS WHAT THE ROUTE SAVED, not what the page sent. The page once
  // said it filed 100 while the route had dropped every one of them.
  const filed = Number(seen.json.saved) || 0
  const noId = Number(seen.json.noId) || 0
  const need = (seen.json.need ?? []) as Array<{ submissionId: string }>
  const hear = new Set((seen.json.hear ?? []) as string[])
  const noFile = Number(seen.json.noFile) || 0
  const waiting = Number(seen.json.waiting) || 0
  const hearLeft = Number(seen.json.hearLeft) || 0
  // Today's videos that were filed on an earlier collection: how many have
  // their words, and why the rest have none (lib/trybe-scripts whyNoWords).
  const haveWords = Number(seen.json.haveWords) || 0
  const noneWhy = typeof seen.json.noneWhy === 'string' ? seen.json.noneWhy : ''

  // FREE FIRST. TRYBE shares the words for some of them at no cost, and
  // readScript is what turns its answer into words.
  let shared = 0, refused = 0, empty = 0
  for (let i = 0; i < need.length && !stopped(); i++) {
    step(`Asking TRYBE for the words (${i + 1} of ${need.length})`)
    const id = need[i].submissionId
    const sr = await requestTrybeApi('GET', `/backend/api/creator/v2/submissions/${encodeURIComponent(id)}/script`).catch(() => null)
    if (!sr) { refused++; continue }
    if (!sr.ok) { refused++; continue }
    const text = readScript(sr.json)
    const saved = await post({ action: 'top_script_save', submissionId: id, script: text })
    if (saved.ok && Number(saved.json.saved) === 1) { shared++; hear.delete(id) } else empty++
  }

  // THEN THE ONES THAT COST, best placed first: on a press only.
  const toHear = o.listen ? [...hear] : []
  let heard = 0, failed = 0
  let notConfigured = false
  // WHY EACH ONE DID NOT COME BACK, counted, so a line saying five did
  // not come back carries its reason instead of leaving the team to guess.
  const whyNot = new Map<string, number>()
  for (let i = 0; i < toHear.length && !stopped(); i++) {
    step(`Listening to the video (${i + 1} of ${toHear.length})`)
    const h = await post({ action: 'top_script_hear', submissionId: toHear[i] })
    if (h.ok && Number(h.json.heard) === 1) heard++
    else {
      failed++
      if (/not configured/i.test(String(h.json.error || ''))) { notConfigured = true; break }
      const why = String(h.json.error || (h.json.why ? `it heard ${h.json.why}` : 'no answer came back'))
        .replace(/^MVP could not listen to that video:\s*/i, '').slice(0, 140)
      whyNot.set(why, (whyNot.get(why) ?? 0) + 1)
    }
  }
  const reasons = [...whyNot].sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([why, n]) => (whyNot.size > 1 ? `${n}: ${why}` : why)).join('; ')

  // EVERY ZERO WITH ITS REASON.
  const lines: string[] = [filed
    ? `Filed ${filed} of the ${entries.length} videos in today’s Top 100.`
    : `MVP filed none of the ${entries.length} videos in today’s Top 100.`]
  if (noId) lines.push(`${noId} came without a video id in TRYBE’s answer, so MVP had nothing to file them under or ask TRYBE about.`)
  // HOW MANY WERE ASKED, and how many TRYBE turned down, whether or not
  // some came back. A line saying TRYBE shared 7 hid that 53 were refused.
  const turnedDown = refused ? `, and refused ${refused} of those outright` : ''
  if (need.length) lines.push(shared
    ? `TRYBE shared the words for ${shared} of the ${need.length} MVP asked about${turnedDown}.`
    : `TRYBE shared the words for none of the ${need.length} MVP asked about${turnedDown}.`)
  else if (filed) {
    // UP TO DATE IS NOT A WARNING (Seb, 2026-10-19). The page said this in
    // amber, with "nothing was paid for" under it, and read as a failure.
    lines.push(`All of them were filed on an earlier collection, so there was nothing new to ask TRYBE about. ${haveWords} of today’s ${entries.length} have their words.`)
    if (noneWhy) lines.push(noneWhy)
  }
  if (empty) lines.push(`${empty} came back with nothing MVP could read.`)
  if (noFile) lines.push(`${noFile} of them have no video file in TRYBE’s answer, so nothing can listen to those.`)
  if (!o.listen) {
    // THE DAILY RUN DOES NOT LISTEN: the server's job does, on its own.
    const queued = hear.size + hearLeft
    if (queued) lines.push(`${queued} with a video file are left for MVP to listen to. It does that on its own over the next few hours, up to 25 a day.`)
  } else if (notConfigured) lines.push('Transcription is not switched on for this deployment, so MVP could not listen to any of them.')
  else if (toHear.length) lines.push(heard
    ? `MVP listened to ${heard} of ${toHear.length}.${failed ? ` ${failed} did not come back${reasons ? ` (${reasons})` : ''}.` : ''}`
    : `MVP could not listen to any of the ${toHear.length} it tried${reasons ? ` (${reasons})` : ''}.`)
  else if (need.length || withFile === 0) lines.push(`Nothing was left with a video file to listen to, so nothing was paid for.${withFile === 0 ? ' TRYBE sent no video files at all in this answer.' : ''}`)
  // WHAT IS LEFT, so a board at 23 of 100 reads as a first pass rather
  // than the whole of it. Listening is capped per collection because it
  // costs, so the next press does the next ones.
  const stillWaiting = Math.max(0, waiting - shared - heard)
  if (o.listen && stillWaiting) {
    lines.push(`${stillWaiting} still have no words.${hearLeft ? ` ${hearLeft} of them have a video file MVP has not listened to yet, and Collect again listens to the next ${Math.min(hearLeft, 25)}.` : ''}`)
  }
  // WHAT TRYBE DID SEND, when none of it was a video file, so the next
  // fix is a field name rather than a guess.
  if (withFile === 0) lines.push(`Each entry TRYBE sent has: ${topEntryFields(top.json)}.`)
  // AMBER ONLY FOR A PROBLEM: nothing filed, entries without an id, TRYBE
  // refusing or answering with nothing, a listen that failed, transcription
  // off, or no files at all. A collection with nothing new to do is fine.
  const problem = !filed || noId > 0 || refused > 0 || empty > 0 || failed > 0 || notConfigured || withFile === 0
  return { ok: true, report: { tone: problem ? 'warn' : 'ok', lines, filed, shared, heard } }
}
