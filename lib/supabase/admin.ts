/**
 * Service-role Supabase client.
 *
 * Use this ONLY in server-side code paths that need to bypass Row-Level
 * Security (RLS) — most importantly Stripe webhooks, where there is no
 * authenticated user cookie. NEVER expose this client to the browser.
 *
 * Requires the SUPABASE_SERVICE_ROLE_KEY environment variable, which is the
 * `service_role` secret found in your Supabase project's API settings.
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

let _admin: ReturnType<typeof createClient<Database>> | null = null

export function createAdminClient() {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local and Vercel env vars. ' +
      'Find it in Supabase Dashboard → Project Settings → API → service_role key.',
    )
  }
  _admin = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _admin
}
