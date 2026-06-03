/**
 * /docs/api — Public-facing API documentation. Server Component (static):
 * lists every /api/v1/* endpoint with its method, path, params, response
 * shape, and a curl example.
 *
 * Linked from /developers (the API key management page). Also indexable
 * — agency / power-user customers will Google "MVP Affiliate API" and
 * land here.
 */

import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'

export const metadata = {
  title: 'API Docs — MVP Affiliate',
  description: 'REST API for the MVP Affiliate content platform. Pro-tier access.',
}

export default function ApiDocsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">
      <header className="space-y-2">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} /> Home
        </Link>
        <h1 className="text-3xl font-bold">MVP Affiliate API</h1>
        <p className="text-gray-600">
          REST API for programmatic access to your MVP content. Pro tier only. Bearer-token auth on
          every endpoint, plus a public health probe.
        </p>
      </header>

      <Section title="Getting started">
        <ol className="list-decimal pl-5 space-y-2 text-sm text-gray-700">
          <li>
            Go to <InlineLink href="/developers">/developers</InlineLink> in your dashboard.
          </li>
          <li>Click <b>Create new key</b>, name it (e.g. "Zapier production"), and copy the secret. <b>You'll only see it once.</b></li>
          <li>Use it as a Bearer token on every request — see examples below.</li>
        </ol>
      </Section>

      <Section title="Base URL">
        <Code>https://www.mvpaffiliate.io/api/v1</Code>
        <p className="text-sm text-gray-600 mt-2">All endpoints below are relative to this base.</p>
      </Section>

      <Section title="Authentication">
        <p className="text-sm text-gray-700 mb-3">
          Every protected endpoint requires an <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">Authorization: Bearer &lt;your-key&gt;</code> header.
          Keys start with <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">mvp_live_</code> so you can grep them out of logs.
        </p>
        <Code>{`curl https://www.mvpaffiliate.io/api/v1/me \\
  -H "Authorization: Bearer mvp_live_..."`}</Code>
      </Section>

      <Section title="Errors">
        <p className="text-sm text-gray-700 mb-3">
          All errors return JSON like <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{`{ "error": "...", "code": "..." }`}</code>.
        </p>
        <table className="text-sm w-full border">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-2 border-r">Status</th>
              <th className="p-2 border-r">Code</th>
              <th className="p-2">Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="p-2 border-t border-r">401</td><td className="p-2 border-t border-r font-mono text-xs">missing_bearer</td><td className="p-2 border-t">No Authorization header.</td></tr>
            <tr><td className="p-2 border-t border-r">401</td><td className="p-2 border-t border-r font-mono text-xs">invalid_format</td><td className="p-2 border-t">Token doesn't start with <code className="text-xs">mvp_live_</code>.</td></tr>
            <tr><td className="p-2 border-t border-r">401</td><td className="p-2 border-t border-r font-mono text-xs">unknown_key</td><td className="p-2 border-t">Key not recognised, or revoked.</td></tr>
            <tr><td className="p-2 border-t border-r">403</td><td className="p-2 border-t border-r font-mono text-xs">tier_not_allowed</td><td className="p-2 border-t">Tier downgraded — re-upgrade to Pro.</td></tr>
            <tr><td className="p-2 border-t border-r">404</td><td className="p-2 border-t border-r font-mono text-xs">not_found</td><td className="p-2 border-t">Resource doesn't exist, or doesn't belong to you.</td></tr>
          </tbody>
        </table>
      </Section>

      <Endpoint
        method="GET"
        path="/health"
        auth={false}
        description="Public probe. Returns ok + the API version. Cacheable. Use this in setup docs to verify network reach."
        response={`{ "ok": true, "version": "v1" }`}
      />

      <Endpoint
        method="GET"
        path="/me"
        description="Current user info, tier, and monthly quotas. The hello-world of the API surface."
        response={`{
  "user": { "id": "...", "email": "you@example.com", "name": "...", "tier": "pro" },
  "limits": {
    "blogPostsPerMonth": 100,
    "thumbnailsPerMonth": 200,
    "scriptsPerMonth": 50,
    "assistantMessagesPerMonth": 500,
    "allowedSocials": ["facebook", "twitter", "linkedin", "pinterest", "instagram", "threads", "tiktok"]
  }
}`}
      />

      <Endpoint
        method="GET"
        path="/blog-posts"
        description="List your blog posts, newest first. Cursor-paginated."
        params={[
          { name: 'status', type: 'string?', notes: 'Filter: published | draft | failed | pending' },
          { name: 'limit', type: 'number?', notes: 'Default 50, max 100' },
          { name: 'cursor', type: 'string?', notes: 'ISO created_at — fetch older than this' },
        ]}
        response={`{
  "data": [
    {
      "id": "uuid",
      "title": "...",
      "slug": "...",
      "status": "published",
      "post_type": "review",
      "wordpress_post_id": 1234,
      "wordpress_url": "https://...",
      "published_at": "2026-06-01T...",
      "created_at": "2026-06-01T..."
    }
  ],
  "nextCursor": "2026-05-30T..." // or null if no more
}`}
      />

      <Endpoint
        method="GET"
        path="/blog-posts/{id}"
        description="Fetch a single blog post including its HTML body and metadata."
        response={`{
  "data": {
    "id": "uuid",
    "title": "...",
    "slug": "...",
    "status": "published",
    "post_type": "review",
    "content": "<p>...</p>",
    "meta_description": "...",
    "wordpress_post_id": 1234,
    "wordpress_url": "https://...",
    "hero_image_url": "https://...",
    "published_at": "...",
    "created_at": "...",
    "updated_at": "..."
  }
}`}
      />

      <Section title="Coming soon">
        <ul className="list-disc pl-5 space-y-1.5 text-sm text-gray-700">
          <li><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">POST /v1/blog-posts</code> — generate from a YouTube URL</li>
          <li><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">GET /v1/thumbnails</code> — list generated thumbnails</li>
          <li><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">POST /v1/thumbnails</code> — generate from a video id</li>
          <li><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">GET /v1/scripts</code> — list video scripts</li>
        </ul>
      </Section>

      <Section title="Support">
        <p className="text-sm text-gray-700">
          Issues or feature requests? Email{' '}
          <a href="mailto:support@mvpaffiliate.io" className="text-[#7C3AED] hover:underline">
            support@mvpaffiliate.io
          </a>{' '}
          with the request and any error response codes you're seeing.
        </p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold mb-3">{title}</h2>
      {children}
    </section>
  )
}

function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[#7C3AED] hover:underline inline-flex items-center gap-0.5">
      {children}<ExternalLink size={11} />
    </Link>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-gray-900 text-gray-100 text-sm rounded-lg p-3 overflow-x-auto"><code>{children}</code></pre>
  )
}

function Endpoint({
  method, path, auth = true, description, params, response,
}: {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH'
  path: string
  auth?: boolean
  description: string
  params?: Array<{ name: string; type: string; notes: string }>
  response: string
}) {
  return (
    <section className="border rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 border-b flex items-center gap-2">
        <span
          className="px-2 py-0.5 rounded text-xs font-semibold font-mono"
          style={{ background: method === 'GET' ? '#10b981' : method === 'POST' ? '#3b82f6' : '#ef4444', color: 'white' }}
        >
          {method}
        </span>
        <code className="text-sm font-mono">{path}</code>
        {!auth && <span className="text-xs text-gray-500 ml-auto">(no auth)</span>}
      </div>
      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-700">{description}</p>
        {params && params.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              Query params
            </h4>
            <table className="text-sm w-full">
              <tbody>
                {params.map(p => (
                  <tr key={p.name}>
                    <td className="py-1 pr-3 font-mono text-xs">{p.name}</td>
                    <td className="py-1 pr-3 text-xs text-gray-500">{p.type}</td>
                    <td className="py-1 text-gray-700">{p.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
            Response
          </h4>
          <Code>{response}</Code>
        </div>
      </div>
    </section>
  )
}
