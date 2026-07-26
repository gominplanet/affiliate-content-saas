#!/usr/bin/env python3
# © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
#
# DIFF-import Amazon's Creator Connections campaigns CSV export into the shared
# cc_campaign_catalog table (migration 161). Run locally:
#
#   python3 scripts/import-cc-catalog.py campaign/affiliate_campaigns_full.csv
#
# WHY THIS IS A DIFF NOW (2026-07 rewrite): the old script re-UPSERTED every
# kept row (~570k) on every run — a ~2-hour, half-million-row write storm that
# drained the Supabase Disk IO budget (throttled DB, slow/unresponsive app).
# This version:
#   1. Loads the campaign_id + content_hash of every existing row (cheap reads).
#   2. Streams the CSV and only WRITES rows that are NEW or actually CHANGED
#      (content_hash differs). Unchanged campaigns are skipped — zero writes.
#   3. DELETEs only the campaigns that truly left the export (set difference),
#      instead of the old imported_at purge (which would nuke the rows we now
#      intentionally don't re-touch).
#   4. Throttles writes (SLEEP_MS between batches) so sustained disk IO stays
#      under the compute tier's baseline and the budget never drains.
# Most weeks few campaigns change, so runs drop from ~2 hours to minutes and the
# IO footprint collapses. Requires migration: cc_campaign_catalog.content_hash.
#
# MIN_COMMISSION: only campaigns paying at least this % are STORED. Deal Radar's
# cross-check and the finder's rulebook only ever surface paying campaigns, so
# storing 0% rows was hundreds of thousands of rows of pure IO for nothing.
# Default 10. Override with CC_MIN_COMMISSION. Set 0 to store everything.

import csv, hashlib, json, os, re, sys, time, urllib.request, urllib.parse
from datetime import date, datetime

MIN_COMMISSION = float(os.environ.get('CC_MIN_COMMISSION', '10'))
BATCH = 500
# Delay between write batches (ms) to keep sustained disk IO under baseline.
SLEEP_MS = int(os.environ.get('CC_SLEEP_MS', '150'))
# Page size for reading existing hashes (PostgREST caps at 1000 by default).
READ_PAGE = 1000

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def env(name):
    vals = {}
    path = os.path.join(REPO, name)
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, v = line.split('=', 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals

E = {**env('.env.vercel'), **env('.env.local')}  # .env.local wins
URL = E.get('NEXT_PUBLIC_SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
KEY = E.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
if not URL or not KEY:
    sys.exit('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local)')

HEADERS = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}

def _throttle():
    if SLEEP_MS > 0: time.sleep(SLEEP_MS / 1000.0)

def load_existing_hashes():
    """campaign_id -> content_hash for every stored row (paged, read-only)."""
    out, offset = {}, 0
    while True:
        url = f'{URL}/rest/v1/cc_campaign_catalog?select=campaign_id,content_hash&limit={READ_PAGE}&offset={offset}'
        req = urllib.request.Request(url, headers=HEADERS, method='GET')
        rows = json.loads(urllib.request.urlopen(req, timeout=120).read())
        if not rows: break
        for r in rows:
            out[r['campaign_id']] = r.get('content_hash')
        offset += len(rows)
        if len(rows) < READ_PAGE: break
        if offset % 50000 == 0: print(f'  read {offset:,} existing…', flush=True)
    return out

def upsert(rows):
    req = urllib.request.Request(
        f'{URL}/rest/v1/cc_campaign_catalog?on_conflict=campaign_id',
        data=json.dumps(rows).encode(),
        headers={**HEADERS, 'Content-Type': 'application/json',
                 'Prefer': 'resolution=merge-duplicates,return=minimal'},
        method='POST')
    urllib.request.urlopen(req, timeout=60).read()
    _throttle()

def delete_ids(ids):
    # Quote each id (campaign ids contain dots) for the PostgREST in.() list.
    quoted = ','.join('"' + i.replace('"', '') + '"' for i in ids)
    url = f'{URL}/rest/v1/cc_campaign_catalog?campaign_id=in.({urllib.parse.quote(quoted, safe="(),")})'
    req = urllib.request.Request(url, headers={**HEADERS, 'Prefer': 'return=minimal'}, method='DELETE')
    urllib.request.urlopen(req, timeout=120).read()
    _throttle()

def parse_num(s):
    s = (s or '').replace('%', '').replace(',', '').strip()
    try: return float(s)
    except: return None

def parse_date(s):
    s = (s or '').strip()[:10]
    try: datetime.strptime(s, '%Y-%m-%d'); return s
    except: return None

def content_hash(row):
    """Stable hash of the MUTABLE stored fields — decides new/changed vs skip.
    asins is sorted so a reordered export doesn't look like a change."""
    sig = {
        'campaign_name': row['campaign_name'], 'brand_name': row['brand_name'],
        'asins': sorted(row['asins']), 'commission_pct': row['commission_pct'],
        'starts_at': row['starts_at'], 'ends_at': row['ends_at'],
        'budget': row['budget'], 'budget_remaining': row['budget_remaining'],
        'available_slot': row['available_slot'], 'total_slot': row['total_slot'],
    }
    return hashlib.sha1(json.dumps(sig, sort_keys=True, default=str).encode()).hexdigest()

def stream(f):
    for line in f:
        yield line.replace('\0', '')  # the export carries a stray NUL line

def main(path):
    today = date.today().isoformat()
    csv.field_size_limit(10_000_000)
    print(f'MIN_COMMISSION={MIN_COMMISSION:g}%  SLEEP_MS={SLEEP_MS}', flush=True)
    print('Loading existing catalog hashes…', flush=True)
    existing = load_existing_hashes()
    print(f'  {len(existing):,} rows already in catalog', flush=True)

    n = written = skipped_unchanged = skipped_comm = skipped_ended = skipped_bad = 0
    batch, seen = [], set()
    t0 = time.time()
    with open(path, newline='', encoding='utf-8-sig', errors='replace') as f:
        for raw in csv.DictReader(stream(f)):
            n += 1
            try:
                cid = (raw.get('Campaign Id') or '').strip()
                asins = re.findall(r'B0[A-Z0-9]{8}', raw.get('ASIN List') or '')
                comm = parse_num(raw.get('Commission Rate'))
                ends = parse_date(raw.get('Campaign End Date'))
                if not cid or not asins or comm is None or not ends or cid in seen:
                    skipped_bad += 1; continue
                if comm < MIN_COMMISSION: skipped_comm += 1; continue
                if ends < today: skipped_ended += 1; continue
                seen.add(cid)
                row = {
                    'campaign_id': cid,
                    'campaign_name': (raw.get('Campaign Name') or '').strip()[:500] or '(unnamed)',
                    'brand_name': ((raw.get('Brand Name') or '').strip()[:200]) or None,
                    'asins': asins[:100],
                    'commission_pct': comm,
                    'starts_at': parse_date(raw.get('Campaign Start Date')),
                    'ends_at': ends,
                    'budget': parse_num(raw.get('Campaign Budget')),
                    'budget_remaining': parse_num(raw.get('Budget Remaining')),
                    'available_slot': int(parse_num(raw.get('Available Slot')) or 0),
                    'total_slot': int(parse_num(raw.get('Total Slot')) or 0),
                }
                h = content_hash(row)
                if existing.get(cid) == h:
                    skipped_unchanged += 1; continue   # already current — no write
                row['content_hash'] = h
                batch.append(row)
                written += 1
                if len(batch) >= BATCH:
                    upsert(batch); batch = []
                    if written % 10000 < BATCH:
                        print(f'  {written:,} written ({n:,} scanned, {skipped_unchanged:,} unchanged, {time.time()-t0:.0f}s)', flush=True)
            except Exception:
                skipped_bad += 1
    if batch: upsert(batch)

    # Delete only campaigns that truly left the export (set difference).
    removed = [cid for cid in existing.keys() if cid not in seen]
    for i in range(0, len(removed), 200):
        delete_ids(removed[i:i+200])

    print(f'Diff import done: {written:,} written, {skipped_unchanged:,} unchanged, {len(removed):,} removed '
          f'({n:,} scanned · below {MIN_COMMISSION:g}%: {skipped_comm:,} · ended: {skipped_ended:,} · bad/dup: {skipped_bad:,}) '
          f'in {time.time()-t0:.0f}s')
    print('Done.')

if __name__ == '__main__':
    arg = sys.argv[1] if len(sys.argv) > 1 else 'campaign/affiliate_campaigns_full.csv'
    path = arg if os.path.isabs(arg) else os.path.join(REPO, arg)
    main(path)
