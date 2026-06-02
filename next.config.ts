import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typescript: {
    // Supabase generic type inference breaks with ssr@0.5 + supabase-js@2.105 — fix post-MVP
    ignoreBuildErrors: true,
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
    // Add other API routes here once we wire the designer overlay into them
    // (youtube/generate-thumbnail, etc.).
  },
  // Tree-shake big barrel packages (lucide-react is imported in ~38 files);
  // only the icons actually used get bundled. Near-zero risk, big bundle win.
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
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
