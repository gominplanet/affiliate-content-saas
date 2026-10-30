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
//   2. else filming order: the B-roll filmed after a talking take and
//      before the next one, by the camera's file number or the time in its
//      name, then by when it reached Drive.
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
}

export interface Pair { a: DriveTake; b: DriveTake | null; how: 'name' | 'order' | 'none'; kind: VideoKind; product: string }

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

const orderOf = (t: DriveTake): number | null => filmedKey(t.name) ?? (t.createdAt ? Date.parse(t.createdAt) || null : null)

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
  // 2. Filming order: the B-roll after a talking take and before the next.
  const sortedA = [...aRoll].filter((a) => !byA.has(a.id) && orderOf(a) != null).sort((x, y) => orderOf(x)! - orderOf(y)!)
  const freeB = () => bRoll.filter((b) => !used.has(b.id) && orderOf(b) != null).sort((x, y) => orderOf(x)! - orderOf(y)!)
  // Only compare like with like: camera numbers with numbers, times with times.
  const sameScale = (x: DriveTake, y: DriveTake) => (filmedKey(x.name) != null) === (filmedKey(y.name) != null)
  sortedA.forEach((a, i) => {
    const next = sortedA[i + 1]
    const b = freeB().find((x) => sameScale(a, x) && orderOf(x)! > orderOf(a)! && (!next || !sameScale(a, next) || orderOf(x)! < orderOf(next)!))
    if (b) { used.add(b.id); byA.set(a.id, { b, how: 'order' }) }
  })
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
