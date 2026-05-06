-- Migration 002: Add VidIQ snapshot column to integrations
-- Run in Supabase SQL Editor

alter table public.integrations
  add column if not exists vidiq_snapshot jsonb,
  add column if not exists vidiq_api_key text,
  add column if not exists geniuslink_api_key text;
