// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DatabaseAdmin } from '@renderer/components/settings/DatabaseAdmin'
import { DbMaintenance } from '@renderer/components/settings/db/DbMaintenance'
import { OperatorConfig } from '@renderer/components/settings/OperatorConfig'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { DEFAULT_TSA_URL } from '@shared/constants'
import { fakeBridge } from '../renderer/fakeBridge'

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}

afterEach(cleanup)

describe('database maintenance', () => {
  it('offers the mock maintenance row on the Database card', async () => {
    fakeBridge({
      db: {
        stats: vi
          .fn()
          .mockResolvedValue({ schemaVersion: 1, dbFileSize: 0, walFileSize: 0, tables: [] })
      }
    })
    mount(<DatabaseAdmin />)
    expect(screen.getByRole('heading', { name: 'Database' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Vacuum' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Rebuild FTS index' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Integrity check' })).toBeDefined()
    await screen.findByText('v1')
  })

  it('reports the checked property and never claims capture verification', async () => {
    const integrityCheck = vi.fn().mockResolvedValue({ ok: true, issues: [] })
    fakeBridge({ db: { integrityCheck } })
    mount(<DbMaintenance />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrity check' }))
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'SQLite integrity and foreign-key checks passed.'
    )
    expect(screen.getByText(/does not verify capture files, manifests or timestamps/)).toBeDefined()
    expect(integrityCheck).toHaveBeenCalledOnce()
  })

  it('displays failures from SQLite rather than success', async () => {
    fakeBridge({
      db: {
        integrityCheck: vi
          .fn()
          .mockResolvedValue({ ok: false, issues: ['CHECK constraint failed in fixture'] })
      }
    })
    mount(<DbMaintenance />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrity check' }))
    expect(await screen.findByText('CHECK constraint failed in fixture')).toBeDefined()
    expect(screen.getByRole('status').textContent).toContain('found problems')
  })

  it('disables maintenance during a check and recovers after an error', async () => {
    let fail: (error: Error) => void = () => {}
    fakeBridge({
      db: {
        integrityCheck: vi.fn(
          () =>
            new Promise((_, reject) => {
              fail = reject
            })
        )
      }
    })
    mount(<DbMaintenance />)
    fireEvent.click(screen.getByRole('button', { name: 'Integrity check' }))
    await screen.findByRole('button', { name: 'Checking…' })
    expect(
      screen.getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled)
    ).toBe(true)
    fail(new Error('Database is locked'))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Database is locked')
    expect(
      (screen.getByRole('button', { name: 'Integrity check' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('keeps vacuum and search-index rebuilding wired to their existing operations', async () => {
    const vacuum = vi.fn().mockResolvedValue({ freedBytes: 1024 })
    const rebuildFts = vi.fn().mockResolvedValue({ rowsIndexed: 5, textsHealed: 2 })
    fakeBridge({ db: { vacuum, rebuildFts } })
    mount(<DbMaintenance />)
    fireEvent.click(screen.getByRole('button', { name: 'Vacuum' }))
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Vacuum complete. Freed 1,024 bytes.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild FTS index' }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Rebuilt FTS indexes. 5 rows indexed, 2 text(s) healed from disk.'
      )
    )
    expect(vacuum).toHaveBeenCalledOnce()
    expect(rebuildFts).toHaveBeenCalledOnce()
  })
})

describe('Operator card', () => {
  it('labels the five fields and preserves operator and timestamp saves', async () => {
    const identity = {
      operatorName: 'A. Analyst',
      operatorRole: 'Analyst',
      operatorOrganization: 'Research',
      installationId: 'install-1'
    }
    const update = vi.fn().mockResolvedValue({ ...identity, tsaUrl: DEFAULT_TSA_URL })
    fakeBridge({
      settings: {
        getIdentity: vi.fn().mockResolvedValue(identity),
        get: vi.fn().mockResolvedValue({ tsaUrl: DEFAULT_TSA_URL }),
        update
      }
    })
    mount(<OperatorConfig />)
    expect(await screen.findByRole('heading', { name: 'Operator', level: 2 })).toBeDefined()
    const name = screen.getByLabelText(/Operator Name/)
    expect(screen.getByLabelText('Installation ID')).toHaveProperty('readOnly', true)
    expect(screen.getAllByRole('textbox')).toHaveLength(5)
    fireEvent.change(name, { target: { value: 'New Operator' } })
    fireEvent.blur(name)
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        operatorName: 'New Operator',
        operatorRole: 'Analyst',
        operatorOrganization: 'Research'
      })
    )
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Researcher' } })
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'Team' } })
    fireEvent.blur(name)
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        operatorName: 'New Operator',
        operatorRole: 'Researcher',
        operatorOrganization: 'Team'
      })
    )
    fireEvent.change(name, { target: { value: '' } })
    fireEvent.blur(name)
    expect(
      await screen.findByText('Operator name is required for capture and export.')
    ).toBeDefined()
    const tsa = screen.getByLabelText('Trusted Timestamp Authority')
    fireEvent.change(tsa, { target: { value: '' } })
    fireEvent.blur(tsa)
    await waitFor(() => expect(update).toHaveBeenCalledWith({ tsaUrl: DEFAULT_TSA_URL }))
  })

  // #1169. The switch is the whole point of the issue, so all three of its jobs
  // are pinned: it shows the persisted state, it writes the opt-out, and it says
  // what declining costs and what it does not.
  describe('trusted-timestamping switch', () => {
    function mountOperator(tsaEnabled: boolean | undefined) {
      const update = vi.fn().mockResolvedValue({})
      fakeBridge({
        settings: {
          getIdentity: vi.fn().mockResolvedValue({
            operatorName: 'A. Analyst',
            operatorRole: 'Analyst',
            operatorOrganization: 'Research',
            installationId: 'install-1'
          }),
          get: vi.fn().mockResolvedValue({ tsaUrl: DEFAULT_TSA_URL, tsaEnabled }),
          update
        }
      })
      mount(<OperatorConfig />)
      return update
    }

    it('reads on, and writes the opt-out when switched off', async () => {
      const update = mountOperator(true)
      const toggle = await screen.findByRole('switch', { name: 'Trusted timestamping' })
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
      fireEvent.click(toggle)
      await waitFor(() => expect(update).toHaveBeenCalledWith({ tsaEnabled: false }))
    })

    it('reads off, writes the opt-back-in, and parks the endpoint field', async () => {
      const update = mountOperator(false)
      const toggle = await screen.findByRole('switch', { name: 'Trusted timestamping' })
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
      expect(screen.getByLabelText('Trusted Timestamp Authority')).toHaveProperty(
        'disabled',
        true
      )
      expect(screen.getByText(/Nothing is sent to this endpoint/)).toBeDefined()
      fireEvent.click(toggle)
      await waitFor(() => expect(update).toHaveBeenCalledWith({ tsaEnabled: true }))
    })

    it('states the consequence of declining, including that it is reversible', async () => {
      mountOperator(true)
      expect(
        await screen.findByText(/no capture is sent to a timestamp authority/i)
      ).toBeDefined()
      expect(screen.getByText(/timestamped if you turn it back on/i)).toBeDefined()
    })

    it('reads a settings file written before the switch existed as on', async () => {
      mountOperator(undefined)
      const toggle = await screen.findByRole('switch', { name: 'Trusted timestamping' })
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    })
  })
})

it('binds nested tab orientation to its own root', () => {
  mount(
    <Tabs orientation="vertical" defaultValue="outer">
      <TabsList aria-label="Settings">
        <TabsTrigger value="outer">Diagnostics</TabsTrigger>
      </TabsList>
      <TabsContent value="outer">
        <Tabs defaultValue="snapshot">
          <TabsList aria-label="Diagnostics">
            <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
            <TabsTrigger value="log">Log</TabsTrigger>
          </TabsList>
          <TabsContent value="snapshot">Snapshot content</TabsContent>
          <TabsContent value="log">Log content</TabsContent>
        </Tabs>
      </TabsContent>
    </Tabs>
  )
  const outer = screen.getByRole('tablist', { name: 'Settings' })
  const inner = screen.getByRole('tablist', { name: 'Diagnostics' })
  expect(outer.getAttribute('data-orientation')).toBe('vertical')
  expect(inner.getAttribute('data-orientation')).toBe('horizontal')
  expect(
    within(inner)
      .getAllByRole('tab')
      .every((tab) => tab.getAttribute('data-orientation') === 'horizontal')
  ).toBe(true)
  fireEvent.mouseDown(within(inner).getByRole('tab', { name: 'Log' }), {
    button: 0,
    ctrlKey: false
  })
  expect(screen.getByText('Log content')).toBeDefined()
})
