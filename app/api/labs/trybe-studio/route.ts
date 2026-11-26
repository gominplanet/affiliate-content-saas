// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE EDIT STUDIO'S BRAND RULES (lib/studio-rules, migration 476). One sheet
// per creator and brand, read from every source MVP has for it.
//
//   GET  ?brand=<id>                    the sources, the sheet and its questions
//   POST { action: 'source' }           brandId, brandName, kind 'trybe_brief' | 'link' | 'text',
//                                       text?, url?, briefUrl? (with trybe_brief: its link, read too)
//   POST { action: 'chat' }             brandId: what the brand sent in chat (Messages), as a source
//   POST { action: 'file_url' }         bytes, name: a signed upload for a PDF or picture
//   POST { action: 'file' }             brandId, path, name, type: read the uploaded file, then delete it
//   POST { action: 'remove' }           brandId, id
//   POST { action: 'build' }            brandId: Claude writes the sheet from the sources
//   POST { action: 'save' }             brandId, sheet: the creator's edits
//   POST { action: 'answer' }           brandId, idx, answer
//
// For the team first (lib/labs-preview trybe_studio).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { spendGate } from '@/lib/ai-spend'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { docsForScripts, type LinksDigest } from '@/lib/trybe-message-links'
import { SHEET_SYSTEM, hashText, readQuestions, readSheet, sheetFromReply, sheetInput, upsertSource, SOURCE_TEXT_MAX, type OldSource, type RuleQuestion, type RuleSource, type SourceKind } from '@/lib/studio-rules'
import { readFileBytes, readLinkText, READ_MAX_BYTES } from '@/lib/studio-read'

export const maxDuration = 300

const BUCKET = 'instagram-videos'
const SHEET_MODEL = 'claude-sonnet-5'
const NEEDS_SQL = 'The Edit Studio needs migration 476 in Supabase first.'
const missing = (m?: string) => /trybe_brand_rules|studio_brand_id|studio_send/.test(m || '') && /does not exist|schema cache|could not find/i.test(m || '')
const BRAND_ID = /^[A-Za-z0-9_-]{4,80}$/

// trybe_brand_rules is newer than the generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any
interface RulesRow { brand_id: string; brand_name: string | null; sources: RuleSource[]; history: OldSource[]; sheet: unknown; questions: RuleQuestion[]; built_at: string | null; edited_at: string | null }

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Sign in again.' }, { status: 401 }) }
  const { data: intg } = await (supabase as Db).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('trybe_studio', intg?.tier)) return { error: NextResponse.json({ error: 'The Edit Studio is still being tested by the MVP team.' }, { status: 403 }) }
  return { userId: user.id as string, tier: (intg?.tier as string) || null }
}

async function readRow(db: Db, userId: string, brandId: string): Promise<{ row: RulesRow | null; error: string | null }> {
  const { data, error } = await db.from('trybe_brand_rules').select('brand_id, brand_name, sources, history, sheet, questions, built_at, edited_at').eq('user_id', userId).eq('brand_id', brandId).maybeSingle()
  if (error) return { row: null, error: missing(error.message) ? NEEDS_SQL : error.message }
  return { row: (data as RulesRow | null) ?? null, error: null }
}

/** What the page shows: the sources without their whole text. */
function out(row: RulesRow | null) {
  return {
    sources: (row?.sources ?? []).map((s) => ({ id: s.id, kind: s.kind, label: s.label, url: s.url ?? null, readAt: s.readAt, error: s.error ?? null, hash: s.hash, words: s.text ? s.text.split(/\s+/).length : 0, preview: s.text.slice(0, 280) })),
    history: (row?.history ?? []).map((h) => ({ id: h.id, label: h.label, readAt: h.readAt, replacedAt: h.replacedAt })),
    sheet: row?.sheet ? readSheet(row.sheet) : null,
    questions: readQuestions(row?.questions ?? []),
    builtAt: row?.built_at ?? null, editedAt: row?.edited_at ?? null,
    brandName: row?.brand_name ?? null,
  }
}

export async function GET(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const brandId = new URL(req.url).searchParams.get('brand') || ''
  if (!BRAND_ID.test(brandId)) return NextResponse.json({ error: 'Which brand?' }, { status: 400 })
  const { row, error } = await readRow(createAdminClient() as Db, g.userId, brandId)
  if (error) return NextResponse.json({ error, needsSql: error === NEEDS_SQL }, { status: error === NEEDS_SQL ? 503 : 500 })
  return NextResponse.json(out(row))
}

export async function POST(req: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''
  const db = createAdminClient() as Db
  const now = new Date().toISOString()
  const who = { userId: g.userId, tier: g.tier }

  // A PDF or picture goes straight to storage (it can be bigger than a request
  // to MVP may carry); the server reads it from there and deletes it.
  if (action === 'file_url') {
    const bytes = Number(body.bytes || 0)
    if (!(bytes > 0)) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
    if (bytes > READ_MAX_BYTES) return NextResponse.json({ error: `That file is ${Math.round(bytes / 1048576)} MB. MVP reads files up to ${Math.round(READ_MAX_BYTES / 1048576)} MB: save the pages that matter as a smaller PDF.` }, { status: 413 })
    const path = `${g.userId}/studio-doc-${crypto.randomUUID()}`
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data?.signedUrl) return NextResponse.json({ error: `MVP could not open an upload for it: ${error?.message || 'no address'}` }, { status: 500 })
    return NextResponse.json({ uploadUrl: data.signedUrl, path })
  }

  const brandId = typeof body.brandId === 'string' ? body.brandId : ''
  if (!BRAND_ID.test(brandId)) return NextResponse.json({ error: 'Which brand?' }, { status: 400 })
  const { row, error: readErr } = await readRow(db, g.userId, brandId)
  if (readErr) return NextResponse.json({ error: readErr, needsSql: readErr === NEEDS_SQL }, { status: readErr === NEEDS_SQL ? 503 : 500 })
  const brandName = (typeof body.brandName === 'string' && body.brandName.trim() ? body.brandName.trim().slice(0, 120) : '') || row?.brand_name || ''
  let sources: RuleSource[] = row?.sources ?? []
  let history: OldSource[] = row?.history ?? []
  const save = async (patch: Record<string, unknown>) => {
    const { data, error } = await db.from('trybe_brand_rules').upsert({ user_id: g.userId, brand_id: brandId, brand_name: brandName || null, sources, history, updated_at: now, ...patch }, { onConflict: 'user_id,brand_id' })
      .select('brand_id, brand_name, sources, history, sheet, questions, built_at, edited_at').single()
    if (error) return NextResponse.json({ error: missing(error.message) ? NEEDS_SQL : error.message }, { status: 500 })
    return NextResponse.json(out(data as RulesRow))
  }
  const add = (s: Omit<RuleSource, 'hash' | 'readAt'>) => { ({ sources, history } = upsertSource(sources, history, { ...s, readAt: now, hash: hashText(s.text) }, now)) }

  if (action === 'source') {
    const kind = body.kind as SourceKind
    if (kind === 'trybe_brief') {
      // Read by the page through SCOUT from the brand's own TRYBE page.
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, SOURCE_TEXT_MAX) : ''
      if (text) add({ id: 'trybe_brief', kind, label: 'TRYBE brief', text, error: null })
      const briefUrl = typeof body.briefUrl === 'string' ? body.briefUrl.trim().slice(0, 1000) : ''
      if (briefUrl) {
        const r = await readLinkText(briefUrl, who)
        add({ id: 'brief_link', kind: 'brief_link', label: 'Brief document on TRYBE', url: briefUrl, text: r.text, error: r.why })
      }
      if (!text && !briefUrl) return NextResponse.json({ error: 'TRYBE showed no brief for this brand.' }, { status: 400 })
      return save({})
    }
    if (kind === 'link') {
      const url = typeof body.url === 'string' ? body.url.trim().slice(0, 1000) : ''
      if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'Paste the whole link, starting with https://' }, { status: 400 })
      const r = await readLinkText(url, who)
      let site = 'A link'
      try { site = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep "A link" */ }
      add({ id: `link:${hashText(url)}`, kind, label: site, url, text: r.text, error: r.why })
      return save({})
    }
    if (kind === 'text') {
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, SOURCE_TEXT_MAX) : ''
      if (text.length < 10) return NextResponse.json({ error: 'Paste the words the brand gave you first.' }, { status: 400 })
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : 'Pasted by you'
      add({ id: `text:${hashText(label)}`, kind, label, text, error: null })
      return save({})
    }
    return NextResponse.json({ error: 'Unknown source.' }, { status: 400 })
  }

  if (action === 'chat') {
    // What the brand sent in chat, as Messages already read it (Pro): its
    // documents and the do's and don'ts MVP wrote from them.
    const { data: hit } = await db.from('trybe_directory_meta').select('value').eq('key', `msglinks:${g.userId}:${brandId}`).maybeSingle()
    const sent = docsForScripts((hit?.value ?? null) as LinksDigest | null)
    if (!sent.text.trim()) return NextResponse.json({ error: 'MVP has not read anything this brand sent you in chat yet. Open your chat with them in Messages and read its links, or add the files here.' }, { status: 400 })
    add({ id: 'chat', kind: 'chat', label: `From your chat (${sent.docs.length || 'its'} ${sent.docs.length === 1 ? 'document' : 'documents'})`, text: sent.text, error: null })
    return save({})
  }

  if (action === 'file') {
    const path = typeof body.path === 'string' ? body.path : ''
    if (!path.startsWith(`${g.userId}/studio-doc-`)) return NextResponse.json({ error: 'That file is not one of your uploads.' }, { status: 400 })
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'A file'
    const dl = await db.storage.from(BUCKET).download(path)
    if (dl.error || !dl.data) return NextResponse.json({ error: `MVP could not find the uploaded file: ${dl.error?.message || 'gone'}. Add it again.` }, { status: 400 })
    const bytes = Buffer.from(await (dl.data as Blob).arrayBuffer())
    const spend = await spendGate(g.userId, g.tier)
    if (spend) { await db.storage.from(BUCKET).remove([path]).catch(() => null); return spend }
    const r = await readFileBytes(bytes, typeof body.type === 'string' ? body.type : '', name, who)
    // Read, then gone: MVP keeps the words, not the brand's file.
    await db.storage.from(BUCKET).remove([path]).catch(() => null)
    add({ id: `file:${hashText(name)}`, kind: 'file', label: name, text: r.text, error: r.why })
    return save({})
  }

  if (action === 'remove') {
    const id = typeof body.id === 'string' ? body.id : ''
    sources = sources.filter((s) => s.id !== id)
    return save({})
  }

  if (action === 'build') {
    const usable = sources.filter((s) => s.text.trim())
    if (!usable.length) return NextResponse.json({ error: 'MVP has nothing readable for this brand yet. Add its brief, a link, a PDF or the words they sent.' }, { status: 400 })
    const spend = await spendGate(g.userId, g.tier)
    if (spend) return spend
    try {
      const msg = await createAnthropicClient().messages.create({
        model: SHEET_MODEL, max_tokens: 6000, system: SHEET_SYSTEM,
        messages: [{ role: 'user', content: sheetInput({ brandName, sources: usable, questions: readQuestions(row?.questions ?? []) }) }],
      }, { signal: AbortSignal.timeout(180_000) })
      try { const u = usageFromAnthropic(msg); recordUsage({ userId: g.userId, tier: g.tier, feature: 'studio_rules', model: SHEET_MODEL, input: u.input, output: u.output }) } catch { /* best-effort */ }
      const text = (msg.content as Array<{ type: string; text?: string }>).map((b) => (b.type === 'text' ? b.text || '' : '')).join('')
      const got = sheetFromReply(text, readQuestions(row?.questions ?? []))
      if (!got) return NextResponse.json({ error: 'MVP read the sources but could not write the rules from them. Try again.' }, { status: 502 })
      return save({ sheet: got.sheet, questions: got.questions, built_at: now })
    } catch (e) {
      return NextResponse.json({ error: `MVP could not read the rules: ${e instanceof Error ? e.message.slice(0, 160) : 'no answer'}` }, { status: 502 })
    }
  }

  if (action === 'save') {
    if (!body.sheet || typeof body.sheet !== 'object') return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    return save({ sheet: readSheet(body.sheet), edited_at: now })
  }

  if (action === 'answer') {
    const qs = readQuestions(row?.questions ?? [])
    const idx = Number(body.idx)
    if (!Number.isInteger(idx) || !qs[idx]) return NextResponse.json({ error: 'Which question?' }, { status: 400 })
    const answer = typeof body.answer === 'string' ? body.answer.trim().slice(0, 400) : ''
    qs[idx] = { ...qs[idx], ...(answer ? { answer } : {}) }
    if (!answer) delete qs[idx].answer
    return save({ questions: qs })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
