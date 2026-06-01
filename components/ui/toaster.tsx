// MVP Affiliate — toast notifications via sonner.
//
// Mounts a single <Toaster /> in the dashboard layout. Throughout the
// app, fire toasts with the `toast` API from 'sonner':
//
//   import { toast } from 'sonner'
//   toast.success('Brand saved')
//   toast.error('Save failed', { description: e.message })
//   toast.loading('Generating thumbnail…', { id: 'thumb' })
//   toast.success('Thumbnail ready', { id: 'thumb' })  // same id replaces
//
// Theme-aware via next-themes. richColors gives success/error built-in
// color treatments. Position top-right keeps toasts away from the
// bottom-stacked action bars on /content and /seo.

'use client'

import { Toaster as SonnerToaster } from 'sonner'
import { useTheme } from 'next-themes'

export function Toaster() {
  const { resolvedTheme } = useTheme()
  return (
    <SonnerToaster
      theme={(resolvedTheme as 'light' | 'dark') || 'light'}
      position="top-right"
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        // Sonner inherits app font automatically via CSS variables in body;
        // we just need to tighten the radius to match our card primitive.
        className: 'rounded-xl',
      }}
    />
  )
}
