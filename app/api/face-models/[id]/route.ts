/**
 * GET    /api/face-models/[id] — poll status (checks Fal if still training)
 * DELETE /api/face-models/[id] — remove a face model + its source files
 *
 * Polling: the client hits this every 10-15 seconds while status='training'.
 * On each poll we ask Fal whether the queued job is done; once it is, we
 * record the resulting LoRA URL and flip status to 'ready'.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { fal } from '@fal-ai/client'

const STORAGE_BUCKET = 'headshots'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: model } = await supabase
    .from('face_models')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // If it's still training, ask Fal whether the job is done. We only
  // mutate the row when the job has actually completed — otherwise we
  // hammer the DB every poll.
  if (model.status === 'training' && model.fal_request_id) {
    const falKey = process.env.FAL_KEY
    if (falKey) fal.config({ credentials: falKey })
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = await (fal as any).queue.status('fal-ai/flux-lora-fast-training', {
        requestId: model.fal_request_id,
        logs: false,
      })
      if (status?.status === 'COMPLETED') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (fal as any).queue.result('fal-ai/flux-lora-fast-training', {
          requestId: model.fal_request_id,
        })
        const loraUrl =
          (result?.data?.diffusers_lora_file?.url as string | undefined)
          || (result?.diffusers_lora_file?.url as string | undefined)
          || null
        if (loraUrl) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await supabase
            .from('face_models')
            .update({ status: 'ready', lora_url: loraUrl, updated_at: new Date().toISOString() })
            .eq('id', id)
          model.status = 'ready'
          model.lora_url = loraUrl
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await supabase
            .from('face_models')
            .update({ status: 'failed', failure_reason: 'Training finished but no LoRA URL returned.', updated_at: new Date().toISOString() })
            .eq('id', id)
          model.status = 'failed'
          model.failure_reason = 'Training finished but no LoRA URL returned.'
        }
      } else if (status?.status === 'FAILED') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase
          .from('face_models')
          .update({ status: 'failed', failure_reason: status.error || 'Training failed.', updated_at: new Date().toISOString() })
          .eq('id', id)
        model.status = 'failed'
        model.failure_reason = status.error || 'Training failed.'
      }
      // Otherwise still IN_QUEUE / IN_PROGRESS — leave the row as-is.
    } catch {
      /* poll error → silently leave status alone, client will retry */
    }
  }

  return NextResponse.json({ model })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Confirm ownership and grab source paths before deleting.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: model } = await supabase
    .from('face_models').select('source_images').eq('id', id).eq('user_id', user.id).single()
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Best-effort cleanup of the original training images.
  const paths = (model.source_images as string[]) || []
  if (paths.length > 0) {
    try { await supabase.storage.from(STORAGE_BUCKET).remove(paths) } catch { /* ignore */ }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase
    .from('face_models').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
