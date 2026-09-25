#!/usr/bin/env bash
# © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
#
# Run migrations against a throwaway Postgres before pasting them at Seb.
#
# WHY THIS EXISTS. Migration 348 was handed over with a `name[] = text[]`
# comparison in it. Every text-level check passed, the build passed, and it
# failed the moment it hit the Supabase SQL editor with 42883, because
# pg_attribute.attname is the `name` type and nothing in the repo could know
# that from reading a string. A regex cannot type-check SQL. Postgres can.
#
# It applies each file TWICE, because "safe to run twice" is a claim made in
# every one of these messages and it should be a tested claim.
#
#   ./scripts/try-migration.sh supabase/migrations/348_catalogue_multi_market.sql
#   ./scripts/try-migration.sh supabase/migrations/34{7,8}_*.sql
#
# Not wired into `npm run build`: Vercel's build image has no Postgres. This is
# for the machine writing the migration, which does.
set -euo pipefail

BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
if [ -z "$BIN" ]; then echo "No Postgres installed. apt-get install postgresql" >&2; exit 2; fi

D=$(mktemp -d /tmp/trypg.XXXXXX)
trap 'su postgres -c "$BIN/pg_ctl -D $D/data stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
mkdir -p "$D/data" "$D/sock"; chown -R postgres:postgres "$D"

su postgres -c "$BIN/initdb -D $D/data -A trust" >/dev/null
su postgres -c "$BIN/pg_ctl -D $D/data -o '-k $D/sock -h \"\"' -l $D/log start" >/dev/null
for _ in $(seq 20); do su postgres -c "psql -h $D/sock -d postgres -c 'select 1'" >/dev/null 2>&1 && break; sleep 0.5; done

# The pieces of the real schema a migration is likely to reference. Supabase
# supplies auth.users and auth.uid(); the rest are the tables most migrations
# hang off. Add to this rather than making a migration avoid them.
cat > "$D/prelude.sql" <<'SQL'
create schema if not exists auth;
-- Supabase's own roles, which policies are written against.
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table if not exists public.youtube_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, title text, youtube_video_id text, asin text, product_url text,
  thumbnail_url text, description text, transcript text, created_at timestamptz default now()
);
create table if not exists public.integrations (
  user_id uuid primary key, tier text
);
SQL
chmod -R a+rX "$D"
su postgres -c "psql -v ON_ERROR_STOP=1 -h $D/sock -d postgres -q -f $D/prelude.sql"

status=0
for pass in 1 2; do
  echo "── pass $pass ───────────────────────────────────────────────"
  for f in "$@"; do
    cp "$f" "$D/m.sql"; chmod a+r "$D/m.sql"
    # PSQL'S EXIT CODE, not its output. ON_ERROR_STOP makes it non-zero on the
    # first real error, while a clean re-run still prints a page of "already
    # exists, skipping" NOTICEs. An earlier version of this line grepped the
    # output and called every idempotent second pass a failure.
    if out=$(su postgres -c "psql -v ON_ERROR_STOP=1 -h $D/sock -d postgres -q -f $D/m.sql" 2>&1); then
      echo "   ok: $f"
    else
      echo "   FAILED on pass $pass: $f"
      echo "$out" | grep -E 'ERROR|DETAIL|HINT' | head -6 | sed 's/^/      /'
      status=1
    fi
  done
done

if [ $status -eq 0 ]; then
  echo
  echo "Both passes clean. Safe to say it can be run twice."
fi
exit $status
