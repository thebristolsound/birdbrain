// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Capture } from '@shared/types'
import { CaptureDownloadMenu } from '@renderer/components/captures/CaptureDownloadMenu'
import { fakeBridge } from '../renderer/fakeBridge'

// This file runs the menu against the bridge itself, with no module mocked, so what it reads is
// the call that leaves the renderer: the channel's method and every argument.

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

type Call = [method: string, ...args: unknown[]]

let calls: Call[]
let answer: (method: string) => Promise<unknown>

// Every method of the `captures` namespace exists and records its call, so a call the menu
// should not make is seen and not only the three it should.
function recordingCaptures(): Record<string, unknown> {
  return new Proxy<Record<string, unknown>>(
    {},
    {
      has: () => true,
      get:
        (_target, method: string) =>
        (...args: unknown[]) => {
          calls.push([method, ...args])
          return answer(method)
        }
    }
  )
}

// A held item leaves the menu open, so this opens it only when it is shut.
function open(): void {
  if (screen.queryByRole('menu')) return
  fireEvent.click(screen.getByTestId('capture-download-menu-btn'))
}

function items(): Array<[testId: string | null, text: string | null]> {
  return screen
    .getAllByRole('menuitem')
    .map((item) => [item.getAttribute('data-testid'), item.textContent])
}

beforeEach(() => {
  calls = []
  answer = async () => '/downloads/file'
  fakeBridge({ captures: recordingCaptures() })
})

afterEach(() => cleanup())

describe('what each Download menu item hands over', () => {
  it('lists the archive, the PDF report and the screenshot, in that order', () => {
    render(<CaptureDownloadMenu capture={capture} />)
    open()
    expect(items()).toEqual([
      ['download-archive-btn', 'MHTML archive'],
      ['download-pdf-btn', 'PDF report'],
      ['download-screenshot-btn', 'Screenshot (PNG)']
    ])
    expect(calls).toEqual([])
  })

  it('names the archive "HTML page" for a Capture stored as HTML', () => {
    render(<CaptureDownloadMenu capture={{ ...capture, format: 'html' }} />)
    open()
    expect(items()[0]).toEqual(['download-archive-btn', 'HTML page'])
  })

  it.each([
    ['download-archive-btn', 'download'],
    ['download-pdf-btn', 'downloadPdf'],
    ['download-screenshot-btn', 'downloadScreenshot']
  ])('%s makes one call, captures.%s, with the Capture id alone', async (testId, method) => {
    render(<CaptureDownloadMenu capture={capture} />)
    open()
    fireEvent.click(screen.getByTestId(testId))

    await waitFor(() => expect(calls).toEqual([[method, 'cap1']]))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByTestId('capture-download-error')).toBeNull()
  })

  it('sends the id of the Capture it is shown for', async () => {
    const { rerender } = render(<CaptureDownloadMenu capture={capture} />)
    rerender(<CaptureDownloadMenu capture={{ ...capture, id: 'cap2' }} />)
    open()
    fireEvent.click(screen.getByTestId('download-archive-btn'))
    open()
    fireEvent.click(screen.getByTestId('download-pdf-btn'))
    open()
    fireEvent.click(screen.getByTestId('download-screenshot-btn'))

    await waitFor(() =>
      expect(calls).toEqual([
        ['download', 'cap2'],
        ['downloadPdf', 'cap2'],
        ['downloadScreenshot', 'cap2']
      ])
    )
  })

  it('hands nothing over for a Capture with no screenshot, and says why', () => {
    render(<CaptureDownloadMenu capture={{ ...capture, screenshotPath: undefined }} />)
    open()
    const item = screen.getByTestId('download-screenshot-btn')
    expect(item.getAttribute('title')).toBe('No screenshot for this capture')

    fireEvent.click(item)
    expect(calls).toEqual([])
  })

  it('asks for the PDF once while an export is running', async () => {
    let finish: (path: string) => void = () => {}
    answer = () => new Promise((resolve) => (finish = resolve))
    render(<CaptureDownloadMenu capture={capture} />)
    open()
    fireEvent.click(screen.getByTestId('download-pdf-btn'))
    await waitFor(() => expect(calls).toEqual([['downloadPdf', 'cap1']]))

    open()
    const item = screen.getByTestId('download-pdf-btn')
    expect(item.textContent).toBe('Exporting PDF…')
    fireEvent.click(item)
    expect(calls).toEqual([['downloadPdf', 'cap1']])

    finish('/downloads/cap1.pdf')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''))
    open()
    expect(screen.getByTestId('download-pdf-btn').textContent).toBe('PDF report')
    fireEvent.click(screen.getByTestId('download-pdf-btn'))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toEqual(['downloadPdf', 'cap1'])
  })

  it("shows the refusal's own message when a download fails", async () => {
    answer = async () => {
      throw new Error('disk full')
    }
    render(<CaptureDownloadMenu capture={capture} />)
    open()
    fireEvent.click(screen.getByTestId('download-screenshot-btn'))

    expect((await screen.findByTestId('capture-download-error')).textContent).toBe('disk full')
    expect(calls).toEqual([['downloadScreenshot', 'cap1']])
  })
})
