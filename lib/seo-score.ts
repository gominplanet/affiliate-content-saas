// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-post SEO + AEO score. Pure content analysis (no network, no GSC) so every
// post gets a score even before Search Console is connected. The GSC signals
// (indexed?, impressions, position) are layered on in /api/seo/overview.
//
// Each check has a weight; score = round(100 * passedWeight / totalWeight).
// `hint` tells the user (and the future one-click fixer) what to do.

import { extractFaqFromHtml } from '@/lib/seo-schema'

export interface SeoCheck {
  id: string
  label: string
  pass: boolean
  weight: number
  hint?: string
}

export interface SeoScoreInput {
  title: string
  metaDescription?: string | null
  contentHtml: string
  /** The user's site host, to identify INTERNAL links (e.g. gominreviews.com). */
  siteHost?: string | null
  postType?: string // 'review' | 'comparison' | 'guide'
}

export interface SeoScoreResult {
  score: number
  checks: SeoCheck[]
}

function plainText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function scorePostSeo(input: SeoScoreInput): SeoScoreResult {
  const html = input.contentHtml || ''
  const text = plainText(html)
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0
  const title = (input.title || '').trim()
  const meta = (input.metaDescription || '').trim()
  const host = (input.siteHost || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()

  const h2s = (html.match(/<h2[\s>]/gi) || []).length
  const images = html.match(/<img\b[^>]*>/gi) || []
  const imagesWithAlt = images.filter(img => /\balt\s*=\s*["'][^"']+["']/i.test(img)).length

  // Internal links = anchors pointing at the user's own host.
  let internalLinks = 0
  for (const a of html.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi) || []) {
    const m = a.match(/href=["']([^"']+)["']/i)
    const href = m?.[1] || ''
    if (host && (href.includes(host) || href.startsWith('/'))) internalLinks++
  }

  // Answer-first: a substantial paragraph appears BEFORE the first H2 (the
  // direct-answer lead AI Overviews reward), or the first ~600 chars carry
  // a real paragraph of prose.
  const beforeFirstH2 = html.split(/<h2[\s>]/i)[0] || ''
  const leadWords = plainText(beforeFirstH2).split(/\s+/).filter(Boolean).length
  const answerFirst = leadWords >= 30

  const faqCount = (() => { try { return extractFaqFromHtml(html).length } catch { return 0 } })()
  const hasFaq = faqCount > 0 || /frequently asked|<h2[^>]*>\s*FAQ/i.test(html)
  const hasTable = /<table[\s>]|wp:table/i.test(html)
  const hasDisclosure = /(affiliate|commission|as an amazon associate|earn from qualifying)/i.test(text)
  const isComparison = input.postType === 'comparison' || input.postType === 'guide'

  const checks: SeoCheck[] = [
    {
      id: 'title_length', label: 'Title is a good length (30–65 chars)',
      pass: title.length >= 30 && title.length <= 65, weight: 10,
      hint: title.length < 30 ? 'Title is short — add the product + a benefit/year.' : 'Title is long — trim to ~60 chars so it isn’t cut off in results.',
    },
    {
      id: 'meta_description', label: 'Meta description set (70–160 chars)',
      pass: meta.length >= 70 && meta.length <= 160, weight: 10,
      hint: 'Write a 1-sentence meta description that answers the query and invites the click.',
    },
    {
      id: 'word_count', label: 'Enough depth (600+ words)',
      pass: words >= 600, weight: 12,
      hint: 'Add more first-hand detail — testing notes, specs, who it’s for.',
    },
    {
      id: 'headings', label: 'Clear H2 structure (2+ sections)',
      pass: h2s >= 2, weight: 8,
      hint: 'Break the review into scannable H2 sections (Verdict, Pros/Cons, Who it’s for…).',
    },
    {
      id: 'answer_first', label: 'Answer-first intro (AI Overview signal)',
      pass: answerFirst, weight: 14,
      hint: 'Open with a direct 2–3 sentence answer before the first section — this is what AI Overviews quote.',
    },
    {
      id: 'internal_links', label: 'Internal links (2+)',
      pass: internalLinks >= 2, weight: 10,
      hint: 'Link to 2+ of your related reviews to build topical authority.',
    },
    {
      id: 'image_alt', label: 'Images have alt text',
      pass: images.length === 0 || imagesWithAlt >= Math.ceil(images.length / 2), weight: 8,
      hint: 'Add descriptive alt text to your in-article images.',
    },
    {
      id: 'faq', label: 'FAQ section (rich-result + AEO)',
      pass: hasFaq, weight: 12,
      hint: 'Add 3–5 FAQs with direct answers — strong for AI Overviews + FAQ rich results.',
    },
    {
      id: 'disclosure', label: 'Affiliate disclosure present',
      pass: hasDisclosure, weight: 8,
      hint: 'Add a visible affiliate disclosure (FTC requirement + a trust signal).',
    },
    {
      id: 'comparison_table', label: isComparison ? 'Comparison table present' : 'Comparison/spec table',
      // Only weighted for comparison/guide posts; informational for single reviews.
      pass: isComparison ? hasTable : true, weight: isComparison ? 8 : 0,
      hint: 'Add a feature/spec comparison table — tables get cited heavily in AI Overviews.',
    },
  ]

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0) || 1
  const passedWeight = checks.reduce((s, c) => s + (c.pass ? c.weight : 0), 0)
  const score = Math.round((passedWeight / totalWeight) * 100)
  return { score, checks }
}
