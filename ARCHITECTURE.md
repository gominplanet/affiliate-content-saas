# AffiliateOS — Architecture

## Stack
| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Styling | Tailwind CSS (Apple-inspired design system) |
| Auth + DB | Supabase (Postgres + Row-Level Security) |
| Deployment | Vercel (zero-config) |
| AI — Blog | Anthropic Claude (`services/claude`) |
| AI — Social | Google Gemini (`services/gemini`) |
| CMS | WordPress REST API (`services/wordpress`) |
| Hosting | Hostinger (`services/hostinger`) |
| Video source | YouTube Data API v3 (`services/youtube`) |

---

## Folder structure

```
app/
  (auth)/              # Public — login, signup
  (dashboard)/         # Protected — all app pages
    dashboard/         # /dashboard — metrics home
    content/           # /content — videos + content status
    brand/             # /brand — brand voice profile
    drafts/            # /drafts — social draft preview & approval
    settings/          # /settings — profile, API keys, notifications
    admin/failures/    # /admin/failures — failed job inspector
  api/
    auth/callback/     # Supabase OAuth callback

components/
  auth/                # LoginForm, SignupForm
  layout/              # Sidebar, Header (shared shell)
  ui/                  # Design-system primitives (future)
  content/             # Content-page-specific components
  brand/               # Brand-page-specific components
  admin/               # Admin-page-specific components

lib/
  supabase/
    client.ts          # Browser client (for 'use client' components)
    server.ts          # Server client (for Server Components + actions)
    middleware.ts      # Middleware client (session refresh)
  types/
    database.ts        # Full typed DB schema (mirrors Supabase)
  utils.ts             # cn(), formatNumber(), relativeTime()…

services/              # External API wrappers (not AI-generated yet)
  youtube/             # Video sync, transcript fetch
  wordpress/           # Post create/publish/update
  hostinger/           # Domain & hosting management
  claude/              # Blog post + social draft generation
  gemini/              # Alternative generation + transcript summary

hooks/
  useUser.ts           # Reactive current user
  useSupabase.ts       # Browser Supabase client memo

supabase/
  schema.sql           # Full idempotent schema (source of truth)
  migrations/          # Version-stamped migration files

middleware.ts          # Route protection + session refresh
```

---

## Data flow (V2 target)

```
YouTube Sync Job
  └─► youtube_videos table
        └─► Blog Generation Job (Claude)
              ├─► blog_posts table
              │     └─► WP Publish Job
              │           └─► blog_posts.wordpress_url
              └─► Social Draft Job (Gemini / Claude)
                    └─► social_drafts table (status: pending)
                          └─► User approves in /drafts
                                └─► Social Publish Job (V3)
```

---

## Auth

Supabase Email/Password auth. The middleware refreshes sessions on every request.
Protected routes: everything except `/login`, `/signup`, `/api/auth`.

A `profiles` row is created automatically via Postgres trigger on `auth.users` insert.

---

## V1 scope (this skeleton)

- [x] Auth-ready app shell (login, signup, middleware guard)
- [x] Dashboard with mock metrics
- [x] Content page grouped by YouTube video
- [x] Brand profile editor
- [x] Settings (profile, integrations, notifications)
- [x] Social draft preview + approve/reject UI
- [x] Admin failures table with expandable error detail
- [x] Database schema with RLS
- [x] Service folder stubs for all external APIs

## V2 (next)

- [ ] Real YouTube sync cron job
- [ ] Transcript fetching
- [ ] Claude blog generation pipeline
- [ ] WordPress auto-publish
- [ ] Gemini social draft generation
- [ ] Supabase Edge Function job queue

## V3

- [ ] Stripe billing
- [ ] Social platform publishing (Buffer / direct APIs)
- [ ] Multi-channel support
- [ ] Analytics dashboard
