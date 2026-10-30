// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR'S DECISIONS (lib/review-edit has the rules that follow).
// Three small AI calls, each a few cents at most, because a creator may make
// 200 of these a month (Seb, 2026-10-30: "I don't want it to be a dollar or
// more per video"):
//   readShots    what each part of the B-roll take shows, from 36 small frames;
//   planEdit     which lines of the review are mistakes, restarts or chatter,
//                which land a strong point, which shot goes under which line;
//   promptChange "logo top left", "keep the part about the price": a typed
//                change turned into settings and cuts.
// Every answer is checked against the take before it is used: a line or shot
// that does not exist is dropped, never guessed at.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { cleanSettings, clock, findWords, POSITIONS, TITLE_COLORS, TITLE_LOOKS, type Cut, type CutKind, type EditSettings, type Line, type Plan, type Shot, type VideoKind, type Word } from '@/lib/review-edit'

const PLAN_MODEL = 'claude-sonnet-5'
const QUICK_MODEL = 'claude-haiku-4-5-20251001'
const KINDS: CutKind[] = ['restart', 'mistake', 'repeat', 'chatter']

type Who = { userId: string; tier: string }

const noDash = (s: unknown, max = 160) => String(s ?? '').replace(/\s*[–—]\s*/g, ', ').replace(/\s+-\s+/g, ', ').trim().slice(0, max)

/** The first JSON object in a reply, or null. Pure. */
export function jsonIn(text: string): Record<string, unknown> | null {
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { const v = JSON.parse(text.slice(a, b + 1)); return v && typeof v === 'object' ? v : null } catch { return null }
}

const textOf = (msg: { content: Array<{ type: string; text?: string }> }) => msg.content.map((b) => (b.type === 'text' ? b.text || '' : '')).join('')

/** What a planner answer may say, checked against the take. Pure. */
export function cleanPlan(raw: Record<string, unknown> | null, lines: Line[], shots: Shot[], words: Word[] = []): Plan {
  const n = lines.length
  const int = (v: unknown) => (Number.isInteger(Number(v)) ? Number(v) : NaN)
  const cuts: Cut[] = []
  for (const c of Array.isArray(raw?.cuts) ? raw!.cuts as Record<string, unknown>[] : []) {
    const from = int(c?.from ?? c?.line), to = int(c?.to ?? c?.from ?? c?.line)
    if (!(from >= 0 && to >= from && to < n)) continue
    // Part of one line: the words it quotes, found in that line, or nothing.
    let part: [number, number] | undefined
    if (typeof c?.text === 'string' && c.text.trim() && from === to) {
      const hit = findWords(words, lines[from], c.text)
      if (!hit) continue
      part = hit[0] === lines[from].w0 && hit[1] === lines[from].w1 ? undefined : hit
    }
    // Never overlapping a cut already taken.
    if (cuts.some((x) => from <= x.to && to >= x.from && (!part || !x.words || (part[0] <= x.words[1] && part[1] >= x.words[0])))) continue
    cuts.push({ from, to, kind: KINDS.includes(c?.kind as CutKind) ? c.kind as CutKind : 'mistake', why: noDash(c?.why) || 'MVP took this out.', ...(part ? { words: part } : {}) })
  }
  // A plan that would cut every line cuts nothing.
  const whole = new Set<number>()
  for (const c of cuts) if (!c.words) for (let i = c.from; i <= c.to; i++) whole.add(i)
  const safeCuts = whole.size >= n ? [] : cuts.sort((a, b) => a.from - b.from || (a.words?.[0] ?? 0) - (b.words?.[0] ?? 0))
  const keys = Array.from(new Set((Array.isArray(raw?.keys) ? raw!.keys : []).map(int).filter((k) => k >= 0 && k < n))).slice(0, 16)
  const shotIds = new Set(shots.map((s) => s.n))
  const used = new Set<number>()
  const placements = []
  for (const p of Array.isArray(raw?.placements) ? raw!.placements as Record<string, unknown>[] : []) {
    const shot = int(p?.shot), line = int(p?.line)
    if (!shotIds.has(shot) || !(line >= 0 && line < n) || used.has(shot)) continue
    used.add(shot)
    placements.push({ shot, line, why: noDash(p?.why) })
  }
  return { cuts: safeCuts, keys, placements, title: noDash(raw?.title, 60) }
}

/** What each part of the B-roll take shows. frames: small pictures, evenly
 *  through the take. Shots shorter than 1.5 seconds, or shaky, blurry or
 *  pointing at nothing, are left out. */
export async function readShots(frames: { at: number; jpg: string }[], duration: number, who: Who): Promise<Shot[]> {
  if (!frames.length) return []
  const step = duration / frames.length
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: `These are ${frames.length} frames from one continuous B-roll take of a product, ${clock(duration)} long, in order, one every ${step.toFixed(1)} seconds.` }]
  frames.forEach((f, i) => {
    content.push({ type: 'text', text: `Frame ${i + 1} (${clock(f.at)})` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.jpg } })
  })
  content.push({ type: 'text', text: 'Group the frames into shots: runs of frames showing the same thing. Leave out frames that are blurry, mid move, or show nothing useful (floor, hand covering the lens). Reply with JSON only: {"shots":[{"from":1,"to":4,"what":"close up of the zipper"}]}. "what" is under ten plain words saying what the viewer sees.' })
  const msg = await createAnthropicClient().messages.create({
    model: QUICK_MODEL, max_tokens: 900,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: content as any }],
  })
  recordAnthropicUsage(msg, { userId: who.userId, tier: who.tier, feature: 'review_edit_broll', model: QUICK_MODEL })
  const raw = jsonIn(textOf(msg as never))
  const out: Shot[] = []
  for (const s of Array.isArray(raw?.shots) ? raw!.shots as Record<string, unknown>[] : []) {
    const a = Number(s?.from), b = Number(s?.to ?? s?.from)
    if (!(a >= 1 && b >= a && b <= frames.length)) continue
    const start = Math.max(0, frames[a - 1].at - step / 2)
    const end = Math.min(duration, frames[b - 1].at + step / 2)
    if (end - start < 1.5) continue
    out.push({ n: out.length + 1, start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, what: noDash(s?.what, 80) || 'B-roll' })
  }
  return out
}

/** Whether the B-roll shows the product the talk is about (Seb, 2026-10-30:
 *  20 talking takes and 20 B-roll paired by MVP). Says no only when the
 *  shots clearly show a different product; unsure, or shots of hands, a box
 *  or a table, is a yes. A failed check is a yes too: the pair was already
 *  shown to the creator. */
export async function brollFits(o: { words: Word[]; shots: Shot[]; product?: string | null; who: Who }): Promise<{ fits: boolean; talk: string; shows: string }> {
  if (!o.shots.length) return { fits: true, talk: '', shows: '' }
  try {
    const said = o.words.map((w) => w.text).join(' ').slice(0, 1500)
    const msg = await createAnthropicClient().messages.create({
      model: QUICK_MODEL, max_tokens: 200,
      messages: [{ role: 'user', content: `A creator filmed a product review talking to the camera, and separately filmed B-roll. Check the B-roll is of the same product.\n\n${o.product ? `The product, as they named it: ${o.product}\n` : ''}What they say (the start):\n${said}\n\nWhat the B-roll shots show:\n${o.shots.map((x) => `- ${x.what}`).join('\n')}\n\nAnswer "same": false only when the shots clearly show a different product (a fishing reel in the shots, a hoodie in the talk). Generic shots (hands, a box, packaging, a table) or not being sure is "same": true. Reply with JSON only: {"same":true,"talk":"the product they talk about, in under eight words","shows":"what the B-roll shows, in under eight words"}` }],
    })
    recordAnthropicUsage(msg, { userId: o.who.userId, tier: o.who.tier, feature: 'review_edit_broll_check', model: QUICK_MODEL })
    const raw = jsonIn(textOf(msg as never)) || {}
    return { fits: raw.same !== false, talk: noDash(raw.talk, 80), shows: noDash(raw.shows, 80) }
  } catch { return { fits: true, talk: '', shows: '' } }
}

const PLAN_SYSTEM = [
  'You edit a creator\'s product review video. They filmed it in one take, talking to the camera, so it has mistakes, restarts and chatter in it. You see what they said, line by line, with the time of each line.',
  'Mark what to cut:',
  '- restart: they began a sentence or a section, stopped, and said it again. Cut the earlier tries, keep the last complete one. When the false start and the retake are on the same line, give that line and quote the exact words to cut in "text".',
  '- mistake: they misspoke and corrected themselves ("no wait", "sorry", "let me redo that"). Cut the wrong part and the correction words.',
  '- repeat: they made the same point twice in a row in almost the same words. Cut the weaker one.',
  '- chatter: talk that is not the review, usually at the start or end ("is it recording?", "okay go", counting down, talking to someone off camera).',
  '- filler: "um", "uh", and an "okay so" or "so yeah" that opens a line. Quote them in "text" on their line. The creator wants it tight.',
  'Never cut for length, never cut the verdict, the price, pros and cons, or anything said once and said well. When unsure, keep it.',
  'Also pick "keys": lines that land a strong point (the verdict, a surprise, the main benefit, a key detail), about one every 20 to 30 seconds of video, at least 4. The video slowly zooms in on each.',
  'If B-roll shots are listed, place shots under the lines that talk about what the shot shows, each shot once, not on the first two lines. Skip a shot that fits nothing.',
  'Suggest a short on-screen "title": 2 to 5 words, usually the product, never a year, no dashes.',
  'Each "why" is one short plain sentence to the creator, like "You started this sentence over; the second try is kept."',
  'Reply with JSON only: {"cuts":[{"from":3,"to":4,"kind":"restart","why":"..."},{"from":7,"to":7,"text":"it keeps the sun off and","kind":"restart","why":"..."}],"keys":[12,30],"placements":[{"shot":2,"line":9,"why":"..."}],"title":"..."}. Line numbers are the numbers shown; "text" is only for part of one line, quoted word for word.',
].join('\n')

// A TRYBE ad is not a review (Seb, 2026-10-30: "It's an ad"): a brand runs it
// as a paid ad, so it is cut harder and opens on a hook.
const TRYBE_SYSTEM = [
  'You edit a creator\'s TRYBE ad: an upright video a brand runs as a paid social ad. It is not a review. They filmed it in one take talking to the camera, so it has mistakes, restarts, filler and chatter in it. You see what they said, line by line, with the time of each line.',
  'Cut harder than for a review:',
  '- restart, mistake, repeat and chatter exactly as an editor would: keep only the last good try of anything said twice.',
  '- filler: "um", "uh", "you know", "so yeah", and a "like" or "okay so" that opens a line. Quote them in "text" on their line.',
  '- rambling: a sentence that wanders before it gets to the point, when a tighter version of the same point is said elsewhere.',
  'Keep the hook (the first strong line about the problem or the product), what the product does, the proof, and the call to action. Never cut the brand or product name.',
  'Pick "keys": the hook, the strongest benefits and the call to action, about one every 10 to 15 seconds, at least 3. The video slowly zooms in on each.',
  'If B-roll shots are listed, place a shot under each line that talks about what the shot shows, each shot once, not on the first line. Ads use B-roll often.',
  'Write a "title": the hook as on-screen text for the first seconds, under 7 words, no year, no dashes, no price.',
  'Each "why" is one short plain sentence to the creator.',
  'Reply with JSON only: {"cuts":[{"from":3,"to":4,"kind":"restart","why":"..."},{"from":7,"to":7,"text":"um so","kind":"mistake","why":"..."}],"keys":[0,9],"placements":[{"shot":2,"line":5,"why":"..."}],"title":"..."}. Line numbers are the numbers shown; "text" is only for part of one line, quoted word for word.',
].join('\n')

/** The plan for one take: a review, or a TRYBE ad. */
export async function planEdit(o: { words: Word[]; lines: Line[]; shots: Shot[]; product?: string | null; kind?: VideoKind; who: Who }): Promise<Plan> {
  const said = o.lines.map((l) => `${l.i} [${clock(l.start)}] ${l.text}`).join('\n')
  const shots = o.shots.length ? `\n\nB-ROLL SHOTS:\n${o.shots.map((s) => `${s.n}: ${s.what} (${(s.end - s.start).toFixed(1)}s)`).join('\n')}` : '\n\nNo B-roll.'
  const msg = await createAnthropicClient().messages.create({
    model: PLAN_MODEL, max_tokens: 2500, system: o.kind === 'trybe' ? TRYBE_SYSTEM : PLAN_SYSTEM,
    messages: [{ role: 'user', content: `${o.product ? `PRODUCT: ${o.product}\n\n` : ''}WHAT THEY SAID:\n${said}${shots}` }],
  })
  recordAnthropicUsage(msg, { userId: o.who.userId, tier: o.who.tier, feature: 'review_edit_plan', model: PLAN_MODEL })
  return cleanPlan(jsonIn(textOf(msg as never)), o.lines, o.shots, o.words)
}

const CHANGE_SYSTEM = [
  'A creator is editing a product review video in MVP and types a change. Turn it into JSON, changing only what they asked for.',
  `Positions: ${POSITIONS.join(', ')} (upper-left is top left, lower-right is bottom right).`,
  'You can set: "logo": {"position", "on", "opacity" (1 solid, 0.7, 0.5 or 0.3 for a see-through stamp), "size" ("small", "medium" or "large"), "when" ("whole" for the whole video, "start" for the first seconds, "end" for the last), "seconds"}; "title": {"text", "position", "seconds" (0 keeps it on for the whole video), "on", "look" (${TITLE_LOOKS.join(', ')}), "color" (${Object.keys(TITLE_COLORS).join(', ')}), "size" ("small", "medium" or "large")}; "captions", "zooms", "color", "broll" (true or false); "cropX" (0 left to 1 right, where an upright ad is cut from a sideways take). Whether it is a review or a TRYBE ad cannot be changed: say so if asked.',
  'The pictures already on the video are in NOW as "pictures", in order. You can change one by giving "pictures" as a list in the same order, each item only the fields to change: "position" (also "center"), "on", "opacity", "size", "when" ("whole", "start", "end", or "say" with "say": the words to wait for), "seconds". You cannot add a new picture: the creator adds those on the page.',
  'You can also "restore" cuts by number (put the part back) or add "cut" with line numbers {"from","to","why"}.',
  'Reply with JSON only: {"settings":{...},"restore":[],"cut":[],"said":"one short plain sentence saying what you changed"}. If the request is not something you can do, change nothing and say so in "said".',
].join('\n')

/** A typed change ("logo top left", "keep the part about the price"),
 *  applied to the settings and the plan. */
export async function promptChange(o: { prompt: string; settings: EditSettings; plan: Plan; words: Word[]; lines: Line[]; who: Who }): Promise<{ settings: EditSettings; plan: Plan; said: string }> {
  const cuts = o.plan.cuts.map((c, k) => `${k}: lines ${c.from}-${c.to} ${c.restored ? '(put back)' : ''} "${(c.words ? o.words.slice(c.words[0], c.words[1] + 1).map((w) => w.text).join(' ') : o.lines.slice(c.from, c.to + 1).map((l) => l.text).join(' ')).slice(0, 140)}"`).join('\n')
  const said = o.lines.map((l) => `${l.i} ${l.text}`).join('\n').slice(0, 12000)
  const msg = await createAnthropicClient().messages.create({
    model: QUICK_MODEL, max_tokens: 700, system: CHANGE_SYSTEM,
    messages: [{ role: 'user', content: `NOW:\n${JSON.stringify(o.settings)}\n\nCUTS:\n${cuts || '(none)'}\n\nLINES:\n${said}\n\nTHE CREATOR TYPED: ${o.prompt.slice(0, 500)}` }],
  })
  recordAnthropicUsage(msg, { userId: o.who.userId, tier: o.who.tier, feature: 'review_edit_change', model: QUICK_MODEL })
  const raw = jsonIn(textOf(msg as never)) || {}
  const rs = (raw.settings && typeof raw.settings === 'object' ? raw.settings : null) as Record<string, unknown> | null
  // A typed change edits the pictures already there, in order; it never adds
  // one or changes where one comes from.
  const picks = rs && Array.isArray(rs.pictures) ? rs.pictures as Record<string, unknown>[] : []
  const pictures = o.settings.pictures.map((p, i) => ({ ...p, ...(picks[i] && typeof picks[i] === 'object' ? picks[i] : {}), url: p.url }))
  const settings = cleanSettings(rs ? { ...o.settings, ...rs, kind: o.settings.kind, logo: { ...(o.settings.logo || {}), ...(rs.logo as object || {}) }, title: { ...o.settings.title, ...(rs.title as object || {}) }, pictures } : o.settings, o.settings)
  const restore = new Set((Array.isArray(raw.restore) ? raw.restore : []).map(Number))
  const plan: Plan = { ...o.plan, cuts: o.plan.cuts.map((c, k) => (restore.has(k) ? { ...c, restored: true } : c)) }
  const added = cleanPlan({ cuts: Array.isArray(raw.cut) ? raw.cut.map((c: Record<string, unknown>) => ({ ...c, kind: 'chatter' })) : [] }, o.lines, [], o.words).cuts
  for (const c of added) if (!plan.cuts.some((x) => !x.restored && c.from <= x.to && c.to >= x.from)) plan.cuts.push({ ...c, why: c.why === 'MVP took this out.' ? 'You asked for this to go.' : c.why })
  plan.cuts.sort((a, b) => a.from - b.from)
  return { settings, plan, said: noDash(raw.said, 200) || 'Done.' }
}
