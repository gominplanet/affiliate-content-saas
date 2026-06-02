/**
 * /admin/encrypt-secrets — one-click admin UI for the secrets encryption
 * migration. Wraps the /api/admin/run-encryption-migration route + the
 * /api/admin/check-crypto-key diagnostic, so the operator never needs
 * to touch a terminal or a browser console.
 *
 * Flow:
 *   1. Page loads → auto-runs the key check, shows ✓ or ✗ at the top.
 *   2. "Run dry-run" button → shows per-table counts of what would change.
 *   3. "Encrypt for real" button (disabled until a dry-run is done) → runs
 *      the actual migration. Shows post-run counts.
 *
 * Admin-only by virtue of the underlying API routes; if a non-admin
 * loads this page, every fetch returns 403 and the UI shows the error.
 */
'use client'

import { Fragment, useEffect, useState } from 'react'
import Header from '@/components/layout/Header'
import {
  Lock, ShieldCheck, AlertCircle, Loader2, Sparkles, ChevronRight,
} from 'lucide-react'

interface MigrationSummaryRow {
  table: string
  rows: number
  encrypted: number
  skipped: number
  errors: number
  /** Postgres error message when the read itself fails (whole table
   *  failed, not per-row). Helps diagnose "which column is missing /
   *  which policy is blocking." */
  errorMessage?: string
}

interface MigrationResponse {
  ok: boolean
  dryRun?: boolean
  summary?: MigrationSummaryRow[]
  note?: string
  error?: string
  detail?: string
}

interface CryptoCheckResponse {
  ok: boolean
  keyBytes?: number
  prefix?: string
  roundTrip?: string
  note?: string
  error?: string
}

export default function EncryptSecretsAdminPage() {
  const [keyCheck, setKeyCheck] = useState<CryptoCheckResponse | null>(null)
  const [keyChecking, setKeyChecking] = useState(true)

  const [dryRunResult, setDryRunResult] = useState<MigrationResponse | null>(null)
  const [dryRunBusy, setDryRunBusy] = useState(false)

  const [realRunResult, setRealRunResult] = useState<MigrationResponse | null>(null)
  const [realRunBusy, setRealRunBusy] = useState(false)
  const [realRunConfirmStep, setRealRunConfirmStep] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/check-crypto-key')
      .then(r => r.json())
      .then((data) => { if (!cancelled) setKeyCheck(data) })
      .catch((e) => { if (!cancelled) setKeyCheck({ ok: false, error: e instanceof Error ? e.message : String(e) }) })
      .finally(() => { if (!cancelled) setKeyChecking(false) })
    return () => { cancelled = true }
  }, [])

  async function runDryRun() {
    setDryRunBusy(true)
    setDryRunResult(null)
    try {
      const r = await fetch('/api/admin/run-encryption-migration?dryRun=1', { method: 'POST' })
      const data: MigrationResponse = await r.json()
      setDryRunResult(data)
    } catch (e) {
      setDryRunResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setDryRunBusy(false)
    }
  }

  async function runReal() {
    setRealRunBusy(true)
    setRealRunResult(null)
    try {
      const r = await fetch('/api/admin/run-encryption-migration', { method: 'POST' })
      const data: MigrationResponse = await r.json()
      setRealRunResult(data)
      setRealRunConfirmStep(false)
    } catch (e) {
      setRealRunResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setRealRunBusy(false)
    }
  }

  const keyOk = keyCheck?.ok === true
  const dryRunSuccess = dryRunResult?.ok === true
  // Can only run for real if (a) key is OK and (b) a dry-run has succeeded
  // so the operator has reviewed the row counts first.
  const canRunReal = keyOk && dryRunSuccess && !realRunBusy && !realRunResult?.ok

  return (
    <>
      <Header
        title="Encrypt secrets at rest"
        subtitle="One-time migration: encrypts every WordPress credential + social OAuth token in the database with AES-256-GCM. Idempotent — already-encrypted rows are skipped."
      />

      {/* ── 1. Key check banner ─────────────────────────────────────────── */}
      <div className="mb-6">
        {keyChecking ? (
          <div className="card p-4 flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-[#7C3AED]" />
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">Checking MVP_CRYPTO_KEY…</p>
          </div>
        ) : keyOk ? (
          <div className="card p-4 border border-[#34c759]/30 bg-[#34c759]/5">
            <p className="text-sm font-semibold text-[#34c759] flex items-center gap-2">
              <ShieldCheck size={15} /> Encryption key is loaded and valid
            </p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-1">
              Format: <code className="font-mono">{keyCheck?.prefix}</code> · Key length: {keyCheck?.keyBytes} bytes · Round-trip: {keyCheck?.roundTrip}
            </p>
          </div>
        ) : (
          <div className="card p-4 border border-[#ff3b30]/30 bg-[#ff3b30]/5">
            <p className="text-sm font-semibold text-[#ff3b30] flex items-center gap-2">
              <AlertCircle size={15} /> MVP_CRYPTO_KEY not loaded
            </p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-1">
              {keyCheck?.error ?? 'Set MVP_CRYPTO_KEY in Vercel (Sensitive, all envs) and redeploy, then refresh this page.'}
            </p>
          </div>
        )}
      </div>

      {/* ── 2. Dry-run section ──────────────────────────────────────────── */}
      <section className="card p-5 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              Step 1 — Dry run (no writes)
            </h2>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
              Inspects every row in <code>integrations</code>, <code>wordpress_sites</code>, and <code>social_accounts</code>.
              Reports how many secret columns would be encrypted. Nothing changes in the database.
            </p>
          </div>
          <button
            onClick={runDryRun}
            disabled={!keyOk || dryRunBusy}
            className="btn-secondary text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {dryRunBusy ? (
              <><Loader2 size={13} className="animate-spin" /> Running…</>
            ) : (
              <>Run dry run <ChevronRight size={13} /></>
            )}
          </button>
        </div>

        {dryRunResult && (
          dryRunResult.ok ? (
            <ResultPanel result={dryRunResult} />
          ) : (
            <div className="border border-[#ff3b30]/30 bg-[#ff3b30]/5 rounded-lg p-3">
              <p className="text-sm font-semibold text-[#ff3b30] mb-1">Dry run failed</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{dryRunResult.error || 'Unknown error'}</p>
              {dryRunResult.detail && (
                <p className="text-[11px] text-[#86868b] mt-1 font-mono">{dryRunResult.detail}</p>
              )}
            </div>
          )
        )}
      </section>

      {/* ── 3. Real-run section ─────────────────────────────────────────── */}
      <section className="card p-5 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
              Step 2 — Encrypt for real
            </h2>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
              Only enabled once the dry run has succeeded. Encrypts every plaintext secret in place. Idempotent — re-runs skip already-encrypted rows.
              After this completes, the data on disk is AES-256-GCM ciphertext; reads transparently decrypt.
            </p>
          </div>
          {!realRunConfirmStep ? (
            <button
              onClick={() => setRealRunConfirmStep(true)}
              disabled={!canRunReal}
              className="btn-primary text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #C026D3 100%)' }}
            >
              {realRunResult?.ok ? (
                <><Sparkles size={13} /> Completed</>
              ) : (
                <><Lock size={13} /> Encrypt for real</>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRealRunConfirmStep(false)}
                className="px-3 py-2 rounded-lg text-xs text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
              >
                Cancel
              </button>
              <button
                onClick={runReal}
                disabled={realRunBusy}
                className="btn-primary text-sm whitespace-nowrap"
                style={{ background: 'linear-gradient(135deg, #ff3b30 0%, #d70015 100%)' }}
              >
                {realRunBusy ? (
                  <><Loader2 size={13} className="animate-spin" /> Encrypting…</>
                ) : (
                  <>Yes, encrypt now</>
                )}
              </button>
            </div>
          )}
        </div>

        {!keyOk && (
          <p className="text-[11px] text-[#86868b] mt-2">⚠️ Disabled — MVP_CRYPTO_KEY isn&apos;t loaded.</p>
        )}
        {keyOk && !dryRunSuccess && (
          <p className="text-[11px] text-[#86868b] mt-2">⚠️ Disabled — run the dry run first so you can review what will change.</p>
        )}

        {realRunResult && (
          realRunResult.ok ? (
            <ResultPanel result={realRunResult} />
          ) : (
            <div className="border border-[#ff3b30]/30 bg-[#ff3b30]/5 rounded-lg p-3 mt-3">
              <p className="text-sm font-semibold text-[#ff3b30] mb-1">Migration failed</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{realRunResult.error || 'Unknown error'}</p>
              {realRunResult.detail && (
                <p className="text-[11px] text-[#86868b] mt-1 font-mono">{realRunResult.detail}</p>
              )}
            </div>
          )
        )}
      </section>
    </>
  )
}

function ResultPanel({ result }: { result: MigrationResponse }) {
  return (
    <div className="border border-gray-200 dark:border-white/10 rounded-lg p-3">
      <p className={`text-xs font-semibold mb-2 ${result.dryRun ? 'text-[#7C3AED]' : 'text-[#34c759]'}`}>
        {result.dryRun ? 'DRY RUN — no writes performed' : '✓ MIGRATION COMPLETED'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 dark:border-white/10">
              <th className="text-left py-1.5 font-medium text-[#86868b]">Table</th>
              <th className="text-right py-1.5 font-medium text-[#86868b]">Rows</th>
              <th className="text-right py-1.5 font-medium text-[#86868b]">
                {result.dryRun ? 'Would encrypt' : 'Encrypted'}
              </th>
              <th className="text-right py-1.5 font-medium text-[#86868b]">Skipped</th>
              <th className="text-right py-1.5 font-medium text-[#86868b]">Errors</th>
            </tr>
          </thead>
          <tbody>
            {result.summary?.map(row => (
              <Fragment key={row.table}>
                <tr className="border-b border-gray-100 dark:border-white/5 last:border-0">
                  <td className="py-1.5 font-mono">{row.table}</td>
                  <td className="text-right py-1.5 tabular-nums">{row.rows}</td>
                  <td className="text-right py-1.5 tabular-nums font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{row.encrypted}</td>
                  <td className="text-right py-1.5 tabular-nums text-[#86868b]">{row.skipped}</td>
                  <td className={`text-right py-1.5 tabular-nums ${row.errors > 0 ? 'text-[#ff3b30] font-semibold' : 'text-[#86868b]'}`}>{row.errors}</td>
                </tr>
                {row.errorMessage && (
                  <tr className="border-b border-gray-100 dark:border-white/5">
                    <td colSpan={5} className="px-3 py-2 bg-[#ff3b30]/5 text-[11px] font-mono text-[#ff3b30] break-all">
                      ⚠ {row.errorMessage}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {result.note && (
        <p className="text-[11px] text-[#86868b] mt-3">{result.note}</p>
      )}
    </div>
  )
}
