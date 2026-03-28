import { writeFileSync, readFileSync, existsSync } from 'fs'
import * as db from '@main/services/database'
import { getCapturePath, readCaptureFile } from '@main/services/storage'
import { hashContent } from '@main/services/hash'
import type { ExportOptions, HashVerification, Capture } from '@shared/types'

interface ExportData {
  caseName: string
  caseDescription?: string
  dateRange: { first: string; last: string } | null
  investigatorName: string
  exportTimestamp: string
  captures: Capture[]
  verifications: HashVerification[]
  screenshots: Map<string, string> // captureId -> base64
}

export function verifyCaptures(caseId: string): HashVerification[] {
  const captures = db.listCaptures(caseId)
  const results: HashVerification[] = []

  for (const capture of captures) {
    const htmlBuffer = readCaptureFile(capture.caseId, capture.id, 'html')

    if (!htmlBuffer) {
      results.push({
        captureId: capture.id,
        url: capture.url,
        title: capture.title,
        storedHash: capture.hash,
        computedHash: '',
        status: 'missing'
      })
      continue
    }

    const computedHash = hashContent(htmlBuffer.toString('utf-8'))
    results.push({
      captureId: capture.id,
      url: capture.url,
      title: capture.title,
      storedHash: capture.hash,
      computedHash,
      status: computedHash === capture.hash ? 'verified' : 'tampered'
    })
  }

  return results
}

export async function generateReport(
  caseId: string,
  options: ExportOptions,
  onProgress?: (step: string, percent: number) => void
): Promise<void> {
  const caseData = db.getCase(caseId)
  if (!caseData) throw new Error(`Case not found: ${caseId}`)

  onProgress?.('Loading captures...', 10)
  const captures = db.listCaptures(caseId)

  // Build export data
  const data: ExportData = {
    caseName: caseData.name,
    caseDescription: caseData.description,
    dateRange:
      captures.length > 0
        ? { first: captures[captures.length - 1].timestamp, last: captures[0].timestamp }
        : null,
    investigatorName: options.investigatorName,
    exportTimestamp: new Date().toISOString(),
    captures,
    verifications: [],
    screenshots: new Map()
  }

  if (options.include.auditTrail) {
    onProgress?.('Verifying capture integrity...', 50)
    data.verifications = verifyCaptures(caseId)
  }

  if (options.include.screenshots) {
    onProgress?.('Loading screenshots...', 60)
    for (const cap of captures) {
      const screenshotBuffer = readCaptureFile(cap.caseId, cap.id, 'png')
      if (screenshotBuffer) {
        data.screenshots.set(cap.id, screenshotBuffer.toString('base64'))
      }
    }
  }

  onProgress?.('Generating report...', 80)
  const html = buildHtmlReport(data, options)

  writeFileSync(options.outputPath, html, 'utf-8')
  onProgress?.('Complete', 100)
}

function buildHtmlReport(data: ExportData, options: ExportOptions): string {
  const sections: string[] = []

  // Cover
  sections.push(`
    <div class="cover">
      <h1>${esc(data.caseName)}</h1>
      ${data.caseDescription ? `<p class="desc">${esc(data.caseDescription)}</p>` : ''}
      ${data.dateRange ? `<p class="date-range">${new Date(data.dateRange.first).toLocaleDateString()} — ${new Date(data.dateRange.last).toLocaleDateString()}</p>` : ''}
      <p class="meta">Investigator: ${esc(data.investigatorName)}</p>
      <p class="meta">Exported: ${new Date(data.exportTimestamp).toLocaleString()}</p>
      <p class="meta">Captures: ${data.captures.length}</p>
    </div>
  `)

  // Summary
  const domainSet = new Set(
    data.captures.map((c) => {
      try {
        return new URL(c.url).hostname
      } catch {
        return ''
      }
    })
  )

  sections.push(`
    <div class="section">
      <h2>Summary</h2>
      <table>
        <tr><td>Total Captures</td><td>${data.captures.length}</td></tr>
        <tr><td>Unique Domains</td><td>${domainSet.size}</td></tr>
      </table>
    </div>
  `)

  // Capture Log
  if (options.include.captures) {
    sections.push(`
      <div class="section">
        <h2>Capture Log</h2>
        <table class="full-width">
          <thead><tr><th>Timestamp</th><th>Title</th><th>URL</th><th>Hash</th></tr></thead>
          <tbody>
            ${data.captures
              .map(
                (c) => `
              <tr>
                <td class="mono">${new Date(c.timestamp).toLocaleString()}</td>
                <td>${esc(c.title)}</td>
                <td class="mono url">${esc(c.url)}</td>
                <td class="mono hash">${c.hash.slice(0, 12)}...</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `)
  }

  // Capture Details with screenshots
  if (options.include.captures && options.include.screenshots) {
    sections.push(`
      <div class="section">
        <h2>Capture Details</h2>
        ${data.captures
          .map((c) => {
            const screenshot = data.screenshots.get(c.id)
            return `
            <div class="capture-detail">
              <h3>${esc(c.title)}</h3>
              <p class="mono url">${esc(c.url)}</p>
              <p class="mono">${new Date(c.timestamp).toLocaleString()}</p>
              ${screenshot ? `<img src="data:image/png;base64,${screenshot}" alt="Screenshot" class="screenshot" />` : ''}
            </div>
          `
          })
          .join('')}
      </div>
    `)
  }

  // Audit Trail
  if (options.include.auditTrail && data.verifications.length > 0) {
    sections.push(`
      <div class="section">
        <h2>Audit Trail — Hash Verification</h2>
        <table class="full-width">
          <thead><tr><th>Status</th><th>Title</th><th>URL</th><th>Stored Hash</th><th>Computed Hash</th></tr></thead>
          <tbody>
            ${data.verifications
              .map(
                (v) => `
              <tr class="verify-${v.status}">
                <td>${v.status === 'verified' ? '✓' : v.status === 'tampered' ? '⚠' : '✗'} ${v.status}</td>
                <td>${esc(v.title)}</td>
                <td class="mono url">${esc(v.url)}</td>
                <td class="mono hash">${v.storedHash.slice(0, 16)}...</td>
                <td class="mono hash">${v.computedHash ? v.computedHash.slice(0, 16) + '...' : '-'}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `)
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Birdbrain Report — ${esc(data.caseName)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 2rem; }
  .cover { text-align: center; padding: 3rem 0; border-bottom: 2px solid #f59e0b; margin-bottom: 2rem; }
  .cover h1 { font-size: 2rem; color: #f59e0b; }
  .cover .desc { margin-top: 0.5rem; color: #a3a3a3; }
  .cover .date-range { margin-top: 0.5rem; font-family: monospace; color: #737373; }
  .cover .meta { margin-top: 0.25rem; font-size: 0.875rem; color: #737373; }
  .section { margin-bottom: 2rem; page-break-inside: avoid; }
  .section h2 { font-size: 1.5rem; color: #f59e0b; border-bottom: 1px solid #262626; padding-bottom: 0.5rem; margin-bottom: 1rem; }
  .section h3 { font-size: 1.1rem; color: #d4d4d4; margin: 1rem 0 0.5rem; }
  table { border-collapse: collapse; margin-bottom: 1rem; }
  table.full-width { width: 100%; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #262626; }
  th { color: #a3a3a3; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }
  .mono { font-family: 'Courier New', monospace; font-size: 0.8rem; }
  .url { word-break: break-all; max-width: 300px; }
  .hash { color: #737373; }
  .context { color: #a3a3a3; font-size: 0.8rem; max-width: 300px; }
  .ai-summary { margin-top: 1rem; padding: 1rem; background: #1a1a0a; border-left: 3px solid #f59e0b; }
  .card { padding: 1rem; margin-bottom: 0.5rem; background: #171717; border: 1px solid #262626; border-radius: 0.5rem; }
  .capture-detail { padding: 1rem 0; border-bottom: 1px solid #262626; page-break-inside: avoid; }
  .screenshot { max-width: 100%; max-height: 400px; margin: 0.5rem 0; border: 1px solid #262626; }
  .verify-verified td:first-child { color: #22c55e; }
  .verify-tampered td:first-child { color: #f59e0b; }
  .verify-missing td:first-child { color: #ef4444; }
  @media print { body { background: white; color: black; } .cover h1, .section h2 { color: #d97706; } }
</style>
</head>
<body>
${sections.join('\n')}
<footer style="text-align: center; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #262626; font-size: 0.75rem; color: #525252;">
  Generated by Birdbrain v0.1.0
</footer>
</body>
</html>`
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
