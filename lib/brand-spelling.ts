// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BRAND NAMES ARE NEVER ALTERED.
//
// A post is written from the video's transcript, and a transcript spells a
// brand the way it sounds: COOFANDY became "Kofandi" in the title, the
// address, the text and the shop list. The brand as Amazon lists it (Keepa's
// brand field, else the listing) is the only spelling that counts, so every
// sound-alike of it is put back to that spelling before the post is saved.
//
// Sound-alike, carefully: the same consonant skeleton (c/k/q alike, vowels,
// y, h and w ignored, doubles collapsed), a close edit distance, and a word
// written as a name (capitalised). A multi-word brand is matched as a whole
// phrase (or run together as one word), never word by word, so "Bird" is not
// turned into "Beard" because the brand is Beard Club.

const skeleton = (w: string) => w.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')
  .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/[cq]/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's')
  .replace(/[aeiouyhw]/g, '').replace(/(.)\1+/g, '$1')

const letters = (w: string) => w.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  }
  return d[a.length][b.length]
}

/** Is `candidate` (one word or a phrase) a mis-hearing of `brand`? */
export function soundsLikeBrand(candidate: string, brand: string): boolean {
  const c = letters(candidate), b = letters(brand)
  if (!c || !b || c === b) return false
  const sk = skeleton(brand)
  if (sk.length < 3 || skeleton(candidate) !== sk) return false
  // Compared as heard: c/k/q one sound, y an i, doubled letters single. Then
  // nearly the same length and at most a letter or two apart. "Kofandi" and
  // "COOFANDY" become the same word; "Anchor" and "Anker", or "Sharp" and
  // "SHARPIE", stay different.
  const heard = (w: string) => w.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/[cq]/g, 'k').replace(/y/g, 'i').replace(/(.)\1+/g, '$1')
  const hc = heard(c), hb = heard(b)
  if (Math.abs(hc.length - hb.length) > 1) return false
  return distance(hc, hb) <= Math.max(1, Math.floor(hb.length * 0.34))
}

/** Every sound-alike of the brand in `text`, put back to the brand's own
 *  spelling. Text only: HTML tags and URLs are left alone. Returns the text
 *  and what was replaced, so the change can be recorded. */
export function fixBrandSpelling(text: string, brand: string | null | undefined): { text: string; replaced: string[] } {
  const official = String(brand || '').trim()
  if (!text || !official || official.length < 3) return { text, replaced: [] }
  const words = official.split(/\s+/)
  const n = words.length
  const replaced = new Set<string>()
  // Candidate runs: n capitalised words (the phrase), or one capitalised word
  // (the brand run together). Only outside tags and URLs.
  const WORD = "[A-Z][A-Za-z0-9'&.-]*"
  const phrase = new RegExp(`\\b${Array(n).fill(WORD).join('\\s+')}\\b`, 'g')
  const single = new RegExp(`\\b${WORD}\\b`, 'g')
  const fixRun = (seg: string) => {
    let out = seg
    for (const re of n > 1 ? [phrase, single] : [single]) {
      out = out.replace(re, (m) => {
        const bare = m.replace(/[.'-]+$/, '')
        if (soundsLikeBrand(bare, official)) { replaced.add(bare); return official + m.slice(bare.length) }
        return m
      })
    }
    return out
  }
  // Split on tags and URLs, fix only the text between them.
  const parts = text.split(/(<[^>]*>|https?:\/\/[^\s"'<>]+)/g)
  const out = parts.map((p, i) => (i % 2 === 1 ? p : fixRun(p))).join('')
  return { text: out, replaced: [...replaced] }
}

/** The same for a URL slug (lowercase, hyphenated). */
export function fixBrandInSlug(slug: string, brand: string | null | undefined): string {
  const official = String(brand || '').trim()
  if (!slug || !official) return slug
  const want = letters(official)
  const parts = slug.split('-')
  const n = official.split(/\s+/).length
  for (let i = 0; i < parts.length; i++) {
    for (const len of n > 1 ? [n, 1] : [1]) {
      const cand = parts.slice(i, i + len).join(' ')
      if (cand && soundsLikeBrand(cand, official)) { parts.splice(i, len, want); break }
    }
  }
  return parts.join('-')
}
