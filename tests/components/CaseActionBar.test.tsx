// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import type { Case } from '@shared/types'

vi.mock('@renderer/components/status/SessionControls', () => ({
  SessionControls: () => <div data-testid="session-controls" />
}))
vi.mock('@renderer/components/export/ExportMenu', () => ({
  ExportMenu: ({ caseId, caseName }: { caseId: string; caseName: string }) => (
    <div data-testid="export-menu">{`${caseId}:${caseName}`}</div>
  )
}))

import { CaseActionBar } from '@renderer/components/layout/CaseActionBar'

afterEach(() => {
  cleanup()
})

describe('CaseActionBar', () => {
  it('carries the session switch and the Export menu for the open case', () => {
    render(<CaseActionBar caseData={{ id: 'case1', name: 'Operation Kestrel' } as Case} />)
    const bar = screen.getByTestId('case-action-bar')
    expect(within(bar).getByTestId('session-controls')).toBeTruthy()
    expect(within(bar).getByTestId('export-menu').textContent).toBe('case1:Operation Kestrel')
  })
})
