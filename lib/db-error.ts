/**
 * Server-side error reporting so failures stop being silent.
 *
 * The YouTube-disconnect bug ran broken for a long time because the code ignored
 * a Supabase error and returned success. Supabase writes DON'T throw on a bad
 * column / RLS deny / constraint — they resolve with an { error } you have to
 * check. When callers don't, the failure is invisible.
 *
 * reportDbError() logs to the console AND best-effort persists to app_errors
 * (migration 245) via the service-role client, so an admin can see recent
 * failures instead of waiting for a support ticket. It NEVER throws — a logger
 * must not become the thing that breaks the request.
 *
 * checkedWrite() is the ergonomic wrapper for the common pattern: run a Supabase
 * write, report if it errored, return whether it succeeded.
 */
import { createAdminClient } from '@/lib/supabase/admin'

function messageOf(error: unknown): string {
  if (!error) return 'unknown error'
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

export function reportDbError(
  context: string,
  error: unknown,
  meta?: { userId?: string | null } & Record<string, unknown>,
): void {
  const message = messageOf(error)
  // Always log — visible in Vercel function logs even if the DB insert fails.
  // eslint-disable-next-line no-console
  console.error(`[db-error] ${context}: ${message}`, meta ?? '')
  try {
    const userId = (meta?.userId as string | null | undefined) ?? null
    const rest = { ...(meta ?? {}) }
    delete (rest as { userId?: unknown }).userId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (createAdminClient() as any)
      .from('app_errors')
      .insert({
        context: context.slice(0, 200),
        message: message.slice(0, 2000),
        user_id: userId,
        meta: Object.keys(rest).length ? rest : null,
      })
      .then((res: { error?: { message?: string } | null }) => {
        if (res?.error) console.error(`[db-error] failed to persist "${context}": ${res.error.message}`)
      })
  } catch {
    /* never throw from the logger */
  }
}

/**
 * Await a Supabase write, report (don't throw) if it errored, and return whether
 * it succeeded. Use for writes where a silent failure would break the user:
 *
 *   const ok = await checkedWrite('youtube.disconnect.clear',
 *     sb.from('integrations').update({ ... }).eq('user_id', userId), { userId })
 *   if (!ok) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
 */
export async function checkedWrite(
  context: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: PromiseLike<{ error: any }>,
  meta?: { userId?: string | null } & Record<string, unknown>,
): Promise<boolean> {
  const { error } = await query
  if (error) {
    reportDbError(context, error, meta)
    return false
  }
  return true
}
