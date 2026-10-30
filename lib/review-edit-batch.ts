// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BATCH FROM GOOGLE DRIVE, A-ROLL AND B-ROLL (Seb, 2026-10-30: "They
// should have a predetermined folder that they use for, let's call it A
// roll and B roll"). The creator keeps their talking takes in one Drive
// folder and their B-roll in another. For a batch they select the new files
// in each (Google's picker opens straight in the folder; MVP cannot look
// inside a folder on its own, which is what keeps Google's permission to
// the files picked). MVP then pairs each talking take with its B-roll:
//   1. the same name in both folders ("Hoodie.mov" and "Hoodie broll.mov");
//   2. else filming order (Seb, 2026-10-30: 20 talking takes and 20 B-roll
//      in Drive, made into 20 videos): the B-roll filmed between one talking
//      take and the next. When each was filmed is read from inside the file
//      (the camera's own date, so names and upload order do not matter),
//      else the camera's file number or the time in its name, else when it
//      reached Drive. Only like is compared with like. B-roll filmed after
//      its talk or before it both work: whichever pairs more is used.
// What the video is for comes from how it was filmed: upright is a TRYBE
// ad, sideways an Amazon and YouTube review. The creator checks the pairs
// before anything is queued. Pure, tested in scripts/test-review-edit-batch.

import type { VideoKind } from '@/lib/review-edit'

export interface DriveTake {
  id: string
  name: string
  bytes: number | null
  width: number | null
  height: number | null
  seconds: number | null
  /** When it reached Drive (ISO). */
  createdAt: string | null
  /** When it was filmed, read from the file itself (ISO), when known. */
  filmedAt?: string | null
}

export interface Pair { a: DriveTake; b: DriveTake | null; how: 'name' | 'filmed' | 'order' | 'none'; kind: VideoKind; product: string }

/** Names a camera or phone gives a file, which say nothing about the product. */
const CAMERA = /^(img|mvi|mov|vid|dsc|dji|gopr|gh\d|gx\d|pxl|c\d{3,}|clip|video|screen ?recording|untitled)[\s_-]*\d/i

const strip = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '')

/** The words of a file's name that could name the product: no extension, no
 *  A-roll or B-roll marker, nothing a camera wrote. Empty when there are none. Pure. */
export function baseName(name: string): string {
  const n = strip(String(name || '')).trim()
  if (CAMERA.test(n)) return ''
  return n.toLowerCase()
    .replace(/\b(a|b)[\s_-]?roll\b|\bbroll\b|\baroll\b|\btalk(ing)?\b|\btake\s*\d*\b|\bfinal\b|\bcopy\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Where a file sits in filming order: the camera's number, or the date and
 *  time in its name (PXL_20261030_142233, VID_20261030_142233). Null when the
 *  name says neither. Pure. */
export function filmedKey(name: string): number | null {
  const n = strip(String(name || ''))
  const stamp = /(20\d{6})[_-]?(\d{6})/.exec(n)
  if (stamp) return Number(`${stamp[1]}${stamp[2]}`)
  const num = /^(?:img|mvi|mov|vid|dsc|dji|gopr|c)[\s_-]*(\d{3,})/i.exec(n)
  return num ? Number(num[1]) : null
}

/** What a take's place in filming order is measured on, and its place.
 *  Two takes are only compared on the same measure. Pure. */
export function orderOf(t: DriveTake): { scale: 'filmed' | 'name' | 'drive'; at: number } | null {
  const filmed = t.filmedAt ? Date.parse(t.filmedAt) : NaN
  if (Number.isFinite(filmed)) return { scale: 'filmed', at: filmed }
  const key = filmedKey(t.name)
  if (key != null) return { scale: 'name', at: key }
  const drive = t.createdAt ? Date.parse(t.createdAt) : NaN
  return Number.isFinite(drive) ? { scale: 'drive', at: drive } : null
}

/** Upright is a TRYBE ad; sideways (or not known) a review. Pure. */
export function kindOf(t: DriveTake): VideoKind {
  return t.width && t.height && t.height > t.width ? 'trybe' : 'review'
}

/** A product name a person wrote, from the file name: its words in title
 *  case, or empty. Pure. */
export function productFromName(name: string): string {
  const b = baseName(name)
  return b ? b.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 120) : ''
}

/** Each talking take with its B-roll. Every talking take is in the answer,
 *  once; a B-roll is used at most once. Pure. */
export function pairTakes(aRoll: DriveTake[], bRoll: DriveTake[]): Pair[] {
  const used = new Set<string>()
  const byA = new Map<string, { b: DriveTake; how: Pair['how'] }>()
  // 1. The same name in both folders.
  for (const a of aRoll) {
    const key = baseName(a.name)
    if (!key) continue
    const b = bRoll.find((x) => !used.has(x.id) && baseName(x.name) === key)
    if (b) { used.add(b.id); byA.set(a.id, { b, how: 'name' }) }
  }
  // 2. Filming order, on each measure in turn: the B-roll between a talking
  // take and the next (filmed after its talk), or between the one before
  // and it (filmed before its talk), whichever pairs more.
  for (const scale of ['filmed', 'name', 'drive'] as const) {
    const As = aRoll.filter((a) => !byA.has(a.id) && orderOf(a)?.scale === scale).sort((x, y) => orderOf(x)!.at - orderOf(y)!.at)
    const Bs = bRoll.filter((b) => !used.has(b.id) && orderOf(b)?.scale === scale).sort((x, y) => orderOf(x)!.at - orderOf(y)!.at)
    if (!As.length || !Bs.length) continue
    const match = (after: boolean) => {
      const taken = new Set<string>()
      const got = new Map<string, DriveTake>()
      As.forEach((a, i) => {
        const t = orderOf(a)!.at
        const lo = after ? t : i > 0 ? orderOf(As[i - 1])!.at : -Infinity
        const hi = after ? (i + 1 < As.length ? orderOf(As[i + 1])!.at : Infinity) : t
        // The nearest one to its talk inside the window.
        const inside = Bs.filter((b) => !taken.has(b.id) && orderOf(b)!.at > lo && orderOf(b)!.at < hi)
        const b = after ? inside[0] : inside[inside.length - 1]
        if (b) { taken.add(b.id); got.set(a.id, b) }
      })
      return got
    }
    const after = match(true), before = match(false)
    const best = before.size > after.size ? before : after
    for (const [aId, b] of best) { used.add(b.id); byA.set(aId, { b, how: scale === 'filmed' ? 'filmed' : 'order' }) }
  }
  // 3. Nothing to go by but the count: as many of each, in the order picked.
  const leftA = aRoll.filter((a) => !byA.has(a.id))
  const leftB = bRoll.filter((b) => !used.has(b.id))
  if (leftA.length && leftA.length === leftB.length && leftA.every((a) => orderOf(a) == null) && leftB.every((b) => orderOf(b) == null)) {
    leftA.forEach((a, i) => { used.add(leftB[i].id); byA.set(a.id, { b: leftB[i], how: 'order' }) })
  }
  return aRoll.map((a) => {
    const got = byA.get(a.id)
    return { a, b: got?.b ?? null, how: got?.how ?? 'none', kind: kindOf(a), product: productFromName(a.name) }
  })
}

/** The B-roll files no talking take was paired with. Pure. */
export function unpaired(pairs: Pair[], bRoll: DriveTake[]): DriveTake[] {
  const used = new Set(pairs.map((p) => p.b?.id).filter(Boolean))
  return bRoll.filter((b) => !used.has(b.id))
}
