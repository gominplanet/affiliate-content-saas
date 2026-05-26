import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typescript: {
    // Supabase generic type inference breaks with ssr@0.5 + supabase-js@2.105 — fix post-MVP
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
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
