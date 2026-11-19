// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE FREE (Seb, 2026-11-19: "open only the trybe feature for all users for
// free ... a great way to acquire new people who may want to look into the
// paid features"; then: "the search brand, definitely super important to be
// able to search and request ... create their own outreach setup and then
// search and request and message. Send their automatic message, not
// necessarily AI message ... That's what people are struggling the most,
// finding good brands and requesting", and upload videos, check earnings,
// the Top 100, look at their brands and create brand scripts: "I know it
// costs AI, but let's see how we can manage that").
//
// An account with no paid plan gets TRYBE, the same page as Pro, with:
//   - Find brands, Top 100, the brand pages, outreach setup, Ready to send,
//     Sent, the Inbox read and answered by hand, Upload videos, This week,
//     Analytics, Submissions and My brands;
//   - requests written from their OWN message (templateRequest), not AI, and
//     sent by SCOUT under FREE_DAILY_SENDS a day;
//   - brand scripts, FREE_SCRIPTS_MONTHLY sets a month;
// and Pro keeps what costs AI or saves the most time: messages written for
// each brand, the daily 20 found and written, reply suggestions, batches,
// edits, the planner, Star brands, Match my TikTok, What's working.
//
// Off until TRYBE_FREE_LIVE is true; an admin sees it with View as Free.
// Enforced on the server by action (FREE_ACTIONS); the page only mirrors it.
// Pure, so it is tested (scripts/test-trybe-free.ts).

/** On for every account with no paid plan (Seb, 2026-11-19: "ok go live"). */
export const TRYBE_FREE_LIVE = true

/** Where a TRYBE Free sign-up lands, and the sign-up that makes one (no card). */
export const TRYBE_FREE_LANDING = '/trybe'
export const TRYBE_FREE_SIGNUP = '/signup?for=trybe'

/** Who gets TRYBE Free: an account with no plan, and members still on the
 *  legacy Creator and Studio plans (Seb, 2026-11-19: "give them free trybe
 *  too"), so a plan that pays never gets less TRYBE than no plan. */
export const TRYBE_FREE_TIERS: readonly string[] = ['trial', 'creator', 'studio']

/** Requests SCOUT sends a day on TRYBE Free (Pro: 200). */
export const FREE_DAILY_SENDS = 20
/** Sets of brand scripts a calendar month on TRYBE Free. */
export const FREE_SCRIPTS_MONTHLY = 3
/** Briefs MVP reads for those scripts a calendar month. */
export const FREE_BRIEF_READS_MONTHLY = 10

/** The tabs open on TRYBE Free; the others show what Pro adds. */
export const FREE_TABS: readonly string[] = ['home', 'find', 'top100', 'queue', 'sent', 'inbox', 'create', 'upload', 'week', 'analytics', 'submissions', 'brands']

/** The server actions TRYBE Free may call (POST). The GET that loads the
 *  page is allowed too. Everything else answers that it is on Pro. */
export const FREE_ACTIONS: ReadonlySet<string> = new Set([
  // Find brands and the brand pages
  'browse', 'star', 'pass', 'unskip', 'priorities', 'amazon_match', 'dossier', 'brand_products', 'brand_top_seen',
  'directory', 'active', 'changes', 'home', 'found', 'top100', 'top_board', 'top_hooks', 'top100_hooks', 'meta_gallery',
  // Outreach: the setup, the list, sending
  'settings', 'adopt', 'import', 'shortlist', 'draft', 'edit', 'skip', 'replied', 'remove', 'reset', 'claim', 'result', 'voice_check',
  'intro_get', 'intro_upload_url', 'intro_saved', 'intro_trybe_saved', 'intro_toggle', 'intro_remove',
  // Upload videos (the note is the creator's template, uploadNote)
  'upload_note', 'kickoff_sent',
  // Earnings and My brands
  'my_stats', 'pooled', 'pool_setting', 'retainers', 'retainer_save', 'retainer_remove',
  // Make videos: brand scripts (capped, FREE_CAPPED) and the scripts kept
  'video_plan', 'brief_read', 'ideas', 'saved_scripts', 'script_done', 'idea_delete', 'idea_restore',
  'brand_scripts', 'top_scripts', 'hook_library', 'top_lines', 'top_scripts_seen', 'top_script_save', 'buyer_resolve', 'message_links_get',
])

/** The AI actions TRYBE Free may call a few times a month, counted from the
 *  AI use MVP records under `feature` this calendar month. */
export const FREE_CAPPED: Record<string, { feature: string; monthly: number; words: string }> = {
  video_plan: { feature: 'trybe_video_plan', monthly: FREE_SCRIPTS_MONTHLY, words: 'sets of brand scripts' },
  brief_read: { feature: 'trybe_brief_read', monthly: FREE_BRIEF_READS_MONTHLY, words: 'brief reads' },
}

export type FreeVerdict = { ok: true } | { ok: false; error: string }

/** Whether TRYBE Free may run this action, before any count. Pure. */
export function freeAllows(action: string): FreeVerdict {
  if (FREE_ACTIONS.has(action)) return { ok: true }
  return { ok: false, error: `${PRO_ONLY_WORDS[action] || 'This part of TRYBE'} is part of MVP Pro. TRYBE Free has Find brands, your own requests, the Inbox, Upload, Earnings, the Top 100 and ${FREE_SCRIPTS_MONTHLY} sets of brand scripts a month.` }
}

const PRO_ONLY_WORDS: Record<string, string> = {
  match: 'Checking each brand’s fit from its website',
  suggest_reply: 'A reply written in your voice',
  kickoff: 'A message written for each brand',
  followup: 'A follow-up written for each brand',
  message_links: 'Reading what a brand sent you',
  top100_profile: 'Reading a top creator’s profile',
  intro_script: 'MVP writing the words for your intro video',
  daily_refresh: 'The daily brands',
}

/** The month's first moment in UTC, for counting a monthly allowance. Pure. */
export function monthStartUtc(now = Date.now()): string {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

/** What is left of a monthly allowance, in words for the page. Pure. */
export function freeLeftWords(left: number, monthly: number, words: string): string {
  return left > 0
    ? `${left} of ${monthly} free ${words} left this month.`
    : `Your ${monthly} free ${words} for this month are used. They come back on the 1st, or Pro writes as many as you need.`
}

const BRAND_TOKEN = /\{\{\s*brand(?:\s*name)?\s*\}\}|\{\s*brand(?:\s*name)?\s*\}|\[\s*brand(?:\s*name)?\s*\]/gi
const GREETING = /^(hi|hello|hey|dear)\b[^\n]{0,40}$/i

/** A REQUEST FROM THE CREATOR'S OWN MESSAGE, no AI (TRYBE Free): {brand},
 *  [Brand] or {{brand name}} become the brand's name; otherwise a short
 *  greeting line becomes "Hi <brand> team!", or one is put first. The rest is
 *  the creator's words, as they wrote them. Pure. */
export function templateRequest(core: string, brand: string): string {
  const name = brand.trim() || 'there'
  const text = core.replace(/\r\n/g, '\n').trim()
  if (!text) return ''
  if (BRAND_TOKEN.test(text)) { BRAND_TOKEN.lastIndex = 0; return text.replace(BRAND_TOKEN, name) }
  const lines = text.split('\n')
  const first = lines[0].trim()
  const m = first.match(GREETING)
  const hi = (w: string) => `${w[0].toUpperCase()}${w.slice(1).toLowerCase()} ${name} team!`
  if (m) return [hi(m[1]), ...lines.slice(1)].join('\n').trim()
  return `Hi ${name} team!\n\n${text}`
}

/** THE UPLOAD NOTE ON TRYBE FREE: one short message for the brand's chat,
 *  from what was uploaded, no AI. The creator edits it before sending. Pure. */
export function uploadNoteTemplate(o: { brand: string; count: number; products: string[] }): string {
  const what = o.products.length ? ` for ${o.products.slice(0, 2).join(' and ')}` : ''
  const n = Math.max(1, Math.round(o.count || 1))
  return `Hi ${o.brand.trim() || 'there'} team! I just submitted ${n === 1 ? 'a new video' : `${n} new videos`}${what} on TRYBE. Let me know if you would like anything changed. Thank you!`
}
