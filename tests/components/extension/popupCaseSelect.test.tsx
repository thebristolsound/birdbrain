// @vitest-environment jsdom
// The rebuilt extension popup (#387): the "Logging to" case select over the one
// global active case, the no-case single-row select, and the page-status block.
//
// Lives under tests/components/ because that is the only .tsx glob the jsdom
// vitest project runs — a tests/extension/*.test.tsx would be collected by no
// project at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import type { CaptureServerCase, CaptureServerStatus } from '@shared/schemas'
import type { ManualCaptureResponse, PopupPageStatus } from '@extension/messages'

vi.mock('@extension/utils/api', () => ({
  getStatus: vi.fn(),
  getCases: vi.fn(),
  activateCase: vi.fn(),
  stopSession: vi.fn()
}))

import { getStatus, getCases, activateCase, stopSession } from '@extension/utils/api'
import { Popup } from '@extension/popup/PopupApp'

const CASES: CaptureServerCase[] = [
  { id: 'case-a', name: 'Operation Nightjar', captureCount: 12 },
  { id: 'case-b', name: 'Kestrel', captureCount: 3 }
]

const CLEAN_URL = 'https://cracked-forum.example.net/threads/88213'

function status(overrides: Partial<CaptureServerStatus> = {}): CaptureServerStatus {
  return {
    running: true,
    activeCase: { id: 'case-a', name: 'Operation Nightjar' },
    sessionActive: false,
    captureCount: 12,
    autoCaptureMode: 'notify',
    cases: [],
    ignoredUrlPatterns: [],
    captureScreenshots: true,
    dedupeWindowSeconds: 60,
    theme: 'dark',
    ...overrides
  }
}

function pageStatus(overrides: Partial<PopupPageStatus> = {}): PopupPageStatus {
  return {
    url: CLEAN_URL,
    blocked: null,
    capturing: false,
    lastCapture: null,
    selectorSummary: null,
    activeSelectorCount: 0,
    ...overrides
  }
}

const sentMessages: Array<Record<string, unknown>> = []
let backgroundReplies: Record<string, unknown> = {}
const createdTabs: string[] = []

function stubChrome(): void {
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined,
      getManifest: () => ({ version: '1.2.3' }),
      sendMessage: (message: Record<string, unknown>, callback?: (response: unknown) => void) => {
        sentMessages.push(message)
        callback?.(backgroundReplies[message.type as string])
      }
    },
    tabs: {
      query: (_query: unknown, callback: (tabs: unknown[]) => void) =>
        callback([{ id: 7, url: CLEAN_URL }]),
      create: ({ url }: { url: string }) => createdTabs.push(url)
    }
  })
}

async function renderPopup(): Promise<void> {
  render(<Popup />)
  await waitFor(() => expect(vi.mocked(getStatus)).toHaveBeenCalled())
}

beforeEach(() => {
  sentMessages.length = 0
  createdTabs.length = 0
  backgroundReplies = { GET_PAGE_STATUS: pageStatus() }
  stubChrome()
  vi.mocked(getStatus).mockResolvedValue(status())
  vi.mocked(getCases).mockResolvedValue(CASES)
  vi.mocked(activateCase).mockImplementation(async (id: string) => ({
    status: 'ok',
    case: { id, name: CASES.find((entry) => entry.id === id)!.name }
  }))
  vi.mocked(stopSession).mockResolvedValue({ status: 'ok', sessionActive: false })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('popup case select', () => {
  it('fronts with the active case and offers the full list under "Set active case"', async () => {
    await renderPopup()

    expect(await screen.findByText('Logging to')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Operation Nightjar/ }))

    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Set active case')).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: /Kestrel/ })).toBeTruthy()
    // The footnote is the whole reason per-tab binding was withdrawn: there is
    // one active case and the app follows it.
    expect(
      within(menu).getByText('One active case — switching here switches the Birdbrain app too.')
    ).toBeTruthy()
  })

  it('activates the picked case and shows it as the one being logged to', async () => {
    await renderPopup()
    fireEvent.click(await screen.findByRole('button', { name: /Operation Nightjar/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Kestrel/ }))

    await waitFor(() => expect(vi.mocked(activateCase)).toHaveBeenCalledWith('case-b'))
    expect(await screen.findByRole('button', { name: /Kestrel/ })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
    // Selectors and the background's cached match summary follow the active
    // case, so it is told to re-poll before the page status is re-read —
    // otherwise the popup shows the previous case's counts for up to 30 s.
    const types = sentMessages.map((m) => m.type)
    expect(types).toContain('CASE_ACTIVATED')
    expect(types.lastIndexOf('GET_PAGE_STATUS')).toBeGreaterThan(types.indexOf('CASE_ACTIVATED'))
  })

  it('closes the case menu on Escape', async () => {
    await renderPopup()
    fireEvent.click(await screen.findByRole('button', { name: /Operation Nightjar/ }))
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('uses the single-row in-place select when no case is active', async () => {
    vi.mocked(getStatus).mockResolvedValue(status({ activeCase: null }))
    await renderPopup()

    expect(await screen.findByText('No case selected')).toBeTruthy()
    // The prototype replaced the old link-out to the app with this control, so
    // there must be no "open the app to choose" escape hatch here.
    fireEvent.click(screen.getByRole('button', { name: /Select a case/ }))
    const list = screen.getByRole('listbox')
    expect(within(list).getByRole('option', { name: /Operation Nightjar/ })).toBeTruthy()

    fireEvent.click(within(list).getByRole('option', { name: /Kestrel/ }))
    await waitFor(() => expect(vi.mocked(activateCase)).toHaveBeenCalledWith('case-b'))
    expect(await screen.findByText('Logging to')).toBeTruthy()
  })

  it('says so plainly when the app has no cases yet', async () => {
    vi.mocked(getStatus).mockResolvedValue(status({ activeCase: null }))
    vi.mocked(getCases).mockResolvedValue([])
    await renderPopup()

    expect(await screen.findByText(/No cases yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Select a case/ })).toBeNull()
  })

  it('keeps the gear on the app settings deep link and offers no session toggle', async () => {
    await renderPopup()
    await screen.findByText('Logging to')

    fireEvent.click(screen.getByRole('button', { name: 'Birdbrain settings' }))
    expect(createdTabs).toEqual(['birdbrain://settings'])
    // HOTFIX semantics: Stop appears only while a session is actually running.
    expect(screen.queryByRole('button', { name: 'Stop session' })).toBeNull()
  })

  it('offers Stop session only while a session is running', async () => {
    vi.mocked(getStatus).mockResolvedValue(status({ sessionActive: true }))
    await renderPopup()

    fireEvent.click(await screen.findByRole('button', { name: 'Stop session' }))

    await waitFor(() => expect(vi.mocked(stopSession)).toHaveBeenCalled())
    expect(sentMessages.some((m) => m.type === 'SESSION_STOPPED')).toBe(true)
  })

  it('offers a retry when the desktop app is not running', async () => {
    vi.mocked(getStatus).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await renderPopup()

    expect(await screen.findByText("Birdbrain isn't running")).toBeTruthy()
    vi.mocked(getStatus).mockResolvedValue(status())
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }))

    expect(await screen.findByText('Logging to')).toBeTruthy()
  })
})

describe('popup page status', () => {
  it('hides Capture now and says why when the page is ignored by an operator rule', async () => {
    backgroundReplies = {
      GET_PAGE_STATUS: pageStatus({ blocked: { reason: 'user', pattern: 'secret.example.*' } })
    }
    await renderPopup()

    expect(await screen.findByText("This page can't be captured")).toBeTruthy()
    expect(screen.getByText('Ignored by your rule: secret.example.*')).toBeTruthy()
    expect(screen.getByText("Selectors don't run on ignored pages.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Capture now' })).toBeNull()
    // The context-menu route runs the same rules, so pointing the operator at
    // it here would be pointing at a menu item that does nothing.
    expect(screen.queryByText(/Right-click the page to capture/)).toBeNull()
  })

  it('names the built-in scheme list rather than a pattern for a chrome:// page', async () => {
    backgroundReplies = {
      GET_PAGE_STATUS: pageStatus({ blocked: { reason: 'default', pattern: null } })
    }
    await renderPopup()

    expect(await screen.findByText("This page can't be captured")).toBeTruthy()
    expect(screen.getByText('Browser, extension and local pages are always ignored.')).toBeTruthy()
  })

  it('reports a capture it made rather than implying a lookup it cannot do', async () => {
    const at = Date.now() - 4 * 60 * 1000
    backgroundReplies = {
      GET_PAGE_STATUS: pageStatus({ lastCapture: { at, manifestIndex: 36 } })
    }
    await renderPopup()

    expect(await screen.findByText('Captured 4 min ago')).toBeTruthy()
    expect(screen.getByText('MHTML · sha256 recorded · index #36')).toBeTruthy()
  })

  it('discloses that an absent record is not proof the page was never captured', async () => {
    await renderPopup()

    expect(await screen.findByText('Not captured yet')).toBeTruthy()
    expect(screen.getByText("Captures made earlier aren't tracked here.")).toBeTruthy()
  })

  it('says the status is unavailable rather than inventing one when nothing answers', async () => {
    backgroundReplies = {}
    await renderPopup()

    expect(await screen.findByText('Page status unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Capture now' })).toBeNull()
  })

  it('summarises the last selector scan of this page', async () => {
    backgroundReplies = {
      GET_PAGE_STATUS: pageStatus({
        selectorSummary: { selectors: 2, hits: 3 },
        activeSelectorCount: 5
      })
    }
    await renderPopup()

    expect(await screen.findByText('2 selectors matched · 3 hits on this page')).toBeTruthy()
  })

  it('sends the capture through the background and reports a client-side block', async () => {
    backgroundReplies = {
      GET_PAGE_STATUS: pageStatus(),
      MANUAL_CAPTURE: {
        started: false,
        blocked: { reason: 'user', pattern: 'secret.example.*' }
      } satisfies ManualCaptureResponse
    }
    await renderPopup()

    fireEvent.click(await screen.findByRole('button', { name: 'Capture now' }))

    // The popup asks; it never evaluates a pattern itself — that seam is what
    // keeps per-case exclusions (#400) a background-side change.
    await waitFor(() =>
      expect(sentMessages.some((m) => m.type === 'MANUAL_CAPTURE' && m.caseId === 'case-a')).toBe(
        true
      )
    )
    expect(
      await screen.findByText('Not captured — ignored by your rule: secret.example.*')
    ).toBeTruthy()
  })

  it('shows the capture in flight once the background accepts it', async () => {
    backgroundReplies = {
      GET_PAGE_STATUS: pageStatus(),
      MANUAL_CAPTURE: { started: true, blocked: null } satisfies ManualCaptureResponse
    }
    await renderPopup()

    const button = await screen.findByRole('button', { name: 'Capture now' })
    backgroundReplies.GET_PAGE_STATUS = pageStatus({ capturing: true })
    fireEvent.click(button)

    expect(await screen.findByText('Capturing…')).toBeTruthy()
    expect(screen.getByText('Serializing page and assets')).toBeTruthy()
    // A second click must not queue a second capture of the same page.
    expect(screen.getByRole('button', { name: 'Capture now' }).hasAttribute('disabled')).toBe(true)
  })
})
