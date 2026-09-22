import type { NextConfig } from 'next'

// Cache-bust marker (build-cache-bust-4): webpack keys its persistent
// filesystem cache on this config file via buildDependencies, so changing this
// file forces Vercel to fully invalidate the restored .next/cache and rebuild
// from scratch, the git equivalent of a no-cache redeploy.
//
// bust-2 cleared a stale client-reference manifest that dropped
// content/page.tsx#default after a new client component entered its import
// graph.
//
// bust-3 cleared the production lane after a682505 was killed at Vercel's
// 45-minute ceiling. Same code, same build command, one lane green and one lane
// dead, so: a cache, not a compile. It worked, and it left the question of why
// the cache went bad unanswered. The note ended "if a production build fails
// again after this commit the theory is wrong". It did, so here is the measured
// answer rather than a fourth guess.
//
// bust-4. Production stuck on bc86968 while four commits sat undeployed:
//
//   bc86968  production Ready  5m05
//   3c65a2b  production Error  7m38
//   16e7903  production Error 46m11   killed at the ceiling
//   4d8c1e9  production Building 32m+
//   38a0ee4  production Building 22m+
//
// 38a0ee4 builds green from a deleted .next in 3m36 on an ordinary container:
// 120 test suites, a 51s compile, type check, 446 static pages. Nothing in the
// code takes 46 minutes. What does is this, measured on that build:
//
//   .next/cache/webpack      1.2 GB
//   .next/cache/fetch-cache   24 KB
//   .next/cache/swc           12 KB
//
// Vercel's build cache ceiling is 1 GB. The webpack pack cache passed it as the
// app grew, so every build now writes a cache too big to be stored whole and
// restores whatever fragment survived. Deserializing a truncated pack cache is
// what the 22 and 32 minute builds were doing, and a build killed mid-write is
// what leaves the next one a worse fragment. That is the loop, and busting the
// marker only resets it until the cache crosses 1 GB again, which it does on the
// first build.
//
// So the cache is off for production builds below. It buys a 51 second compile
// that was already inside the 3m36, and it removes the only piece of state that
// differs between a lane that builds and a lane that does not. Dev keeps its
// cache: that one lives on the machine, is never uploaded, and is the one place
// the speed is actually felt.

const nextConfig: NextConfig = {
  typescript: {
    // Was `true`, with a note about Supabase generic inference breaking under
    // ssr@0.5 + supabase-js@2.105, to be fixed post-MVP. That fix happened
    // somewhere along the way: the codebase is type-clean and a build with this
    // off gets through "Checking validity of types" and on to page generation.
    //
    // Leaving the escape hatch open meant type errors could not fail a deploy,
    // so the only thing gating production was the test suite below `build`.
    // Good as that is, it cannot catch a bad type. Turning this back on costs
    // nothing today and makes the next regression a failed build rather than a
    // runtime surprise on someone's account.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Native Node addons that ship .node binaries — webpack can't bundle these,
  // they must be loaded at runtime from node_modules. Adding here tells
  // Next.js to leave them alone in the server bundle.
  //   @resvg/resvg-js → Rust SVG→PNG renderer (used by designer text overlays)
  //   sharp           → libvips image processor
  serverExternalPackages: ['@resvg/resvg-js', 'sharp'],
  // Force-include @fontsource font files in the serverless function bundle.
  // We load them at runtime via require.resolve(), which Vercel's bundler
  // can't statically detect — so without this, the .woff files don't ship
  // with the function and Satori errors at render time. Globbing every
  // @fontsource subpackage's `files/*.woff` so adding new fonts later
  // doesn't require updating this list.
  outputFileTracingIncludes: {
    '/api/admin/designer-text-test': ['./node_modules/@fontsource/**/files/*.woff'],
    // Live YouTube thumbnail flow uses the designer overlay too — needs the
    // same font files bundled or Satori errors on missing glyphs. Also needs
    // the bundled Anton TTF (lib/fonts/) for opentype.js text-to-path bake.
    '/api/youtube/generate-thumbnail': [
      './node_modules/@fontsource/**/files/*.woff',
      './lib/fonts/*.ttf',
    ],
  },
  // Tree-shake big barrel packages (lucide-react is imported in ~38 files);
  // only the icons actually used get bundled. Near-zero risk, big bundle win.
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  // Production builds do not keep a webpack filesystem cache. See bust-4 at the
  // top of this file: it had grown to 1.2 GB against Vercel's 1 GB ceiling, so
  // what came back on each build was a fragment, and reading a fragment is
  // slower than compiling from nothing. Off, a production build is honest about
  // its cost every time. Dev is left alone deliberately.
  webpack(config, { dev }) {
    if (!dev) config.cache = false
    return config
  },
  // Old route slug → new. The YouTube Co-Pilot page moved from /studio to
  // /co-pilot (its real product name); 308-redirect so old bookmarks and any
  // stale links still land on the page.
  async redirects() {
    return [
      { source: '/studio', destination: '/co-pilot', permanent: true },
    ]
  },
  // ── /freeguide → the static file in public/ ───────────────────────────────
  //
  // The free Amazon Influencer guide is ONE self-contained HTML file with its
  // own inline CSS and JS, its own <title>, description, canonical and Open
  // Graph tags. It is not a React page and must not become one: rebuilding it
  // as JSX would mean re-styling it, and the root layout's metadata would sit
  // on top of the tags it already carries.
  //
  // A file at public/freeguide/index.html is served by Next at
  // /freeguide/index.html and nowhere else, so this rewrites the clean URL onto
  // it. A rewrite and not a redirect, so the address bar keeps /freeguide and
  // the canonical tag in the file agrees with what the visitor sees.
  //
  // /freeguide/ with the trailing slash is handled before this, by Next's own
  // trailing-slash normalisation, which 308s it to /freeguide.
  //
  // MIDDLEWARE RUNS FIRST. A rewrite here cannot help a request the auth gate
  // has already bounced to /login, which is why '/freeguide' is also in
  // publicPaths in middleware.ts. That ordering has caught this codebase out
  // before: see the note about mvpl.ink below.
  async rewrites() {
    return [
      { source: '/freeguide', destination: '/freeguide/index.html' },
    ]
  },
  // NOTE: the Passport Links short domain (mvpl.ink/<code> → /go/<code>) is
  // handled in middleware.ts, not here — it must run BEFORE the auth gate, and a
  // next.config rewrite runs after middleware, so a logged-out clicker was being
  // bounced to /login. See the passport-host block in middleware.ts.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
      // Generated-image CDNs (fal / replicate / Google storage) so dashboard
      // thumbnails can move from raw <img> to next/image over time.
      { protocol: 'https', hostname: 'fal.media' },
      { protocol: 'https', hostname: '**.fal.media' },
      { protocol: 'https', hostname: 'fal.run' },
      { protocol: 'https', hostname: '**.fal.run' },
      { protocol: 'https', hostname: 'replicate.delivery' },
      { protocol: 'https', hostname: '**.replicate.delivery' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
    ],
  },
}

export default nextConfig
