// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { Capture } from '@shared/types'

const downloadCapture = vi.hoisted(() => vi.fn(async () => '/tmp/cap1.mhtml'))
const downloadCapturePdf = vi.hoisted(() => vi.fn(async () => '/tmp/cap1.pdf'))
const downloadCaptureScreenshot = vi.hoisted(() => vi.fn(async () => '/tmp/cap1.png'))

vi.mock('@renderer/lib/api/system', () => ({
  downloadCapture,
  downloadCapturePdf,
  downloadCaptureScreenshot
}))

import { CaptureDownloadMenu } from '@renderer/components/captures/CaptureDownloadMenu'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence',
  title: 'Example evidence page',
  hash: 'h',
  timestamp: '2026-08-01T12:00:00.000Z',
  createdAt: '2026-08-01T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension',
  screenshotPath: '/store/case1/cap1.png'
}

beforeEach(() => {
  downloadCapture.mockClear()
  downloadCapturePdf.mockClear()
  downloadCaptureScreenshot.mockClear()
})

afterEach(() => cleanup())

// #466. The label is hidden by a container query on the narrow viewer pane, so
// the trigger's name has to come from somewhere the CSS cannot take away.
describe('CaptureDownloadMenu naming', () => {
  it('names the trigger without leaning on the visible label', () => {
    render(<CaptureDownloadMenu capture={capture} />)

    const trigger = screen.getByRole('button', { name: 'Download capture artifacts' })
    expect(trigger.getAttribute('title')).toBe('Download capture artifacts')
    expect(trigger.textContent).toContain('Download')
  })

  it('announces a running export without renaming the trigger', async () => {
    let resolvePdf: (path: string) => void = () => {}
    downloadCapturePdf.mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolvePdf = resolve))
    )
    render(<CaptureDownloadMenu capture={capture} />)

    fireEvent.click(screen.getByTestId('capture-download-menu-btn'))
    fireEvent.click(screen.getByTestId('download-pdf-btn'))

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Exporting PDF'))
    const trigger = screen.getByRole('button', { name: 'Download capture artifacts' })
    expect(trigger.textContent).toContain('Exporting…')

    resolvePdf('/tmp/cap1.pdf')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''))
    expect(screen.getByTestId('capture-download-menu-btn').getAttribute('aria-label')).toBe(
      'Download capture artifacts'
    )
  })
})

describe('CaptureDownloadMenu items', () => {
  it('downloads the stored archive, the PDF report and the screenshot', async () => {
    render(<CaptureDownloadMenu capture={capture} />)

    fireEvent.click(screen.getByTestId('capture-download-menu-btn'))
    expect(screen.getByTestId('download-archive-btn').textContent).toContain('MHTML archive')
    fireEvent.click(screen.getByTestId('download-archive-btn'))
    await waitFor(() => expect(downloadCapture).toHaveBeenCalledWith('cap1'))

    fireEvent.click(screen.getByTestId('capture-download-menu-btn'))
    fireEvent.click(screen.getByTestId('download-pdf-btn'))
    await waitFor(() => expect(downloadCapturePdf).toHaveBeenCalledWith('cap1'))

    fireEvent.click(screen.getByTestId('capture-download-menu-btn'))
    fireEvent.click(screen.getByTestId('download-screenshot-btn'))
    await waitFor(() => expect(downloadCaptureScreenshot).toHaveBeenCalledWith('cap1'))
  })

  it('offers the pre-v11 wording for an HTML capture and no screenshot to save', () => {
    render(
      <CaptureDownloadMenu capture={{ ...capture, format: 'html', screenshotPath: undefined }} />
    )

    fireEvent.click(screen.getByTestId('capture-download-menu-btn'))
    expect(screen.getByTestId('download-archive-btn').textContent).toContain('HTML page')
    expect(screen.getByTestId('download-screenshot-btn').hasAttribute('disabled')).toBe(true)
  })

  it('surfaces a failed download beside the trigger', async () => {
    downloadCapture.mockRejectedValueOnce(new Error('disk full'))
    render(<CaptureDownloadMenu capture={capture} />)

    fireEvent.click(screen.getByTestId('capture-download-menu-btn'))
    fireEvent.click(screen.getByTestId('download-archive-btn'))

    const error = await screen.findByTestId('capture-download-error')
    expect(error.textContent).toBe('disk full')
    // #466: an error string has no length an operator can predict, so it hangs
    // below the trigger instead of widening the toolbar row it would push the
    // capture pager out of.
    expect(error.className).toContain('absolute')
    expect(error.getAttribute('role')).toBe('alert')
  })

  it('wraps a long unbroken path in a failed download rather than clipping it', async () => {
    const path = '/home/operator/cases/' + 'a'.repeat(120) + '/capture.pdf'
    downloadCapture.mockRejectedValueOnce(new Error(`EACCES: permission denied, open '${path}'`))
    render(<CaptureDownloadMenu capture={capture} />)

    fireEvent.click(screen.getByTestId('capture-download-menu-btn'))
    fireEvent.click(screen.getByTestId('download-archive-btn'))

    const error = await screen.findByTestId('capture-download-error')
    expect(error.textContent).toContain(path)
    // The viewer shell clips its overflow, so a token wider than the box has
    // to break inside it or the reason the export failed is unreadable.
    expect(error.className).toContain('break-words')
  })

  it('closes on Escape and on a click outside', async () => {
    render(<CaptureDownloadMenu capture={capture} />)

    fireEvent.click(screen.getByTestId('capture-download-menu-btn'))
    expect(screen.getByRole('menu')).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    fireEvent.click(screen.getByTestId('capture-download-menu-btn'))
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})
