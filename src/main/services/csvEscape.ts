// RFC 4180 CSV escaping.
// Values that contain a comma, double quote, CR, or LF are wrapped in double quotes,
// and any inner double quotes are escaped by doubling them.

export type CsvValue = string | number | boolean | null | undefined

export function escapeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  const str = typeof value === 'string' ? value : String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function buildCsv(header: string[], rows: CsvValue[][]): string {
  const lines: string[] = []
  lines.push(header.map(escapeCsvField).join(','))
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','))
  }
  // RFC 4180 recommends CRLF line endings; trailing CRLF matches Excel export convention.
  return lines.join('\r\n') + '\r\n'
}
