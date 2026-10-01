import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { ReportProblemDialog } from '@renderer/components/diagnostics/ReportProblemDialog'
import { fakeBridge } from '../renderer/fakeBridge'

// vi.hoisted: vi.mock is lifted above every top-level const, so a plain
// `const notifyError = vi.fn()` is still in its TDZ when the factory runs.
const { notifyError } = vi.hoisted(() => ({ notifyError: vi.fn() }))
vi.mock('@renderer/lib/notify', () => ({ notify: { error: notifyError } }))

const createReport = vi.fn().mockResolvedValue({ path: 'C:/x/report.zip' })

beforeEach(() => {
  vi.clearAllMocks()
  createReport.mockResolvedValue({ path: 'C:/x/report.zip' })
  fakeBridge({ diagnostics: { createReport } })
})

afterEach(() => {
  cleanup()
})

describe('ReportProblemDialog', () => {
  it('lists exactly what the bundle will contain', () => {
    render(<ReportProblemDialog open onOpenChange={() => {}} />)
    expect(screen.getByText(/diagnostics.json/)).toBeTruthy()
    expect(screen.getByText(/birdbrain.log/)).toBeTruthy()
    expect(screen.getByText(/never sends it anywhere/i)).toBeTruthy()
  })

  // report.md carries getInstallationId(), the value captures record as their
  // operatorId, so the tester has to be told before attaching it anywhere public.
  it('discloses the installation identifier', () => {
    render(<ReportProblemDialog open onOpenChange={() => {}} />)
    expect(screen.getByText(/installation identifier/i)).toBeTruthy()
  })

  it('points the tester at their issue, not a tester chat', () => {
    render(<ReportProblemDialog open onOpenChange={() => {}} />)
    expect(screen.getByText(/attach to your issue/i)).toBeTruthy()
    expect(screen.queryByText(/chat/i)).toBeNull()
    expect(screen.queryByText(/api key/i)).toBeNull()
  })

  it('sends the three fields when submitted', async () => {
    render(<ReportProblemDialog open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText(/what did you do/i), { target: { value: 'captured' } })
    fireEvent.change(screen.getByLabelText(/what did you expect/i), { target: { value: 'saved' } })
    fireEvent.change(screen.getByLabelText(/what happened/i), { target: { value: 'nothing' } })
    fireEvent.click(screen.getByRole('button', { name: /create report/i }))

    await waitFor(() =>
      expect(createReport).toHaveBeenCalledWith(
        expect.objectContaining({ whatYouDid: 'captured', whatHappened: 'nothing' })
      )
    )
  })

  it('closes the dialog once the report is created', async () => {
    const onOpenChange = vi.fn()
    render(<ReportProblemDialog open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: /create report/i }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('stays open when the user cancels the save dialog', async () => {
    createReport.mockResolvedValue(null)
    const onOpenChange = vi.fn()
    render(<ReportProblemDialog open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: /create report/i }))
    await waitFor(() => expect(createReport).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('passes the correlationId through when provided', async () => {
    render(<ReportProblemDialog open onOpenChange={() => {}} correlationId="log-123" />)
    fireEvent.click(screen.getByRole('button', { name: /create report/i }))
    await waitFor(() =>
      expect(createReport).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: 'log-123' })
      )
    )
  })

  // An unwritable destination or a full disk rejects createReport. Before this
  // was caught, the rejection went unhandled (the submit handler is invoked with
  // `void`), the dialog just stopped spinning, and the tester got no reason and
  // no next step — in the one workflow whose whole job is reporting a failure.
  it('surfaces a failure and keeps the typed text when saving rejects', async () => {
    createReport.mockRejectedValue(new Error('EACCES: permission denied'))
    const onOpenChange = vi.fn()
    render(<ReportProblemDialog open onOpenChange={onOpenChange} />)

    const whatHappened = screen.getByLabelText(/what happened/i)
    fireEvent.change(whatHappened, { target: { value: 'it exploded' } })
    fireEvent.click(screen.getByRole('button', { name: /create report/i }))

    await waitFor(() => expect(notifyError).toHaveBeenCalled())
    expect(notifyError.mock.calls[0][1]).toMatchObject({ code: 'app.bug_report_failed' })

    // Dialog stays open, and what the tester typed is still there.
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByLabelText(/what happened/i) as HTMLTextAreaElement).value).toBe(
      'it exploded'
    )
  })
})
