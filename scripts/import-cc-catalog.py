#!/usr/bin/env python3
# © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
#
# Stream-import Amazon's Creator Connections campaigns CSV export into the
# shared cc_campaign_catalog table (migration 161). Run locally:
#
#   python3 scripts/import-cc-catalog.py campaign/affiliate_campaigns_full.csv
#
# - STREAMS the file (never loads it in memory) — handles the ~300MB export.
# - Filters to RULE-PASSING campaigns only (commission >= 15%, still running,
#   has a campaign id + >= 1 ASIN) — 678k rows in, ~241k lean rows stored.
# - Upserts in batches of 500 via Supabase REST (service role from .env.local).
# - Rows not touched by this import (campaigns that left the catalog) are
#   purged at the end by imported_at < run start.

import csv, json, os, re, sys, time, urllib.request
from datetime import date, datetime, timezone

MIN_COMMISSION = 15.0
BATCH = 500

# Repo root = the script's parent dir's parent (scripts/ → repo). Makes env +
# CSV paths work no matter the cwd (background runs start in $HOME).
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

E = {**env('.env.vercel'), **env('.env.local')}  # .env.local wins (has the service key we just added)
URL = E.get('NEXT_PUBLIC_SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
KEY = E.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
if not URL or not KEY:
    sys.exit('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local)')

def post(rows):
    req = urllib.request.Request(
        f'{URL}/rest/v1/cc_campaign_catalog?on_conflict=campaign_id',
        data=json.dumps(rows).encode(),
        headers={
            'apikey': KEY, 'Authorization': f'Bearer {KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        }, method='POST')
    urllib.request.urlopen(req, timeout=60).read()

def purge_older_than(iso):
    req = urllib.request.Request(
        f'{URL}/rest/v1/cc_campaign_catalog?imported_at=lt.{iso}',
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Prefer': 'return=minimal'},
        method='DELETE')
    urllib.request.urlopen(req, timeout=120).read()

def parse_num(s):
    s = (s or '').replace('%', '').replace(',', '').strip()
    try: return float(s)
    except: return None

def parse_date(s):
    s = (s or '').strip()[:10]
    try: datetime.strptime(s, '%Y-%m-%d'); return s
    except: return None

def stream(f):
    for line in f:
        yield line.replace('\0', '')  # the export carries a stray NUL line

def main(path):
    run_start = datetime.now(timezone.utc).isoformat()
    today = date.today().isoformat()
    csv.field_size_limit(10_000_000)
    n = kept = skipped_comm = skipped_ended = skipped_bad = 0
    batch, seen = [], set()
    t0 = time.time()
    with open(path, newline='', encoding='utf-8-sig', errors='replace') as f:
        for row in csv.DictReader(stream(f)):
            n += 1
            try:
                cid = (row.get('Campaign Id') or '').strip()
                asins = re.findall(r'B0[A-Z0-9]{8}', row.get('ASIN List') or '')
                comm = parse_num(row.get('Commission Rate'))
                ends = parse_date(row.get('Campaign End Date'))
                if not cid or not asins or comm is None or not ends or cid in seen:
                    skipped_bad += 1; continue
                if comm < MIN_COMMISSION: skipped_comm += 1; continue
                if ends < today: skipped_ended += 1; continue
                seen.add(cid)
                batch.append({
                    'campaign_id': cid,
                    'campaign_name': (row.get('Campaign Name') or '').strip()[:500] or '(unnamed)',
                    'brand_name': ((row.get('Brand Name') or '').strip()[:200]) or None,
                    'asins': asins[:100],
                    'commission_pct': comm,
                    'starts_at': parse_date(row.get('Campaign Start Date')),
                    'ends_at': ends,
                    'budget': parse_num(row.get('Campaign Budget')),
                    'budget_remaining': parse_num(row.get('Budget Remaining')),
                    'available_slot': int(parse_num(row.get('Available Slot')) or 0),
                    'total_slot': int(parse_num(row.get('Total Slot')) or 0),
                })
                kept += 1
                if len(batch) >= BATCH:
                    post(batch); batch = []
                    if kept % 10000 < BATCH:
                        print(f'  {kept:,} imported ({n:,} scanned, {time.time()-t0:.0f}s)', flush=True)
            except Exception as e:
                skipped_bad += 1
    if batch: post(batch)
    print(f'Import done: {kept:,} kept of {n:,} rows '
          f'(below {MIN_COMMISSION:.0f}%: {skipped_comm:,} · ended: {skipped_ended:,} · bad/dup: {skipped_bad:,}) '
          f'in {time.time()-t0:.0f}s')
    print('Purging rows from previous imports…')
    purge_older_than(run_start)
    print('Done.')

if __name__ == '__main__':
    arg = sys.argv[1] if len(sys.argv) > 1 else 'campaign/affiliate_campaigns_full.csv'
    path = arg if os.path.isabs(arg) else os.path.join(REPO, arg)
    main(path)
