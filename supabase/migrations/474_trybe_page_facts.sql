-- What a brand's own TRYBE page says (Seb, 2026-11-25, Chef Preserve: its
-- page said 4.9 from 146 reviews and $500K+ earned; MVP's copy of TRYBE's
-- list said 22 reviews and $50K+). Kept apart from the list copy, which each
-- admin collection replaces whole, and laid over it when brands are listed
-- (lib/trybe-score withPageFacts). Holds { rating, reviews, earnings, at }.
-- Safe to run twice.
alter table public.trybe_directory add column if not exists trybe_page jsonb;
notify pgrst, 'reload schema';
