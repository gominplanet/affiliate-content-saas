// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BLOG POST'S WORDPRESS TAGS, CHECKED AGAINST THE POST (Seb, 2026-10-20:
// "anything that MVP creates as far as tagging and hashtags, let's make sure
// that it runs through this kind of engine ... I don't want to hear from users
// that the hashtags are poor").
//
// The writer used to name ten tags and the first six or ten went to WordPress
// as written. Now the post's main keyword (confirmed by a search box when
// lib/keyword-research found one) and its supporting searches lead, and the
// writer's tags follow only when they are about the post: every real word in
// a tag is a word of the post (lib/search-suggest matchesContent). No years,
// no hashtags, no sentence. Pure; tested in scripts/test-tag-coverage.

import { matchesContent, contentVocab, cleanSearch } from '@/lib/search-suggest'

const YEAR = /\b(?:19|20)\d\d\b/

/** The tags to send, at most `max`, the keyword and its searches first. */
export function postTags(input: { tags: unknown; title: string; content?: string | null; keyword?: string | null; supporting?: string[] | null; max?: number }): string[] {
  const max = input.max ?? 6
  const text = `${input.title || ''}\n${String(input.content || '').replace(/<[^>]+>/g, ' ')}`
  const vocab = contentVocab(text)
  const out: string[] = []
  const add = (raw: unknown) => {
    const t = cleanSearch(String(raw ?? '').replace(/^#+/, ''))
    if (!t || t.length > 40 || YEAR.test(t) || t.split(' ').length > 4 || out.includes(t)) return
    if (!matchesContent(t, vocab)) return
    out.push(t)
  }
  add(input.keyword)
  for (const s of input.supporting || []) add(s)
  for (const t of Array.isArray(input.tags) ? input.tags : []) add(t)
  return out.slice(0, max)
}
