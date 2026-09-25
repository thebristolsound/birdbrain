import { describe, it, expect, beforeEach, vi } from 'vitest'

// The render path drives a hidden BrowserWindow over the DevTools protocol, so
// Electron is replaced by a fake window whose webContents records the CDP calls.
// That is what lets the injected cover script be inspected without Chromium.
// Built in vi.hoisted because pdfExport imports 'electron' during module init,
// before the test body's own declarations exist.
const electronFake = vi.hoisted(() => {
  const loadURL = vi.fn()
  const sendCommand = vi.fn()
  const printToPDF = vi.fn()
  const detach = vi.fn()

  class FakeBrowserWindow {
    static getAllWindows(): FakeBrowserWindow[] {
      return []
    }
    webContents = {
      session: { setPermissionRequestHandler: vi.fn() },
      setWindowOpenHandler: vi.fn(),
      setAudioMuted: vi.fn(),
      loadURL,
      debugger: { attach: vi.fn(), isAttached: () => true, detach, sendCommand },
      printToPDF,
      isDestroyed: () => false
    }
    on = vi.fn()
    isDestroyed(): boolean {
      return false
    }
    destroy = vi.fn()
  }

  return {
    app: { on: vi.fn() },
    BrowserWindow: FakeBrowserWindow,
    loadURL,
    sendCommand,
    printToPDF,
    detach
  }
})

vi.mock('electron', () => ({
  app: electronFake.app,
  BrowserWindow: electronFake.BrowserWindow
}))

import { buildPdfMetadataRows, renderCapturePdf } from '@main/services/pdfExport'
import type { Capture, TrustedTime } from '@shared/types'
import type { TrustedTimeResult } from '@shared/verify/trustedTime'
import { TRUSTED_TIME_LABELS, TRUSTED_TIME_UNNAMED_TSA } from '@shared/trustedTimeDisclosure'

const CAPTURE: Capture = {
  id: 'cap-1',
  caseId: 'case-1',
  url: 'https://example.com/a',
  title: 'Example',
  hash: 'a'.repeat(64),
  timestamp: '2026-08-17T10:00:00.000Z',
  createdAt: '2026-08-17T10:00:00.000Z',
  format: 'mhtml',
  method: 'extension'
}

function rowValue(rows: [string, string][], label: string): string | undefined {
  return rows.find(([rowLabel]) => rowLabel === label)?.[1]
}

// Renders the cover rows for a capture whose DB mirror holds `mirror` and whose
// manifest resolves to `resolved`, and returns the Trusted time row.
function trustedTimeRow(mirror: TrustedTime | undefined, resolved: TrustedTimeResult): string {
  const rows = buildPdfMetadataRows({ ...CAPTURE, trustedTimeStatus: mirror }, resolved)
  const row = rowValue(rows, 'Trusted time')
  expect(row).toBeDefined()
  return row as string
}

describe('buildPdfMetadataRows — trusted time (#509)', () => {
  it('prints the manifest answer, not the captures.trustedTimeStatus mirror', () => {
    // Known answer: the mirror claims an RFC 3161 token the manifest does not
    // have. The manifest is authoritative, so the row must disclose the
    // local-clock floor and the mirror's claim must not survive anywhere in it.
    const row = trustedTimeRow('rfc3161', { trustedTime: 'none' })

    expect(row).toBe('Local clock only: no RFC 3161 token is retained for this capture')
    expect(row).not.toContain('rfc3161')
  })

  it('prints the manifest answer when the mirror understates it', () => {
    // The inverse disagreement: a stale 'none' mirror against a manifest that
    // does hold a token. The mirror must not suppress the disclosure either.
    const row = trustedTimeRow('none', {
      trustedTime: 'rfc3161',
      tsaName: 'tsa.example.net',
      stampedAt: '2026-08-17T10:00:04.000Z'
    })

    expect(row).toContain('RFC 3161 token retained')
    expect(row).toContain('tsa.example.net')
    expect(row).toContain('2026-08-17T10:00:04.000Z')
  })

  it('names the TSA and the asserted time for a stamped capture', () => {
    const row = trustedTimeRow(undefined, {
      trustedTime: 'rfc3161',
      tsaName: 'freetsa.org',
      stampedAt: '2026-08-17T10:00:04.000Z'
    })

    // The asserted time is rendered like every other timestamp on the cover:
    // ISO first, operator-local rendering in parentheses after it.
    expect(row).toContain(
      'RFC 3161 token retained: freetsa.org asserts the capture digest existed no later than ' +
        '2026-08-17T10:00:04.000Z ('
    )
  })

  it('says the TSA identity is unrecorded when the token carries none (#519)', () => {
    // Known answer: the row must not name this install's configured authority —
    // the token may be foreign (archive import) or predate a settings change.
    const row = trustedTimeRow(undefined, { trustedTime: 'rfc3161' })

    expect(row).toBe(
      'RFC 3161 token retained: an RFC 3161 authority whose identity is not recorded in the ' +
        'retained token asserts the capture digest existed no later than the time recorded in ' +
        'the retained token'
    )
    expect(row).toContain(TRUSTED_TIME_UNNAMED_TSA)
    expect(row).not.toContain('configured')
  })

  it('discloses a pending stamp with its own label, not the none label (#519)', () => {
    const row = trustedTimeRow('rfc3161', { trustedTime: 'pending' })

    expect(row).toBe(
      'Local clock — token pending: no RFC 3161 token is recorded for this capture, and the ' +
        'manifest does not state whether one was requested'
    )
    expect(row.startsWith(TRUSTED_TIME_LABELS.none)).toBe(false)
  })

  // The detail may not assert that a token was ever asked for. The manifest
  // records tokens, not requests, and since #1169 an installation can decline
  // trusted timestamping outright — in which case no request was made for any
  // capture the package holds, and the old phrasing was simply false.
  it('does not claim a token was requested for a capture that carries none (#1169)', () => {
    for (const resolved of [{ trustedTime: 'pending' }, { trustedTime: 'none' }] as const) {
      const row = trustedTimeRow('rfc3161', resolved)
      expect(row).not.toMatch(/was requested but/i)
      expect(row).not.toMatch(/awaiting/i)
    }
  })

  it('leads every row with the label report.html uses for the same axis (#519)', () => {
    // The two operator-facing artifacts share one label vocabulary; this pins
    // that the PDF actually renders it rather than a paraphrase.
    const cases: TrustedTimeResult[] = [
      { trustedTime: 'rfc3161', tsaName: 'tsa.example.net', stampedAt: '2026-08-17T10:00:04.000Z' },
      { trustedTime: 'pending' },
      { trustedTime: 'none' }
    ]
    for (const resolved of cases) {
      const row = trustedTimeRow(undefined, resolved)
      expect(row.startsWith(`${TRUSTED_TIME_LABELS[resolved.trustedTime]}: `)).toBe(true)
    }
  })

  it('always emits the row — an unresolvable axis is stated, never omitted', () => {
    // resolveTrustedTime answers 'none' both for a genuinely unstamped capture
    // and for one absent from the manifest entirely. Neither may print nothing:
    // an omitted row reads as "nothing to disclose".
    const rows = buildPdfMetadataRows(
      { ...CAPTURE, trustedTimeStatus: undefined },
      {
        trustedTime: 'none'
      }
    )

    expect(rows.filter(([label]) => label === 'Trusted time')).toHaveLength(1)
  })
})

describe('renderCapturePdf — cover injection (#509)', () => {
  beforeEach(() => {
    electronFake.loadURL.mockResolvedValue(undefined)
    electronFake.printToPDF.mockResolvedValue(Buffer.from('%PDF-1.4'))
    electronFake.sendCommand.mockReset()
    electronFake.sendCommand.mockImplementation((method: string) =>
      method === 'Page.getLayoutMetrics' ? { cssContentSize: { width: 1920, height: 4000 } } : {}
    )
  })

  // Reads the cover script that was actually evaluated in the render window —
  // the last point at which the disclosure can still be wrong.
  function injectedCoverScript(): string {
    const call = electronFake.sendCommand.mock.calls.find(
      ([method]) => method === 'Runtime.evaluate'
    )
    expect(call).toBeDefined()
    return (call![1] as { expression: string }).expression
  }

  it('injects the manifest-resolved axis, so the mirror never reaches the PDF', async () => {
    const pdf = await renderCapturePdf(
      { ...CAPTURE, trustedTimeStatus: 'rfc3161' },
      '/tmp/does-not-need-to-exist.mhtml',
      { trustedTime: 'none' }
    )

    expect(pdf.toString()).toBe('%PDF-1.4')
    const script = injectedCoverScript()
    expect(script).toContain('Local clock only: no RFC 3161 token is retained for this capture')
    expect(script).not.toContain('rfc3161')
  })

  it('injects the retained token details when the manifest holds one', async () => {
    await renderCapturePdf({ ...CAPTURE, trustedTimeStatus: 'none' }, '/tmp/cap.mhtml', {
      trustedTime: 'rfc3161',
      tsaName: 'tsa.example.net',
      stampedAt: '2026-08-17T10:00:04.000Z'
    })

    const script = injectedCoverScript()
    expect(script).toContain('RFC 3161 token retained')
    expect(script).toContain('tsa.example.net')
  })
})
