'use client'

import { useMemo } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

export function useSupabase() {
  return useMemo(() => createBrowserClient(), [])
}
