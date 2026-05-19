/**
 * Dependency-free streaming CSV parser (client-side).
 *
 * Amazon's Creator Connections export has fields like the ASIN List
 * — "[B0GTV77BY7, B0...]" — which contain commas, so naive split(',')
 * is wrong; this handles RFC-4180 quoting ("" escapes, commas/newlines
 * inside quotes). It streams row-by-row and yields to the event loop
 * periodically so a 70 MB file doesn't freeze the tab, and stops early
 * once the caller has what it needs (returns false from onRow).
 */
export async function streamCsv(
  text: string,
  onRow: (cols: string[], index: number) => boolean | void,
  onProgress?: (rowsSeen: number) => void,
): Promise<void> {
  const n = text.length
  let i = 0
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let rowIndex = 0
  let sinceYield = 0

  const finishRow = (): boolean => {
    // Skip blank trailing lines.
    if (row.length === 1 && row[0] === '' && field === '') { row = []; return true }
    row.push(field)
    field = ''
    const cont = onRow(row, rowIndex)
    rowIndex++
    row = []
    if (++sinceYield >= 2000) {
      sinceYield = 0
      onProgress?.(rowIndex)
    }
    return cont !== false
  }

  while (i < n) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') {
      if (!finishRow()) return
      // Cooperative yield so the UI stays responsive on huge files.
      if (rowIndex % 5000 === 0) await new Promise(r => setTimeout(r, 0))
      i++; continue
    }
    field += c; i++
  }
  // Last row without trailing newline.
  if (field !== '' || row.length) finishRow()
  onProgress?.(rowIndex)
}
