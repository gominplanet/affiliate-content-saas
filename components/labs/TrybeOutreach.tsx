'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE Outreach (Pro, in Find products since 2026-10-08). Seb's flow, 2026-10-06:
//   1. Write the core message: the idea of what goes out. Line breaks are kept.
//   2. Pick categories and keywords. SCOUT searches TRYBE for the keywords and
//      presses the categories as TRYBE's own filters; MVP reads each brand's
//      TRYBE profile and website and judges whether it fits. "Not just blindly
//      message all brands."
//   3. The brands that fit are listed, best first, with why. Tick and draft.
//   Ready to send, its own tab: every day, when this page is opened, MVP and
//   SCOUT find up to 20 new brands that fit and draft them. You skim and press
//   Send all; SCOUT presses Request to Join for each, 45 to 120 seconds apart.
//
// What each row shows is what happened: "Sent" only when SCOUT saw TRYBE close
// the request box, "Not confirmed" when Send Request was pressed and TRYBE did
// not show it closing, "Already requested" when TRYBE itself said so. Every
// step of a send run is written in the run log, so a run that could not start
// says why instead of looking like nothing happened.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Lock, Search, Sparkles, Send, Square, ExternalLink, Check, AlertTriangle, Globe, Star, Handshake, RotateCcw, X, Trash2, Tag,
  Dumbbell, Shirt, House, UtensilsCrossed, Baby, PawPrint, Gem, Cpu, Tent, Plane, BookOpen, Church, Palette, SprayCan, Moon, Pill, HeartPulse,
  Scissors, Droplet, Coffee, Leaf, Wand2, MessageCircle, Pencil, ChevronUp, Bell, Lightbulb, CalendarDays, Inbox, ArrowRight, Clapperboard, type LucideIcon } from 'lucide-react'
import { requestTrybeApi, requestTrybeAccess, requestTrybeScan, requestTrybeSend, requestTrybeHarvest, requestTrybeRun, requestTrybeRunStatus, requestTrybeRunStop, type TrybeScanPass, type TrybeRun } from '@/lib/extension-frame'
import { readMetaAds, metaAdsWords } from '@/components/labs/metaAdsRead'
import { nextGapMs, prefsKey, CATEGORY_SUGGESTIONS, DAILY_FIND, SCAN_READ, SHORT_RUN_UNDER, SHORT_GAP_MS, MAX_DAILY_CAP } from '@/lib/trybe-outreach'
import TrybeInbox, { fetchTrybeInbox, lastIsMine, type Conversation } from '@/components/labs/TrybeInbox'
import { reportTrybeInbox } from '@/lib/trybe-alerts'
import { readDiscoveryPage, requestState, acceptRate, type BrandFlags, type RequestState } from '@/lib/trybe-invites'
import TrybeLink from '@/components/labs/TrybeLink'
import { SCOUT_TRYBE_FIND_MIN_VERSION, SCOUT_TRYBE_HARVEST_MIN_VERSION, SCOUT_TRYBE_BACKGROUND_SEND_MIN_VERSION, SCOUT_TRYBE_RUNNER_MIN_VERSION, SCOUT_TRYBE_INBOX_MIN_VERSION, SCOUT_TRYBE_OPEN_BRAND_MIN_VERSION, SCOUT_TRYBE_PLAYBOOK_MIN_VERSION, SCOUT_TRYBE_MYBRANDS_MIN_VERSION, SCOUT_STORE_LISTING_URL, scoutAtLeast } from '@/lib/scout-version'
import { META_ADS_FRESH_MS, TOP100_FRESH_MS, type PickReason } from '@/lib/trybe-pick'
import { type AfterState } from '@/lib/trybe-playbook'
import TrybeAfterAccept, { type AfterBrand } from '@/components/labs/TrybeAfterAccept'
import TrybeMyBrands from '@/components/labs/TrybeMyBrands'
import TrybeWeek from '@/components/labs/TrybeWeek'
import TrybeChanges, { fetchChanges, changesSummary, type ChangesRead } from '@/components/labs/TrybeChanges'
import { readJoinedBrandIds } from '@/lib/trybe-joined'
import { type PeekActions } from '@/components/labs/TrybeBrandPeek'
import TrybeWorking from '@/components/labs/TrybeWorking'
import TrybeHookCheck from '@/components/labs/TrybeHookCheck'
import TrybeCreate from '@/components/labs/TrybeCreate'
import TrybeStage from '@/components/labs/TrybeStage'
import TrybeAds from '@/components/labs/TrybeAds'
import TrybeRetainers from '@/components/labs/TrybeRetainers'
import TrybeSampleGuard from '@/components/labs/TrybeSampleGuard'
import { readScript } from '@/lib/trybe-mybrands'
import { FinderToolbar, FinderFilterNote, FinderPriorities, FinderPresets, BrandExtras, StarButton, PassButton, AmazonLine, PayChip, CrowdChip, SpendChip, SpendNote, NewChip, StaticsChip, SellsChip, VerdictChip, ReviewChip, PaidOutChip, TikTokShopChip, CompareButton, BrandMark, NO_FILTERS, filtersOn, type LiveAmazon, type LivePayEst } from '@/components/labs/TrybeFinderControls'
import TrybeCompare from '@/components/labs/TrybeCompare'
import { COMPARE_MAX } from '@/lib/trybe-compare'
import { useTrybeAmazon } from '@/components/labs/useTrybeAmazon'
import { readVoice } from '@/components/labs/useTrybeVoice'
import { DEFAULT_PRIORITIES, adLibraryUrl, type Priorities } from '@/lib/trybe-pick'
import { type FinderFilters, type FilterId, type DirStats, type CrowdRead, type SpendRead } from '@/lib/trybe-finder'
import type { SellsRead } from '@/lib/trybe-sells'

const PURPLE = '#7C3AED'
/** Where to join TRYBE, free (MVP's referral link). */
const TRYBE_JOIN_URL = 'https://jointrybe.com/r/HTLEJE47'
const GREEN = '#16A34A'
const AMBER = '#B45309'
const RED = '#DC2626'

interface Brand {
  brand_id: string
  name: string
  categories: string[] | null
  website: string | null
  about: string | null
  pay_text: string | null
  rating: number | null
  reviews: number | null
  creator_earnings: string | null
  total_creators: number | null
  trybe_score: number | null
  site_summary: string | null
  site_products: string[] | null
  site_error: string | null
  status: 'new' | 'not_fit' | 'drafted' | 'sending' | 'sent' | 'failed' | 'skipped' | 'already' | 'removed'
  draft: string | null
  sent_at: string | null
  send_started_at: string | null
  error: string | null
  worked_with: boolean
  /** When MVP's last whole read of TRYBE's list missed this brand (failed and
   *  queued brands only). Null while TRYBE still lists it. */
  left_trybe_at?: string | null
  fit_score?: number | null
  fit_reason?: string | null
  fit_prefs?: string | null
  /** When MVP first saw this brand's TRYBE conversation (migration 419). */
  replied_at?: string | null
  /** After the brand accepted (migration 425). */
  kickoff_draft?: string | null
  kickoff_sent_at?: string | null
  followup_sent_at?: string | null
  video_plan?: AfterBrand['video_plan']
  video_plan_at?: string | null
}

type Access = 'checking' | 'granted' | 'not-granted' | 'no-scout' | 'old'
/** MVP's copy of every TRYBE brand (shared), and how complete it is. */
interface Directory { brands: number; listed?: number | null; firstCountAt?: string | null; joinedSinceFirst?: number | null; joinedStillListed?: number | null; withWebsite: number; websitesRead: number; lastCollectedAt: string | null; lastPartial?: { at: string; pages: number | null; totalPages: number | null } | null; categories: string[]; top100?: { at?: string; entries?: number; brands?: number; matched?: number } | null }
/** The whole list is collected again after this long. */
const RECOLLECT_MS = 20 * 3600_000
type Tab = 'create' | 'find' | 'queue' | 'sent' | 'inbox' | 'brands' | 'week' | 'changes' | 'working'
/** One brand from MVP's copy of TRYBE, as the live list shows it. */
interface LiveBrand {
  brand_id: string; name: string; website: string | null; categories: string[]; about: string | null
  pay_text: string | null; pay_kind?: 'flat' | 'percent' | 'both' | null; trybe_score: number | null; total_creators: number | null; match: number
  first_seen_at?: string | null
  products: string[]; website_read: boolean
  /** Where it stands on this creator's own list, if it is on it. */
  status: Brand['status'] | null; fit_score: number | null; fit_reason: string | null
  /** Its fit was judged for an earlier search, not the one shown. */
  fit_stale?: boolean
  /** Cole's picks (lib/trybe-pick): the score, why, and how many signals were read. */
  pick?: number; pick_reasons?: PickReason[]; pick_read?: number
  meta_ads?: number | null; meta_ads_checked_at?: string | null
  /** The brand on Amazon, TRYBE's own numbers, and the creator's star. */
  amazon?: LiveAmazon | null; stats?: DirStats | null; starred?: boolean
  /** What a video pays (lib/trybe-pay), how crowded, new, and statics. */
  pay_est?: LivePayEst | null; crowd?: CrowdRead | null; spend?: SpendRead | null; is_new?: boolean; statics?: boolean | null
  /** What it sells (lib/trybe-sells), with why. */
  sells?: SellsRead | null
  /** How fast it decides videos, from MVP members' results. */
  review?: { reviewDays: number | null; slowShare: number | null } | null
  /** TRYBE's payout range, the range before when it went up lately, TikTok Shop, and the Top 100 (Seb, 2026-10-17). */
  earnings_bucket?: string | null
  tier_up?: { before: string | null; after: string | null; at: string } | null
  tiktok_shop?: boolean | null
  top100_hits?: number | null
  top100_best_rank?: number | null
}
const REQUESTS_KEY = 'mvp.trybe.requests'
interface RequestsRead { at: number; complete: boolean; pages: number; flags: Record<string, BrandFlags>; invites: BrandFlags[] }
const REQUEST_WORDS: Record<RequestState, { label: string; color: string; bg: string }> = {
  accepted: { label: 'Accepted', color: GREEN, bg: 'rgba(22,163,74,0.12)' },
  pending: { label: 'Pending', color: AMBER, bg: 'rgba(180,83,9,0.10)' },
  declined: { label: 'Declined or expired', color: RED, bg: 'rgba(220,38,38,0.10)' },
}
type LiveSort = 'match' | 'picks' | 'pay' | 'spend' | 'payouts' | 'creators' | 'fit' | 'newest'
type LivePay = 'any' | 'flat' | 'percent' | 'both' | 'adspend' | 'guaranteed'
const SORTS: Array<{ id: LiveSort; label: string; says: string }> = [
  { id: 'match', label: 'Best match', says: 'Best matches first.' },
  { id: 'picks', label: 'Best bets', says: 'Best bets first, ranked by Your priorities: few creators, real ad spend (Meta ads, TRYBE\u2019s Top 100), pay, samples, and brands you already filmed on Amazon.' },
  { id: 'pay', label: 'Highest pay', says: 'Highest pay first: what a video pays (your results, members\u2019 results, or its flat fee and retainer), then % of sales.' },
  { id: 'spend', label: 'Pays creators most', says: 'Most paid to TRYBE creators a month first, estimated: its videos approved in the last 30 days times its pay per video. Brands MVP cannot estimate come after.' },
  { id: 'payouts', label: 'Highest total payouts', says: 'Most paid out to creators on TRYBE first, by TRYBE\u2019s own payout range ($200K+, $50K+...), then most creators. Brands TRYBE gives no range for come after.' },
  { id: 'creators', label: 'Fewest creators', says: 'Fewest creators first: less competition for each brand.' },
  { id: 'fit', label: 'Best fit', says: 'Highest AI fit score for this search first. Brands not scored for it come after, then the ones the AI said do not fit it.' },
  { id: 'newest', label: 'Newest', says: 'Newest on TRYBE first, by when MVP first saw each brand.' },
]
const PAYS: Array<{ id: LivePay; label: string }> = [
  { id: 'any', label: 'Any pay' },
  { id: 'flat', label: 'Flat fee' },
  { id: 'percent', label: '% of sales' },
  { id: 'both', label: '% plus a fee' },
  { id: 'adspend', label: '% of ad spend' },
  { id: 'guaranteed', label: 'Guaranteed' },
]
const PAY_WORD: Record<LivePay, string> = { any: 'anything', flat: 'a flat fee', percent: 'a % of sales', both: 'a fee and a % of sales together', adspend: 'a % of ad spend', guaranteed: 'a guaranteed retainer' }
const PAY_SAYS: Record<LivePay, string> = {
  any: 'Every brand, whatever it pays.',
  flat: 'Brands that pay a set amount per video first.',
  percent: 'Brands that pay a commission on what your videos sell first.',
  both: 'Brands that pay a flat fee per video and a % of sales together.',
  adspend: 'Brands that pay a % of what they spend running your videos as ads.',
  guaranteed: 'Brands that pay a guaranteed retainer for a set number of videos.',
}
/** On the list in a way that means it is not picked again from the live list. */
const TAKEN: Array<Brand['status']> = ['drafted', 'sending', 'sent', 'already', 'failed']
interface LogLine { at: number; name: string; text: string; tone: 'ok' | 'warn' | 'bad' | 'info' }

// The kind of core message MVP recommends (Seb, 2026-10-07): who you are and
// your numbers, what you make and why it helps the brand sell, where to see
// your work. MVP adds the hello to each brand and the sign-off.
const STARTER = `I'm an Amazon Influencer making real-life video reviews that help customers make buying decisions, and your products are right in my wheelhouse.

I'd love to bring your brand into my current catalogue of content, and I'm happy to start with one video so you can see the fit.

You can see my work on my Amazon storefront.`

/** SCOUT's send codes, in words. */
const SEND_WORDS: Record<string, string> = {
  'not-signed-in': 'TRYBE is signed out in this Chrome',
  'brand-not-found': 'SCOUT could not find this brand on TRYBE',
  'message-box-not-found': 'TRYBE did not open the message box',
  'send-button-not-found': 'SCOUT could not find Send Request',
  'message-did-not-take': 'TRYBE did not take the message',
  'send-disabled': 'Send Request stayed greyed out',
  'no-access': 'SCOUT is not allowed on TRYBE',
  'bad-url': 'The brand link is not a TRYBE link',
  'no-message': 'The draft is empty',
  'no-answer-from-page': 'The TRYBE page did not answer',
  'request-button-not-found': 'TRYBE showed the brand but no Request to Join button',
}
const sendWords = (e: string | null | undefined): string => {
  const raw = String(e || '')
  // SCOUT 1.48.0 to 1.50.0 ran it out of sight and would not take the screen
  // for it. From 1.50.1 nothing on TRYBE takes the screen, and Send now tries
  // again hidden with the name typed into TRYBE's search.
  if (raw.startsWith('needs-screen: ')) return `SCOUT could not reach it out of sight (${sendWords(raw.slice(14))}). Press Send now on it to try again`
  const code = raw.split(' (')[0]
  return SEND_WORDS[code] ? raw.replace(code, SEND_WORDS[code]) : raw
}

/** A failed send to a brand that is gone: SCOUT could not find it on TRYBE,
 *  and MVP's last whole read of TRYBE's list did not have it either. Two
 *  signals, so a brand SCOUT merely missed is never called gone. */
function goneFromTrybe(b: Brand): boolean {
  return b.status === 'failed' && !!b.left_trybe_at && /^brand-not-found/.test(String(b.error || '').replace(/^needs-screen: /, ''))
}

function priority(b: Brand): number {
  return (b.worked_with ? 1000 : 0) + (b.fit_score ?? 0) * 2 + (b.trybe_score ?? 0) + (b.pay_text ? Math.min(50, parseFloat((b.pay_text.match(/[\d.]+/) || ['0'])[0]) || 0) : 0)
}

async function api(body?: Record<string, unknown>) {
  const r = await fetch('/api/labs/trybe', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok && !d.capped) throw new Error(d.error || `Request failed (${r.status})`)
  return d
}

function passWords(p: TrybeScanPass): string {
  if (p.kind === 'list') return `Discover list: ${p.listed} listed, ${p.read} new read`
  const what = p.kind === 'search' ? `Search "${p.term}"` : `Category "${p.term}"`
  if (!p.applied) return p.kind === 'search' ? `${what}: TRYBE's search box was not found` : `${what}: TRYBE shows no filter by that name`
  return `${what}: ${p.listed} listed, ${p.read} new read`
}

/** Keywords offered to try, one click each. */
const KEYWORD_EXAMPLES = ['golf', 'bible journaling', 'dog toys', 'camping gear', 'coffee', 'kids crafts']
/** Find notes that only describe MVP's copy of TRYBE (counts, where it came
 *  from) and go to the admin only. Every other note, a problem above all, is
 *  shown to everyone: a find that failed must never look like a quiet one. */
const ADMIN_NOTE = /^(SCOUT collected |Using MVP's copy|The TRYBE list carried no websites)/
/** A fit score this high or more is a strong fit (Tick Fit 80+). */
const FIT_STRONG = 80
/** Niches shown before "Show all". */
const NICHES_SHOWN = 12

/** A picture for a TRYBE niche, from its name. Anything unknown gets a tag. */
function nicheIcon(name: string): LucideIcon {
  const n = name.toLowerCase()
  const rules: Array<[RegExp, LucideIcon]> = [
    [/skin/, Droplet], [/hair/, Scissors], [/makeup|cosmetic|beauty device/, Wand2], [/beauty|groom|personal care|hygiene/, Sparkles],
    [/supplement|nutrition|vitamin/, Pill], [/fitness|gym|weight|sport/, Dumbbell], [/health|wellness/, HeartPulse],
    [/food|beverage|drink|coffee|snack/, Coffee], [/kitchen|dining|cook/, UtensilsCrossed], [/home|decor|living|furniture/, House],
    [/fashion|apparel|cloth/, Shirt], [/jewel|accessor/, Gem], [/tech|gadget|electronic|app/, Cpu], [/baby|kid|child|parent/, Baby],
    [/pet|dog|cat/, PawPrint], [/outdoor|camp|hik/, Tent], [/travel/, Plane], [/book|education|learn/, BookOpen],
    [/faith|bible|christian|church/, Church], [/craft|hobby|art/, Palette], [/clean/, SprayCan], [/sleep/, Moon], [/eco|garden|plant|natural/, Leaf],
  ]
  return rules.find(([re]) => re.test(n))?.[1] || Tag
}

/** A brand's TRYBE conversation, matched by its whole name: TRYBE names a
 *  brand's chat after the brand ("NOBL", "HiStrips Team (DM)"). Only the whole
 *  name counts, and never a group: "Audien Creator Vault" is a community of
 *  400 creators, not Audien replying. The latest one wins. */
function convoFor(brand: string, convos: Conversation[]): Conversation | null {
  const n = (t: string) => t.toLowerCase().replace(/\(dm\)/g, ' ').replace(/[^a-z0-9()]+/g, ' ').replace(/\b(team|official)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const b = n(brand)
  if (b.length < 2) return null
  const hits = convos.filter(c => !/\(group\)/i.test(c.name) && n(c.name) === b)
  return hits.sort((x, y) => y.at - x.at)[0] || null
}

/** The brand's TRYBE conversation, when it counts as an answer to MVP's
 *  request: only for a request that went (sent, already requested, or not
 *  yet confirmed), and only a conversation active after it was sent. A chat
 *  from before the request is not a reply to it. */
const WENT: Array<Brand['status']> = ['sent', 'already', 'sending']
function replyConvo(b: Brand, convos: Conversation[]): Conversation | null {
  if (!WENT.includes(b.status)) return null
  const c = convoFor(b.name, convos)
  if (!c) return null
  const sentAt = Date.parse(b.send_started_at || b.sent_at || '')
  return Number.isFinite(sentAt) && c.at > 0 && c.at < sentAt ? null : c
}

/** One number tile. */
/** A glance card: what it is, one big number, what the number means. The
 *  colour on top says which card it is at a glance; the number takes it only
 *  when it needs attention. */
function Stat({ label, value, hint, tone, accent = '#7C3AED', onClick }: { label: string; value: string; hint?: string; tone?: string; accent?: string; onClick?: () => void }) {
  const body = (<>
    <p className="text-[13px] font-semibold" style={{ color: 'var(--text-soft)' }}>{label}</p>
    <p className="text-[28px] font-bold leading-tight mt-1 tabular-nums" style={tone ? { color: tone } : undefined}>{value}</p>
    {hint && <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-soft)' }}>{hint}</p>}
  </>)
  const cls = 'text-left rounded-2xl border px-5 py-4'
  const style = { borderColor: 'var(--border)', background: 'var(--surface)', borderTop: `4px solid ${accent}` }
  return onClick ? <button onClick={onClick} className={`${cls} hover:shadow-sm transition-shadow`} style={style}>{body}</button> : <div className={cls} style={style}>{body}</div>
}

/** The menu, in three groups in the order a creator works (Seb, 2026-10-14:
 *  "logical, visible and modern looking"): make the videos, get the brands,
 *  keep track. Every tab in sight, none behind a scroll. */
type TabGroup = 'create' | 'brands' | 'track'
const TAB_GROUPS: Array<{ id: TabGroup; label: string; says: string }> = [
  { id: 'create', label: 'Create', says: 'Plan and film' },
  { id: 'brands', label: 'Get brands', says: 'Reach out and reply' },
  { id: 'track', label: 'Track', says: 'Pay and news' },
]
const TABS: Array<{ id: Tab; label: string; icon: LucideIcon; group: TabGroup; says: string }> = [
  { id: 'create', label: 'Make videos', icon: Clapperboard, group: 'create', says: 'Pick a brand, pick the product you have, and get ten shooting scripts that follow its brief.' },
  { id: 'week', label: 'This week', icon: CalendarDays, group: 'create', says: 'Your samples, ticked as they arrive, and your next 7 days planned from them.' },
  { id: 'working', label: 'What\u2019s working', icon: Lightbulb, group: 'create', says: 'Check your own hook, then see how the videos in TRYBE\u2019s Top 100 open, with examples to watch.' },
  { id: 'find', label: 'Find brands', icon: Search, group: 'brands', says: 'Brands that fit your channel, and a first message to each, in your words.' },
  { id: 'queue', label: 'Ready to send', icon: Send, group: 'brands', says: 'Messages written and waiting. SCOUT sends them slowly, under your daily limit.' },
  { id: 'sent', label: 'Sent', icon: Check, group: 'brands', says: 'Who you asked, who answered, and what to do next with each brand.' },
  { id: 'inbox', label: 'Inbox', icon: Inbox, group: 'brands', says: 'Your TRYBE chats, each with a suggested reply.' },
  { id: 'brands', label: 'My brands', icon: Star, group: 'track', says: 'What each brand paid you and approved, which to focus on, and what MVP members see together.' },
  { id: 'changes', label: 'What changed', icon: Bell, group: 'track', says: 'What changed on TRYBE this week: new brands, pay changes, more Meta ads, the Top 100. Your brands first.' },
]


/** When the next send opens up, in the creator's own clock. */
function opensWords(at: string | null): string {
  if (!at) return 'Daily cap reached.'
  const t = new Date(at)
  if (!Number.isFinite(t.getTime())) return 'Daily cap reached.'
  const sameDay = t.toDateString() === new Date().toDateString()
  const time = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `Next one can go at ${time}${sameDay ? '' : ' tomorrow'}.`
}

/** `preview`: the Amazon plan's TRYBE (Seb, 2026-10-14). Find brands to
 *  browse, with the Amazon match, filters, priorities, stars and pass; every
 *  other tab is shown as Pro, and nothing that writes, sends or reads the
 *  inbox runs. The server enforces the same (lib/labs-preview). */
export default function TrybeOutreach({ preview = false }: { preview?: boolean } = {}) {
  const [brands, setBrands] = useState<Brand[]>([])
  // "Include my results in members' combined numbers" (migration 428).
  const [poolOptOut, setPoolOptOut] = useState(false)
  // What changed on TRYBE this week (migration 428), read once for the
  // "Your week" line and the What changed tab.
  const [changes, setChanges] = useState<ChangesRead | null>(null)
  const [changesError, setChangesError] = useState<string | null>(null)
  // The brand list the Inbox matches chats against (id, name, website).
  const inboxDirectory = useMemo(() => brands.map((b) => ({ id: b.brand_id, name: b.name, website: b.website })), [brands])
  const [loading, setLoading] = useState(true)
  // Make videos first (Seb, 2026-10-13: brand, product, scripts, streamlined).
  const [tab, setTab] = useState<Tab>(preview ? 'find' : 'create')
  // A Pro tab opened on the Amazon plan: said, with the way to Pro.
  const [lockedTab, setLockedTab] = useState<Tab | null>(null)
  const go = useCallback((t: Tab) => {
    if (preview && t !== 'find') { setLockedTab(t); return }
    setLockedTab(null); setTab(t)
  }, [preview])
  const [core, setCore] = useState('')
  const [cap, setCap] = useState(20)
  // The cap the server holds, for the tile and Send all; `cap` is the input.
  const [savedCap, setSavedCap] = useState(20)
  const [used, setUsed] = useState(0)
  // When the next send opens up, once the cap is used: the oldest counted send
  // turning 24 hours old, never midnight (Seb, 2026-10-09).
  const [freeAt, setFreeAt] = useState<string | null>(null)
  const [cats, setCats] = useState<string[]>([])
  const [kws, setKws] = useState<string[]>([])
  const [kwInput, setKwInput] = useState('')
  const [savedKey, setSavedKey] = useState(prefsKey([], []))
  const [dailyFind, setDailyFind] = useState(true)
  const [lastFindAt, setLastFindAt] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [access, setAccess] = useState<Access>('checking')
  const [scoutVersion, setScoutVersion] = useState<string | null>(null)
  const [finding, setFinding] = useState<{ stage: string; done?: number; total?: number } | null>(null)
  const [findNotes, setFindNotes] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showNotFit, setShowNotFit] = useState(false)
  const [pageRunning, setRunning] = useState(false)
  // SEND ALL RUN BY SCOUT (1.48.0): the run lives in SCOUT, this page only
  // shows it, so the tab can close. Read on load and every few seconds while on.
  const [scoutRun, setScoutRun] = useState<TrybeRun | null>(null)
  const running = pageRunning || !!scoutRun?.on
  const [current, setCurrent] = useState<string | null>(null)
  const [waitUntil, setWaitUntil] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [log, setLog] = useState<LogLine[]>([])
  const [runSize, setRunSize] = useState(0)
  const [directory, setDirectory] = useState<Directory | null>(null)
  // How MVP's copy of TRYBE is doing (counts, collection notes) is for the
  // admin only (Seb, 2026-10-07): it makes no difference to a creator.
  const [isAdmin, setIsAdmin] = useState(false)
  const [showAllNiches, setShowAllNiches] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // The TRYBE inbox, for the unread count and which sent brands answered.
  const [inbox, setInbox] = useState<{ convos: Conversation[]; me: string[]; myName: string } | null>(null)
  const [inboxError, setInboxError] = useState<string | null>(null)
  const [openChat, setOpenChat] = useState<{ id: string; n: number } | null>(null)
  const [editingCore, setEditingCore] = useState(false)
  const [sentFilter, setSentFilter] = useState<'all' | 'replied' | 'waiting' | 'accepted' | 'declined'>('all')
  // THE LIVE LIST (Seb, 2026-10-07): MVP's copy of TRYBE searched as the
  // filters change, no SCOUT and no website fetched.
  const [live, setLive] = useState<{ brands: LiveBrand[]; matched: number; capped: boolean; hiddenMine?: number; payUnknown?: number; payOther?: number
    hiddenBy?: Partial<Record<FilterId, number>>; blankBy?: Partial<Record<FilterId, number>>; unknownBy?: Partial<Record<FilterId, number>>; amazonNotes?: string[]; amazonVideos?: number; rawKeys?: string[]; prioritiesSaved?: boolean; starsSaved?: boolean; crowdDays?: number | null; spendKnown?: { recent: number; lifetime: number; none: number } | null; mix?: { small: number; mid: number; big: number; unknown: number; says: string | null } | null } | null>(null)
  // FINDER (Seb, 2026-10-14, after Rob's Oink Blue video: "build all 4"):
  // filters, a brand's name, and the creator's priorities for Best bets.
  const [filters, setFilters] = useState<FinderFilters>(NO_FILTERS)
  const [nameQ, setNameQ] = useState('')
  const [priorities, setPriorities] = useState<Priorities>(DEFAULT_PRIORITIES)
  const [prioritiesEdited, setPrioritiesEdited] = useState(false)
  const [prioritiesNote, setPrioritiesNote] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)
  const prioritiesSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showMine, setShowMine] = useState(false)
  // SORT AND PAY FILTER (Seb, 2026-10-08 upgrade 3), done on the server so
  // the order covers every match and not just the 60 on screen.
  const [sortBy, setSortBy] = useState<LiveSort>('match')
  // What changed's "See all new": Find brands on the New this week list.
  const seeNew = useCallback(() => { setFilters({ ...NO_FILTERS, newOnly: true }); setSortBy('picks'); go('find') }, [go])
  const [payType, setPayType] = useState<LivePay>('any')
  const [picksHelp, setPicksHelp] = useState(false)
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [livePick, setLivePick] = useState<Set<string>>(new Set())
  // COMPARE (Seb, 2026-10-17: "do ... eight"): the brands kept for the side by
  // side view, as they were shown, so a new search does not drop them.
  const [compare, setCompare] = useState<LiveBrand[]>([])
  const flipCompare = (b: LiveBrand) => setCompare(c => c.some(x => x.brand_id === b.brand_id) ? c.filter(x => x.brand_id !== b.brand_id) : c.length >= COMPARE_MAX ? c : [...c, b])
  const [liveNonce, setLiveNonce] = useState(0)
  const liveReq = useRef(0)
  // COLE'S PICKS (Seb, 2026-10-12): TRYBE's Top 100 and Meta ad counts, read
  // by SCOUT 1.45.0, with what happened said under the list.
  const [signalNote, setSignalNote] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null)
  const [metaRun, setMetaRun] = useState<{ done: number; total: number } | null>(null)
  // Each after-a-yes panel tells the page its stage, so the counts on top
  // are the panels' own, never a second guess from the list.
  const [afterStates, setAfterStates] = useState<Record<string, AfterState>>({})
  const onAfterState = useCallback((id: string, st: AfterState) => setAfterStates(m => (m[id] === st ? m : { ...m, [id]: st })), [])
  const [requestsFailed, setRequestsFailed] = useState<string | null>(null)
  const [topRun, setTopRun] = useState(false)
  const topTried = useRef(false)
  // What the server has saved, which is what the daily find goes by: never
  // the half-typed message or a box ticked a second ago.
  const [saved, setSaved] = useState<{ core: string; dailyFind: boolean } | null>(null)
  const stopRef = useRef(false)
  // Leaving the page stops a send run: nothing sends with nothing on screen.
  // Leaving also ends a read of TRYBE's brand list (Sent's request states).
  const leftRef = useRef(false)
  useEffect(() => () => { stopRef.current = true; leftRef.current = true }, [])
  const autoRan = useRef(false)

  const say = (name: string, text: string, tone: LogLine['tone']) => setLog(l => [{ at: Date.now(), name, text, tone }, ...l].slice(0, 200))

  const load = useCallback(async () => {
    try {
      const d = await api()
      setBrands(d.brands || [])
      setCore(c => c || d.settings?.coreMessage || '')
      setCap(d.settings?.dailyCap ?? 20)
      setSavedCap(d.settings?.dailyCap ?? 20)
      setUsed(d.usedToday ?? 0)
      setFreeAt(d.nextFreeAt ?? null)
      const c = d.settings?.categories || [], k = d.settings?.keywords || []
      setSavedKey(prefsKey(c, k))
      setDailyFind(d.settings?.dailyFind !== false)
      setPoolOptOut(d.settings?.poolOptOut === true)
      setLastFindAt(d.settings?.lastFindAt ?? null)
      setDirectory(d.directory ?? null)
      setIsAdmin(d.isAdmin === true)
      setSaved({ core: d.settings?.coreMessage || '', dailyFind: d.settings?.dailyFind !== false })
      if (!(d.settings?.coreMessage || '').trim()) setEditingCore(true)
      return d
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load'); return null }
    finally { setLoading(false) }
  }, [])

  // The niche fields are filled once from what was saved, then belong to the page.
  useEffect(() => {
    void load().then(d => {
      if (!d) return
      setCats(d.settings?.categories || [])
      setKws(d.settings?.keywords || [])
    })
  }, [load])
  useEffect(() => { void requestTrybeAccess(false).then(r => { setAccess(r.state); setScoutVersion(r.version ?? null) }) }, [])
  const canInbox = !preview && access === 'granted' && scoutAtLeast(scoutVersion, SCOUT_TRYBE_INBOX_MIN_VERSION)
  const scoutOpens = access === 'granted' && scoutAtLeast(scoutVersion, SCOUT_TRYBE_OPEN_BRAND_MIN_VERSION)
  // 1.46.0: My brands, and each brand's best videos next to its video ideas.
  const canMyBrands = access === 'granted' && scoutAtLeast(scoutVersion, SCOUT_TRYBE_MYBRANDS_MIN_VERSION)
  // What changed, read ahead. Read again once SCOUT can read your joined
  // brands, so any brand you joined wrongly listed as left is put right first.
  useEffect(() => { if (preview || access === 'checking') return; fetchChanges(7, canMyBrands).then(setChanges).catch((e) => setChangesError(e instanceof Error ? e.message : 'not read')) }, [access, canMyBrands]) // eslint-disable-line react-hooks/exhaustive-deps
  const myBrandsUpdate = access === 'granted' && scoutVersion && !canMyBrands
    ? `Your SCOUT is ${scoutVersion}. My brands needs SCOUT ${SCOUT_TRYBE_MYBRANDS_MIN_VERSION} or newer: update it from the Chrome Web Store (or remove it and add it again), then reload this page.`
    : null
  const loadInbox = useCallback(async () => {
    const r = await fetchTrybeInbox().catch(() => ({ ok: false as const, error: 'SCOUT did not answer.' }))
    if (r.ok) { setInbox({ convos: r.convos, me: r.me, myName: r.myName }); setInboxError(null) } else setInboxError(r.error)
  }, [])
  useEffect(() => { if (canInbox) void loadInbox() }, [canInbox, loadInbox])
  // The tiles and Sent stay current too: every two minutes while in view, and
  // straight away when the tab comes back into view. The Inbox tab reads its
  // own list on the same rhythm.
  useEffect(() => {
    if (!canInbox) return
    const tick = () => { if (document.visibilityState === 'visible' && tab !== 'inbox') void loadInbox() }
    const t = setInterval(tick, 120_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [canInbox, loadInbox, tab])
  // ACCEPTED, PENDING, DECLINED (upgrade 1): read from TRYBE's Discover
  // Brands list, which flags each brand the signed-in creator has a pending
  // request with, or an invite from (lib/trybe-invites.ts). Every page is
  // read, so a brand missing from the flags really is no longer pending; a
  // read that stops early says so and tags only what it saw. Kept for three
  // hours in this browser: a full read is about 80 pages through SCOUT.
  const canRequests = canInbox
  const brandIdsRef = useRef<Set<string>>(new Set())
  brandIdsRef.current = new Set(brands.map(b => b.brand_id))
  const [requests, setRequests] = useState<RequestsRead | null>(null)
  const [requestsNote, setRequestsNote] = useState<string | null>(null)
  const [requestsPage, setRequestsPage] = useState<string | null>(null)
  const requestsBusy = useRef(false)
  const loadRequests = useCallback(async (force = false) => {
    if (requestsBusy.current) return
    if (!force) {
      try {
        const c = JSON.parse(localStorage.getItem(REQUESTS_KEY) || 'null') as RequestsRead | null
        if (c && Date.now() - c.at < 3 * 3600_000) { setRequests(c); setRequestsNote(null); return }
      } catch { /* read again below */ }
    }
    requestsBusy.current = true
    setRequestsNote(null)
    const flags: Record<string, BrandFlags> = {}
    const invites: BrandFlags[] = []
    let pages = 0, total: number | null = null, complete = false, stopped: string | null = null
    try {
      for (let p = 1; p <= 150; p++) {
        if (leftRef.current) { stopped = 'You left the page.'; break }
        setRequestsPage(total ? `page ${p} of ${total}` : `page ${p}`)
        const r = await requestTrybeApi('GET', `/backend/api/discovery/brands?limit=75&page=${p}`).catch(() => ({ ok: false as const, error: 'SCOUT did not answer.' }))
        if (!r.ok) { stopped = 'error' in r && r.error ? r.error : `TRYBE answered ${'status' in r ? r.status : 'nothing'}`; break }
        const page = readDiscoveryPage(r.json)
        pages = p
        total = page.totalPages ?? total
        for (const f of page.flags) {
          if (brandIdsRef.current.has(f.brandId)) flags[f.brandId] = f
          if (f.pendingInvite && !invites.some(x => x.brandId === f.brandId)) invites.push(f)
        }
        if (!page.listed || (total && p >= total)) { complete = true; break }
      }
      if (!complete && !stopped) stopped = 'TRYBE listed more pages than MVP reads.'
      // NOTHING READ IS NOT ZERO (review 2026-10-12): with no page read there
      // is no "0 accepted", only a read that failed, said as one.
      if (pages === 0) { setRequestsFailed(stopped || 'TRYBE did not answer.'); return }
      setRequestsFailed(null)
      const read: RequestsRead = { at: Date.now(), complete, pages, flags, invites: invites.slice(0, 50) }
      setRequests(read)
      if (stopped) setRequestsNote(`MVP read ${pages} page${pages === 1 ? '' : 's'} of TRYBE's brands, then stopped (${stopped}). Only brands it saw are tagged.`)
      else try { localStorage.setItem(REQUESTS_KEY, JSON.stringify(read)) } catch { /* this browser only */ }
    } finally { requestsBusy.current = false; setRequestsPage(null) }
  }, [])
  useEffect(() => { if (canRequests && tab === 'sent' && !requests) void loadRequests() }, [canRequests, tab, requests, loadRequests])
  // REPLY ALERTS (upgrade 4): every fresh read of the inbox is noted on MVP,
  // so the menu count and the Today list show it on other pages.
  const [alertsError, setAlertsError] = useState<string | null>(null)
  useEffect(() => {
    if (!inbox) return
    void reportTrybeInbox(inbox.convos).then(r => { if (!r.ok) setAlertsError(r.error); else if (!r.skipped) setAlertsError(null) })
  }, [inbox])
  // The Today list and the menu count link straight to the Inbox tab.
  useEffect(() => {
    try { const t = new URLSearchParams(window.location.search).get('tab'); if (preview) { if (t && t !== 'find') setLockedTab(t as Tab) } else if (t === 'inbox' || t === 'brands' || t === 'week' || t === 'changes' || t === 'working' || t === 'create' || t === 'find') setTab(t) } catch { /* no URL */ }
  }, [])
  const onInboxConvos = useCallback((convos: Conversation[]) => setInbox(i => (i ? { ...i, convos } : { convos, me: [], myName: '' })), [])
  // A reply seen for the first time is saved, so it counts from then on even
  // when the inbox cannot be read. Each brand once per visit.
  const stampedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!inbox) return
    const fresh = brands.filter(b => !b.replied_at && !stampedRef.current.has(b.brand_id))
      .map(b => ({ b, c: replyConvo(b, inbox.convos) })).filter(x => x.c)
    if (!fresh.length) return
    for (const x of fresh) stampedRef.current.add(x.b.brand_id)
    void api({ action: 'replied', replies: fresh.map(x => ({ id: x.b.brand_id, at: x.c!.at ? new Date(x.c!.at).toISOString() : null })) })
      .then(() => { for (const x of fresh) patch(x.b.brand_id, { replied_at: x.c!.at ? new Date(x.c!.at).toISOString() : new Date().toISOString() }) })
      .catch(() => { /* before migration 419 the live count still shows */ })
  }, [inbox, brands]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!waitUntil) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [waitUntil])
  const usesRunner = scoutAtLeast(scoutVersion, SCOUT_TRYBE_RUNNER_MIN_VERSION)
  // This page's lines and SCOUT's own run, newest first, in the same words.
  const runLog = useMemo(() => {
    const fromScout: LogLine[] = (scoutRun?.log || []).map(l => ({ ...l, text: l.text.startsWith('Not sent: ') ? `Not sent: ${sendWords(l.text.slice(10).replace(/\.$/, ''))}.` : l.text }))
    return [...log, ...fromScout].sort((a, b) => b.at - a.at).slice(0, 200)
  }, [log, scoutRun])
  const runSeen = useRef<string>('')
  useEffect(() => {
    if (!usesRunner || preview) return
    let gone = false
    const read = async () => {
      const r = await requestTrybeRunStatus().catch(() => null)
      if (gone) return
      setScoutRun(r)
      // Each request SCOUT finished, and the end of the run, show on the list.
      const mark = r ? `${r.startedAt}:${r.idx}:${r.on}` : ''
      if (mark !== runSeen.current) { const first = !runSeen.current; runSeen.current = mark; if (!first) void load() }
    }
    void read()
    const t = setInterval(() => { void read(); setNow(Date.now()) }, scoutRun?.on ? 4000 : 30000)
    return () => { gone = true; clearInterval(t) }
  }, [usesRunner, preview, scoutRun?.on]) // eslint-disable-line react-hooks/exhaustive-deps

  const pageKey = prefsKey(cats, kws)
  const unsavedNiche = pageKey !== savedKey
  const hasNiche = cats.length > 0 || kws.length > 0
  const canSearchTrybe = scoutAtLeast(scoutVersion, SCOUT_TRYBE_FIND_MIN_VERSION)
  // 1.41.2: SCOUT collects the whole TRYBE list and MVP searches its own copy.
  const canHarvest = scoutAtLeast(scoutVersion, SCOUT_TRYBE_HARVEST_MIN_VERSION)
  // 1.45.0: TRYBE's Top 100 and Meta's Ad Library (Cole's picks).
  const canPlaybook = !preview && access === 'granted' && scoutAtLeast(scoutVersion, SCOUT_TRYBE_PLAYBOOK_MIN_VERSION)
  // Read once a day by itself, quietly, when the page opens.
  useEffect(() => {
    if (!canPlaybook || topTried.current || !directory || !isAdmin) return
    const at = directory.top100?.at ? Date.parse(directory.top100.at) : 0
    if (Date.now() - at < TOP100_FRESH_MS) return
    topTried.current = true
    void readTop100(true)
  }, [canPlaybook, directory]) // eslint-disable-line react-hooks/exhaustive-deps

  const queue = useMemo(() => brands.filter(b => b.status === 'drafted' && b.draft).sort((a, b) => priority(b) - priority(a)), [brands])
  const found = useMemo(() => brands.filter(b => b.status === 'new' && b.fit_prefs === savedKey).sort((a, b) => priority(b) - priority(a)), [brands, savedKey])
  const notFit = useMemo(() => brands.filter(b => b.status === 'not_fit' && b.fit_prefs === savedKey).sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0)), [brands, savedKey])
  const unjudged = useMemo(() => brands.filter(b => (b.status === 'new' || b.status === 'not_fit') && b.fit_prefs !== savedKey), [brands, savedKey])
  const history = useMemo(() => brands.filter(b => ['sent', 'sending', 'failed', 'already'].includes(b.status))
    .sort((a, b) => Date.parse(b.send_started_at || b.sent_at || '0') - Date.parse(a.send_started_at || a.sent_at || '0')), [brands])
  // THE AMAZON MATCH on Ready to send, Sent and the found list (Seb,
  // 2026-10-14: "add the amazon match to most places"). Read for the tab open.
  const amzList = useMemo(() => (tab === 'queue' ? queue : tab === 'sent' ? history : tab === 'find' ? found : []).slice(0, 300).map(b => ({ id: b.brand_id, name: b.name })), [tab, queue, history, found])
  const amz = useTrybeAmazon(amzList, [], !preview && amzList.length > 0)
  // "You already promote them" (storefront or TikTok) only when the Amazon
  // line does not already say it.
  const promotes = (b: Brand) => b.worked_with && !(amz.brand(b.brand_id)?.yourVideos || amz.brand(b.brand_id)?.storefront)
  const remaining = Math.max(0, savedCap - used)

  // Categories offered: the usual ones, the ones TRYBE showed on brands found,
  // and any already picked.
  const catOptions = useMemo(() => {
    const seen = new Map<string, number>()
    for (const b of brands) for (const c of b.categories || []) seen.set(c, (seen.get(c) || 0) + 1)
    const fromTrybe = Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c]) => c)
    // The TRYBE category list first, once SCOUT has read it.
    const all = [...cats, ...(directory?.categories || []), ...fromTrybe, ...(directory?.categories?.length ? [] : CATEGORY_SUGGESTIONS)]
    return all.filter((c, i) => all.findIndex(o => o.toLowerCase() === c.toLowerCase()) === i)
  }, [brands, cats, directory])

  function patch(id: string, p: Partial<Brand>) { setBrands(bs => bs.map(b => b.brand_id === id ? { ...b, ...p } : b)) }

  async function saveSettings(quiet = false) {
    setSavingSettings(true)
    try {
      const d = await api({ action: 'settings', coreMessage: core, dailyCap: cap, categories: cats, keywords: kws, dailyFind })
      setCap(d.settings.dailyCap)
      setSavedCap(d.settings.dailyCap)
      setSavedKey(prefsKey(d.settings.categories || [], d.settings.keywords || []))
      // THE DAILY RUN GOES BY WHAT WAS SAVED: unticking it and saving used to
      // leave the old "on" here, and the run wrote twenty messages anyway.
      setSaved({ core: d.settings.coreMessage || '', dailyFind: d.settings.dailyFind !== false })
      if (!quiet) toast.success('Saved')
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); return false }
    finally { setSavingSettings(false) }
  }

  async function allow() {
    const r = await requestTrybeAccess(true)
    setAccess(r.state); setScoutVersion(r.version ?? null)
    if (r.state === 'granted') toast.success('SCOUT can work in TRYBE now')
  }

  function addKeyword() {
    const parts = kwInput.split(',').map(s => s.trim()).filter(Boolean)
    if (!parts.length) return
    setKws(k => {
      const next = [...k]
      for (const p of parts) if (!next.some(o => o.toLowerCase() === p.toLowerCase()) && next.length < 12) next.push(p.slice(0, 40))
      return next
    })
    setKwInput('')
  }

  /** Draft these brands into Ready to send, four at a time. */
  async function draftIds(ids: string[]): Promise<{ ok: number; failed: number }> {
    let ok = 0, failed = 0
    setFinding({ stage: 'Writing messages', done: 0, total: ids.length })
    for (let i = 0; i < ids.length; i += 4) {
      const chunk = ids.slice(i, i + 4)
      try {
        // Your own messages to brands, so the first message writes the way you do.
        const d = await api({ action: 'draft', brandIds: chunk, voice: readVoice() })
        for (const r of (d.results || []) as Array<{ ok: boolean }>) r.ok ? ok++ : failed++
      // The rest are counted too: a stop must not make them vanish from the total.
      } catch (e) { failed += ids.length - i; toast.error(e instanceof Error ? e.message : 'Draft failed'); break }
      setFinding({ stage: 'Writing messages', done: Math.min(ids.length, i + 4), total: ids.length })
    }
    return { ok, failed }
  }

  /** Judge every brand not yet judged against the saved niche, five at a time. */
  async function judge(list: Brand[]): Promise<{ fit: number; no: number; failed: number }> {
    let fit = 0, no = 0, failed = 0
    const ids = list.map(b => b.brand_id).slice(0, 80)
    setFinding({ stage: 'Reading websites and checking fit', done: 0, total: ids.length })
    for (let i = 0; i < ids.length; i += 5) {
      const chunk = ids.slice(i, i + 5)
      try {
        const d = await api({ action: 'match', brandIds: chunk })
        for (const r of (d.results || []) as Array<{ ok: boolean; fit?: boolean }>) { if (!r.ok) failed++; else if (r.fit) fit++; else no++ }
      } catch (e) { failed += ids.length - i; toast.error(e instanceof Error ? e.message : 'Fit check failed'); break }
      setFinding({ stage: 'Reading websites and checking fit', done: Math.min(ids.length, i + 5), total: ids.length })
    }
    return { fit, no, failed }
  }

  /** Find brands: SCOUT searches TRYBE, MVP judges the fit. `auto` is the
   *  daily run: it also drafts the best ones into Ready to send. */
  async function findBrands(auto = false) {
    if (access !== 'granted') { toast.error('Allow SCOUT on TRYBE first'); return }
    if (!core.trim()) { toast.error('Write your core message first'); setTab('find'); return }
    if (!(await saveSettings(true))) return
    const notes: string[] = []
    setFindNotes([])
    try {
      let collected = true
      if (canHarvest) collected = await collectAndShortlist(notes)
      else await scanTrybe(notes)
      // TRYBE COULD NOT BE READ: said, and the day is not marked done, so the
      // next visit tries again instead of waiting twenty hours.
      if (!collected) {
        notes.push(auto ? 'Today\u2019s brands were not found because TRYBE could not be read. MVP tries again the next time this page opens.' : 'No brands found: TRYBE could not be read.')
        return
      }
      const d = await load()
      const all: Brand[] = d?.brands || brands
      const key = prefsKey(d?.settings?.categories || cats, d?.settings?.keywords || kws)
      const toJudge = all.filter(b => (b.status === 'new' || b.status === 'not_fit') && b.fit_prefs !== key)
      if (toJudge.length) {
        const j = await judge(toJudge)
        notes.push(hasNiche
          ? `MVP checked ${j.fit + j.no} against your niche from their websites: ${j.fit} fit, ${j.no} do not.${j.failed ? ` ${j.failed} could not be checked and are tried again next time.` : ''}`
          : `${j.fit} listed. Pick categories or keywords so MVP only lists brands that fit.`)
      }
      const after = await load()
      const list: Brand[] = ((after?.brands || []) as Brand[]).filter(b => b.status === 'new' && b.fit_prefs === key).sort((a, b) => priority(b) - priority(a))
      setSelected(new Set(list.slice(0, DAILY_FIND).map(b => b.brand_id)))
      if (auto) {
        const room = Math.max(0, DAILY_FIND - ((after?.brands || []) as Brand[]).filter(b => b.status === 'drafted').length)
        const pick = list.slice(0, room).map(b => b.brand_id)
        if (pick.length) {
          const r = await draftIds(pick)
          notes.push(`Today's drafts: ${r.ok} added to Ready to send${r.failed ? `, ${r.failed} could not be written` : ''}.`)
        } else notes.push(room ? 'No new brands that fit today, so nothing was added to the queue.' : 'Ready to send already holds today’s 20.')
        await api({ action: 'found' }).catch(() => null)
        setLastFindAt(new Date().toISOString())
        await load()
        // Only from Find brands or Ready to send: never away from a reply
        // being typed in the Inbox or a list being read in Sent.
        setTab(t => (t === 'find' || t === 'queue' ? 'queue' : t))
      }
    } catch (e) {
      notes.push(e instanceof Error ? e.message : 'Finding brands failed.')
    } finally {
      setFinding(null)
      setFindNotes(notes)
    }
  }

  /** SCOUT 1.41.2+: collect TRYBE's whole list when MVP's copy is a day old,
   *  then search MVP's copy for the niche. TRYBE's own search is not used: it
   *  does not find brands by what they sell. */
  async function collectAndShortlist(notes: string[]): Promise<boolean> {
    const ok = await collectFromTrybe(notes, false)
    if (!ok) return false
    setFinding({ stage: 'Searching every TRYBE brand for your niche' })
    const sl = await api({ action: 'shortlist', limit: SCAN_READ })
    notes.push(hasNiche
      ? (sl.added ? `MVP searched its copy of TRYBE for your niche and took the best ${sl.added} brands you have not seen to the fit check.` : 'MVP searched its copy of TRYBE and found no new brands matching your niche. Try more keywords or categories.')
      : `${sl.added} brands taken, highest TRYBE score first. Pick a niche to search by it.`)
    return true
  }

  /** SCOUT collects TRYBE's whole list when MVP's copy is a day old, or now
   *  when `force`. */
  /** False only when TRYBE could not be read and MVP has no copy to use. */
  async function collectFromTrybe(notes: string[], force: boolean): Promise<boolean> {
    const last = directory?.lastCollectedAt ? Date.parse(directory.lastCollectedAt) : 0
    if (force || !directory?.brands || Date.now() - last > RECOLLECT_MS) {
      setFinding({ stage: 'SCOUT is collecting every brand on TRYBE, in a tab behind this one' })
      const h = await requestTrybeHarvest()
      const items = h.items || []
      if (!items.length) {
        const why: Record<string, string> = {
          'no-access': 'SCOUT is not allowed on TRYBE yet. Press Allow SCOUT on TRYBE.',
          'not-signed-in': 'TRYBE showed its sign-in page. Sign in to TRYBE in this Chrome, then press Find brands again.',
          'no-sign-in-found': 'SCOUT opened TRYBE but could not find your TRYBE sign-in in this Chrome. Open jointrybe.com, make sure you are signed in, then press Find brands again.',
          'refused-401': 'TRYBE refused the brand list with your sign-in (401). Sign out of TRYBE and back in, then press Find brands again.',
          'refused-403': 'TRYBE refused the brand list with your sign-in (403). Sign out of TRYBE and back in, then press Find brands again.',
          'no-brands': 'SCOUT reached TRYBE but its brand list came back empty.',
          timeout: 'SCOUT ran out of time collecting the TRYBE list.',
        }
        notes.push(why[h.error || ''] || `SCOUT could not collect the TRYBE list: ${h.error || 'no answer'}.`)
        if (!directory?.brands) return false
        notes.push(`Using MVP's copy from ${directory.lastCollectedAt ? new Date(directory.lastCollectedAt).toLocaleString() : 'earlier'} instead.`)
      } else {
        let saved = 0, withSite = 0
        let keys: string[] = []
        const STEP = 250
        // YOUR JOINED BRANDS (Seb, 2026-10-16): TRYBE's Discover list leaves
        // them out, so MVP is told them, or nothing is marked as left.
        const joinedIds = canMyBrands ? await readJoinedBrandIds() : null
        if (joinedIds == null) notes.push('SCOUT could not read the brands you joined on TRYBE, so this collection marks no brand as left TRYBE.')
        for (let i = 0; i < items.length; i += STEP) {
          setFinding({ stage: 'Saving the TRYBE brands to MVP', done: i, total: items.length })
          const lastChunk = i + STEP >= items.length
          const d = await api({
            action: 'directory', items: items.slice(i, i + STEP),
            ...(i === 0 && h.categories ? { categories: h.categories } : {}),
            // Only a whole collection lets MVP wait a day before the next.
            ...(lastChunk ? { collected: { complete: h.complete === true, pages: h.pages, totalPages: h.totalPages }, joined: joinedIds == null ? { read: false } : { read: true, ids: joinedIds } } : {}),
          })
          saved += d.saved || 0; withSite += d.withWebsite || 0
          if (!keys.length && Array.isArray(d.keys)) keys = d.keys
        }
        notes.push(`SCOUT collected ${items.length.toLocaleString()} entries from ${h.pages ?? '?'} of ${h.totalPages ?? '?'} pages (TRYBE lists ${h.total != null ? h.total.toLocaleString() : '?'}). MVP saved ${saved.toLocaleString()} brands, ${withSite.toLocaleString()} with a website.`)
        if (h.complete !== true) notes.push(`SCOUT stopped at page ${h.pages ?? '?'} of ${h.totalPages ?? '?'}${h.error ? ` (${h.error})` : ''}. What it collected is kept, and the next Find brands collects again.`)
        if (!saved) notes.push(`MVP could not read the TRYBE entries. Fields TRYBE sent: ${keys.join(', ') || 'none'}.`)
        else if (!withSite) notes.push(`The TRYBE list carried no websites, so MVP matches on the TRYBE description for now. Fields TRYBE sent: ${keys.join(', ')}.`)
      }
    } else {
      notes.push(`Using MVP's copy of TRYBE (${directory.brands.toLocaleString()} brands, collected ${new Date(directory.lastCollectedAt!).toLocaleString()}).`)
    }
    return true
  }

  /** Older SCOUT: read TRYBE's Discover screen brand by brand. */
  async function scanTrybe(notes: string[]) {
    setFinding({ stage: canSearchTrybe && hasNiche ? 'SCOUT is searching TRYBE for your keywords and categories' : 'SCOUT is reading TRYBE’s Discover Brands' })
    const res = await requestTrybeScan(brands.map(b => b.name), SCAN_READ, canSearchTrybe ? kws : [], canSearchTrybe ? cats : [])
    for (const p of res.passes || []) notes.push(passWords(p))
    if (!res.ok) {
      const why: Record<string, string> = {
        'no-access': 'SCOUT is not allowed on TRYBE yet. Press Allow SCOUT on TRYBE.',
        'not-signed-in': 'TRYBE opened its sign-in page. Sign in to TRYBE in this browser, then try again.',
        'discover-not-found': 'SCOUT could not find Discover Brands. TRYBE may have changed the page.',
        'no-rows': 'SCOUT opened Discover Brands but saw no brand rows on it.',
        timeout: 'SCOUT ran out of time reading TRYBE. What it read so far is kept.',
      }
      notes.push(why[res.error || ''] || `SCOUT could not read TRYBE: ${res.error || 'no answer'}.`)
    }
    const got = res.brands || []
    if (got.length) {
      const d = await api({ action: 'import', brands: got })
      notes.push(`SCOUT read ${got.length} brand${got.length === 1 ? '' : 's'}: ${d.added} new to MVP, ${d.already} TRYBE already shows as requested.`)
    } else if (res.ok) {
      notes.push(`No brands you have not seen yet (${res.listed ?? 0} listed on TRYBE).`)
    }
    if (res.failures?.length) notes.push(`${res.failures.length} could not be opened on TRYBE (${res.failures.slice(0, 3).map(f => f.name).join(', ')}${res.failures.length > 3 ? '...' : ''}).`)
  }

  // THE DAILY FIND. Once a day, when this page is opened with SCOUT allowed
  // and a niche saved, MVP and SCOUT find and draft up to 20 brands that fit.
  useEffect(() => {
    if (preview || loading || autoRan.current || access !== 'granted' || !saved || !saved.dailyFind || running || finding) return
    if (!saved.core.trim() || savedKey === prefsKey([], [])) return
    const last = lastFindAt ? Date.parse(lastFindAt) : 0
    if (Date.now() - last < RECOLLECT_MS) return
    autoRan.current = true
    toast('Finding today\u2019s brands that fit your niche. SCOUT works in a tab behind this one for a few minutes.', { duration: 9000 })
    void findBrands(true)
  }, [loading, access, saved, lastFindAt, savedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Searched again a moment after each change to the categories or keywords.
  const hasDirectory = !!directory && directory.brands > 0
  const catsKey = cats.join('|'), kwsKey = kws.join('|')
  useEffect(() => {
    if (!hasDirectory) return
    const id = ++liveReq.current
    setLiveLoading(true)
    const t = setTimeout(async () => {
      try {
        const d = await api({ action: 'browse', categories: cats, keywords: kws, limit: 60, includeMine: showMine, sort: sortBy, payType, filters, name: nameQ.trim(), ...(prioritiesEdited ? { priorities } : {}) })
        if (id !== liveReq.current) return // a newer search has started
        setLive({ brands: d.brands || [], matched: d.matched ?? 0, capped: !!d.capped, hiddenMine: d.hiddenMine ?? 0, payUnknown: d.payUnknown ?? 0, payOther: d.payOther ?? 0,
          hiddenBy: d.hiddenBy, blankBy: d.blankBy, unknownBy: d.unknownBy, amazonNotes: d.amazonNotes, amazonVideos: d.amazonVideos, rawKeys: d.rawKeys, prioritiesSaved: d.prioritiesSaved, starsSaved: d.starsSaved })
        // The saved priorities, until the creator changes them on this visit.
        if (!prioritiesEdited && d.priorities) setPriorities(d.priorities)
        setLiveError(null)
        // Ticks stay only on brands still listed and still free to draft.
        setLivePick(p => new Set(Array.from(p).filter(x => (d.brands || []).some((b: LiveBrand) => b.brand_id === x && !TAKEN.includes(b.status as Brand['status'])))))
      } catch (e) {
        if (id === liveReq.current) setLiveError(e instanceof Error ? e.message : 'The live search failed.')
      } finally {
        if (id === liveReq.current) setLiveLoading(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [hasDirectory, catsKey, kwsKey, liveNonce, showMine, sortBy, payType, JSON.stringify(filters), nameQ.trim(), prioritiesEdited ? JSON.stringify(priorities) : '']) // eslint-disable-line react-hooks/exhaustive-deps

  /** A priority changed: Best bets ranks by it at once, and it is saved a
   *  moment later. A save that failed is said; the ranking still uses it. */
  function changePriorities(p: Priorities) {
    setPriorities(p); setPrioritiesEdited(true); setSortBy('picks')
    if (prioritiesSave.current) clearTimeout(prioritiesSave.current)
    prioritiesSave.current = setTimeout(() => {
      api({ action: 'priorities', priorities: p })
        .then(() => setPrioritiesNote({ text: 'Saved. Best bets ranks by these.', tone: 'ok' }))
        .catch((e) => setPrioritiesNote({ text: `Used for this visit, not saved: ${e instanceof Error ? e.message : 'the save failed'}`, tone: 'warn' }))
    }, 700)
  }

  /** Star a brand, or unstar it. */
  async function star(b: LiveBrand) {
    const on = !b.starred
    setLive(l => l && { ...l, brands: l.brands.map(x => x.brand_id === b.brand_id ? { ...x, starred: on } : x) })
    try { await api({ action: 'star', brandId: b.brand_id, on }) } catch (e) {
      setLive(l => l && { ...l, brands: l.brands.map(x => x.brand_id === b.brand_id ? { ...x, starred: !on } : x) })
      toast.error(`Not ${on ? 'starred' : 'unstarred'}: ${e instanceof Error ? e.message : 'the save failed'}`)
    }
  }

  /** Pass on a brand from the live list (Oink's Pass), or undo it. */
  async function pass(b: LiveBrand) {
    const undo = b.status === 'skipped'
    try {
      const d = await api({ action: undo ? 'unskip' : 'pass', brandId: b.brand_id })
      setLive(l => l && { ...l, brands: l.brands.map(x => x.brand_id === b.brand_id ? { ...x, status: d.status } : x) })
      setLivePick(p => { const n = new Set(p); n.delete(b.brand_id); return n })
      toast.success(undo ? `${b.name} is back on the list` : `Passed on ${b.name}. It leaves the list next time it loads.`)
    } catch (e) { toast.error(`${undo ? 'Not brought back' : 'Not passed'}: ${e instanceof Error ? e.message : 'the save failed'}`) }
  }

  /** Draft the brands ticked in the live list into Ready to send. */
  async function draftPicked(only?: string[]) {
    const ids = only || Array.from(livePick)
    if (!ids.length) { toast.message('Tick the brands to draft first.'); return }
    if (!core.trim()) { toast.error('Write your core message first'); return }
    if (!(await saveSettings(true))) return
    try {
      setFinding({ stage: 'Putting the brands you picked on your list' })
      const a = await api({ action: 'adopt', brandIds: ids })
      const ready: string[] = a.ready || []
      const r = ready.length ? await draftIds(ready) : { ok: 0, failed: 0 }
      if (r.failed) toast.error(`${r.failed} draft${r.failed === 1 ? '' : 's'} could not be written`)
      if (r.ok) { toast.success(`${r.ok} added to Ready to send`); if (!only) setTab('queue') }
      if (!ready.length) toast.message(only ? 'That brand is already in Ready to send or sent.' : 'None of those could be drafted: they are already in your queue or sent.')
      if (!only) setLivePick(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Drafting failed')
    } finally {
      setFinding(null)
      await load()
      setLiveNonce(n => n + 1)
    }
  }

  /** Collect TRYBE's list now, whatever its age, then show the live list. */
  async function refreshFromTrybe() {
    if (access !== 'granted') { toast.error('Allow SCOUT on TRYBE first'); return }
    const notes: string[] = []
    setFindNotes([])
    try { await collectFromTrybe(notes, true) } catch (e) {
      notes.push(e instanceof Error ? e.message : 'Refreshing from TRYBE failed.')
    } finally {
      setFinding(null); setFindNotes(notes)
      await load(); setLiveNonce(n => n + 1)
    }
  }

  /** TRYBE's Top 100 videos, read by SCOUT from the creator's own TRYBE and
   *  counted per brand on MVP. A brand seen in it often is spending. */
  async function readTop100(quiet = false) {
    if (!canPlaybook) return
    setTopRun(true)
    try {
      const r = await requestTrybeApi('GET', '/backend/api/creator/v2/top-creatives')
      if (!r.ok) { setSignalNote({ tone: quiet ? 'warn' : 'bad', text: `TRYBE's Top 100 could not be read${quiet ? ' this time' : ''}: ${r.error || `TRYBE answered ${r.status ?? 'nothing'}`}. Make sure you are signed in to TRYBE.` }); return }
      const d = await api({ action: 'top100', json: r.json })
      if (d.notSaved) { if (!quiet) setSignalNote({ tone: 'warn', text: d.notSaved }) }
      else if (!d.read || !d.matched) setSignalNote({ tone: 'bad', text: `MVP read TRYBE's Top 100 but could not match its videos to brands${isAdmin && d.sample ? ` (TRYBE sent: ${d.sample})` : ''}. Nothing was changed.` })
      else if (!quiet) setSignalNote({ tone: 'ok', text: `TRYBE's Top 100 read: ${d.matched} brand${d.matched === 1 ? ' has' : 's have'} videos in it right now.` })
      // HOOKS WINNING ON TRYBE: when the Top 100 carries no words, the MVP
      // team's SCOUT reads each video's script (the same read as a brand's
      // best videos) and MVP keeps their opening lines for every member.
      if (isAdmin && Array.isArray(d.needScripts) && d.needScripts.length) {
        const got: Array<Record<string, unknown>> = []
        for (const v of d.needScripts as Array<{ submissionId: string; brandId: string | null; brandName: string | null; rank: number | null }>) {
          const sr = await requestTrybeApi('GET', `/backend/api/creator/v2/submissions/${encodeURIComponent(v.submissionId)}/script`).catch(() => null)
          const text = sr && sr.ok ? readScript(sr.json) : null
          if (text) got.push({ ...v, text })
        }
        const h = await api({ action: 'top100_hooks', hooks: got }).catch(() => null)
        if (!quiet) setSignalNote({ tone: h?.saved ? 'ok' : 'warn', text: h?.saved ? `Hooks winning on TRYBE: kept the opening lines of ${h.saved} Top 100 videos for Make videos.` : `Hooks winning on TRYBE: ${h?.why || `TRYBE shared the words of ${got.length} of ${d.needScripts.length} Top 100 videos, too few to keep.`}` })
      }
      setLiveNonce(n => n + 1)
      void load()
    } catch (e) {
      setSignalNote({ tone: 'bad', text: e instanceof Error ? e.message : 'TRYBE\u2019s Top 100 could not be saved.' })
    } finally { setTopRun(false) }
  }

  /** How many active Meta ads mention each brand shown, read by SCOUT from
   *  Meta's public Ad Library, eight at a time so each batch answers well
   *  inside SCOUT's time limit and progress shows as it goes. */
  async function checkMetaAds() {
    const shown = live?.brands || []
    const todo = shown.filter(b => !b.meta_ads_checked_at || Date.now() - Date.parse(b.meta_ads_checked_at) > META_ADS_FRESH_MS).slice(0, 25)
    if (!todo.length) { setSignalNote({ tone: 'ok', text: 'Every brand shown already has a Meta ad count from this week.' }); return }
    setMetaRun({ done: 0, total: todo.length }); setSignalNote(null)
    try {
      // The MVP team's read also copies the ads themselves for What's working (SCOUT 1.51.0).
      const run = await readMetaAds(todo.map(b => ({ brandId: b.brand_id, name: b.name })), { cards: isAdmin, onProgress: (done, total) => setMetaRun({ done, total }), gone: () => leftRef.current })
      setSignalNote(metaAdsWords(run, scoutVersion))
      setLiveNonce(n => n + 1)
    } catch (e) {
      setSignalNote({ tone: 'bad', text: e instanceof Error ? e.message : 'The Meta ad counts could not be saved.' })
    } finally { setMetaRun(null) }
  }

  async function draftSelected() {
    const ids = found.filter(b => selected.has(b.brand_id)).map(b => b.brand_id)
    if (!ids.length) { toast.message('Tick the brands to draft first.'); return }
    if (!core.trim()) { toast.error('Write your core message first'); return }
    if (!(await saveSettings(true))) return
    const r = await draftIds(ids)
    setFinding(null)
    if (r.failed) toast.error(`${r.failed} draft${r.failed === 1 ? '' : 's'} could not be written`)
    if (r.ok) { toast.success(`${r.ok} added to Ready to send`); setTab('queue') }
    setSelected(new Set())
    await load()
  }

  // SAVED BEFORE IT IS SENT: Send now waits for the save in flight, and a
  // save that failed stops the send instead of sending the older copy.
  const pendingSave = useRef<Map<string, Promise<boolean>>>(new Map())
  async function saveDraft(b: Brand, text: string): Promise<boolean> {
    const inFlight = pendingSave.current.get(b.brand_id)
    if (inFlight) await inFlight
    if (text === (brands.find(x => x.brand_id === b.brand_id)?.draft ?? b.draft) && !inFlight) return true
    const job = api({ action: 'edit', brandId: b.brand_id, draft: text })
      .then(() => { patch(b.brand_id, { draft: text }); return true })
      .catch(e => { toast.error(`Not saved: ${e instanceof Error ? e.message : 'error'}`); return false })
      .finally(() => { if (pendingSave.current.get(b.brand_id) === job) pendingSave.current.delete(b.brand_id) })
    pendingSave.current.set(b.brand_id, job)
    return job
  }

  async function skip(b: Brand, undo = false) {
    const d = await api({ action: undo ? 'unskip' : 'skip', brandId: b.brand_id }).catch(e => { toast.error(e.message); return null })
    if (d?.status) patch(b.brand_id, { status: d.status })
  }

  /** Write these drafts again from the core message as it is now. */
  async function rewrite(list: Brand[]) {
    if (!list.length) return
    if (!core.trim()) { toast.error('Write your core message first'); return }
    if (!(await saveSettings(true))) return
    const r = await draftIds(list.map(b => b.brand_id))
    setFinding(null)
    if (r.failed) toast.error(`${r.failed} could not be rewritten`)
    if (r.ok) toast.success(`${r.ok} message${r.ok === 1 ? '' : 's'} rewritten`)
    await load()
  }

  /** Off the page for good: never sent, never offered again by the daily find. */
  async function remove(b: Brand) {
    const d = await api({ action: 'remove', brandId: b.brand_id }).catch(e => { toast.error(e.message); return null })
    if (d?.status) { patch(b.brand_id, { status: 'removed' }); toast.success(`${b.name} removed`) }
  }

  async function requeue(b: Brand) {
    await api({ action: 'edit', brandId: b.brand_id, draft: b.draft || '' }).catch(e => toast.error(e.message))
    await load()
  }

  async function settle(b: Brand, went: boolean) {
    await api({ action: 'reset', brandId: b.brand_id, went }).catch(e => toast.error(e.message))
    await load()
  }

  async function sendAll() {
    const list = queue.slice(0, remaining)
    if (usesRunner) { await startRunner(list, 'Send all'); return }
    await runSends(list, 'Send all')
  }
  /** Hand the list to SCOUT, which sends it by itself (1.48.0). */
  async function startRunner(list: Brand[], label: string) {
    if (access !== 'granted') { toast.error('Allow SCOUT on TRYBE first'); say(label, 'Not started: SCOUT is not allowed on TRYBE yet.', 'bad'); return }
    if (!list.length) { say(label, remaining ? 'Nothing in the queue to send.' : `All ${savedCap} sends of the last 24 hours are used. ${opensWords(freeAt)} The queue waits until then.`, 'warn'); return }
    const r = await requestTrybeRun(list.map(b => b.brand_id), label)
    if (r.run !== undefined) setScoutRun(r.run ?? null)
    if (r.ok) { toast.success(`SCOUT is sending ${list.length}. You can close this tab or keep working.`); return }
    const why = r.error === 'running' ? 'SCOUT is already sending a list. It takes the next one when that finishes.'
      : r.error === 'no-access' ? 'SCOUT is not allowed on TRYBE yet.' : r.error || 'SCOUT did not answer.'
    toast.error(why); say(label, `Not started: ${why}`, 'bad')
  }
  async function stopRun() {
    if (scoutRun?.on) { const r = await requestTrybeRunStop().catch(() => null); if (r) setScoutRun(r); return }
    stopRef.current = true
  }
  /** One message now, without waiting for the rest. */
  async function sendOne(b: Brand) {
    // One at a time on TRYBE: a Send now waits for SCOUT's own run.
    if (scoutRun?.on) { toast.message('SCOUT is sending your list right now. Press Send now again when it finishes.'); return }
    if (!remaining) { toast.error(`All ${savedCap} sends of the last 24 hours are used. ${opensWords(freeAt)}`); return }
    await runSends([b], 'Send now')
  }

  async function runSends(list: Brand[], label: string) {
    // EVERY STOP SAYS WHY (2026-10-06: "it didn't do anything when i clicked
    // send all"). A send that could not start used to note it on a row the
    // reload then wiped, so a run could end with nothing on screen.
    if (access !== 'granted') { toast.error('Allow SCOUT on TRYBE first'); say(label, 'Not started: SCOUT is not allowed on TRYBE yet.', 'bad'); return }
    if (!list.length) { say(label, remaining ? 'Nothing in the queue to send.' : `All ${savedCap} sends of the last 24 hours are used. ${opensWords(freeAt)} The queue waits until then.`, 'warn'); return }
    stopRef.current = false
    setRunSize(list.length)
    setRunning(true)
    say(label, `Starting: ${list.length} request${list.length === 1 ? '' : 's'}, one at a time. Keep this tab open.`, 'info')
    let sentThisRun = 0
    let lastFailed = false
    try {
      for (let i = 0; i < list.length; i++) {
        if (stopRef.current) { say(label, 'Stopped.', 'warn'); break }
        const b = list[i]
        const c = await api({ action: 'claim', brandId: b.brand_id }).catch(e => ({ ok: false, error: e.message }))
        if (c.capped) { setFreeAt(c.nextFreeAt ?? null); say(label, `All ${c.dailyCap} sends of the last 24 hours are used. ${opensWords(c.nextFreeAt ?? null)}`, 'warn'); toast.message('Daily cap reached'); break }
        if (!c.ok) { say(b.name, `Not started: ${c.error || 'MVP could not reserve it'}.`, 'bad'); toast.error(`${b.name}: ${c.error || 'could not start'}`); continue }
        setUsed(c.usedToday)
        if (c.nextFreeAt) setFreeAt(c.nextFreeAt)
        setCurrent(b.brand_id)
        patch(b.brand_id, { status: 'sending', send_started_at: new Date().toISOString(), error: null })
        say(b.name, 'SCOUT is opening TRYBE to send it.', 'info')
        const res = await requestTrybeSend(c.url, c.name, c.message)
        // What TRYBE listed instead, when SCOUT could not find the brand (1.47.1).
        const seen = Array.isArray(res.seen) && res.seen.length ? `; TRYBE listed: ${res.seen.slice(0, 5).join(', ')}` : ''
        const err = res.error ? `${res.error}${res.steps?.length ? ` (got to: ${res.steps.slice(-3).join(', ')}${seen})` : ''}` : null
        const recorded = await api({ action: 'result', brandId: b.brand_id, outcome: res.outcome, error: err }).then(() => true).catch(() => false)
        patch(b.brand_id, {
          status: res.outcome === 'sent' ? 'sent' : res.outcome === 'already' ? 'already' : res.outcome === 'failed' ? 'failed' : 'sending',
          error: res.outcome === 'sent' || res.outcome === 'already' ? null : (err || 'Not confirmed'),
        })
        if (res.outcome === 'sent') say(b.name, 'Sent. TRYBE closed the request box.', 'ok')
        else if (res.outcome === 'already') say(b.name, 'TRYBE already shows a request to this brand.', 'warn')
        else if (res.outcome === 'failed') say(b.name, `Not sent: ${sendWords(err) || 'SCOUT could not send it'}.`, 'bad')
        else say(b.name, `Not confirmed: ${sendWords(err) || 'TRYBE did not show the box closing'}. Check TRYBE's Pending Requests.`, 'warn')
        if (!recorded) say(b.name, 'MVP could not save this result. Reload before sending again.', 'bad')
        if (res.outcome === 'failed' || res.outcome === 'already') setUsed(u => Math.max(0, u - 1))
        setCurrent(null)
        // Two failures in a row usually mean TRYBE changed or signed out: stop.
        if (res.outcome === 'failed' && lastFailed) {
          say(label, 'Two sends in a row failed, so SCOUT stopped.', 'bad')
          toast.error('Two sends in a row failed, so SCOUT stopped. See the run log.')
          break
        }
        lastFailed = res.outcome === 'failed'
        if (res.outcome === 'sent') sentThisRun++
        if (i < list.length - 1 && !stopRef.current) {
          const gap = nextGapMs(sentThisRun, Math.random, list.length)
          setWaitUntil(Date.now() + gap); setNow(Date.now())
          const end = Date.now() + gap
          while (Date.now() < end && !stopRef.current) await new Promise(r => setTimeout(r, 500))
          setWaitUntil(null)
        }
      }
      say(label, `Done: ${sentThisRun} sent.`, sentThisRun ? 'ok' : 'warn')
    } finally {
      setRunning(false); setCurrent(null); setWaitUntil(null)
      await load()
    }
  }

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 size={16} className="animate-spin" /></div>

  const card = 'rounded-2xl border p-5'
  const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
  const soft = { color: 'var(--text-soft)' }
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50'
  const busy = !!finding || running
  // WHAT CHANGED CAN MESSAGE TOO (Seb, 2026-10-16): the same draft and send
  // steps as Find brands and Ready to send, handed to the brand details there.
  // Not on the Amazon plan's preview, which only shows the details.
  const peekActions: PeekActions | undefined = preview ? undefined : {
    mineOf: (id) => { const b = brands.find(x => x.brand_id === id); return b ? { status: b.status, draft: b.draft } : null },
    message: (id) => draftPicked([id]),
    send: async (id) => {
      const b = brands.find(x => x.brand_id === id)
      if (!b || !b.draft) { toast.error('That message is not in Ready to send any more. Reload the page.'); return }
      await sendOne(b)
      const after = (await api().catch(() => null))?.brands as Brand[] | undefined
      const now = after?.find(x => x.brand_id === id)?.status
      if (now === 'sent') toast.success(`Sent to ${b.name}`)
      else if (now === 'already') toast.message(`TRYBE already shows a request to ${b.name}`)
      else if (now === 'failed') toast.error(`${b.name}: not sent. Sent shows why, and it can be sent again.`)
      else if (now === 'sending') toast.message(`${b.name}: TRYBE did not confirm it. Check TRYBE's Pending Requests.`)
      // Still in Ready to send: the send never started, and sendOne said why.
    },
    openList: (where) => go(where),
    busy,
    sendBlocked: access !== 'granted' ? 'Allow SCOUT on TRYBE first (top of this page).' : null,
  }
  const sendBlocked = access !== 'granted' ? 'Allow SCOUT on TRYBE first.' : !remaining ? `All ${savedCap} sends of the last 24 hours are used. ${opensWords(freeAt)}` : !queue.length ? 'Nothing drafted yet.' : null

  const unread = (inbox?.convos || []).reduce((n, c) => n + (c.unread > 0 ? c.unread : 0), 0)
  const sentRows = history.map(b => {
    // The chat is shown for any brand; it counts as a reply only per replyConvo.
    const c = inbox ? convoFor(b.name, inbox.convos) : null
    const answered = WENT.includes(b.status) && (!!b.replied_at || (inbox ? !!replyConvo(b, inbox.convos) : false))
    const lastMine = c && inbox ? lastIsMine(c, inbox.me, inbox.myName) : null
    // REPLIED = A CONVERSATION EXISTS (Seb, 2026-10-08: "i know for a fact
    // that brands have responded"). TRYBE opens a chat with a brand only once
    // it accepts or writes back, so a sent brand with one has answered, whoever
    // wrote last. TRYBE's list does not reliably say who wrote last, which
    // left this at zero. A reply stamped before (replied_at) stays a reply.
    const reply: 'replied' | 'none' | 'unknown' = answered ? 'replied' : !inbox ? 'unknown' : 'none'
    // Where the request stands on TRYBE, when its request list was read.
    // The same rule as Replied: a chat opened after the request.
    const rqState = requests ? requestState(requests.flags[b.brand_id], inbox ? answered : null) : null
    const rq = rqState ? { state: rqState } : null
    return { b, c, reply, lastMine, rq }
  })
  const repliedCount = sentRows.filter(r => r.reply === 'replied').length
  // Out of requests that went, not every attempt: a failed send never asked anyone.
  const wentCount = history.filter(b => WENT.includes(b.status)).length
  const weekAgo = Date.now() - 7 * 86_400_000
  // This week: stamped in the last seven days, or seen now and not yet stamped.
  const repliedWeek = sentRows.filter(r => r.reply === 'replied' && (r.b.replied_at ? Date.parse(r.b.replied_at) >= weekAgo : true)).length

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6" style={{ color: 'var(--text)' }}>
      {/* Header: what this is, in one line, and where to join. */}
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[16rem]">
          <h1 className="text-[34px] font-bold tracking-tight leading-none flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl inline-flex items-center justify-center" style={{ background: PURPLE, color: '#fff' }}><Handshake size={20} /></span>
            TRYBE
          </h1>
          <p className="text-[14.5px] mt-2 max-w-[60ch]" style={soft}>Find brands that fit your channel, send each a first message in your words, answer them, and plan the videos they pay for.</p>
        </div>
        {/* Not on TRYBE yet: where to join, in plain sight (Seb, 2026-10-06).
            MVP's referral link, and it says so. */}
        <a href={TRYBE_JOIN_URL} target="_blank" rel="sponsored noopener noreferrer" title="MVP's referral link"
          className="inline-flex items-center gap-1 text-[12.5px] font-semibold rounded-full border px-3 py-1.5" style={{ borderColor: 'rgba(124,58,237,0.35)', color: PURPLE }}>
          New to TRYBE? Join free <ExternalLink size={11} />
        </a>
      </header>

      {/* THE AMAZON PLAN'S PREVIEW: what is open, and what Pro adds. */}
      {preview && (
        <section className="rounded-2xl border p-4 flex flex-wrap items-center gap-3" style={{ borderColor: 'rgba(124,58,237,0.35)', background: 'rgba(124,58,237,0.05)' }}>
          <div className="flex-1 min-w-[16rem]">
            <p className="text-[15px] font-bold">TRYBE preview on the Amazon plan</p>
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-2)' }}>Find brands is open: see which TRYBE brands you already filmed on Amazon, rank them by what matters to you, filter, star and pass. Pro writes and sends your messages, plans your videos from each brand&rsquo;s brief, reads your inbox and tracks what each brand pays you.</p>
          </div>
          <a href="/billing" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold" style={{ background: PURPLE, color: '#fff' }}>See Pro <ArrowRight size={13} /></a>
        </section>
      )}

      {/* YOUR WEEK, in one line: each part opens its tab. */}
      {!preview && (() => {
        const parts: Array<{ text: string; to: Tab }> = []
        const sum = changesSummary(changes)
        if (sum) parts.push({ text: sum, to: 'changes' })
        if (inbox && unread) parts.push({ text: `${unread} unread repl${unread === 1 ? 'y' : 'ies'}`, to: 'inbox' })
        if (queue.length) parts.push({ text: `${queue.length} message${queue.length === 1 ? '' : 's'} ready to send`, to: 'queue' })
        if (!parts.length) return null
        return (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border px-5 py-2.5" style={{ borderColor: 'rgba(124,58,237,0.35)', background: 'rgba(124,58,237,0.05)' }}>
            <span className="inline-flex items-center gap-2 text-[14px] font-bold" style={{ color: PURPLE }}><span className="w-2 h-2 rounded-full" style={{ background: PURPLE }} aria-hidden /> Your week</span>
            {parts.map((x, i) => (
              <button key={i} onClick={() => setTab(x.to)} className="text-[14px] font-semibold hover:underline" style={{ color: 'var(--text)' }}>
                {i > 0 && <span className="mr-3" style={soft} aria-hidden>&middot;</span>}{x.text}
              </button>
            ))}
          </div>
        )
      })()}

      {/* SETUP CHECK: shown until everything is ready, with the next step. */}
      {!preview && (() => {
        if (access === 'checking') return null
        const steps: Array<{ done: boolean; title: string; ok: string; todo: string; action?: React.ReactNode }> = [
          { done: access !== 'no-scout', title: 'SCOUT in this Chrome', ok: 'Installed.', todo: 'SCOUT is MVP\u2019s Chrome extension. It works in your own TRYBE, in your browser.',
            action: <a href={SCOUT_STORE_LISTING_URL} target="_blank" rel="noopener noreferrer" className={btn} style={{ background: PURPLE, color: '#fff' }}>Install SCOUT <ExternalLink size={12} /></a> },
          { done: access !== 'no-scout' && access !== 'old', title: 'SCOUT up to date', ok: scoutVersion ? `Version ${scoutVersion}.` : 'Up to date.', todo: 'Chrome updates SCOUT by itself within a day. To do it now, open chrome://extensions, turn on Developer mode and press Update.' },
          { done: access === 'granted', title: 'SCOUT allowed on TRYBE', ok: 'Allowed.', todo: 'Chrome asks you once to let SCOUT read and act on jointrybe.com.',
            action: access === 'not-granted' ? <button onClick={() => void allow()} className={btn} style={{ background: PURPLE, color: '#fff' }}>Allow SCOUT on TRYBE</button> : undefined },
          // Counted as signed in until a read of TRYBE fails, so the card does not
          // flash while the inbox is still being read.
          { done: access === 'granted' && !inboxError, title: 'Signed in to TRYBE', ok: 'MVP can read your TRYBE.', todo: inboxError ? `TRYBE did not answer: ${inboxError}. Open jointrybe.com in this Chrome and sign in.` : 'Open jointrybe.com in this Chrome and sign in.',
            action: <a href="https://jointrybe.com" target="_blank" rel="noopener noreferrer" className={btn} style={{ border: '1px solid var(--border)' }}>Open jointrybe.com <ExternalLink size={12} /></a> },
          { done: !!saved?.core.trim(), title: 'Your core message', ok: 'Written.', todo: 'What every brand reads, in your words. Write it once in Find brands.',
            action: <button onClick={() => { setTab('find'); setEditingCore(true) }} className={btn} style={{ border: '1px solid var(--border)' }}>Write it</button> },
          // No niche step (Seb, 2026-10-14: "niche should not be in there.. since
          // it may change depending on what users are searching for"). The
          // search lives in Find brands, and changes with every search.
        ]
        const next = steps.findIndex((x) => !x.done)
        if (next < 0) return null
        return (
          <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex flex-wrap items-baseline gap-2 mb-2">
              <h2 className="text-[18px] font-bold">Setup check</h2>
              <span className="ml-auto text-[13px] font-semibold" style={{ color: PURPLE }}>Next: {steps[next].title}</span>
            </div>
            <ol className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {steps.map((x, i) => (
                <li key={x.title} className="flex items-start gap-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
                  <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full inline-flex items-center justify-center text-[12px] font-bold"
                    style={x.done ? { background: GREEN, color: '#fff' } : i === next ? { background: PURPLE, color: '#fff' } : { border: '1px solid var(--border)', color: 'var(--text-soft)' }}>
                    {x.done ? <Check size={14} /> : i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14.5px] font-semibold flex flex-wrap items-center gap-2" style={!x.done && i !== next ? soft : undefined}>
                      {x.title}{i === next && <span className="text-[11px] font-bold rounded-full px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>Next</span>}
                    </p>
                    <p className="text-[13px]" style={soft}>{x.done ? x.ok : x.todo}</p>
                    {i === next && x.action && <div className="mt-2">{x.action}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )
      })()}

      {/* The numbers that matter today. */}
      {!preview && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat accent={PURPLE} label="Sent, last 24 hours" value={`${used} of ${savedCap}`} hint={remaining ? `${remaining} more can go now` : opensWords(freeAt)} onClick={() => setTab('sent')} />
        <Stat accent="#0E7490" label="Ready to send" value={String(queue.length)} hint={queue.length ? 'Messages written' : 'Nothing written yet'} onClick={() => setTab('queue')} />
        <Stat accent={GREEN} label="Replied this week" value={inbox || repliedCount ? String(repliedWeek) : inboxError || !canInbox ? 'Not read' : '...'} hint={inbox || repliedCount ? `${repliedCount} of ${wentCount} sent have replied` : inboxError ? 'Could not read TRYBE' : canInbox ? 'Reading TRYBE...' : 'Needs SCOUT on TRYBE'} tone={repliedWeek ? GREEN : undefined} onClick={() => setTab('sent')} />
        <Stat accent="#DB2777" label="Unread" value={inbox ? String(unread) : inboxError || !canInbox ? 'Not read' : '...'} hint={inbox ? (unread ? 'Waiting in your inbox' : 'All caught up') : inboxError ? 'Could not read TRYBE' : canInbox ? 'Reading TRYBE...' : 'Needs SCOUT on TRYBE'} tone={unread ? PURPLE : undefined} onClick={() => setTab('inbox')} />
      </div>}
      {/* The menu count and Today depend on this save: a failure is said here. */}
      {alertsError && <p className="text-[12px] -mt-2 mb-3 inline-flex items-center gap-1" style={{ color: AMBER }}><AlertTriangle size={12} /> The inbox was read, but the reply alert for the menu and Today could not be saved: {alertsError}</p>}

      {finding && (
        <p className="text-[12px] inline-flex items-center gap-1.5 rounded-lg px-3 py-2" style={{ background: 'rgba(124,58,237,0.08)', color: PURPLE }}>
          <Loader2 size={12} className="animate-spin" /> {finding.stage}{finding.total ? ` (${finding.done ?? 0} of ${finding.total})` : '...'}
        </p>
      )}

      {/* THE MENU: three groups side by side, each tab a full row with its
          count; on a phone the groups stack and their tabs sit two by two.
          Every tab in sight, never a sideways scroll (Seb, 2026-10-13/14).
          On a phone the icons step aside and a long name wraps, never cut. */}
      <nav aria-label="TRYBE" className="rounded-2xl border p-2 grid gap-1 md:grid-cols-3 md:gap-0 md:divide-x" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
        {TAB_GROUPS.map((g) => (
          <div key={g.id} className="px-1.5 py-1.5 md:px-2" style={{ borderColor: 'var(--border-2)' }}>
            <p className="px-2 pb-1.5 flex items-baseline gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: PURPLE }}>{g.label}</span>
              <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>{g.says}</span>
            </p>
            <div className="grid grid-cols-2 md:grid-cols-1 gap-1">
              {TABS.filter((t) => t.group === g.id).map(({ id, label, icon: Icon }) => {
                const n = preview ? 0 : id === 'queue' ? queue.length : id === 'sent' ? history.length : id === 'inbox' ? unread : id === 'changes' ? (changes?.changes.filter((c) => c.yours).length ?? 0) : 0
                const on = (lockedTab ?? tab) === id
                const locked = preview && id !== 'find'
                // Something waiting on you is filled; a running total is quiet.
                const waiting = id === 'inbox' || id === 'queue'
                return (
                  <button key={id} aria-current={on ? 'page' : undefined} onClick={() => go(id)} title={locked ? 'On the Pro plan' : undefined}
                    className="group w-full flex items-center gap-2.5 rounded-xl px-2.5 sm:px-2 py-2 sm:py-1.5 text-left text-[13.5px] sm:text-[14px] font-semibold transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]"
                    style={on ? { background: 'rgba(124,58,237,0.12)', color: PURPLE } : { color: 'var(--text)' }}>
                    <span className="hidden sm:inline-flex w-7 h-7 shrink-0 rounded-lg items-center justify-center transition-colors"
                      style={on ? { background: PURPLE, color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                      <Icon size={15} />
                    </span>
                    <span className="flex-1 min-w-0 leading-tight">{label}</span>
                    {locked && <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-1.5 py-0.5 inline-flex items-center gap-0.5" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}><Lock size={9} /> Pro</span>}
                    {n > 0 && <span className="text-[11.5px] font-bold rounded-full px-2 py-0.5 min-w-[1.5rem] text-center tabular-nums"
                      style={waiting ? { background: PURPLE, color: '#fff' } : { color: on ? PURPLE : 'var(--text-3)' }}>{n}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
      {/* Where you are, and what it is for. */}
      {(() => {
        const t = TABS.find((x) => x.id === (lockedTab ?? tab))
        if (!t) return null
        const Icon = t.icon
        return (
          <div className="flex items-start gap-3 -mt-1">
            <span className="mt-0.5 w-9 h-9 shrink-0 rounded-xl inline-flex items-center justify-center" style={{ background: 'rgba(124,58,237,0.12)', color: PURPLE }}><Icon size={18} /></span>
            <div className="min-w-0">
              <h2 className="text-[20px] font-bold leading-tight">{t.label}</h2>
              <p className="text-[14px]" style={{ color: 'var(--text-3)' }}>{t.says}</p>
            </div>
          </div>
        )
      })()}

      {tab === 'changes' && (changesError && !changes
        ? <TrybeChanges scoutOpens={scoutOpens} onRead={(c) => { setChanges(c); setChangesError(null) }} onSeeNew={seeNew} actions={peekActions} />
        : changes ? <TrybeChanges scoutOpens={scoutOpens} initial={changes} onRead={setChanges} onSeeNew={seeNew} actions={peekActions} /> : <p className="text-[13px] inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Reading what changed on TRYBE...</p>)}

      {tab === 'create' && <TrybeCreate canRead={canMyBrands} isAdmin={isAdmin} onFind={() => setTab('find')} />}

      {tab === 'working' && <TrybeHookCheck />}
      {tab === 'working' && (
        <TrybeWorking canRead={canMyBrands} isAdmin={isAdmin} scoutVersion={scoutVersion}
          newToTop={changes ? Array.from(new Map(changes.changes.filter((c) => c.kind === 'top100').map((c) => [c.brand_id, { id: c.brand_id, name: c.name || 'A brand' }])).values()) : null} />
      )}

      {/* A Pro tab opened on the Amazon plan. */}
      {lockedTab && (
        <section className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-2)', background: 'var(--surface)' }}>
          <p className="text-[15px] font-bold inline-flex items-center gap-2"><Lock size={15} style={{ color: PURPLE }} /> {TABS.find((x) => x.id === lockedTab)?.label} is on the Pro plan</p>
          <p className="text-[13px] mt-1 max-w-[62ch]" style={{ color: 'var(--text-2)' }}>{TABS.find((x) => x.id === lockedTab)?.says} On your Amazon plan, Find brands is open: see which TRYBE brands you already filmed on Amazon, and rank, filter and star them.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <a href="/billing" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold" style={{ background: PURPLE, color: '#fff' }}>See Pro <ArrowRight size={13} /></a>
            <button onClick={() => go('find')} className="rounded-lg px-4 py-2 text-[13px] font-semibold border" style={{ borderColor: 'var(--border-2)' }}>Back to Find brands</button>
          </div>
        </section>
      )}

      {tab === 'find' && !lockedTab && (<>
        {/* Your stage: volume first, then double down on winners (Seb, 2026-10-14). */}
        <TrybeStage canRead={canMyBrands} onGo={go} />
        {/* 1. Core message: a short preview once written, the box while editing. */}
        {!preview && <div className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-semibold">1. Your core message</p>
            {!editingCore && core.trim() && (
              <button onClick={() => setEditingCore(true)} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}><Pencil size={12} /> Edit</button>
            )}
          </div>
          {!editingCore && core.trim() ? (
            <p className="text-[13px] mt-2 whitespace-pre-wrap line-clamp-3" style={soft}>{core}</p>
          ) : (<>
            <p className="text-[12px] mt-1 mb-2" style={soft}>What every brand reads, in your words. MVP sends it nearly word for word: it adds a short hello to each brand by name on top, puts the brand&rsquo;s name where yours mentions a brand, and ends with your sign-off. Say who you are, what you make, and where to see your work (your links).</p>
            <textarea value={core} onChange={e => setCore(e.target.value)} rows={8} placeholder={STARTER}
              className="w-full rounded-lg border p-3 text-[13px] whitespace-pre-wrap" style={{ borderColor: 'var(--border)', background: 'var(--bg, transparent)' }} />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {!core.trim() && <button onClick={() => setCore(STARTER)} className={btn} style={{ border: '1px solid var(--border)' }}>Use the starter</button>}
              <button onClick={() => void saveSettings().then(ok => { if (ok && core.trim()) { setEditingCore(false); setSaved(sv => (sv ? { ...sv, core } : sv)) } })} disabled={savingSettings || !core.trim()} className={btn} style={{ background: PURPLE, color: '#fff' }}>
                {savingSettings ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save message
              </button>
              {saved?.core.trim() && <button onClick={() => { setCore(saved.core); setEditingCore(false) }} className="text-[12px] font-semibold" style={soft}>Cancel</button>}
            </div>
          </>)}
        </div>}

        {/* 2. Find brands. Seb, 2026-10-07: one click on a niche shows its
            brands, but make it very visible that searching a keyword is the
            better way, because a keyword matches what each brand sells. */}
        <div className={card} style={cardStyle}>
          <p className="text-[14px] font-semibold">{preview ? '' : '2. '}Find brands for your channel</p>

          <div className="mt-3 rounded-2xl border-2 p-4" style={{ borderColor: PURPLE, background: 'rgba(124,58,237,0.05)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5" style={{ background: PURPLE, color: '#fff' }}>Best results</span>
              <p className="text-[15px] font-semibold">Search what you review</p>
            </div>
            <p className="text-[12px] mt-1 mb-3" style={soft}>A keyword finds brands by what they actually sell. &ldquo;golf&rdquo; brings up the golf brands a broad niche like Fitness would bury.</p>
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: PURPLE }} />
                <input ref={searchRef} value={kwInput} onChange={e => setKwInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKeyword() } }}
                  placeholder="A product or topic you make videos about" aria-label="Search brands by keyword"
                  className="w-full h-12 rounded-xl border pl-10 pr-3 text-[15px]" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} />
              </div>
              <button onClick={addKeyword} disabled={!kwInput.trim()} className="h-12 rounded-xl px-5 text-[14px] font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }}>Search</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              {kws.map(k => (
                <span key={k} className="rounded-full pl-3 pr-2 py-1 text-[13px] font-medium inline-flex items-center gap-1.5" style={{ background: PURPLE, color: '#fff' }}>
                  {k} <button onClick={() => setKws(ks => ks.filter(o => o !== k))} aria-label={`Remove ${k}`} className="opacity-80 hover:opacity-100"><X size={12} /></button>
                </span>
              ))}
              {!kws.length && (<>
                <span className="text-[12px] mr-0.5" style={soft}>Try</span>
                {KEYWORD_EXAMPLES.map(k => (
                  <button key={k} onClick={() => setKws(ks => ks.some(o => o.toLowerCase() === k) ? ks : [...ks, k].slice(0, 12))}
                    className="rounded-full border px-2.5 py-1 text-[12px] hover:border-current" style={{ borderColor: 'var(--border)', color: PURPLE }}>{k}</button>
                ))}
              </>)}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-[13px] font-semibold">Or browse a niche</p>
              <p className="text-[12px]" style={soft}>One click shows the brands in it.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-2">
              {catOptions.filter((c, i) => showAllNiches || i < NICHES_SHOWN || cats.some(o => o.toLowerCase() === c.toLowerCase())).map(c => {
                const on = cats.some(o => o.toLowerCase() === c.toLowerCase())
                const Icon = nicheIcon(c)
                return (
                  <button key={c} onClick={() => setCats(cs => on ? cs.filter(o => o.toLowerCase() !== c.toLowerCase()) : cs.length < 12 ? [...cs, c] : cs)}
                    aria-pressed={on}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[13px] font-medium transition-colors"
                    style={on ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border)', background: 'var(--surface)' }}>
                    <Icon size={16} className="shrink-0" style={on ? undefined : { color: PURPLE }} />
                    <span className="min-w-0 leading-tight">{c}</span>
                    {on && <Check size={13} className="ml-auto shrink-0" />}
                  </button>
                )
              })}
            </div>
            {catOptions.length > NICHES_SHOWN && (
              <button onClick={() => setShowAllNiches(v => !v)} className="mt-2 text-[12px] font-semibold" style={{ color: PURPLE }}>
                {showAllNiches ? 'Show fewer niches' : `Show all ${catOptions.length} niches`}
              </button>
            )}
          </div>

          {!preview && !canHarvest && access === 'granted' && (
            <p className="text-[12px] mt-3" style={{ color: AMBER }}>Your SCOUT ({scoutVersion || 'unknown'}) reads TRYBE&rsquo;s screen a brand at a time. SCOUT {SCOUT_TRYBE_HARVEST_MIN_VERSION} collects every TRYBE brand at once so MVP can search them all by your niche. MVP checks every brand against your niche either way.</p>
          )}
          {!preview && <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <label className="text-[13px] flex items-center gap-2">Daily cap
              <input type="number" min={1} max={MAX_DAILY_CAP} value={cap} onChange={e => setCap(Math.min(MAX_DAILY_CAP, Number(e.target.value)))} className="w-16 rounded border px-2 py-1" style={{ borderColor: 'var(--border)', background: 'transparent' }} />
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>per rolling 24 hours (TRYBE allows up to {MAX_DAILY_CAP}; each send frees up 24 hours after it went)</span>
            </label>
            <label className="text-[13px] flex items-center gap-2">
              <input type="checkbox" checked={dailyFind} onChange={e => setDailyFind(e.target.checked)} className="accent-[#7C3AED]" />
              Write messages to {DAILY_FIND} new brands every day when I open this page
            </label>
            <button onClick={() => void saveSettings()} disabled={savingSettings} className={btn} style={{ background: PURPLE, color: '#fff' }}>{savingSettings ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
            {unsavedNiche && <span className="text-[12px]" style={{ color: AMBER }}>The list below already uses these. Save keeps them for the daily messages.</span>}
          </div>}
        </div>

        {/* 3. The live list, from MVP's copy of TRYBE */}
        {hasDirectory ? (
          <div className={card} style={cardStyle}>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <p className="text-[14px] font-semibold">{preview ? '' : '3. '}Brands that match ({live ? live.matched.toLocaleString() : '...'}{live?.capped ? '+' : ''})</p>
              {liveLoading && <Loader2 size={13} className="animate-spin" style={{ color: PURPLE }} />}
              {preview && (
                <a href="/billing" className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ border: `1px solid ${PURPLE}`, color: PURPLE }} title="Pro writes each brand a first message in your words and SCOUT sends it">
                  <Lock size={12} /> Message brands on Pro
                </a>
              )}
              {!preview && <div className="ml-auto flex flex-wrap gap-2">
                <button onClick={() => void refreshFromTrybe()} disabled={busy || access !== 'granted' || !canHarvest} className={btn} style={{ border: '1px solid var(--border)' }}
                  title={access !== 'granted' ? 'Allow SCOUT on TRYBE first (top of this page).' : !canHarvest ? 'Your SCOUT is too old to collect TRYBE\u2019s list. Chrome updates it within a day.' : busy ? `Busy: ${finding?.stage || 'sending'}. This unlocks when it finishes.` : "SCOUT collects TRYBE's list again now. It does this by itself once a day."}>
                  {finding ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Refresh from TRYBE
                </button>
                <button onClick={() => setLivePick(new Set((live?.brands || []).filter(b => !TAKEN.includes(b.status as Brand['status'])).slice(0, DAILY_FIND).map(b => b.brand_id)))}
                  disabled={!live?.brands.length} className={btn} style={{ border: '1px solid var(--border)' }}>
                  <Check size={13} /> Tick the top {DAILY_FIND}
                </button>
                {/* THE STRONG FITS ONLY (Seb, 2026-10-07: "a button that selects
                    ... only the top ratings over 80"). Brands the AI check
                    scored 80 or more, still free to message. */}
                {(() => {
                  const strong = (live?.brands || []).filter(b => !TAKEN.includes(b.status as Brand['status']) && b.status !== 'not_fit' && (b.fit_score ?? 0) >= FIT_STRONG)
                  return (
                    <button onClick={() => setLivePick(new Set(strong.map(b => b.brand_id)))} disabled={!strong.length} className={btn} style={{ border: `1px solid ${strong.length ? GREEN : 'var(--border)'}`, color: strong.length ? GREEN : undefined }}
                      title={strong.length ? `Tick the ${strong.length} brands MVP's AI check scored ${FIT_STRONG} or more for your niche` : `No brand in this list has a fit score of ${FIT_STRONG} or more yet. Fit scores come from the daily find, which runs once a day when this page opens with a saved niche.`}>
                      <Star size={13} /> Tick Fit {FIT_STRONG}+ ({strong.length})
                    </button>
                  )
                })()}
                <button onClick={() => void draftPicked()} disabled={busy || !livePick.size} className={btn} style={{ background: PURPLE, color: '#fff' }}
                  title={running ? 'Send all is running. This unlocks when it finishes.' : finding ? `Busy: ${finding.stage}. This unlocks when it finishes.` : !livePick.size ? 'Tick the brands to write to first.' : undefined}>
                  <Sparkles size={13} /> Write {livePick.size} message{livePick.size === 1 ? '' : 's'}
                </button>
              </div>}
            </div>
            <p className="text-[12px] mb-3" style={soft}>{SORTS.find(s => s.id === sortBy)?.says} {preview ? 'Star the ones you like and pass on the rest.' : 'Tick the brands you want and MVP writes each one a message from your core message.'}</p>
            {/* ONE TOOLBAR (Seb, 2026-10-16: "very overwhelming"): Quick lists,
                then search, Sort, Pay, Sells and Filters; every choice that is
                on shows as a chip with an x (components/labs/TrybeFinderControls). */}
            <FinderPresets filters={filters} sort={sortBy} onPick={p => { if (p) { setFilters(p.filters); setSortBy(p.sort) } else setFilters(NO_FILTERS) }} />
            {(() => {
              const priorityBox = (
                <FinderPriorities priorities={priorities} onChange={changePriorities}
                  note={prioritiesNote ?? (live && live.prioritiesSaved === false ? { text: isAdmin ? 'Saving priorities and stars needs migration 430 in Supabase. They work for this visit meanwhile.' : 'Your priorities work for this visit; saving them is being set up.', tone: 'warn' } : null)} />
              )
              return (
                <>
                  <FinderToolbar filters={filters} onFilters={setFilters} name={nameQ} onName={setNameQ}
                    sort={sortBy} sorts={SORTS.filter(s => !preview || s.id !== 'fit')} onSort={v => setSortBy(v as LiveSort)}
                    pay={payType} pays={PAYS.map(p => ({ ...p, label: p.id === 'any' ? 'Any' : p.label, says: PAY_SAYS[p.id] }))} onPay={v => setPayType(v as LivePay)}
                    panelExtra={sortBy === 'picks' ? undefined : priorityBox} />
                  {/* Your priorities rank Best bets: in view when that is the sort. */}
                  {sortBy === 'picks' && priorityBox}
                </>
              )
            })()}
            {!preview && <TrybeSampleGuard onFilm={() => go('week')} />}
            {live?.mix?.says && <p className="text-[12px] mb-2 rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(124,58,237,0.06)' }}><b>Your mix:</b> {live.mix.says}</p>}
            {filters.onAmazon && live && (live.amazonVideos ?? 0) === 0 && (
              <p className="text-[12px] mb-3" style={{ color: AMBER }}>MVP has none of your Amazon videos yet, so On Amazon only finds brands in your storefront and on Creator Connections. <a href="/earnings" className="font-semibold underline">Sync your Amazon videos</a> to see which TRYBE brands you already filmed.</p>
            )}
            {(live?.amazonNotes || []).map((n) => <p key={n} className="text-[12px] mb-2" style={{ color: AMBER }}>{n}</p>)}
            {/* WHAT BEST BETS READS, and how much of it is read: a signal not
                read yet is said as not read, never scored as zero. */}
            {sortBy === 'picks' && (() => {
              const shown = live?.brands || []
              const metaRead = shown.filter(b => b.meta_ads_checked_at).length
              const topAt = directory?.top100?.at
              const todoMeta = shown.filter(b => !b.meta_ads_checked_at || Date.now() - Date.parse(b.meta_ads_checked_at) > META_ADS_FRESH_MS).slice(0, 25).length
              if (!picksHelp) {
                return (
                  <p className="text-[12px] mb-3" style={soft}>
                    Best bets ranks brands the way top TRYBE creators pick them: few creators, real ad spend, not on TikTok Shop. Each brand says why it ranks where it does.{' '}
                    <button onClick={() => setPicksHelp(true)} className="font-semibold underline" style={{ color: PURPLE }}>What it reads</button>
                    {canPlaybook && todoMeta > 0 && (
                      <>{' '}<button onClick={() => void checkMetaAds()} disabled={metaRun != null} className="inline-flex items-center gap-1 font-semibold underline disabled:opacity-50" style={{ color: PURPLE }}>
                        {metaRun != null ? <><Loader2 size={11} className="animate-spin" /> Reading Meta&rsquo;s Ad Library: {metaRun.done} of {metaRun.total} done</> : `Check ${todoMeta} brands for Meta ads`}
                      </button></>
                    )}
                    {signalNote && <span className="block mt-1" style={{ color: signalNote.tone === 'ok' ? GREEN : signalNote.tone === 'warn' ? AMBER : RED }}>{signalNote.text}</span>}
                  </p>
                )
              }
              return (
                <div className="rounded-xl border px-3 py-2.5 mb-3 text-[12px] space-y-1" style={{ borderColor: 'var(--border)' }}>
                  <p className="font-semibold flex items-center gap-2">What Best bets reads <button onClick={() => setPicksHelp(false)} className="ml-auto text-[11px] font-semibold underline" style={{ color: PURPLE }}>Hide</button></p>
                  <p><b>Creators per brand</b>, from TRYBE: fewer means more of the budget for you.</p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span><b>TRYBE&rsquo;s Top 100</b>: {topAt ? `read ${new Date(topAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${directory?.top100?.matched != null ? `, ${directory.top100.matched} brands in it` : ''}` : 'not read yet'}. A brand in it is spending on ads.</span>
                    {canPlaybook && isAdmin && <button onClick={() => void readTop100(false)} disabled={topRun} className="font-semibold underline disabled:opacity-50" style={{ color: PURPLE }}>{topRun ? 'Reading...' : 'Read it now'}</button>}
                    {topAt && Date.now() - Date.parse(topAt) > 30 * 3600_000 && <span style={{ color: AMBER }}>This copy is more than a day old.</span>}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span><b>Meta ads running</b>: proof a brand spends on ads. {shown.length ? `Checked for ${metaRead} of the ${shown.length} brands below.` : 'Checked once brands are listed below.'}</span>
                    {canPlaybook && todoMeta > 0 && (
                      <button onClick={() => void checkMetaAds()} disabled={metaRun != null} className="inline-flex items-center gap-1 font-semibold underline disabled:opacity-50" style={{ color: PURPLE }}>
                        {metaRun != null ? <><Loader2 size={11} className="animate-spin" /> Reading Meta&rsquo;s Ad Library: {metaRun.done} of {metaRun.total} done</> : `Check ${todoMeta} in Meta's Ad Library`}
                      </button>
                    )}
                  </p>
                  <p><b>TikTok Shop</b>, from each brand&rsquo;s website, read in the background: brands not on it have less competition.</p>
                  {access !== 'granted' && <p style={{ color: AMBER }}>Allow SCOUT on TRYBE (top of this page) so it can read the Top 100 and Meta ads.</p>}
                  {!canPlaybook && access === 'granted' && <p style={{ color: AMBER }}>SCOUT {SCOUT_TRYBE_PLAYBOOK_MIN_VERSION} reads TRYBE&rsquo;s Top 100 and Meta&rsquo;s Ad Library. Yours is {scoutVersion || 'unknown'}; Chrome updates it by itself once the new version is published.</p>}
                  {signalNote && <p style={{ color: signalNote.tone === 'ok' ? GREEN : signalNote.tone === 'warn' ? AMBER : RED }}>{signalNote.text}</p>}
                </div>
              )
            })()}
            {/* Best fit with no scores would look like best match: say so. */}
            {sortBy === 'fit' && live && live.brands.length > 0 && !live.brands.some(b => b.fit_score != null) && (
              <p className="text-[12px] mb-3 rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(180,83,9,0.10)', color: AMBER }}>None of these brands has a fit score yet, so they are in best match order. Fit scores come from the daily find, which runs once a day when this page opens with a saved niche.</p>
            )}
            {/* WHY THE BUTTON IS OFF, said where the button is (Seb, 2026-10-07:
                "what is the reason the write message is not clickable?"). The
                daily run or a collection works on the list meanwhile, and its
                progress used to show only in the status card at the top. */}
            {busy && (
              <p className="text-[12px] mb-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(124,58,237,0.08)', color: PURPLE }}>
                <Loader2 size={12} className="animate-spin" />
                {running
                  ? 'Send all is running. Write messages unlocks when it finishes.'
                  : <>Busy: {finding?.stage}{finding?.total ? ` (${finding.done ?? 0} of ${finding.total})` : '...'}. Write messages unlocks when this finishes.</>}
              </p>
            )}
            {isAdmin && (
              <details className="rounded-lg border border-dashed px-3 py-2 mb-3 text-[12px] space-y-1" style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                <summary className="cursor-pointer font-semibold">Admin only</summary>
                <p>Updates as you change niches and keywords, from MVP&rsquo;s copy of every TRYBE brand: nothing is fetched from TRYBE or the websites.</p>
                {directory && (
                  <p>{directory.listed != null ? <>On TRYBE now: <b>{directory.listed.toLocaleString()}</b> brands{directory.brands > directory.listed ? <> (MVP also keeps {(directory.brands - directory.listed).toLocaleString()} that TRYBE no longer lists; they are left out of matches)</> : null}. </> : null}{directory.joinedSinceFirst != null && directory.firstCountAt ? <>New on TRYBE since MVP&rsquo;s first count ({new Date(directory.firstCountAt).toLocaleDateString()}): <b>{directory.joinedSinceFirst.toLocaleString()}</b>{directory.joinedStillListed != null && directory.joinedStillListed !== directory.joinedSinceFirst ? <>, {directory.joinedStillListed.toLocaleString()} of them still listed</> : null}. </> : null}MVP&rsquo;s copy of TRYBE: <b>{directory.brands.toLocaleString()}</b> brands ever seen, {directory.withWebsite.toLocaleString()} with a website, {directory.websitesRead.toLocaleString()} websites read so far{directory.websitesRead < directory.withWebsite ? ' (the rest are read in the background, so website matches grow every hour)' : ''}.{directory.lastCollectedAt ? ` Collected ${new Date(directory.lastCollectedAt).toLocaleString()}.` : ''}</p>
                )}
                {findNotes.filter(n => ADMIN_NOTE.test(n)).map((n, i) => <p key={i}>{n}</p>)}
                {/* What TRYBE's list sends, so the new filters are read from what is there. */}
                {live?.rawKeys && live.rawKeys.length > 0 && <p className="break-words">TRYBE&rsquo;s brand list sends: {live.rawKeys.join(', ')}</p>}
              </details>
            )}
            {findNotes.some(n => !ADMIN_NOTE.test(n)) && (
              <ul className="text-[12px] mb-3 space-y-0.5">{findNotes.filter(n => !ADMIN_NOTE.test(n)).map((n, i) => <li key={i}>{n}</li>)}</ul>
            )}
            {/* A niche alone is the quick way; a keyword is the better one. */}
            {cats.length > 0 && !kws.length && (live?.brands.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 mb-3" style={{ background: 'rgba(124,58,237,0.08)' }}>
                <Search size={14} style={{ color: PURPLE }} />
                <span className="text-[12px] flex-1 min-w-[12rem]">Showing every brand in {cats.length === 1 ? cats[0] : `${cats.length} niches`}. Add a keyword for brands that sell what you review.</span>
                <button onClick={() => { searchRef.current?.focus(); searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}
                  className="text-[12px] font-semibold rounded-lg px-2.5 py-1" style={{ background: PURPLE, color: '#fff' }}>Add a keyword</button>
              </div>
            )}
            {liveError && <p className="text-[12px] mb-3" style={{ color: RED }}>{liveError}</p>}
            {live && !live.brands.length && !liveLoading && (
              <p className="text-[13px]" style={soft}>
                {payType !== 'any' && (live.payOther ?? 0) > 0
                  ? <>No brand here pays {PAY_WORD[payType]} as far as TRYBE&rsquo;s list says. <button onClick={() => setPayType('any')} className="font-semibold underline" style={{ color: PURPLE }}>Show any pay</button></>
                  : filters.starred && !nameQ.trim() && !Object.values(live.hiddenBy || {}).some(n => (n ?? 0) > 0) ? 'No starred brands yet. Press the star on a brand to keep it here.'
                  : filtersOn(filters) || nameQ.trim() ? <>No brand passes these filters. <button onClick={() => { setFilters(NO_FILTERS); setNameQ('') }} className="font-semibold underline" style={{ color: PURPLE }}>Clear filters</button></>
                  : hasNiche ? 'No TRYBE brands match these niches and keywords yet. Try other words.' : 'No TRYBE brands to show yet. Press Refresh from TRYBE to collect the list.'}
              </p>
            )}
            <div className="space-y-2">
              {(live?.brands || []).map(b => {
                const taken = TAKEN.includes(b.status as Brand['status'])
                const on = livePick.has(b.brand_id)
                const where = b.status === 'drafted' ? 'Ready to send' : b.status === 'sent' ? 'Sent' : b.status === 'sending' ? 'Sending or not confirmed' : b.status === 'already' ? 'Already requested on TRYBE' : b.status === 'failed' ? 'Last send failed: queue it again in Sent' : b.status === 'skipped' ? 'You skipped it' : b.status === 'removed' ? 'You removed it' : b.status === 'not_fit' ? (b.fit_stale ? 'AI said not a fit for an earlier search' : 'AI said not a fit') : null
                const hits = (p: string) => kws.some(k => p.toLowerCase().includes(k.toLowerCase()))
                return (
                  <label key={b.brand_id} className={`flex gap-3 rounded-xl border p-3.5 ${taken ? 'opacity-60' : 'cursor-pointer'}`} style={{ borderColor: on ? PURPLE : 'var(--border)', background: on ? 'rgba(124,58,237,0.04)' : undefined }}>
                    {!preview && <input type="checkbox" className="mt-3 accent-[#7C3AED]" checked={on} disabled={taken} aria-label={`Pick ${b.name}`}
                      onChange={e => setLivePick(p => { const n = new Set(p); if (e.target.checked) n.add(b.brand_id); else n.delete(b.brand_id); return n })} />}
                    <BrandMark name={b.name} website={b.website} />
                    <span className="flex-1 min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] font-semibold">{b.name}</span>
                        <StarButton on={!!b.starred} onClick={() => void star(b)} />
                        <CompareButton on={compare.some(x => x.brand_id === b.brand_id)} full={compare.length >= COMPARE_MAX} onClick={() => flipCompare(b)} />
                        {where && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>{where}</span>}
                        <TrybeLink brandId={b.brand_id} name={b.name} scout={scoutOpens} />
                        <a href={adLibraryUrl(b.name)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[12px] inline-flex items-center gap-0.5" style={soft} title="Its ads in Meta's Ad Library">Meta ads <ExternalLink size={10} /></a>
                        {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[12px] inline-flex items-center gap-0.5" style={soft}><Globe size={11} /> Website <ExternalLink size={10} /></a>}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <NewChip on={b.is_new} />
                        {sortBy !== 'picks' && <VerdictChip score={b.pick} read={b.pick_read} />}
                        <CrowdChip crowd={b.crowd} windowDays={live?.crowdDays} />
                        <PayChip est={b.pay_est} payText={b.pay_text} />
                        <SpendChip spend={b.spend} />
                        {b.stats?.paidOut == null && <PaidOutChip bucket={b.earnings_bucket} up={b.tier_up} />}
                        <TikTokShopChip on={b.tiktok_shop} />
                        <ReviewChip review={b.review} />
                        <StaticsChip on={b.statics} />
                        <SellsChip sells={b.sells} />
                        {b.trybe_score != null && <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 inline-flex items-center gap-0.5 cursor-help" style={{ background: 'rgba(124,58,237,0.08)', color: PURPLE }} title="TRYBE's own rating of this brand, as shown on TRYBE."><Star size={10} /> TRYBE score {b.trybe_score}</span>}
                        {b.fit_score != null && <span className="text-[11px] font-semibold rounded-md px-2 py-0.5 cursor-help" style={b.fit_score >= FIT_STRONG ? { background: 'rgba(22,163,74,0.14)', color: GREEN } : { background: 'rgba(180,83,9,0.10)', color: AMBER }}
                          title={`Fit ${b.fit_score} of 100: MVP's AI check of how well what this brand sells matches your niches and keywords, from its TRYBE profile and website. ${FIT_STRONG}+ is a strong fit.`}>Fit {b.fit_score}</span>}
                        {b.total_creators != null && (b.total_creators > 0 || sortBy === 'creators') && <span className="text-[11px] rounded-md px-2 py-0.5" style={{ background: 'var(--surface-2, rgba(0,0,0,0.05))', color: 'var(--text-soft)' }}>{b.total_creators.toLocaleString()} creator{b.total_creators === 1 ? '' : 's'}</span>}
                        {sortBy === 'newest' && b.first_seen_at && <span className="text-[11px] rounded-md px-2 py-0.5" style={{ background: 'var(--surface-2, rgba(0,0,0,0.05))', color: 'var(--text-soft)' }}>First seen {new Date(b.first_seen_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                      </span>
                      <BrandExtras amazon={b.amazon} stats={b.stats} />
                      {sortBy === 'picks' && (
                        <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <VerdictChip score={b.pick ?? 0} read={b.pick_read} />
                          {(b.pick_reasons || []).slice(0, 6).map(r => (
                            <span key={r.text} className="text-[11px] rounded-md px-2 py-0.5" style={r.tone === 'good' ? { background: 'rgba(22,163,74,0.10)', color: GREEN } : r.tone === 'bad' ? { background: 'rgba(220,38,38,0.08)', color: RED } : { background: 'var(--surface-2, rgba(0,0,0,0.05))', color: 'var(--text-soft)' }}>{r.text}</span>
                          ))}
                        </span>
                      )}
                      {b.fit_reason && <span className="block text-[12px] mt-1.5">{b.fit_reason}</span>}
                      {!b.fit_reason && b.about && <span className="block text-[12px] mt-1.5 line-clamp-2" style={soft}>{b.about}</span>}
                      {b.products.length > 0 && (
                        <span className="flex flex-wrap gap-1.5 mt-2">
                          {b.products.map(pr => (
                            <span key={pr} className="text-[11px] rounded-md border px-2 py-0.5 max-w-[16rem] truncate"
                              style={hits(pr) ? { borderColor: PURPLE, color: PURPLE, background: 'rgba(124,58,237,0.08)' } : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>{pr}</span>
                          ))}
                        </span>
                      )}
                      {b.categories.length > 0 && <span className="block text-[11px] mt-1.5" style={soft}>{b.categories.join(' • ')}</span>}
                    </span>
                    {/* One brand, one click: written straight into Ready to send. */}
                    {!taken && !preview && (
                      <button onClick={e => { e.preventDefault(); e.stopPropagation(); void draftPicked([b.brand_id]) }} disabled={busy}
                        className="self-start shrink-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
                        style={{ border: `1px solid ${PURPLE}`, color: PURPLE }} title={busy ? `Busy: ${finding?.stage || 'sending'}. This unlocks when it finishes.` : 'Write this brand a message now'}>
                        <MessageCircle size={12} /> Message
                      </button>
                    )}
                    {(!taken || b.status === 'skipped') && <PassButton passed={b.status === 'skipped'} onClick={() => void pass(b)} />}
                  </label>
                )
              })}
            </div>
            {live && (live.hiddenMine || showMine) ? (
              <p className="text-[12px] mt-3" style={soft}>
                {showMine
                  ? <>Showing brands you already messaged too. <button onClick={() => setShowMine(false)} className="font-semibold underline" style={{ color: PURPLE }}>Hide them</button></>
                  : <>{live.hiddenMine} brand{live.hiddenMine === 1 ? '' : 's'} you already messaged, wrote to, passed on or removed {live.hiddenMine === 1 ? 'is' : 'are'} hidden. <button onClick={() => setShowMine(true)} className="font-semibold underline" style={{ color: PURPLE }}>Show them</button></>}
              </p>
            ) : null}
            {/* What the pay filter did, counted so the list is never quietly
                short: brands known to pay the other way are hidden; brands
                TRYBE's list gives no pay for stay, after the ones that match. */}
            {live && payType !== 'any' && ((live.payUnknown ?? 0) + (live.payOther ?? 0)) > 0 && (
              <p className="text-[12px] mt-3" style={soft}>
                {live.payUnknown ? `TRYBE's brand list does not say what ${live.payUnknown.toLocaleString()} of these brands pay, so they are listed after the ones that do. Open a brand on TRYBE to see its pay. ` : ''}
                {live.payOther ? `${live.payOther.toLocaleString()} brand${live.payOther === 1 ? '' : 's'} paying ${payType === 'flat' ? 'only a % of sales' : payType === 'both' ? 'only one of the two' : payType === 'percent' ? 'only a flat fee' : 'another way'} ${live.payOther === 1 ? 'is' : 'are'} hidden. ` : ''}
                <button onClick={() => setPayType('any')} className="font-semibold underline" style={{ color: PURPLE }}>Show any pay</button>
              </p>
            )}
            {live && <FinderFilterNote hiddenBy={live.hiddenBy} blankBy={live.blankBy} unknownBy={live.unknownBy} />}
            {/* SPENDING ON ADS NEEDS THE COUNT: offered right where it is
                missing, not only under Best bets. */}
            {live && filters.spending && (live.unknownBy?.spending ?? 0) > 0 && canPlaybook && (
              <p className="text-[12px] mt-1.5" style={soft}>
                <button onClick={() => void checkMetaAds()} disabled={metaRun != null} className="inline-flex items-center gap-1 font-semibold underline disabled:opacity-50" style={{ color: PURPLE }}>
                  {metaRun != null ? <><Loader2 size={11} className="animate-spin" /> Reading Meta&rsquo;s Ad Library: {metaRun.done} of {metaRun.total} done</> : 'Count their Meta ads now (25 at a time, through SCOUT)'}
                </button>
                {signalNote && <span className="block mt-1" style={{ color: signalNote.tone === 'ok' ? GREEN : signalNote.tone === 'warn' ? AMBER : RED }}>{signalNote.text}</span>}
              </p>
            )}
            {/* Said whenever the list leans on it, or when no brand on it has a figure. */}
            {live?.spendKnown && (sortBy === 'spend' || !!filters.minSpend || live.spendKnown.recent + live.spendKnown.lifetime === 0) && <SpendNote known={live.spendKnown} windowDays={live.crowdDays} />}
            {live && live.matched > live.brands.length && (
              <p className="text-[12px] mt-3" style={soft}>Showing the best {live.brands.length} of {live.matched.toLocaleString()}{live.capped ? '+' : ''} matches. Add a keyword to narrow it down.</p>
            )}
            {compare.length > 0 && <div className="h-20" aria-hidden />}
            <TrybeCompare brands={compare} onRemove={(id) => setCompare(c => c.filter(x => x.brand_id !== id))} onClear={() => setCompare([])} />
          </div>
        ) : preview ? (
          <p className="text-[13px]" style={soft}>MVP&rsquo;s copy of TRYBE&rsquo;s brands is not ready yet. Check back soon.</p>
        ) : (
        <div className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="text-[14px] font-semibold">3. Brands that fit ({found.length})</p>
            <div className="ml-auto flex flex-wrap gap-2">
              <button onClick={() => void findBrands(false)} disabled={busy || access !== 'granted'} className={btn} style={{ border: '1px solid var(--border)' }}>
                {finding ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Find brands
              </button>
              <button onClick={() => void draftSelected()} disabled={busy || !found.some(b => selected.has(b.brand_id))} className={btn} style={{ background: PURPLE, color: '#fff' }}>
                <Sparkles size={13} /> Write {found.filter(b => selected.has(b.brand_id)).length} messages
              </button>
            </div>
          </div>
          <p className="text-[12px] mb-3" style={soft}>Be signed in to TRYBE in this browser. Best fits first; the top {DAILY_FIND} are ticked.</p>
          {isAdmin && directory && directory.brands > 0 && (
            <p className="text-[12px] mb-3" style={soft}>
              {directory.listed != null ? <>On TRYBE now: <b>{directory.listed.toLocaleString()}</b> brands{directory.brands > directory.listed ? <> (MVP also keeps {(directory.brands - directory.listed).toLocaleString()} that TRYBE no longer lists; they are left out of matches)</> : null}. </> : null}{directory.joinedSinceFirst != null && directory.firstCountAt ? <>New on TRYBE since MVP&rsquo;s first count ({new Date(directory.firstCountAt).toLocaleDateString()}): <b>{directory.joinedSinceFirst.toLocaleString()}</b>{directory.joinedStillListed != null && directory.joinedStillListed !== directory.joinedSinceFirst ? <>, {directory.joinedStillListed.toLocaleString()} of them still listed</> : null}. </> : null}MVP&rsquo;s copy of TRYBE: <b>{directory.brands.toLocaleString()}</b> brands ever seen, {directory.withWebsite.toLocaleString()} with a website, {directory.websitesRead.toLocaleString()} websites read so far{directory.websitesRead < directory.withWebsite ? ' (the rest are read in the background, so website matches grow every hour)' : ''}.{directory.lastCollectedAt ? ` Collected ${new Date(directory.lastCollectedAt).toLocaleString()}.` : ''}
            </p>
          )}
          {findNotes.some(n => isAdmin || !ADMIN_NOTE.test(n)) && (
            <ul className="text-[12px] mb-3 space-y-0.5">{findNotes.filter(n => isAdmin || !ADMIN_NOTE.test(n)).map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
          {unjudged.length > 0 && !finding && (
            <p className="text-[12px] mb-3" style={{ color: AMBER }}>{unjudged.length} brand{unjudged.length === 1 ? '' : 's'} not yet checked against this niche. <button onClick={() => void judge(unjudged).finally(() => setFinding(null)).then(() => load())} className="underline">Check them now</button></p>
          )}
          {!found.length && <p className="text-[13px]" style={soft}>{hasNiche ? 'No brands that fit yet. Press Find brands.' : 'Pick your niche, then press Find brands.'}</p>}
          <div className="space-y-2">
            {found.map(b => (
              <label key={b.brand_id} className="flex gap-3 rounded-xl border p-3 cursor-pointer" style={{ borderColor: selected.has(b.brand_id) ? PURPLE : 'var(--border)' }}>
                <input type="checkbox" className="mt-1 accent-[#7C3AED]" checked={selected.has(b.brand_id)}
                  onChange={e => setSelected(s => { const n = new Set(s); if (e.target.checked) n.add(b.brand_id); else n.delete(b.brand_id); return n })} />
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-semibold">{b.name}</span>
                    {b.fit_score != null && <span className="text-[11px] rounded px-1.5 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}>Fit {b.fit_score}</span>}
                    {promotes(b) && <span className="text-[11px] rounded px-1.5 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}>You already promote them</span>}
                    {b.pay_text && <span className="text-[12px]" style={{ color: PURPLE }}>{b.pay_text}</span>}
                    {b.trybe_score != null && <span className="text-[12px] inline-flex items-center gap-0.5" style={soft}><Star size={11} /> Score {b.trybe_score}</span>}
                    {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[12px] inline-flex items-center gap-0.5" style={soft}><Globe size={11} /> Website <ExternalLink size={10} /></a>}
                  </span>
                  <AmazonLine amazon={amz.brand(b.brand_id)} className="mt-1" />
                  {b.fit_reason && <span className="block text-[12px] mt-0.5">{b.fit_reason}</span>}
                  {b.categories && b.categories.length > 0 && <span className="block text-[11px] mt-0.5" style={soft}>{b.categories.join(' • ')}</span>}
                </span>
                <button onClick={e => { e.preventDefault(); void skip(b) }} className="self-start text-[11px] underline" style={soft}>Skip</button>
              </label>
            ))}
          </div>
          {notFit.length > 0 && (
            <div className="mt-4">
              <button onClick={() => setShowNotFit(v => !v)} className="text-[12px] underline" style={soft}>{showNotFit ? 'Hide' : 'Show'} {notFit.length} that do not fit</button>
              {showNotFit && (
                <div className="mt-2 space-y-1.5">
                  {notFit.map(b => (
                    <div key={b.brand_id} className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="font-medium">{b.name}</span>
                      <span style={soft}>{b.fit_reason || 'Not a fit.'}</span>
                      <button onClick={() => void skip(b, true).then(() => load())} className="underline" style={{ color: PURPLE }}>Use anyway</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </>)}

      {tab === 'queue' && (
        <div className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <p className="text-[14px] font-semibold">Ready to send ({queue.length})</p>
            <div className="ml-auto flex items-center gap-2">
              {running && (scoutRun?.on ? (scoutRun.current ? null : scoutRun.nextAt) : waitUntil) ? <span className="text-[12px]" style={soft}>Next request in {Math.max(0, Math.ceil(((scoutRun?.on ? scoutRun.nextAt : waitUntil) as number - now) / 1000))}s</span> : null}
              {running
                ? <button onClick={() => void stopRun()} className={btn} style={{ border: '1px solid var(--border)' }}><Square size={13} /> Stop</button>
                : <>
                  {queue.length > 0 && <button onClick={() => void rewrite(queue)} disabled={!!finding} className={btn} style={{ border: '1px solid var(--border)' }} title="Write every message here again from your core message as it is now">
                    {finding ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Rewrite all
                  </button>}
                  <button onClick={() => void sendAll()} disabled={!!finding || !queue.length} className={btn} style={{ background: PURPLE, color: '#fff' }}
                    title={finding ? `Busy: ${finding.stage}. Send all unlocks when it finishes.` : sendBlocked || undefined}><Send size={13} /> Send all ({Math.min(queue.length, remaining)})</button>
                </>}
            </div>
          </div>
          <p className="text-[12px] mb-3" style={soft}>
            {dailyFind && (!saved?.core.trim() || savedKey === prefsKey([], []))
              ? <>The daily messages are on, but they wait for a saved core message and a saved niche or keyword. Save both in Find brands.</>
              : dailyFind
              ? <>Every day, when you open this page, MVP and SCOUT find up to {DAILY_FIND} new brands that fit your niche and write their messages here.{lastFindAt ? ` Last found ${new Date(lastFindAt).toLocaleString()}.` : ''} Skim, edit or remove, then press Send all.</>
              : <>The daily messages are off. Turn them on in Find brands, or pick brands there yourself.</>}
          </p>
          {findNotes.some(n => isAdmin || !ADMIN_NOTE.test(n)) && (
            <ul className="text-[12px] mb-3 space-y-0.5">{findNotes.filter(n => isAdmin || !ADMIN_NOTE.test(n)).map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
          {sendBlocked && !running && queue.length > 0 && <p className="text-[12px] mb-3" style={{ color: AMBER }}>{sendBlocked}</p>}
          {scoutRun?.on && (
            <p className="text-[12px] mb-3" style={{ color: GREEN }}>
              SCOUT is sending these by itself, out of sight: {scoutRun.sent} sent, {Math.min(scoutRun.idx + (scoutRun.current ? 1 : 0), scoutRun.ids.length)} of {scoutRun.ids.length} done{scoutRun.current ? `, sending ${scoutRun.current.name} now` : ''}.
              {' '}You can close this tab or keep working. Nothing takes your screen; a brand SCOUT cannot reach stays in Ready to send with the reason.
            </p>
          )}
          {!scoutRun?.on && scoutRun?.ended && scoutRun.endedAt && Date.now() - scoutRun.endedAt < 6 * 3600_000 && (
            <p className="text-[12px] mb-3" style={soft}>Last run by SCOUT, {new Date(scoutRun.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}: {scoutRun.ended}</p>
          )}
          {pageRunning && <p className="text-[12px] mb-3" style={{ color: AMBER }}>{scoutAtLeast(scoutVersion, SCOUT_TRYBE_BACKGROUND_SEND_MIN_VERSION)
            ? `Keep this tab open. SCOUT sends each request in a TRYBE tab behind this one, ${runSize < SHORT_RUN_UNDER ? `${SHORT_GAP_MS / 1000} seconds apart` : '45 seconds to 2 minutes apart, with a longer pause every five'}. It comes to the front only if TRYBE needs it.`
            : `Keep this tab open. SCOUT opens TRYBE for each request and brings you back, ${runSize < SHORT_RUN_UNDER ? `${SHORT_GAP_MS / 1000} seconds apart` : '45 seconds to 2 minutes apart, with a longer pause every five'}.`}</p>}
          {runLog.length > 0 && (
            <div className="rounded-xl border p-3 mb-3 max-h-56 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[12px] font-semibold mb-1">Run log</p>
              {runLog.map((l, i) => (
                <p key={i} className="text-[12px]" style={{ color: l.tone === 'ok' ? GREEN : l.tone === 'bad' ? RED : l.tone === 'warn' ? AMBER : 'var(--text)' }}>
                  <span style={soft}>{new Date(l.at).toLocaleTimeString()}</span> <b>{l.name}</b>: {l.text}
                </p>
              ))}
            </div>
          )}
          {!queue.length && <p className="text-[13px]" style={soft}>No messages ready yet. <button onClick={() => setTab('find')} className="font-semibold underline" style={{ color: PURPLE }}>Pick brands in Find brands</button> and press Write messages.</p>}
          <div className="space-y-3">
            {queue.map(b => <QueueRow key={b.brand_id} b={b} amazon={amz.brand(b.brand_id)} promotes={promotes(b)} busy={current === b.brand_id || scoutRun?.current?.id === b.brand_id} disabled={running} onSave={t => void saveDraft(b, t)} onRemove={() => void remove(b)} onRewrite={() => void rewrite([b])} rewriting={!!finding} scoutOpens={scoutOpens} onSendNow={t => void saveDraft(b, t).then(ok => { if (ok) void sendOne({ ...b, draft: t }) })} canSend={access === 'granted' && remaining > 0 && !finding} sendReason={finding ? `Busy: ${finding.stage}.` : sendBlocked} />)}
          </div>
          {/* Brands skipped before Remove existed: put back, or off the page. */}
          {brands.some(b => b.status === 'skipped') && (
            <div className="mt-4">
              <p className="text-[12px] font-semibold mb-1.5">Skipped</p>
              <div className="flex flex-wrap gap-2">
                {brands.filter(b => b.status === 'skipped').map(b => (
                  <span key={b.brand_id} className="inline-flex items-center gap-2 rounded-full border pl-3 pr-1.5 py-1 text-[12px]" style={{ borderColor: 'var(--border)' }}>
                    {b.name}
                    <button onClick={() => void skip(b, true)} title="Put it back" aria-label={`Put ${b.name} back`} className="inline-flex items-center gap-0.5 font-semibold" style={{ color: PURPLE }}><RotateCcw size={11} /> Restore</button>
                    <button onClick={() => void remove(b)} title="Remove it from this page" aria-label={`Remove ${b.name}`} className="rounded-full p-1" style={{ color: RED }}><Trash2 size={12} /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'inbox' && <TrybeInbox scoutVersion={scoutVersion} allowed={access === 'granted'} openRequest={openChat} onOpened={() => setOpenChat(null)} onConvos={onInboxConvos}
        directory={inboxDirectory} />}

      {tab === 'brands' && canMyBrands && <TrybeAds canRead={canMyBrands} isAdmin={isAdmin} onPlan={() => go('week')} />}
      {tab === 'brands' && canMyBrands && <TrybeRetainers canRead={canMyBrands} scoutOpens={scoutOpens} />}
      {tab === 'brands' && (
        <TrybeMyBrands canRead={canMyBrands} canSend={canInbox} convos={inbox ? inbox.convos : null} me={inbox?.me || []} myName={inbox?.myName || ''}
          isAdmin={isAdmin} scoutOpens={scoutOpens} needsUpdate={myBrandsUpdate} poolOptOut={poolOptOut} onPoolOptOut={setPoolOptOut} />
      )}

      {tab === 'week' && (
        // Accepted brands first, for the brand box (Seb, 2026-10-13).
        <TrybeWeek canRead={canMyBrands} isAdmin={isAdmin}
          knownBrands={[...sentRows.filter(r => r.rq?.state === 'accepted'), ...sentRows.filter(r => r.rq?.state !== 'accepted')].map(r => ({ id: r.b.brand_id, name: r.b.name }))} />
      )}

      {tab === 'sent' && (
        <div className={card} style={cardStyle}>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="text-[14px] font-semibold">Sent and tried</p>
            {canInbox && (
              <button onClick={() => { void loadInbox(); if (canRequests) void loadRequests(true) }} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}><RotateCcw size={12} /> Check replies</button>
            )}
          </div>
          {/* WHO ANSWERED (Seb, 2026-10-07). Read from the TRYBE inbox: a brand
              whose conversation's last message is theirs has replied. A brand
              with no conversation has not answered on TRYBE yet. */}
          <p className="text-[12px] mb-3" style={soft}>
            {inbox ? `${repliedCount} of ${wentCount} sent replied. Replies are read from your TRYBE inbox.`
              : inboxError ? `Replies could not be read from TRYBE: ${inboxError}`
              : canInbox ? 'Reading replies from your TRYBE inbox...' : 'Allow SCOUT on TRYBE to see which brands replied.'}
          </p>
          {/* WHAT TO DO NEXT, counted across the brands with a chat. */}
          {inbox && (() => {
            const states = sentRows.filter(r => r.c && r.reply === 'replied').map(r => afterStates[r.b.brand_id] || 'checking')
            const n = (k: string) => states.filter(x => x === k).length
            if (!states.length) return null
            return (
              <p className="text-[12px] mb-3 rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(124,58,237,0.06)' }}>
                <b>Next steps:</b>{' '}
                {[n('send_first') && `${n('send_first')} accepted and waiting for your first message`, n('no_answer') && `${n('no_answer')} not answering (don't film for them yet)`, n('answered') && `${n('answered')} answered, safe to film 2 or 3`, n('waiting') && `${n('waiting')} waiting for an answer`, n('checking') && `${n('checking')} being read`, n('unknown') && `${n('unknown')} could not be read`].filter(Boolean).join(' · ')}.
              </p>
            )
          })()}
          {/* ACCEPTED, PENDING, DECLINED (upgrade 1), from TRYBE's own request
              list. Not read is said as not read, never as zero accepted. */}
          {(history.length > 0 || (requests?.invites.length ?? 0) > 0) && (() => {
            if (!canRequests) return access === 'granted' ? <p className="text-[12px] mb-3" style={soft}>Accepted, pending and declined show here with SCOUT {SCOUT_TRYBE_INBOX_MIN_VERSION} or newer. Yours is {scoutVersion || 'unknown'}; Chrome updates it by itself.</p> : null
            if (!requests && requestsFailed) return (
              <p className="text-[12px] mb-3" style={{ color: AMBER }}>
                MVP could not read where your requests stand on TRYBE: {requestsFailed} Make sure you are signed in to TRYBE in this Chrome.{' '}
                <button onClick={() => void loadRequests(true)} className="font-semibold underline" style={{ color: PURPLE }}>Read again</button>
              </p>
            )
            if (!requests) return (
              <p className="text-[12px] mb-3 inline-flex items-center gap-1.5" style={soft}>
                <Loader2 size={12} className="animate-spin" /> Reading where your requests stand on TRYBE{requestsPage ? `, ${requestsPage}` : ''}. SCOUT reads TRYBE&rsquo;s brand list in a tab behind this one.
              </p>
            )
            const went = sentRows.filter(r => WENT.includes(r.b.status))
            const states = went.map(r => r.rq?.state).filter((x): x is RequestState => !!x)
            const n = (k: RequestState) => states.filter(x => x === k).length
            const rate = acceptRate(states)
            // Only a whole read can say a brand is missing from TRYBE's list.
            const notListed = requests.complete ? went.filter(r => !requests.flags[r.b.brand_id]).length : 0
            const needInbox = went.filter(r => { const f = requests.flags[r.b.brand_id]; return f && !f.pendingRequest && !inbox }).length
            return (
              <div className="text-[12px] mb-3 space-y-1">
                <p>
                  On TRYBE: <b style={{ color: GREEN }}>{n('accepted')} accepted</b>, <b style={{ color: AMBER }}>{n('pending')} pending</b>, <b style={{ color: RED }}>{n('declined')} declined or expired</b>
                  {rate != null ? `. ${rate}% of the brands that answered said yes` : ''}.{' '}
                  <span style={soft}>Read {new Date(requests.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</span>{' '}
                  {requestsPage
                    ? <span className="inline-flex items-center gap-1" style={soft}><Loader2 size={11} className="animate-spin" /> Reading again, {requestsPage}</span>
                    : <button onClick={() => void loadRequests(true)} className="font-semibold underline" style={{ color: PURPLE }}>Read again</button>}
                </p>
                {notListed > 0 && <p style={soft}>{notListed} sent {notListed === 1 ? 'brand is' : 'brands are'} not in TRYBE&rsquo;s brand list now, so {notListed === 1 ? 'it is' : 'they are'} not tagged.</p>}
                {needInbox > 0 && <p style={soft}>{needInbox} {needInbox === 1 ? 'request is' : 'requests are'} no longer pending. Accepted or declined is told from your TRYBE inbox, which could not be read.</p>}
                {requestsNote && <p style={{ color: AMBER }}>{requestsNote}</p>}
                {requestsFailed && <p style={{ color: AMBER }}>The latest read failed ({requestsFailed}), so these are from {new Date(requests.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>}
                {/* A brand that invited the creator is the warmest lead there is. */}
                {requests.invites.length > 0 && (
                  <p className="rounded-lg px-2.5 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ background: 'rgba(22,163,74,0.10)' }}>
                    <b style={{ color: GREEN }}>{requests.invites.length} {requests.invites.length === 1 ? 'brand has' : 'brands have'} invited you on TRYBE:</b>
                    {requests.invites.slice(0, 8).map(f => <span key={f.brandId} className="inline-flex items-center gap-1">{f.name || 'A brand'} <TrybeLink brandId={f.brandId} name={f.name} scout={scoutOpens} /></span>)}
                    {requests.invites.length > 8 && <span style={soft}>and {requests.invites.length - 8} more</span>}
                  </p>
                )}
              </div>
            )
          })()}
          {(inbox || requests) && history.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {([
                ['all', `All (${history.length})`],
                ...(inbox ? [['replied', `Replied (${repliedCount})`], ['waiting', `No reply yet (${sentRows.filter(r => r.reply !== 'replied' && WENT.includes(r.b.status)).length})`]] : []),
                ...(requests ? [['accepted', `Accepted (${sentRows.filter(r => r.rq?.state === 'accepted').length})`], ['declined', `Declined (${sentRows.filter(r => r.rq?.state === 'declined').length})`]] : []),
              ] as Array<[typeof sentFilter, string]>).map(([id, label]) => (
                <button key={id} onClick={() => setSentFilter(id)} className="rounded-full border px-3 py-1 text-[12px] font-semibold"
                  style={sentFilter === id ? { background: PURPLE, borderColor: PURPLE, color: '#fff' } : { borderColor: 'var(--border)' }}>{label}</button>
              ))}
            </div>
          )}
          {!history.length && <p className="text-[13px]" style={soft}>Nothing sent yet.</p>}
          <div className="space-y-2">
            {sentRows.filter(r => sentFilter === 'all' || (sentFilter === 'accepted' || sentFilter === 'declined' ? r.rq?.state === sentFilter : sentFilter === 'replied' ? r.reply === 'replied' : r.reply !== 'replied' && WENT.includes(r.b.status))).map(({ b, c, reply, lastMine, rq }) => (
              <div key={b.brand_id} className="flex items-start gap-3 rounded-xl border p-3" style={{ borderColor: reply === 'replied' ? 'rgba(22,163,74,0.45)' : 'var(--border)' }}>
                <BrandMark name={b.name} website={b.website} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span className="text-[14px] font-semibold">{b.name}</span>
                    <TrybeLink brandId={b.brand_id} name={b.name} scout={scoutOpens} />
                    {rq && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: REQUEST_WORDS[rq.state].bg, color: REQUEST_WORDS[rq.state].color }} title="Where this request stands in your TRYBE requests">{REQUEST_WORDS[rq.state].label}</span>}
                    {reply === 'replied' && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}>Replied{b.replied_at ? ` ${new Date(b.replied_at).toLocaleDateString()}` : ''}</span>}
                    {reply === 'replied' && lastMine === true && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(124,58,237,0.10)', color: PURPLE }}>You wrote last</span>}
                    {reply === 'none' && (b.status === 'sent' || b.status === 'already') && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2, rgba(0,0,0,0.05))', color: 'var(--text-soft)' }}>No reply yet</span>}
                    {c && c.unread > 0 && <span className="text-[11px] font-bold rounded-full px-1.5 text-white" style={{ background: PURPLE }}>{c.unread} new</span>}
                  </div>
                  <AmazonLine amazon={amz.brand(b.brand_id)} className="mt-1" />
                  <div className="text-[12px] mt-1">
                    {b.status === 'sent' && <span className="inline-flex items-center gap-1" style={{ color: GREEN }}><Check size={12} /> Request sent {b.sent_at ? new Date(b.sent_at).toLocaleString() : ''}</span>}
                    {b.status === 'already' && <span style={soft}>Already requested on TRYBE</span>}
                    {b.status === 'failed' && goneFromTrybe(b) && (
                      <span className="inline-flex flex-wrap items-center gap-2" style={{ color: AMBER }}>
                        <AlertTriangle size={12} /> No longer on TRYBE&rsquo;s Discover: SCOUT could not find it, and MVP&rsquo;s last full read of TRYBE&rsquo;s list ({new Date(b.left_trybe_at || '').toLocaleDateString()}) did not have it either.
                        {!running && <button onClick={() => void remove(b)} className="underline">Remove</button>}
                        {!running && b.draft && <button onClick={() => void requeue(b)} className="underline">Queue it again anyway</button>}
                      </span>
                    )}
                    {b.status === 'failed' && !goneFromTrybe(b) && (
                      <span className="inline-flex flex-wrap items-center gap-2" style={{ color: RED }}>
                        <AlertTriangle size={12} /> Not sent: {sendWords(b.error)}
                        {!running && b.draft && <button onClick={() => void requeue(b)} className="underline">Queue it again</button>}
                        {!running && <button onClick={() => void remove(b)} className="underline">Remove</button>}
                      </span>
                    )}
                    {b.status === 'sending' && current !== b.brand_id && (
                      <span className="inline-flex flex-wrap items-center gap-2" style={{ color: AMBER }}>
                        <AlertTriangle size={12} /> Not confirmed{b.error ? `: ${sendWords(b.error)}` : ''}. Is it in TRYBE&rsquo;s Pending Requests?
                        <button onClick={() => void settle(b, true)} className="underline">Yes, it went</button>
                        <button onClick={() => void settle(b, false)} className="underline">No, queue it again</button>
                      </span>
                    )}
                    {b.status === 'sending' && current === b.brand_id && <span className="inline-flex items-center gap-1" style={soft}><Loader2 size={12} className="animate-spin" /> Sending now</span>}
                  </div>
                  {c?.last && <p className="text-[12px] mt-1.5 rounded-lg px-2.5 py-1.5 line-clamp-2" style={{ background: 'var(--surface-2, rgba(0,0,0,0.04))' }}>{c.last}</p>}
                  {/* AFTER A YES (Cole's playbook): message before you film,
                      don't film for a brand nobody answers for, then video ideas. */}
                  {c && inbox && reply === 'replied' && (
                    <TrybeAfterAccept b={b} chatId={c.id} lastAt={c.at} me={inbox.me} myName={inbox.myName} canSend={canInbox}
                      canReadWinners={canMyBrands} isAdmin={isAdmin}
                      onPatch={p => patch(b.brand_id, p as Partial<Brand>)} onState={onAfterState} />
                  )}
                </div>
                {c && (
                  <button onClick={() => { setOpenChat(o => ({ id: c.id, n: (o?.n ?? 0) + 1 })); setTab('inbox') }}
                    className="self-start shrink-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold"
                    style={reply === 'replied' ? { background: PURPLE, color: '#fff' } : { border: `1px solid ${PURPLE}`, color: PURPLE }}>
                    <MessageCircle size={12} /> Open chat
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function QueueRow({ b, busy, disabled, onSave, onRemove, onRewrite, rewriting, onSendNow, canSend, sendReason, scoutOpens, amazon, promotes }: {
  /** The brand on Amazon, and whether to say "You already promote them". */
  amazon?: LiveAmazon | null; promotes?: boolean
  b: Brand; busy: boolean; disabled: boolean; onSave: (t: string) => void; onRemove: () => void; onRewrite: () => void; rewriting: boolean; scoutOpens: boolean
  /** Why Send now is off, when it is. */
  sendReason?: string | null
  /** Saves the text shown, then sends it: never an older copy. */
  onSendNow: (text: string) => void; canSend: boolean
}) {
  const [text, setText] = useState(b.draft || '')
  // COMPACT UNTIL OPENED (Seb, 2026-10-07): a short preview per brand, the
  // full box only for the one being edited.
  const [open, setOpen] = useState(false)
  useEffect(() => { setText(b.draft || '') }, [b.draft])
  const researched = !!(b.site_summary || (b.site_products && b.site_products.length))
  const soft = { color: 'var(--text-soft)' }
  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: busy ? PURPLE : 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-start gap-3">
        <BrandMark name={b.name} website={b.website} size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-semibold">{b.name}</span>
            {promotes && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: GREEN }}>You already promote them</span>}
            {b.pay_text && <span className="text-[11px] font-semibold rounded-md px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.10)', color: GREEN }}>{b.pay_text}</span>}
            {b.left_trybe_at && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'rgba(217,119,6,0.12)', color: AMBER }} title={`MVP's last full read of TRYBE's list (${new Date(b.left_trybe_at).toLocaleDateString()}) did not have this brand. It may have left TRYBE, or stopped taking creators. Open it on TRYBE to check before sending.`}>Not in TRYBE&rsquo;s list lately</span>}
            <TrybeLink brandId={b.brand_id} name={b.name} scout={scoutOpens} />
            {b.website && <a href={b.website} target="_blank" rel="noopener noreferrer" className="text-[12px] inline-flex items-center gap-0.5" style={soft}><Globe size={11} /> Website <ExternalLink size={10} /></a>}
            {busy && <span className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: PURPLE }}><Loader2 size={11} className="animate-spin" /> Sending now</span>}
          </div>
          <AmazonLine amazon={amazon} className="mt-1" />
          <p className="text-[11px] mt-0.5" style={{ color: researched ? GREEN : AMBER }}>
            {researched ? 'Written knowing their website' : `Website not read${b.site_error ? `: ${b.site_error}` : ''}`}
          </p>
          {!open && (
            <button onClick={() => setOpen(true)} className="block w-full text-left mt-2 rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap line-clamp-3" style={{ background: 'var(--surface-2, rgba(0,0,0,0.04))' }} title="Open to read or edit">
              {text || 'No message yet.'}
            </button>
          )}
          {open && (<>
            <textarea value={text} onChange={e => setText(e.target.value)} onBlur={() => onSave(text)} rows={10} disabled={disabled} autoFocus
              className="w-full mt-2 rounded-lg border p-2.5 text-[13px] whitespace-pre-wrap" style={{ borderColor: 'var(--border)', background: 'transparent' }} />
            <p className="text-[11px] mt-1" style={soft}>{text.length} characters, sent as shown, line breaks included. Changes save when you click away.</p>
          </>)}
          {b.error && <p className="text-[11px] mt-1" style={{ color: RED }}>Last try: {sendWords(b.error)}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[12px]">
            <button onClick={() => { if (open) onSave(text); setOpen(o => !o) }} className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--text)' }}>
              {open ? <><ChevronUp size={12} /> Done</> : <><Pencil size={11} /> Edit</>}
            </button>
            <button onClick={onRewrite} disabled={disabled || rewriting} className="inline-flex items-center gap-1 font-semibold disabled:opacity-50" style={{ color: PURPLE }} title="Write it again from your core message as it is now"><RotateCcw size={11} /> Rewrite</button>
            <button onClick={onRemove} disabled={disabled} className="inline-flex items-center gap-1 font-semibold disabled:opacity-50" style={{ color: RED }}><Trash2 size={11} /> Remove</button>
            <button onClick={() => onSendNow(text)} disabled={disabled || !canSend || !text.trim()} className="ml-auto inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: PURPLE, color: '#fff' }}
              title={disabled ? 'Send all is running. This unlocks when it finishes.' : !text.trim() ? 'The message is empty.' : !canSend ? (sendReason || 'Sending is not available right now.') : 'Send just this one now'}>
              <Send size={11} /> Send now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
