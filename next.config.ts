import type { NextConfig } from 'next'

// Cache-bust marker (build-cache-bust-3): webpack keys its persistent
// filesystem cache on this config file via buildDependencies, so changing this
// file forces Vercel to fully invalidate the restored .next/cache and rebuild
// from scratch, the git equivalent of a no-cache redeploy.
//
// bust-2 cleared a stale client-reference manifest that dropped
// content/page.tsx#default after a new client component entered its import
// graph.
//
// bust-3 clears the production lane after a682505 was killed at Vercel's
// 45-minute ceiling. Vercel caches per lane, and every production build since
// that kill has failed in under three and a half minutes while the identical
// commit built green as a preview:
//
//   a74de65  production Ready 4m21
//   a682505  production Error 46m11   preview Ready  4m29
//   4a3b5f2e production Error  3m24   preview Ready 14m10
//   6ec78c9f production Error  2m40   preview Ready  5m12
//
// Same code, same build command, same test suites, one lane green and one lane
// dead. That is a cache, not a compile. If a production build fails again after
// this commit the theory is wrong and the build log is the next thing to read.

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
  // Old route slug → new. The YouTube Co-Pilot page moved from /studio to
  // /co-pilot (its real product name); 308-redirect so old bookmarks and any
  // stale links still land on the page.
  async redirects() {
    return [
      { source: '/studio', destination: '/co-pilot', permanent: true },
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
