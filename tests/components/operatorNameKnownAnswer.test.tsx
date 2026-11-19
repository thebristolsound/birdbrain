// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { BirdbrainSettings } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge, quietVpnWarning } from '../renderer/fakeBridge'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn()
}))

import { OperatorConfig } from '@renderer/components/settings/OperatorConfig'
import { StartDialog } from '@renderer/components/launchedBrowser/StartDialog'

// The operator name is stamped on every Capture and embedded in the export certification, and
// two places write it: the Operator tab and the launch dialog. For one input both save the same
// value, or both save nothing.
const REFUSED = Symbol('nothing saved')
type Saved = string | typeof REFUSED

const SETTINGS = {
  operatorName: '',
  egress: { kind: 'direct' },
  lastActiveCaseId: null,
  tsaUrl: '',
  tsaEnabled: true
}

function mount(ui: ReactNode) {
  const update = vi.fn(async (partial: Partial<BirdbrainSettings>) => ({ ...SETTINGS, ...partial }))
  const activateCase = vi.fn(async (caseId: string) => ({
    activeCaseId: caseId,
    sessionActive: false,
    captureCount: 0
  }))
  const launch = vi.fn(async () => ({ state: 'none' }))
  fakeBridge({
    egress: { vpnStatus: vi.fn(async () => ({ vpnSeen: true })), ...quietVpnWarning() },
    cases: {
      list: vi.fn(async () => [{ id: 'case-1', name: 'Ferry Line', archived: false }])
    },
    settings: {
      get: vi.fn(async () => SETTINGS),
      getIdentity: vi.fn(async () => ({
        operatorName: '',
        operatorRole: '',
        operatorOrganization: '',
        installationId: 'installation-1'
      })),
      update
    },
    session: { activateCase },
    launchedBrowser: {
      list: vi.fn(async () => [
        {
          family: 'chrome',
          label: 'Google Chrome',
          executablePath: '/opt/google/chrome/chrome',
          chosen: false,
          lastVersion: null
        }
      ]),
      status: vi.fn(async () => ({ state: 'none' })),
      launch
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return { update, activateCase, launch }
}

function savedName({ update }: Pick<ReturnType<typeof mount>, 'update'>): Saved {
  expect(update.mock.calls.length).toBeLessThanOrEqual(1)
  const name = update.mock.calls[0]?.[0].operatorName
  return name === undefined ? REFUSED : name
}

// Long enough for a save to have been sent, were one coming.
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
}

// The Operator tab saves when the field loses focus.
async function operatorTabSaves(input: string): Promise<Saved> {
  const mounted = mount(<OperatorConfig />)
  const field = (await screen.findByLabelText(/Operator Name/)) as HTMLInputElement
  if (input !== '') fireEvent.change(field, { target: { value: input } })
  expect(field.value).toBe(input)
  fireEvent.blur(field)
  await settle()
  const saved = savedName(mounted)
  // A refusal says why; a save says nothing.
  expect(screen.queryAllByRole('alert').map((alert) => alert.textContent)).toEqual(
    saved === REFUSED ? ['Operator name is required for capture and export.'] : []
  )
  return saved
}

// The launch dialog saves when Launch is pressed, and holds Launch while the name is blank.
async function launchDialogSaves(input: string): Promise<Saved> {
  const mounted = mount(<StartDialog />)
  act(() => useAppStore.getState().openStartDialog('case-1'))
  const field = (await screen.findByRole('textbox', { name: 'Operator Name' })) as HTMLInputElement
  const launch = screen.getByRole('button', { name: 'Launch' }) as HTMLButtonElement
  // With a name in the field Launch can be pressed, so everything else it waits for has
  // loaded and only the name under test can hold it.
  fireEvent.change(field, { target: { value: 'Probe' } })
  await waitFor(() => expect(launch.disabled).toBe(false))
  fireEvent.change(field, { target: { value: input } })
  expect(field.value).toBe(input)
  fireEvent.click(launch)
  await settle()
  const saved = savedName(mounted)
  if (saved === REFUSED) {
    expect(launch.disabled).toBe(true)
    expect(mounted.activateCase).not.toHaveBeenCalled()
    expect(mounted.launch).not.toHaveBeenCalled()
  }
  return saved
}

afterEach(() => {
  cleanup()
  useAppStore.setState({ startDialogCaseId: null, startDialogPicking: false, sessionActive: false })
})

describe('the operator name the Operator tab and the launch dialog save', () => {
  it.each<[string, string, Saved]>([
    ['a plain name', 'A. Marsh', 'A. Marsh'],
    ['a name with spaces before and after it', '  A. Marsh  ', '  A. Marsh  '],
    ['an empty string', '', REFUSED],
    ['a string of spaces', '   ', REFUSED]
  ])('is the same for %s', async (_, input, expected) => {
    const fromTab = await operatorTabSaves(input)
    cleanup()
    const fromDialog = await launchDialogSaves(input)
    expect(fromTab).toBe(expected)
    expect(fromDialog).toBe(expected)
  })
})
