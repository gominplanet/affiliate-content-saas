// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A real Excel file (.xlsx) without a library: the few XML parts Excel,
// Google Sheets and Numbers need, zipped by the caller (jszip). Several
// sheets, a bold frozen header row, column widths, numbers, money and
// percent formats, and formulas so totals update as the creator edits.
// Pure: it returns the files; scripts/test-trybe-export.ts opens them.

export type CellStyle = 'bold' | 'pct' | 'money' | 'wrap'
export type Cell = string | number | null | undefined | { v?: string | number | null; f?: string; s?: CellStyle }
export interface Sheet { name: string; widths?: number[]; rows: Cell[][] }

const STYLE_ID: Record<CellStyle, number> = { bold: 1, pct: 2, money: 3, wrap: 4 }

/** A, B, ... Z, AA, AB ... Pure. */
export function colName(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// Characters XML 1.0 does not allow are dropped, then the rest escaped.
const esc = (t: string) => t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A sheet name Excel accepts: no []:*?/\, at most 31 characters, unique. */
export function sheetName(raw: string, taken: Set<string>): string {
  let base = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet'
  let name = base
  for (let i = 2; taken.has(name.toLowerCase()); i++) { const tail = ` ${i}`; name = base.slice(0, 31 - tail.length) + tail }
  taken.add(name.toLowerCase())
  return name
}

function cellXml(c: Cell, ref: string, header: boolean): string {
  if (c == null || c === '') return ''
  const o = typeof c === 'object' ? c : { v: c }
  const style = o.s ? STYLE_ID[o.s] : header ? STYLE_ID.bold : 0
  const s = style ? ` s="${style}"` : ''
  if (o.f) return `<c r="${ref}"${s}><f>${esc(o.f.replace(/^=/, ''))}</f></c>`
  if (o.v == null || o.v === '') return style ? `<c r="${ref}"${s}/>` : ''
  if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${ref}"${s}><v>${o.v}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(o.v).slice(0, 32000))}</t></is></c>`
}

function sheetXml(sh: Sheet): string {
  const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(120, w))}" customWidth="1"/>`).join('')}</cols>` : ''
  const rows = sh.rows.map((r, ri) => {
    const cells = r.map((c, ci) => cellXml(c, `${colName(ci)}${ri + 1}`, ri === 0)).join('')
    return `<row r="${ri + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData></worksheet>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

/** Every file of the workbook, path to XML. Pure. */
export function buildXlsx(sheets: Sheet[]): Record<string, string> {
  const taken = new Set<string>()
  const named = sheets.map((s) => ({ ...s, name: sheetName(s.name, taken) }))
  const files: Record<string, string> = {}
  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
  files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  files['xl/styles.xml'] = STYLES
  named.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s) })
  return files
}
