// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Browser-side ZIP reader for the CC catalog upload. Amazon's "Download all …
// campaigns" exports arrive as a ZIP of CSV parts; the admin drops the ZIP(s)
// straight into MVP instead of unzipping by hand. We extract each .csv entry as
// a File (a Blob with a name) so it flows through the SAME streaming CSV parser
// the uploader already uses — no giant string ever sits in memory.
//
// Uses the platform DecompressionStream('deflate-raw'), so there's no library.
// Handles stored (method 0) and deflate (method 8); throws clearly on zip64.

// A Uint8Array view → a standalone ArrayBuffer (a valid BlobPart across TS lib
// versions, and detached from the big backing buffer).
function toBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

async function inflateRaw(bytes: Uint8Array): Promise<Blob> {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([toBuffer(bytes)]).stream().pipeThrough(ds)
  return await new Response(stream).blob()
}

/**
 * Extract every .csv entry from a ZIP File as a named File. Returns [] if the
 * ZIP holds no CSVs. Throws on a corrupt/zip64 archive.
 */
export async function unzipCsvFiles(file: File): Promise<File[]> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const dv = new DataView(buf)

  // Find the End Of Central Directory record (sig 0x06054b50), scanning back.
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65536; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error(`${file.name} isn't a valid ZIP (no end-of-directory record).`)

  const cdCount = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true) // central directory offset
  const out: File[] = []
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break // central directory header
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const fnLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOff = dv.getUint32(p + 42, true)
    if (compSize === 0xffffffff || localOff === 0xffffffff) {
      throw new Error(`${file.name} uses ZIP64 (too large) — please unzip it manually and drop the CSVs.`)
    }
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + fnLen))
    if (/\.csv$/i.test(name) && dv.getUint32(localOff, true) === 0x04034b50) {
      // Local header tells us where the entry's data actually begins.
      const lFnLen = dv.getUint16(localOff + 26, true)
      const lExtraLen = dv.getUint16(localOff + 28, true)
      const dataStart = localOff + 30 + lFnLen + lExtraLen
      const comp = bytes.subarray(dataStart, dataStart + compSize)
      let blob: Blob
      if (method === 0) blob = new Blob([toBuffer(comp)])  // stored
      else if (method === 8) blob = await inflateRaw(comp) // deflate
      else throw new Error(`${file.name}: unsupported ZIP compression (method ${method}).`)
      const base = name.split('/').pop() || name
      out.push(new File([blob], base, { type: 'text/csv' }))
    }
    p += 46 + fnLen + extraLen + commentLen
  }
  return out
}
