// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { updateToast } from '@extension/toast'
import { suppressCaptureUi, releaseCaptureUiSuppression } from '@extension/captureSuppression'
import type { CaptureCardDetails } from '@shared/schemas'

const card: CaptureCardDetails = {
  caseId: 'case-1',
  captureId: 'capture-1',
  caseName: 'Nightjar',
  title: '<img src=x onerror=alert(1)>',
  format: 'mhtml',
  hash: 'a'.repeat(64),
  manifestIndex: 42,
  tags: [
    { id: 't-1', name: 'Evidence', color: '#f59e0b', applied: false },
    { id: 't-2', name: 'Review', color: '#ec4899', applied: true },
    { id: 't-3', name: 'Lead', color: '#0ea5e9', applied: false }
  ]
}
const send = vi.fn()
const shadow = () => document.getElementById('birdbrain-capture-toast')!.shadowRoot!
let clickListeners: WeakMap<EventTarget, EventListener>
// Unit-level browser input: jsdom cannot create trusted DOM events. The browser
// harness separately proves real pointer input passes and page script cannot.
const click = (selector: string): void => {
  const button = shadow().querySelector<HTMLButtonElement>(selector)!
  clickListeners.get(button)!.call(button, { isTrusted: true } as MouseEvent)
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  clickListeners = new WeakMap()
  const addListener = EventTarget.prototype.addEventListener
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
    this: EventTarget,
    type,
    listener,
    options
  ) {
    if (type === 'click' && typeof listener === 'function') clickListeners.set(this, listener)
    return addListener.call(this, type, listener, options)
  })
  releaseCaptureUiSuppression()
  document.body.innerHTML = '<main><p>Original evidence</p></main>'
  send.mockReset().mockResolvedValue({ ok: true })
  vi.stubGlobal('chrome', { runtime: { sendMessage: send } })
})
afterEach(() => {
  suppressCaptureUi()
  releaseCaptureUiSuppression()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('post-capture card', () => {
  it('rejects page-script clicks on every privileged card action', async () => {
    updateToast({ status: 'success', card })
    for (const selector of ['.tag', '.view', '.recapture']) {
      shadow().querySelector<HTMLButtonElement>(selector)!.click()
    }
    await settle()
    expect(send).not.toHaveBeenCalled()
    expect(shadow().querySelector('.tag')!.getAttribute('aria-pressed')).toBe('false')
    expect(shadow().querySelector('.card')).not.toBeNull()
  })

  it('renders saved facts as inert text, three real tag toggles, and full-page mode', async () => {
    updateToast({ status: 'success', card })
    expect(shadow().textContent).toContain('Captured to Nightjar')
    expect(shadow().querySelector('.title')!.textContent).toBe(card.title)
    expect(shadow().querySelector('img')).toBeNull()
    expect(shadow().querySelector('.facts')!.textContent).toBe(
      'Full page · MHTML · sha256 recorded · #42'
    )
    expect(shadow().querySelector('.facts')!.getAttribute('title')).toBe(`SHA-256: ${card.hash}`)
    expect(shadow().querySelectorAll('.tag')).toHaveLength(3)
    click('.tag')
    await settle()
    expect(send).toHaveBeenCalledWith({
      type: 'CAPTURE_CARD_ACTION',
      captureId: card.captureId,
      action: 'tag',
      tagId: 't-1',
      applied: true
    })
    expect(shadow().querySelector('.tag')!.getAttribute('aria-pressed')).toBe('true')
    click('.tag')
    await settle()
    expect(shadow().querySelector('.tag')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps a failed toggle unchanged and surfaces its error', async () => {
    updateToast({ status: 'degraded', card, scrolling: true, message: 'Screenshot too large' })
    send.mockResolvedValueOnce({ ok: false, error: 'Could not update tag' })
    click('.tag')
    await settle()
    expect(shadow().querySelector('.tag')!.getAttribute('aria-pressed')).toBe('false')
    expect(shadow().querySelector('[role=alert]')!.textContent).toBe('Could not update tag')
    expect(shadow().querySelector('.facts')!.textContent).toContain('Full page (scrolling)')
    expect(shadow().querySelector('.warning')!.textContent).toBe('Screenshot too large')
  })

  it.each(['view', 'recapture'])(
    'dispatches %s and dismisses when acknowledged',
    async (action) => {
      updateToast({ status: 'success', card, scrolling: true })
      click(`.${action}`)
      await settle()
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CAPTURE_CARD_ACTION', action })
      )
      expect(document.getElementById('birdbrain-capture-toast')).toBeNull()
    }
  )

  it('holds five seconds, pauses for interaction, and can be dismissed immediately', () => {
    updateToast({ status: 'success', card })
    vi.advanceTimersByTime(4000)
    expect(document.getElementById('birdbrain-capture-toast')).not.toBeNull()
    shadow().querySelector('.card')!.dispatchEvent(new Event('mouseenter'))
    vi.advanceTimersByTime(6000)
    expect(document.getElementById('birdbrain-capture-toast')).not.toBeNull()
    shadow().querySelector('.card')!.dispatchEvent(new Event('mouseleave'))
    vi.advanceTimersByTime(5200)
    expect(document.getElementById('birdbrain-capture-toast')).toBeNull()
    updateToast({ status: 'success', card })
    click('.dismiss')
    expect(document.getElementById('birdbrain-capture-toast')).toBeNull()
  })

  it('restores the exact original DOM synchronously before recapture and refuses a late card during frames', () => {
    const expected = document.documentElement.outerHTML
    updateToast({ status: 'success', card })
    expect(document.documentElement.outerHTML).not.toBe(expected)
    expect(suppressCaptureUi()).toEqual([])
    expect(document.documentElement.outerHTML).toBe(expected)
    updateToast({ status: 'success', card })
    vi.runAllTimers()
    expect(document.documentElement.outerHTML).toBe(expected)
    releaseCaptureUiSuppression()
    updateToast({ status: 'success', card })
    expect(shadow().querySelector('.card')).not.toBeNull()
  })
})
