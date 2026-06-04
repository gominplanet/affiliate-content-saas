// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// POST /api/deals/parse-csv
//
// Accepts a CSV file (Amazon Creator Connections deals export) as
// multipart/form-data, parses it server-side via lib/amazon-deals-csv,
// returns the parsed rows + warnings.
//
// We parse server-side (not client-side) so:
//   - The 5MB FormData limit applies to the raw CSV bytes, not the
//     post-parse JSON (~3x bigger).
//   - We can size-cap + sanity-check before shipping rows over the wire.
//   - Same parser is reachable from other server flows (e.g. a future
//     "import via URL" path or a scheduled CSV pull from Amazon's API).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { parseDealsCsv } from '@/lib/amazon-deals-csv'

export const maxDuration = 30
export const runtime = 'nodejs'

// 5MB cap — Amazon CSVs in the wild are 50-500 rows, well under 1MB.
// Larger uploads almost certainly mean the user picked the wrong file
// (e.g. analytics export instead of the deals CSV).
const MAX_CSV_BYTES = 5 * 1024 * 1024
// Reject if rows exceeds this — even a tier=admin user typing into the
// CSV picker probably doesn't want to scroll through 10,000 deals.
const MAX_ROWS = 2000

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Tier gate — Deals Hub is Studio + Pro + Admin only, the CSV picker
  // shares the same gate.
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  if (tier !== 'studio' && tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({
      error: 'CSV upload requires the Studio or Pro tier.',
      code: 'tier_not_allowed',
    }, { status: 403 })
  }

  // Read the multipart body.
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a "file" field.' }, { status: 400 })
  }
  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file uploaded. Attach the CSV under field name "file".' }, { status: 400 })
  }
  const f = file as File
  if (f.size > MAX_CSV_BYTES) {
    return NextResponse.json({
      error: `File is ${Math.round(f.size / 1024 / 1024)}MB, the cap is ${Math.round(MAX_CSV_BYTES / 1024 / 1024)}MB. Make sure this is the deals CSV (usually under 1MB), not an analytics export.`,
      code: 'too_large',
    }, { status: 400 })
  }
  // Best-effort MIME check. Browsers + Excel + Numbers exports sometimes
  // send application/octet-stream, so we don't hard-fail on type alone
  // — name extension is the more reliable signal.
  const looksLikeCsv =
    /\.csv$/i.test(f.name || '') ||
    f.type === 'text/csv' ||
    f.type === 'application/csv'
  if (!looksLikeCsv) {
    return NextResponse.json({
      error: `Expected a .csv file. Got "${f.name || f.type || 'unknown'}".`,
      code: 'bad_type',
    }, { status: 400 })
  }

  let text: string
  try {
    text = await f.text()
  } catch (err) {
    return NextResponse.json({
      error: `Couldn't read the uploaded file: ${err instanceof Error ? err.message : 'unknown error'}.`,
    }, { status: 400 })
  }

  // Parse.
  const result = parseDealsCsv(text)
  if (result.errors.length > 0) {
    return NextResponse.json({
      error: result.errors.join(' '),
      warnings: result.warnings,
      headers: result.headers,
      code: 'parse_failed',
    }, { status: 400 })
  }

  if (result.rows.length > MAX_ROWS) {
    return NextResponse.json({
      error: `CSV has ${result.rows.length} rows. The cap is ${MAX_ROWS}. Split the file and upload in batches.`,
      code: 'too_many_rows',
    }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    rows: result.rows,
    warnings: result.warnings,
    totalRows: result.totalRows,
    fileName: f.name,
    fileSize: f.size,
  })
}
