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
//
// ONE VIDEO, SEVERAL FILES (Seb, 2026-11-02: "what if i have two files and
// they should be for the same video", "users should be able to let MVP
// know.. these files are for video #1.. and so on"). A video of the batch is
// one or more talking files, joined in the order they were filmed, and any
// number of B-roll files. MVP's first guess joins talking takes filmed back
// to back (batchVideos); the creator then says which video each file is for
// (moveFile), and the video server joins them (ingest-service join-takes).

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

export interface Pair { a: DriveTake; b: DriveTake | null; how: 'name' | 'filmed' | 'order' | 'none' | 'you'; kind: VideoKind; product: string }

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

// ── One video, several files ─────────────────────────────────────────────────

/** One video of a batch: its talking files, joined in this order, and its
 *  B-roll files. `apart`: when MVP joined talking files because they were
 *  filmed back to back, the longest gap between them in seconds (said on the
 *  page, so a join MVP guessed is never mistaken for one the creator made). */
export interface BatchVideo { a: DriveTake[]; b: DriveTake[]; how: Pair['how']; apart: number | null; kind: VideoKind; product: string }

/** The most files one take is joined from (lib/review-edit-server MAX_TAKE_FILES). */
export const MAX_FILES = 6
/** Talking takes are guessed to be one video when the next one was started
 *  this soon after the last one stopped. */
export const JOIN_GAP_SEC = 45

/** Talking takes filmed back to back, as one video each (Seb's IMG_0097 and
 *  IMG_0098). Only on the filming time read from the files (a file number
 *  says nothing about the gap), and only when the next was started within
 *  JOIN_GAP_SEC of the last one stopping, filmed the same way up, with no
 *  B-roll filmed in between and names that do not name two products. Every
 *  talking take is in the answer once, in the order picked. Pure. */
export function backToBack(aRoll: DriveTake[], bRoll: DriveTake[]): { files: DriveTake[]; apart: number | null }[] {
  const filmedAt = (t: DriveTake) => (orderOf(t)?.scale === 'filmed' ? orderOf(t)!.at : null)
  const timed = aRoll.filter((t) => filmedAt(t) != null).sort((x, y) => filmedAt(x)! - filmedAt(y)!)
  const bTimes = bRoll.map(filmedAt).filter((x): x is number => x != null)
  const chainOf = new Map<string, { files: DriveTake[]; apart: number | null }>()
  let cur: { files: DriveTake[]; apart: number | null } | null = null
  for (const t of timed) {
    const prev = cur?.files[cur.files.length - 1]
    if (cur && prev) {
      const gap = (filmedAt(t)! - filmedAt(prev)!) / 1000 - (prev.seconds ?? Infinity)
      const named = baseName(prev.name) && baseName(t.name) && baseName(prev.name) !== baseName(t.name)
      const brollBetween = bTimes.some((b) => b > filmedAt(prev)! && b < filmedAt(t)!)
      if (gap >= -10 && gap <= JOIN_GAP_SEC && kindOf(prev) === kindOf(t) && !named && !brollBetween && cur.files.length < MAX_FILES) {
        cur.files.push(t)
        cur.apart = Math.max(cur.apart ?? 0, Math.max(0, Math.round(gap)))
        chainOf.set(t.id, cur)
        continue
      }
    }
    cur = { files: [t], apart: null }
    chainOf.set(t.id, cur)
  }
  const out: { files: DriveTake[]; apart: number | null }[] = []
  const seen = new Set<object>()
  for (const t of aRoll) {
    const c = chainOf.get(t.id) ?? { files: [t], apart: null }
    if (seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

/** MVP's first guess at the batch's videos: talking takes filmed back to
 *  back joined, then each video paired with its B-roll (pairTakes, on its
 *  first file). Pure. */
export function batchVideos(aRoll: DriveTake[], bRoll: DriveTake[]): BatchVideo[] {
  const chains = backToBack(aRoll, bRoll)
  const pairs = pairTakes(chains.map((c) => c.files[0]), bRoll)
  return chains.map((c, i) => ({ a: c.files, b: pairs[i].b ? [pairs[i].b!] : [], how: pairs[i].how, apart: c.files.length > 1 ? c.apart : null, kind: pairs[i].kind, product: pairs[i].product }))
}

/** Files in the order they were filmed when that is known for all of them
 *  on one measure, else by name (IMG_0097 before IMG_0098). Pure. */
export function filmingOrder(files: DriveTake[]): DriveTake[] {
  const o = files.map(orderOf)
  if (o.every((x) => x && x.scale === o[0]!.scale)) return [...files].sort((x, y) => orderOf(x)!.at - orderOf(y)!.at)
  return [...files].sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }))
}

/** A file moved to another video (`to` is its number from 0), to a new
 *  video of its own just after ('new', talking files), or out of every video ('none',
 *  B-roll). A talking file stays a talking file and B-roll stays B-roll; a
 *  video left with no talking file is gone, and its B-roll unused. A video
 *  takes up to MAX_FILES of each. Files land in filming order. Pure. */
export function moveFile(videos: BatchVideo[], fileId: string, to: number | 'new' | 'none', pool: DriveTake[] = []): BatchVideo[] {
  const fromA = videos.find((v) => v.a.some((f) => f.id === fileId))
  const talk = fromA?.a.find((f) => f.id === fileId) ?? null
  const roll = talk ? null : videos.flatMap((v) => v.b).find((f) => f.id === fileId) ?? pool.find((f) => f.id === fileId) ?? null
  const file = talk ?? roll
  if (!file) return videos
  const target = typeof to === 'number' ? videos[to] : null
  if (typeof to === 'number' && !target) return videos
  if (target && (talk ? target.a : target.b).some((f) => f.id === fileId)) return videos
  if (target && (talk ? target.a : target.b).length >= MAX_FILES) return videos
  if (talk && to === 'none') return videos
  if (roll && to === 'new') return videos
  // Out of where it was.
  let next = videos.map((v) => ({ ...v, a: v.a.filter((f) => f.id !== fileId), b: v.b.filter((f) => f.id !== fileId) }))
  const at = (v: BatchVideo) => next[videos.indexOf(v)]
  const into = target ? at(target) : null
  if (talk && into) { into.a = filmingOrder([...into.a, talk]); into.apart = null }
  if (roll && into) { into.b = filmingOrder([...into.b, roll]); into.how = 'you' }
  if (talk && fromA && fromA !== target) at(fromA).apart = null
  // A new video goes straight after the one the file came from.
  if (talk && to === 'new') next.splice(videos.indexOf(fromA!) + 1, 0, { a: [talk], b: [], how: 'none', apart: null, kind: kindOf(talk), product: productFromName(talk.name) })
  next = next.filter((v) => v.a.length > 0)
  next.forEach((v) => { if (!v.b.length) v.how = 'none' })
  return next
}

/** A talking file one place earlier in its video. Pure. */
export function moveUp(videos: BatchVideo[], fileId: string): BatchVideo[] {
  return videos.map((v) => {
    const i = v.a.findIndex((f) => f.id === fileId)
    if (i < 1) return v
    const a = [...v.a];
    [a[i - 1], a[i]] = [a[i], a[i - 1]]
    return { ...v, a }
  })
}

/** B-roll files in no video. Pure. */
export function unusedBroll(videos: BatchVideo[], bRoll: DriveTake[]): DriveTake[] {
  const used = new Set(videos.flatMap((v) => v.b.map((f) => f.id)))
  return bRoll.filter((b) => !used.has(b.id))
}

/** How long a video's talking files are together, when every length is known. Pure. */
export function talkSeconds(v: BatchVideo): number | null {
  return v.a.every((f) => typeof f.seconds === 'number') ? v.a.reduce((n, f) => n + (f.seconds as number), 0) : null
}

/** What the add action is sent for one video: its first file, then `more`. Pure. */
export function addBody(v: BatchVideo): { review: { driveId: string; name: string; more?: { driveId: string; name: string }[] }; broll?: { driveId: string; name: string; more?: { driveId: string; name: string }[] } } {
  const take = (files: DriveTake[]) => ({ driveId: files[0].id, name: files[0].name, ...(files.length > 1 ? { more: files.slice(1).map((f) => ({ driveId: f.id, name: f.name })) } : {}) })
  return { review: take(v.a), ...(v.b.length ? { broll: take(v.b) } : {}) }
}
