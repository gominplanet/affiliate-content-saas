/**
 * Renders a chat message as markdown with two important behaviors:
 *
 * 1. **In-app routes auto-link.** Bare paths like `/face-training` or
 *    `/setup` that the assistant mentions in plain text get rewritten
 *    to clickable Next.js <Link> components — one click teleports the
 *    user to that page in the dashboard. The system prompt also asks
 *    the assistant to emit explicit markdown links like
 *    `[Face Training](/face-training)`; those work too. Both paths
 *    converge on the same custom <a> renderer below.
 *
 * 2. **External URLs open in a new tab.** Anything starting with http://
 *    or https:// gets `target="_blank"` + `rel="noopener noreferrer"`
 *    so users don't lose their chat session jumping to Hostinger /
 *    Amazon / etc.
 *
 * Bundle note: react-markdown + remark-gfm together are ~80KB
 * gzipped. The /assistant page is already a heavy client component,
 * and this only loads when the user opens the page (the page itself
 * is dynamically routed). Acceptable.
 */

'use client'

import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

/**
 * Canonical list of in-app routes the assistant might mention. Used by
 * preProcessRoutes() to auto-wrap bare paths in markdown links.
 *
 * Keep in sync with sidebar entries in components/layout/DashboardShellV2.tsx
 * and the URL list in lib/assistant-features-doc.ts. Order matters:
 * longer/more-specific routes first so `/setup/wp-doctor` matches before
 * `/setup` does.
 */
const IN_APP_ROUTES = [
  '/setup/wp-doctor',
  '/newsletter/compose',
  '/newsletter/subscribers',
  '/newsletter',
  '/setup',
  '/co-pilot',
  '/content',
  '/brand',
  '/learn',
  '/photobooth',
  '/face-training',
  '/connect-socials',
  '/comparison',
  '/buying-guides',
  '/deals',
  '/collaborations',
  '/script',
  '/assistant',
  '/billing',
  '/dashboard',
  '/customize',
  '/seo',
  '/agency',
  '/community',
] as const

/**
 * Wrap any bare in-app route in a markdown link so the renderer below
 * picks it up. Only wraps tokens that aren't already inside a markdown
 * link (`[text](...)`), inline code (`/path`), or the URL part of an
 * existing markdown link `(url)`.
 *
 * Word-boundary-aware so we don't break `1/2 cup` or paths inside code
 * blocks. Idempotent — running it twice on the same string is a no-op.
 */
function preProcessRoutes(md: string): string {
  let out = md
  for (const route of IN_APP_ROUTES) {
    // (?<![\w\]/`(]) — not preceded by:
    //   * word char (avoids /setup matching inside path-like-this/setup)
    //   * `]`       (the assistant already emitted [text](/path) — don't
    //                touch the URL inside (...))
    //   * `/`       (already inside a deeper path)
    //   * backtick  (`/setup` inline code)
    //   * `(`       (the URL part of an EXISTING markdown link, e.g.
    //                [Face Training](/face-training) — without this
    //                guard the preprocessor would wrap the URL again
    //                and the parser produces a broken nested href.
    //                2026-06-05 bugfix.)
    // (?![\w-]) — followed by a non-word character or string end.
    //   Stops /setup from matching inside /setup-wizard etc.
    const re = new RegExp(
      `(?<![\\w\\]/\`(])${route.replace(/[/\\^$+?.()|[\]{}]/g, '\\$&')}(?![\\w-])`,
      'g',
    )
    out = out.replace(re, `[\`${route}\`](${route})`)
  }
  return out
}

interface Props {
  /** Raw markdown from the assistant. */
  content: string
  /** Optional Tailwind class extras for the wrapper. */
  className?: string
}

export function MessageMarkdown({ content, className = '' }: Props) {
  // Preprocess to catch bare paths the assistant didn't explicitly link.
  const processed = preProcessRoutes(content)

  const components: Components = {
    // Override link rendering — in-app routes use Next Link, externals
    // open in a new tab. Class lists keep the visual style consistent
    // across both types.
    a({ href, children, ...rest }) {
      const h = href ?? ''
      const isInApp = h.startsWith('/')
      const cls = 'text-[#7C3AED] underline underline-offset-2 hover:text-[#6d28d9] transition-colors'
      if (isInApp) {
        return (
          <Link href={h} className={cls}>
            {children}
          </Link>
        )
      }
      return (
        <a href={h} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>
          {children}
        </a>
      )
    },
    // Make markdown look like chat — tighter spacing than default <prose>
    // styles. Tailwind utilities chosen to match the surrounding chat
    // bubble's `text-sm leading-relaxed`.
    h1({ children }) {
      return <h1 className="text-base font-semibold mt-3 mb-1.5 first:mt-0">{children}</h1>
    },
    h2({ children }) {
      return <h2 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0">{children}</h2>
    },
    h3({ children }) {
      return <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>
    },
    p({ children }) {
      return <p className="mb-2 last:mb-0">{children}</p>
    },
    ul({ children }) {
      return <ul className="list-disc list-outside pl-5 mb-2 space-y-0.5 last:mb-0">{children}</ul>
    },
    ol({ children }) {
      return <ol className="list-decimal list-outside pl-5 mb-2 space-y-0.5 last:mb-0">{children}</ol>
    },
    li({ children }) {
      return <li className="leading-snug">{children}</li>
    },
    code({ children, ...rest }) {
      // No `inline` prop in react-markdown v10+; detect via the className
      // (block code blocks come with `language-xxx`). Inline code = no
      // language class.
      const codeClass = (rest as { className?: string }).className || ''
      const isBlock = codeClass.startsWith('language-')
      if (isBlock) {
        return (
          <pre className="bg-black/5 dark:bg-white/10 rounded-md p-2.5 text-[11px] font-mono overflow-x-auto my-2">
            <code>{children}</code>
          </pre>
        )
      }
      return (
        <code className="bg-black/5 dark:bg-white/10 rounded px-1 py-0.5 text-[12px] font-mono">
          {children}
        </code>
      )
    },
    strong({ children }) {
      return <strong className="font-semibold">{children}</strong>
    },
    em({ children }) {
      return <em className="italic">{children}</em>
    },
    hr() {
      return <hr className="my-3 border-black/10 dark:border-white/10" />
    },
    blockquote({ children }) {
      return (
        <blockquote className="border-l-2 border-[#7C3AED]/40 pl-3 my-2 text-[#6e6e73] dark:text-[#ebebf0]">
          {children}
        </blockquote>
      )
    },
    table({ children }) {
      return <table className="border-collapse my-2 text-[12px]">{children}</table>
    },
    th({ children }) {
      return <th className="border border-black/10 dark:border-white/10 px-2 py-1 font-semibold bg-black/5 dark:bg-white/5">{children}</th>
    },
    td({ children }) {
      return <td className="border border-black/10 dark:border-white/10 px-2 py-1">{children}</td>
    },
  }

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  )
}
