-- 047 — Per-user LoRA face models for premium thumbnail face inclusion
--
-- A trained LoRA captures one specific person's identity across many
-- shots / angles / lighting conditions. The user uploads 10-20 of
-- their own headshots, we ship them to Fal's flux-lora-fast-training
-- endpoint, and store the resulting weights URL here. Future thumbnail
-- generations prepend the user's trigger token in the prompt and load
-- the LoRA at inference time so their actual face appears (not a
-- generic AI hallucination).
--
-- Pro-only feature — gated at the route layer, not in this schema.

create table if not exists public.face_models (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  /** Human-readable name the user gives the face ("Me", "My partner"). */
  name            text not null,
  /** Short trigger word the AI uses in prompts (e.g. "sebmvp123").
   *  Must be unique per user — multiple words in the same prompt cause
   *  identity blending. Generated server-side from the name. */
  trigger_token   text not null,
  /** Lifecycle:
   *    uploading  — user is dropping files; we haven't kicked off training
   *    training   — Fal job is running (typically 5-15 minutes)
   *    ready      — lora_url is populated and the face can be used
   *    failed     — training errored; failure_reason carries the message */
  status          text not null default 'uploading'
                  check (status in ('uploading', 'training', 'ready', 'failed')),
  /** Public URL Fal returns for the trained LoRA weights. Loaded at
   *  inference time via the lora_url input on the Flux endpoint. */
  lora_url        text,
  /** Fal job id — used to poll status and to debug failed training runs. */
  fal_request_id  text,
  /** Free-form Supabase Storage paths to the 10-20 source images. We
   *  hold these around so the user can re-train with the same set if a
   *  Fal API change requires it. */
  source_images   jsonb not null default '[]'::jsonb,
  failure_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, trigger_token)
);

create index if not exists face_models_user_idx on public.face_models (user_id, created_at desc);

alter table public.face_models enable row level security;

create policy "Users can read their own face models"
  on public.face_models for select
  using (auth.uid() = user_id);

create policy "Users can manage their own face models"
  on public.face_models for all
  using (auth.uid() = user_id);
