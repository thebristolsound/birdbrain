import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { ReportProblemDialog } from '@renderer/components/diagnostics/ReportProblemDialog'

const createReport = vi.fn().mockResolvedValue({ path: 'C:/x/report.zip' })

beforeEach(() => {
  vi.clearAllMocks()
  createReport.mockResolvedValue({ path: 'C:/x/report.zip' })
  vi.stubGlobal('birdbrain', { diagnostics: { createReport } })
})

afterEach(() => {
  cleanup()
})

describe('ReportProblemDialog', () => {
  it('lists exactly what the bundle will contain', () => {
    render(<ReportProblemDialog open onOpenChange={() => {}} />)
    expect(screen.getByText(/diagnostics.json/)).toBeTruthy()
    expect(screen.getByText(/birdbrain.log/)).toBeTruthy()
    expect(screen.getByText(/never leaves your computer/i)).toBeTruthy()
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
})
