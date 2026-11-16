// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/labs/trybe-batch — BATCH SCRIPTS FOR A BRAND CHALLENGE (lib/trybe-batch;
// Seb, 2026-11-14: "we need to add a functionality into trybe scriptwriting so
// people can do batches of scripts"). Pro (trybe_batch, open 2026-11-16).
//
// POST { action }:
//   list                          the creator's campaigns, and the month's allowance
//   get      { id }               one campaign: its setup and every script
//   save     { id?, campaign }    create or update a campaign's setup
//   delete   { id }               a campaign and its scripts
//   rules    { id, briefText?, trybe? }  the rules read from everything MVP has
//                                 for the brand (TRYBE's brief, what the brand sent,
//                                 its own description, anything pasted) and folded
//                                 onto the setup; the answer says what was read
//   write    { id }               the next round (up to 10): written, checked,
//                                 broken ones rewritten up to twice, saved
//   rewrite  { id, idx, note? }   one script written again, with the creator's note
//   update   { id, idx, patch }   edit a script, its status or its submission link
//   remove   { id, idx }          take one script out
//   recheck  { id }               every script checked again (after the rules change)
//
// Pro. 300 scripts a campaign, 600 a month, a quarter of that in the free week
// (lib/intro-allowance), counted on the member's real billing month. Rewrites
// replace a script, so they do not count; the AI spend ceiling still applies.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { spendGate } from '@/lib/ai-spend'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { billingWindow, normalizeTier } from '@/lib/tier'
import { introCap, introNote } from '@/lib/intro-allowance'
import { docsForScripts, type LinksDigest } from '@/lib/trybe-message-links'
import {
  readCampaign, runRound, checkScript, planSlots, parseScripts, writerSystem, writerPrompt, rulesFromReply, notReadyWords,
  estimateSeconds, rulesInput, claimsFromReply, contextFromReply, contextInput, contextStale, RULES_SYSTEM, CONTEXT_SYSTEM, BATCH_ROUND, MAX_PER_CAMPAIGN, SCRIPT_STATUSES,
  type Campaign, type Script, type ScriptStatus, type Ask, type ContextPlan,
} from '@/lib/trybe-batch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const WRITER = 'claude-sonnet-4-6'
const READER = 'claude-haiku-4-5-20251001'
/** Scripts a month on Pro; the free week gets a quarter. */
const MONTHLY = 600

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  const db = createAdminClient() as Db
  const { data: intg } = await db.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (intg?.tier as string | null) ?? null
  if (!canUsePreview('trybe_batch', tier)) return { error: NextResponse.json({ error: 'Batch scripts is part of MVP Pro.', code: 'tier_not_allowed' }, { status: 403 }) }
  return { userId: user.id, ownerId, tier, db }
}

/** The month's scripts: used, the limit, what is left. */
async function allowance(db: Db, ownerId: string, tier: string | null) {
  const t = normalizeTier(tier)
  const { data: ig } = await db.from('integrations').select('subscribed_at,subscription_period_start,subscription_period_end').eq('user_id', ownerId).maybeSingle()
  const subscribedAt = (ig?.subscribed_at as string | null | undefined) ?? null
  const limit = t === 'admin' ? null : introCap(MONTHLY, subscribedAt)
  const w = billingWindow({ periodStart: ig?.subscription_period_start ?? null, periodEnd: ig?.subscription_period_end ?? null })
  const { count } = await db.from('trybe_campaign_scripts').select('id', { count: 'exact', head: true }).eq('user_id', ownerId).gte('created_at', w.startISO)
  const used = count ?? 0
  return { used, limit, left: limit === null ? null : Math.max(0, limit - used), resetLabel: w.resetLabel, introNote: limit === null ? null : introNote(subscribedAt) }
}

const rowToScript = (r: Record<string, unknown>): Script => ({
  idx: Number(r.idx), title: String(r.title || ''), angle: String(r.angle || ''), host: String(r.host || ''), location: String(r.location || ''),
  realStory: r.real_story === true, realityReason: String(r.reality_reason || ''),
  story: Array.isArray(r.story) ? r.story as Script['story'] : [], body: Array.isArray(r.body) ? r.body as Script['body'] : [],
  estSeconds: Number(r.est_seconds) || 0, status: (SCRIPT_STATUSES as string[]).includes(String(r.status)) ? r.status as ScriptStatus : 'draft',
  link: (r.link as string | null) ?? null, notes: (r.notes as string | null) ?? null,
  checks: r.checks && typeof r.checks === 'object' && (r.checks as { state?: string }).state ? r.checks as Script['checks'] : { state: 'green', reasons: [], warnings: [] },
  tries: Number(r.tries) || 0,
})
const scriptToRow = (s: Script) => ({
  idx: s.idx, title: s.title, angle: s.angle, host: s.host, location: s.location, real_story: s.realStory, reality_reason: s.realityReason,
  story: s.story, body: s.body, est_seconds: s.estSeconds, status: s.status, link: s.link, notes: s.notes, checks: s.checks, tries: s.tries,
})

async function loadCampaign(db: Db, ownerId: string, id: string): Promise<{ c: Campaign; brandName: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await db.from('trybe_campaigns').select('id,brand_id,name,setup').eq('id', id).eq('user_id', ownerId).maybeSingle()
  if (!data) return null
  return { c: readCampaign({ ...(data.setup || {}), name: data.name, brandId: data.brand_id }, data.id), brandName: null }
}
async function loadScripts(db: Db, id: string): Promise<Script[]> {
  const { data } = await db.from('trybe_campaign_scripts').select('*').eq('campaign_id', id).order('idx', { ascending: true }).limit(MAX_PER_CAMPAIGN + 50)
  return ((data ?? []) as Record<string, unknown>[]).map(rowToScript)
}
const setupOf = (c: Campaign) => ({ brandName: c.brandName, product: c.product, rules: c.rules, reality: c.reality, creatorFacts: c.creatorFacts, angles: c.angles, hooks: c.hooks, references: c.references, feedback: c.feedback, target: c.target, deadline: c.deadline, context: c.context, contextPlan: c.contextPlan })

/** THE CONTEXT READ INTO STORY IDEAS (Seb, 2026-11-16, the Walter scripts):
 *  the details a story can start from, each bridged to the product's
 *  problem, what the product is never shown doing with it, and what to say
 *  with care. null when the read failed; the context still goes to the
 *  writer as the creator wrote it, and the plan says the ideas are missing. */
async function readContext(c: Campaign, userId: string, tier: string | null): Promise<ContextPlan | null> {
  if (!c.context) return null
  try {
    const msg = await createAnthropicClient().messages.create({ model: WRITER, max_tokens: 2500, system: CONTEXT_SYSTEM, messages: [{ role: 'user', content: contextInput(c) }] })
    try { const u = usageFromAnthropic(msg); recordUsage({ userId, tier, feature: 'trybe_batch_context', model: WRITER, input: u.input, output: u.output }) } catch { /* best-effort */ }
    return contextFromReply((msg.content as Array<{ type: string; text?: string }>).map((b) => (b.type === 'text' ? b.text || '' : '')).join(''), c.context)
  } catch { return null }
}

/** The writer, recording what each call cost. */
function writerAsk(userId: string, tier: string | null): Ask {
  return async (system, user) => {
    const msg = await createAnthropicClient().messages.create({ model: WRITER, max_tokens: 14000, system, messages: [{ role: 'user', content: user }] })
    try { const u = usageFromAnthropic(msg); recordUsage({ userId, tier, feature: 'trybe_batch_scripts', model: WRITER, input: u.input, output: u.output }) } catch { /* best-effort */ }
    return (msg.content as Array<{ type: string; text?: string }>).map((b) => (b.type === 'text' ? b.text || '' : '')).join('')
  }
}

const tableMissing = (e: { message?: string } | null) => !!e && /trybe_campaign|does not exist|schema cache/i.test(String(e.message || ''))
const NEEDS_SQL = 'Batch scripts needs its database tables first (migration 467).'

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const { db, ownerId, userId, tier } = g
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await req.json().catch(() => ({})) as Record<string, any>
  const action = String(body.action || '')
  const id = String(body.id || '')

  if (action === 'list') {
    const { data, error } = await db.from('trybe_campaigns').select('id,name,brand_id,updated_at,setup').eq('user_id', ownerId).order('updated_at', { ascending: false }).limit(50)
    if (error) return NextResponse.json({ error: tableMissing(error) ? NEEDS_SQL : error.message, needsSql: tableMissing(error) }, { status: tableMissing(error) ? 503 : 500 })
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
    const counts = new Map<string, { all: number; accepted: number }>()
    if (ids.length) {
      const { data: rows } = await db.from('trybe_campaign_scripts').select('campaign_id,status').in('campaign_id', ids).limit(20000)
      for (const r of (rows ?? []) as Array<{ campaign_id: string; status: string }>) {
        const k = counts.get(r.campaign_id) || { all: 0, accepted: 0 }
        k.all++; if (r.status === 'accepted') k.accepted++
        counts.set(r.campaign_id, k)
      }
    }
    const campaigns = ((data ?? []) as Array<{ id: string; name: string; brand_id: string | null; updated_at: string; setup: { target?: number } }>).map((r) => ({
      id: r.id, name: r.name, brandId: r.brand_id, updatedAt: r.updated_at, target: Number(r.setup?.target) || 0, scripts: counts.get(r.id)?.all ?? 0, accepted: counts.get(r.id)?.accepted ?? 0,
    }))
    // WHAT IS THE CREATOR'S, NOT THE BRAND'S: where they film, who is on
    // camera, their facts and angles, carried into the next campaign.
    const top = (data ?? [])[0] as { setup?: Record<string, unknown> } | undefined
    const last = top?.setup ? { reality: top.setup.reality ?? null, creatorFacts: top.setup.creatorFacts ?? null, angles: top.setup.angles ?? null, hooks: top.setup.hooks ?? null } : null
    return NextResponse.json({ ok: true, campaigns, last, allowance: await allowance(db, ownerId, tier) })
  }

  if (action === 'save') {
    const c = readCampaign(body.campaign, id)
    // A context that changed is read again before it is kept (once the brief
    // gave claims; a campaign still being set up is read with the rules).
    if (!c.context) c.contextPlan = null
    else if (contextStale(c) && c.rules.approvedClaims.length && !(await spendGate(userId, tier))) c.contextPlan = await readContext(c, userId, tier)
    const row = { name: c.name, brand_id: c.brandId, setup: setupOf(c), updated_at: new Date().toISOString() }
    if (id) {
      const { data, error } = await db.from('trybe_campaigns').update(row).eq('id', id).eq('user_id', ownerId).select('id').maybeSingle()
      if (error) return NextResponse.json({ error: tableMissing(error) ? NEEDS_SQL : error.message }, { status: 500 })
      if (!data) return NextResponse.json({ error: 'That campaign is not yours, or it was deleted.' }, { status: 404 })
      return NextResponse.json({ ok: true, campaign: { ...c, id } })
    }
    const { data, error } = await db.from('trybe_campaigns').insert({ ...row, user_id: ownerId }).select('id').single()
    if (error) return NextResponse.json({ error: tableMissing(error) ? NEEDS_SQL : error.message, needsSql: tableMissing(error) }, { status: tableMissing(error) ? 503 : 500 })
    return NextResponse.json({ ok: true, campaign: { ...c, id: data.id } })
  }

  const got = await loadCampaign(db, ownerId, id)
  if (!got) return NextResponse.json({ error: 'That campaign was not found.' }, { status: 404 })
  const c = got.c

  if (action === 'get') {
    return NextResponse.json({ ok: true, campaign: c, scripts: await loadScripts(db, id), allowance: await allowance(db, ownerId, tier) })
  }

  if (action === 'delete') {
    const { error } = await db.from('trybe_campaigns').delete().eq('id', id).eq('user_id', ownerId)
    if (error) return NextResponse.json({ error: `The campaign was not deleted: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'rules') {
    // EVERYTHING MVP HAS FOR THE BRAND (Seb, 2026-11-15: "we already have the
    // information from tribe directly"): the creative brief on TRYBE, read by
    // the page through SCOUT; the documents and PDFs from the brand's
    // messages; the brand's own description; and whatever the creator pasted.
    // The answer says which of them had words, so nothing read looks like
    // nothing found.
    const pasted = String(body.briefText || '').slice(0, 40_000)
    const t = (body.trybe && typeof body.trybe === 'object' ? body.trybe : {}) as Record<string, unknown>
    const trybeBrief = typeof t.brief === 'string' ? t.brief.trim().slice(0, 20_000) : ''
    const briefState = ['text', 'link_only', 'none', 'unread'].includes(String(t.state)) ? String(t.state) : null
    const briefWhy = typeof t.why === 'string' ? t.why.slice(0, 300) : ''
    const brandName = (typeof t.brandName === 'string' && t.brandName.trim() ? t.brandName.slice(0, 120) : '') || c.brandName || ''
    const key = c.brandId || `batch-${id}`
    let sent = { text: '', docs: [] as Array<{ title: string; whole: boolean }> }
    try {
      const { data: hit } = await db.from('trybe_directory_meta').select('value').eq('key', `msglinks:${ownerId}:${key}`).maybeSingle()
      sent = docsForScripts((hit?.value ?? null) as LinksDigest | null)
    } catch { /* read without it, and say so below */ }
    let brand = ''
    if (c.brandId) {
      try {
        const { data: own } = await db.from('trybe_brands').select('name,about,site_summary,site_products').eq('user_id', ownerId).eq('brand_id', c.brandId).maybeSingle()
        const { data: dir } = own ? { data: null } : await db.from('trybe_directory').select('name,about,site_summary,site_products').eq('brand_id', c.brandId).maybeSingle()
        const row = (own || dir) as { about?: string | null; site_summary?: string | null; site_products?: unknown } | null
        if (row) brand = [row.about, row.site_summary, Array.isArray(row.site_products) && row.site_products.length ? `Products: ${(row.site_products as unknown[]).map(String).slice(0, 15).join(', ')}` : ''].filter(Boolean).join('\n')
      } catch { brand = '' }
    }
    const briefNote = !trybeBrief && briefState === 'link_only' ? `The brief on TRYBE is a link MVP could not read${briefWhy ? ` (${briefWhy})` : ''}.` : ''
    if (!trybeBrief && !sent.text && !pasted.trim()) {
      const who = brandName || c.product.name || 'this brand'
      const why = briefState === 'link_only' ? `${who}'s brief on TRYBE is a link MVP could not open${briefWhy ? ` (${briefWhy})` : ''}`
        : briefState === 'none' ? `${who} has no brief on its TRYBE page` : briefState === 'unread' ? `MVP could not read ${who}'s page on TRYBE` : 'There is no brief to read yet'
      return NextResponse.json({ error: `${why}, and MVP has no documents from your messages with them. Paste the brief, or add the PDF they sent.`, nothingToRead: true }, { status: 400 })
    }
    const spend = await spendGate(userId, tier)
    if (spend) return spend
    try {
      const input = rulesInput({ product: c.product.name, brandName, brief: trybeBrief, briefNote, sent: sent.text, pasted, brand })
      const msg = await createAnthropicClient().messages.create({ model: READER, max_tokens: 3000, system: RULES_SYSTEM, messages: [{ role: 'user', content: input }] })
      try { const u = usageFromAnthropic(msg); recordUsage({ userId, tier, feature: 'trybe_batch_rules', model: READER, input: u.input, output: u.output }) } catch { /* best-effort */ }
      const text = (msg.content as Array<{ type: string; text?: string }>).map((b) => (b.type === 'text' ? b.text || '' : '')).join('')
      const next = rulesFromReply(text, c)
      if (next === c) return NextResponse.json({ error: 'MVP read the brief but could not make rules from it. Try again, or type the claims in yourself.' }, { status: 502 })
      // The context read with the claims just found, so its story ideas bridge to what the brand allows.
      if (next.context) next.contextPlan = await readContext(next, userId, tier)
      const { error: saveErr } = await db.from('trybe_campaigns').update({ setup: setupOf(next), updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', ownerId)
      if (saveErr) return NextResponse.json({ error: `MVP read the brief, but the rules it made were not saved: ${saveErr.message}` }, { status: 500 })
      const words = (x: string) => (x.trim() ? x.trim().split(/\s+/).length : 0)
      return NextResponse.json({ ok: true, campaign: next, read: {
        trybe: trybeBrief ? { words: words(trybeBrief) } : briefState ? { state: briefState, why: briefWhy || null } : null,
        sent: sent.docs.map((d) => d.title),
        pasted: pasted.trim() ? words(pasted) : 0,
        brand: brand.length > 0,
        claimsFrom: claimsFromReply(text) || (next.rules.approvedClaims.length ? null : 'none'),
        claims: next.rules.approvedClaims.length,
        context: next.context ? (next.contextPlan ? { ideas: next.contextPlan.seeds.length } : { failed: true }) : null,
      } })
    } catch (e) {
      return NextResponse.json({ error: `MVP could not read the brief: ${e instanceof Error ? e.message : 'no answer'}` }, { status: 502 })
    }
  }

  const scripts = await loadScripts(db, id)

  if (action === 'write') {
    const missing = notReadyWords(c)
    if (missing.length) return NextResponse.json({ error: `Before writing, add ${missing.join(', ')}.` }, { status: 400 })
    const a = await allowance(db, ownerId, tier)
    const room = Math.min(BATCH_ROUND, c.target - scripts.length, MAX_PER_CAMPAIGN - scripts.length, a.left === null ? BATCH_ROUND : a.left)
    if (scripts.length >= c.target) return NextResponse.json({ ok: true, scripts: [], done: true, allowance: a, said: `All ${c.target} scripts are written.` })
    if (room <= 0) return NextResponse.json({ error: `You have used all ${a.limit} batch scripts for this month${a.resetLabel ? `. More on ${a.resetLabel}` : ''}.${a.introNote ? ` ${a.introNote}` : ''}`, limitReached: true, allowance: a }, { status: 429 })
    const spend = await spendGate(userId, tier)
    if (spend) return spend
    let round
    try {
      round = await runRound(c, scripts, room, writerAsk(userId, tier), { budgetMs: 200_000 })
    } catch (e) {
      return NextResponse.json({ error: `MVP could not write this round: ${e instanceof Error ? e.message : 'no answer'}. Nothing was counted; press Keep writing to try again.` }, { status: 502 })
    }
    if (!round.scripts.length) return NextResponse.json({ error: 'The writer answered in a shape MVP could not read, so nothing was saved or counted. Press Keep writing to try again.' }, { status: 502 })
    const now = new Date().toISOString()
    const { error } = await db.from('trybe_campaign_scripts').insert(round.scripts.map((s) => ({ ...scriptToRow(s), campaign_id: id, user_id: ownerId, created_at: now, updated_at: now })))
    if (error) return NextResponse.json({ error: tableMissing(error) ? NEEDS_SQL : `The scripts were written but not saved: ${error.message}` }, { status: 500 })
    await db.from('trybe_campaigns').update({ updated_at: now }).eq('id', id).eq('user_id', ownerId)
    const total = scripts.length + round.scripts.length
    return NextResponse.json({ ok: true, scripts: round.scripts, missing: round.missing, done: total >= c.target, total, allowance: await allowance(db, ownerId, tier) })
  }

  if (action === 'recheck') {
    // THE RULES CHANGED: every script checked again against them.
    let changed = 0
    let unsaved = 0
    for (const s of scripts) {
      // In number order, so of two alike scripts the later one is flagged.
      const next = checkScript(s, c, scripts.filter((o) => o.idx !== s.idx), { skipLater: true })
      if (JSON.stringify(next) === JSON.stringify(s.checks)) continue
      s.checks = next
      changed++
      const { error } = await db.from('trybe_campaign_scripts').update({ checks: next, updated_at: new Date().toISOString() }).eq('campaign_id', id).eq('idx', s.idx)
      if (error) unsaved++
    }
    if (unsaved) return NextResponse.json({ error: `${unsaved} of ${changed} new checks were not saved. Press Check all again to retry.` }, { status: 500 })
    return NextResponse.json({ ok: true, scripts, changed })
  }

  const idx = Number(body.idx)
  const cur = scripts.find((s) => s.idx === idx)
  if (!cur) return NextResponse.json({ error: 'That script was not found.' }, { status: 404 })
  const others = scripts.filter((s) => s.idx !== idx)

  if (action === 'rewrite') {
    const note = String(body.note || '').trim().slice(0, 600)
    const spend = await spendGate(userId, tier)
    if (spend) return spend
    const slot = { idx, location: cur.location, host: cur.host, angle: cur.angle }
    // The place, host or angle may have left the campaign: a fresh slot then.
    const valid = c.reality.locations.some((l) => l.name === slot.location) && c.reality.cast.some((p) => p.name === slot.host) && c.angles.includes(slot.angle)
    const s0 = valid ? slot : { ...planSlots(c, others, 1)[0], idx }
    const ask = writerAsk(userId, tier)
    let best: Script | null = null
    let reasons = cur.checks.reasons
    for (let t = 0; t < 2; t++) {
      const prompt = writerPrompt(c, [s0], others, [{ idx, reasons: reasons.length ? reasons : ['Write a new version.'], instruction: note || undefined, previous: cur }])
      const d = parseScripts(await ask(writerSystem(), prompt), [s0])[0]
      if (!d) continue
      const next: Script = { ...cur, ...d, status: cur.status === 'draft' || cur.status === 'approved' ? cur.status : 'draft', tries: cur.tries + 1, checks: checkScript(d, c, others) }
      if (!best || next.checks.reasons.length < best.checks.reasons.length) best = next
      if (next.checks.state !== 'red') break
      reasons = next.checks.reasons
    }
    if (!best) return NextResponse.json({ error: 'The writer answered in a shape MVP could not read. The script was left as it was.' }, { status: 502 })
    const { error } = await db.from('trybe_campaign_scripts').update({ ...scriptToRow(best), updated_at: new Date().toISOString() }).eq('campaign_id', id).eq('idx', idx)
    if (error) return NextResponse.json({ error: `The new version was written but not saved: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true, script: best })
  }

  if (action === 'update') {
    const p = (body.patch && typeof body.patch === 'object' ? body.patch : {}) as Record<string, unknown>
    const next: Script = { ...cur }
    if (typeof p.title === 'string') next.title = p.title.trim().slice(0, 90)
    if (Array.isArray(p.story)) next.story = (p.story as Array<{ say?: unknown; show?: unknown }>).slice(0, 8).map((b) => ({ say: String(b?.say ?? '').slice(0, 400), show: String(b?.show ?? '').slice(0, 300) }))
    if (Array.isArray(p.body)) next.body = (p.body as Array<{ say?: unknown; show?: unknown; claimIds?: unknown }>).slice(0, 8).map((b) => ({ say: String(b?.say ?? '').slice(0, 400), show: String(b?.show ?? '').slice(0, 300), claimIds: Array.isArray(b?.claimIds) ? (b.claimIds as unknown[]).map(String).slice(0, 6) : [] }))
    if (typeof p.status === 'string' && (SCRIPT_STATUSES as string[]).includes(p.status)) next.status = p.status as ScriptStatus
    if (typeof p.link === 'string') next.link = /^https?:\/\//i.test(p.link.trim()) ? p.link.trim().slice(0, 600) : (p.link.trim() ? next.link : null)
    if (typeof p.notes === 'string') next.notes = p.notes.slice(0, 1000) || null
    if (typeof p.realStory === 'boolean') next.realStory = p.realStory
    next.estSeconds = estimateSeconds(next.story, next.body)
    next.checks = checkScript(next, c, others)
    const { error } = await db.from('trybe_campaign_scripts').update({ ...scriptToRow(next), updated_at: new Date().toISOString() }).eq('campaign_id', id).eq('idx', idx)
    if (error) return NextResponse.json({ error: `Your change was not saved: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true, script: next })
  }

  if (action === 'remove') {
    const { error } = await db.from('trybe_campaign_scripts').delete().eq('campaign_id', id).eq('idx', idx)
    if (error) return NextResponse.json({ error: `The script was not removed: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
