// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOOKS × BODIES × CTAs (Seb, 2026-11-26: "I'm uploading 3 different hooks,
// and then I'm uploading 3 different bodies, and then I'm uploading 3
// different CTAs, and then I could upload some B-roll, beauty shots of the
// product ... and then having MVP put together everything"; and on why:
// brands spend a little on several videos, keep the one or two that win, and
// scale those, so each video has to be its own test).
//
// Each combination is one video: its hook, body and CTA joined in that order
// (the review editor's take of several files), with B-roll laid over it.
// Three ways to choose them:
//   all    every combination (3 × 3 × 3 = 27);
//   pairs  every hook with every body once, the CTAs taking turns (9): the
//          most different set, since brands mostly test the opening;
//   once   each clip used once (3), the smallest real test.
// Every video is named by what is in it (H2 · B1 · C3), so a winner says
// which hook won.
//
// Pure, so it is tested (scripts/test-edit-studio.ts).

export type MixMode = 'all' | 'pairs' | 'once'
export interface MixCombo { h: number; b: number; c: number | null; label: string }

/** At most this many files in one video (lib/review-edit-server MAX_TAKE_FILES). */
export const MIX_MAX_FILES = 6

export function mixLabel(h: number, b: number, c: number | null): string {
  return `H${h + 1} · B${b + 1}${c != null ? ` · C${c + 1}` : ''}`
}

/** The combinations to make, in order. CTAs may be none (a body that ends
 *  on its own call to action). Pure. */
export function mixCombos(nh: number, nb: number, nc: number, mode: MixMode): MixCombo[] {
  if (nh < 1 || nb < 1 || nc < 0) return []
  const out: MixCombo[] = []
  const cOf = (k: number) => (nc > 0 ? k % nc : null)
  if (mode === 'all') {
    for (let h = 0; h < nh; h++) for (let b = 0; b < nb; b++) {
      if (nc > 0) for (let c = 0; c < nc; c++) out.push({ h, b, c, label: mixLabel(h, b, c) })
      else out.push({ h, b, c: null, label: mixLabel(h, b, null) })
    }
  } else if (mode === 'pairs') {
    for (let h = 0; h < nh; h++) for (let b = 0; b < nb; b++) out.push({ h, b, c: cOf(h + b), label: mixLabel(h, b, cOf(h + b)) })
  } else {
    const n = Math.max(nh, nb, nc)
    for (let k = 0; k < n; k++) out.push({ h: k % nh, b: k % nb, c: cOf(k), label: mixLabel(k % nh, k % nb, cOf(k)) })
  }
  return out
}

/** How many videos each way makes. Pure. */
export function mixCounts(nh: number, nb: number, nc: number): Record<MixMode, number> {
  return { all: mixCombos(nh, nb, nc, 'all').length, pairs: mixCombos(nh, nb, nc, 'pairs').length, once: mixCombos(nh, nb, nc, 'once').length }
}

/** Which B-roll clips a combination uses: all of them when they fit in one
 *  video, else a turn of them, so the videos differ in their B-roll too. Pure. */
export function brollFor(k: number, n: number, max = MIX_MAX_FILES): number[] {
  if (n <= 0) return []
  if (n <= max) return Array.from({ length: n }, (_, i) => i)
  const start = (k * max) % n
  return Array.from({ length: max }, (_, i) => (start + i) % n)
}

export const MIX_WORDS: Record<MixMode, { label: string; says: string }> = {
  all: { label: 'Every combination', says: 'Every hook with every body and every CTA.' },
  pairs: { label: 'Each hook with each body', says: 'The most different set: brands mostly test the opening, and the CTAs take turns.' },
  once: { label: 'Each clip once', says: 'The smallest real test: every clip used one time.' },
}
