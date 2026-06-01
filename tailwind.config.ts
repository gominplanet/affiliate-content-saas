import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Legacy "apple.*" token names retained so any existing consumers
        // keep working — the values were re-skinned to the new violet
        // brand accent (matching the --accent CSS var in globals.css).
        apple: {
          blue: '#7C3AED',
          'blue-hover': '#6D28D9',
          gray: '#f5f5f7',
          'gray-mid': '#d2d2d7',
          text: '#18181B',
          'text-secondary': '#52525B',
          'text-tertiary': '#71717A',
          red: '#ff3b30',
          green: '#34c759',
          orange: '#ff9500',
          yellow: '#ffcc00',
        },
      },
      fontFamily: {
        // Inter Variable + Geist Mono are loaded via next/font in app/layout.tsx
        // and exposed as CSS variables. System-font fallback ONLY kicks in if
        // next/font fails (rare) — never serves a different font to Windows /
        // Android users like the old SF Pro stack did.
        sans: [
          'var(--font-sans)',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'var(--font-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'monospace',
        ],
      },
      boxShadow: {
        'apple-sm': '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        'apple-md': '0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)',
        'apple-lg': '0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.04)',
      },
      borderRadius: {
        apple: '12px',
        'apple-lg': '18px',
        'apple-xl': '24px',
      },
    },
  },
  plugins: [],
}

export default config
