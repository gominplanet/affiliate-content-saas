// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AIO (AI Optimization) readiness score — how likely a published post is to be
// QUOTED by an AI answer engine (ChatGPT, Perplexity, Google AI Overviews), not
// just ranked by Google. Answer engines lift content that gives a direct answer
// early, structures Q&A as standalone extractable pairs, cites sources, carries
// a real author + a fresh date, and exposes machine-readable product facts.
//
// This is the visible, tangible half of MVP's AIO push: a 0–100 score with a
// per-check breakdown the creator (and the generator) can act on. Pure + cheap —
// scores the final HTML plus a few schema flags, no network, no model call. The
// generator already produces most of these signals (answer-first lead, FAQ,
// author E-E-A-T, freshness); the score makes that work legible and catches the
// posts that slip through.

export interface AioCheck {
  key: string
  label: string
  pass: boolean
  weight: number
  /** What to change when it fails — shown to the creator. */
  hint: string
}

export interface AioScore {
  score: number            // 0–100
  grade: 'A' | 'B' | 'C' | 'D'
  checks: AioCheck[]
}

export interface AioInput {
  /** Final published post HTML. */
  html: string
  /** Number of Q&A pairs that made it into FAQPage schema. */
  faqCount?: number
  /** A Product/Review node was emitted (machine-readable product facts). */
  hasProductSchema?: boolean
  /** Author carries authority signals (bio / jobTitle / knowsAbout). */
  hasAuthorAuthority?: boolean
  /** dateModified/published present (freshness signal). */
  hasFreshness?: boolean
}

const stripTags = (html: string): string => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** The intro text before the first H2 — the "answer-first" zone. */
function leadText(html: string): string {
  const idx = html.search(/<h2[\s>]/i)
  const head = idx >= 0 ? html.slice(0, idx) : html
  return stripTags(head)
}

export function scoreAio(input: AioInput): AioScore {
  const html = input.html || ''
  const text = stripTags(html)
  const words = text ? text.split(' ').length : 0
  const lead = leadText(html)
  const h2h3 = (html.match(/<h[23][\s>]/gi) || []).length
  const hasTable = /<table[\s>]/i.test(html)
  const hasSpecList = /(pros?|cons?|specs?|specifications?|features?)\b[\s\S]{0,120}<(ul|ol)[\s>]/i.test(html)
  // Outbound citation: a link off the affiliate/self domain, a <cite>, or an
  // attributive phrase ("according to", "source:") — engines trust sourced claims.
  const hasCitation = /<cite[\s>]/i.test(html)
    || /\b(according to|source:|as reported by|per\s+[A-Z])/i.test(text)
    || /<a\s+[^>]*href="https?:\/\/(?!(?:www\.)?amazon\.)/i.test(html)

  const checks: AioCheck[] = [
    {
      key: 'answer_first',
      label: 'Answer-first opening',
      weight: 20,
      pass: lead.length >= 40 && lead.length <= 700,
      hint: 'Open with a tight 2–3 sentence direct answer before the first heading — the block AI engines quote.',
    },
    {
      key: 'faq',
      label: 'Q&A the engine can lift',
      weight: 18,
      pass: (input.faqCount ?? 0) >= 2,
      hint: 'Add a FAQ section (2+ real questions) — it ships as FAQPage schema, the exact shape AI answers pull from.',
    },
    {
      key: 'headings',
      label: 'Scannable structure',
      weight: 12,
      pass: h2h3 >= 3,
      hint: 'Break the post into 3+ clear H2/H3 sections so an engine can map and extract it.',
    },
    {
      key: 'product_facts',
      label: 'Machine-readable product facts',
      weight: 14,
      pass: !!input.hasProductSchema && (hasTable || hasSpecList),
      hint: 'Include a visible specs / pros-cons table mirrored in Product schema — engines extract structured facts first.',
    },
    {
      key: 'author',
      label: 'Author authority (E-E-A-T)',
      weight: 12,
      pass: !!input.hasAuthorAuthority,
      hint: 'Set an author with a short bio + expertise (Voice Training / Brand Profile) — engines weight authored, expert content.',
    },
    {
      key: 'freshness',
      label: 'Freshness signal',
      weight: 10,
      pass: !!input.hasFreshness,
      hint: 'Carry a published/updated date so engines treat the post as current.',
    },
    {
      key: 'citations',
      label: 'Sourced claims',
      weight: 8,
      pass: hasCitation,
      hint: 'Cite a source or link out to authoritative references — sourced content is quoted more often.',
    },
    {
      key: 'depth',
      label: 'Enough substance',
      weight: 6,
      pass: words >= 600,
      hint: 'Aim for 600+ words of real substance so there is something worth quoting.',
    },
  ]

  const earned = checks.reduce((s, c) => s + (c.pass ? c.weight : 0), 0)
  const total = checks.reduce((s, c) => s + c.weight, 0)
  const score = Math.round((earned / total) * 100)
  const grade: AioScore['grade'] = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D'
  return { score, grade, checks }
}
