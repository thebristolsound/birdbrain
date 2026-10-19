// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubResizeObserverWithWidth } from './resizeObserverStub'
import {
  InvestigateView,
  type InvestigateSelection
} from '@renderer/components/investigate/InvestigateView'
import type {
  InvestigationView,
  RunProgressEvent,
  RunSummary,
  RunStatus
} from '@shared/investigation'
import {
  FIXTURE_BEFORE_RUN_VIEW,
  FIXTURE_IDS,
  FIXTURE_POPULATED_INQUIRY,
  FIXTURE_POPULATED_VIEW,
  FIXTURE_TEAMMATE
} from '@shared/investigationFixture'

const CASE_ID = 'c0ffee00-0000-4000-8000-000000000001'
const REVISION = FIXTURE_POPULATED_VIEW.revision
const NO_HANDLER = new Error(
  "Error invoking remote method 'investigation:getView': Error: No handler registered for 'investigation:getView'"
)

let reportWidth: (width: number) => void
let progress: ((event: RunProgressEvent) => void) | null

function investigationStubs(getView: () => Promise<InvestigationView>) {
  return {
    getView: vi.fn(getView),
    getRevision: vi.fn(async () => REVISION),
    startRun: vi.fn(async () => 'run-1'),
    cancelRun: vi.fn(async () => undefined),
    setWithheld: vi.fn(async () => REVISION),
    getSpan: vi.fn(),
    checkSpan: vi.fn(),
    getChanges: vi.fn(),
    decideJoint: vi.fn(),
    decideSpan: vi.fn(),
    chooseSubject: vi.fn(),
    addSubject: vi.fn(),
    keepSubject: vi.fn(),
    setSourceClass: vi.fn(),
    setCopyMark: vi.fn(),
    listOwnIdentifiers: vi.fn(),
    markOwnIdentifier: vi.fn(),
    unmarkOwnIdentifier: vi.fn()
  }
}

function install(stubs: ReturnType<typeof investigationStubs>) {
  fakeBridge({
    investigation: stubs,
    diagnostics: { log: vi.fn(async () => '') },
    onInvestigationProgress: vi.fn((callback: (event: RunProgressEvent) => void) => {
      progress = callback
      return () => {
        progress = null
      }
    })
  })
}

function mount(selection: InvestigateSelection = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <InvestigateView caseId={CASE_ID} caseName="Harbour inquiry" selection={selection} />
    </QueryClientProvider>
  )
}

function finishRun(runId: string, status: RunStatus) {
  act(() =>
    progress?.({
      caseId: CASE_ID,
      runId,
      phase: 'store',
      exhibitsRead: 11,
      exhibitsWithheld: 2,
      exhibitsTotal: 15,
      status,
      reason: null
    })
  )
}

// On a machine busy with other suites, one wait in this file ran past the one-second default.
const SLOW = { timeout: 5000 }

const runButton = () => screen.getByRole('button', { name: 'Run' })

beforeEach(() => {
  reportWidth = stubResizeObserverWithWidth()
  progress = null
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('InvestigateView, loading and a build with no engine', () => {
  it('shows a loading line and no setup while the view is read', () => {
    install(investigationStubs(() => new Promise(() => {})))
    mount()
    expect(screen.getByText('Loading the investigation view…')).toBeTruthy()
    expect(screen.queryByText('Ask the Case')).toBeNull()
  })

  it('shows only the load failure when no handler answers, as in a packaged build', async () => {
    const stubs = investigationStubs(async () => {
      throw NO_HANDLER
    })
    install(stubs)
    mount()

    expect(
      await screen.findByText(
        `Failed to load the investigation view: ${NO_HANDLER.message}`,
        undefined,
        SLOW
      )
    ).toBeTruthy()
    expect(screen.queryByText('Ask the Case')).toBeNull()
    expect(screen.queryByTestId('investigate-header')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(stubs.getView).toHaveBeenCalledTimes(2), SLOW)
    for (const [name, stub] of Object.entries(stubs)) {
      if (name !== 'getView') expect(stub, name).not.toHaveBeenCalled()
    }
  })
})

describe('InvestigateView, run setup', () => {
  it('shows the setup and its facts in the accepted wording before any run', async () => {
    install(investigationStubs(async () => FIXTURE_BEFORE_RUN_VIEW))
    mount()

    expect(await screen.findByRole('heading', { name: 'Ask the Case' }, SLOW)).toBeTruthy()
    expect(screen.getByText('Harbour inquiry')).toBeTruthy()
    const inquiry = screen.getByLabelText('Inquiry or claim')
    expect(inquiry.getAttribute('placeholder')).toBe(
      'Who owned the Marlow Star between 2019 and 2022?'
    )
    expect(screen.getByText('Starting Subjects')).toBeTruthy()
    expect(screen.getByText('Two Subjects with one name are listed separately')).toBeTruthy()

    const facts = Object.fromEntries(
      [...document.querySelectorAll('dt')].map((dt) => [
        dt.textContent,
        dt.nextElementSibling?.textContent
      ])
    )
    expect(Object.keys(facts)).toEqual([
      'Withheld from analysis',
      'Sources',
      'AI analysis',
      'What the run records'
    ])
    expect(facts['Withheld from analysis']).toMatch(/^2 Exhibits withheld/)
    expect(facts.Sources).toBe('Stored Case only')
    expect(facts['AI analysis']).toBe(
      'AI analysis is off. Without it, this run matches shared identifiers and identical text ' +
        'only. It cannot find a paraphrased retelling or a relation stated only in prose; an ' +
        'empty result never means there is no connection.'
    )
    expect(facts['What the run records']).toBe(
      'The inquiry, the starting Subjects, the withheld list, the Note passages it uses as they ' +
        'read now, and the Case state as of now.'
    )
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('lists every Subject once, picks and unpicks it, and keeps two Rowan Pikes apart', async () => {
    install(investigationStubs(async () => FIXTURE_BEFORE_RUN_VIEW))
    mount()
    await screen.findByRole('heading', { name: 'Ask the Case' }, SLOW)

    const subjects = FIXTURE_BEFORE_RUN_VIEW.subjects
    expect(screen.getAllByTestId('investigate-addable-subject')).toHaveLength(subjects.length)
    expect(screen.queryAllByTestId('investigate-picked-subject')).toHaveLength(0)

    const byline = screen.getByRole('button', {
      name: 'Add Rowan Pike (byline, gazette.example.com)'
    })
    const minutes = screen.getByRole('button', { name: 'Add Rowan Pike (harbour board minutes)' })
    expect(byline.textContent).toContain('person · byline, gazette.example.com')
    expect(minutes.textContent).toContain('person · harbour board minutes')

    fireEvent.click(byline)
    const picked = screen.getAllByTestId('investigate-picked-subject')
    expect(picked).toHaveLength(1)
    expect(picked[0].textContent).toContain('Rowan Pike')
    expect(screen.getAllByTestId('investigate-addable-subject')).toHaveLength(subjects.length - 1)

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Rowan Pike (byline, gazette.example.com)' })
    )
    expect(screen.queryAllByTestId('investigate-picked-subject')).toHaveLength(0)
    expect(screen.getAllByTestId('investigate-addable-subject')).toHaveLength(subjects.length)
  })

  it('shows each withheld Exhibit with its holders and clears only a flag of this installation', async () => {
    const view: InvestigationView = {
      ...FIXTURE_BEFORE_RUN_VIEW,
      withheld: [
        ...FIXTURE_BEFORE_RUN_VIEW.withheld,
        {
          exhibitId: 'held-by-nk',
          exhibitNumber: 4,
          memberCode: 'NK',
          name: 'Ferry timetable scan',
          holders: [FIXTURE_TEAMMATE]
        }
      ]
    }
    const stubs = investigationStubs(async () => view)
    install(stubs)
    mount()
    await screen.findByRole('heading', { name: 'Ask the Case' }, SLOW)

    const rows = screen.getAllByTestId('investigate-withheld-row')
    expect(rows.map((r) => r.textContent)).toEqual([
      'MB-8Private notes pageyour flagClear my flag',
      'MB-13Source contact sheetwithheld by you and NKClear my flag',
      'NK-4Ferry timetable scanwithheld by NK'
    ])

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Clear my flag' }))
    await waitFor(
      () =>
        expect(stubs.setWithheld).toHaveBeenCalledWith({
          caseId: CASE_ID,
          exhibitId: FIXTURE_IDS.exhibits.withheldAfter,
          withheld: false
        }),
      SLOW
    )
    expect(stubs.setWithheld).toHaveBeenCalledTimes(1)
  })

  it('runs from an inquiry or a picked Subject, and waits for the run to end', async () => {
    let view: InvestigationView = FIXTURE_BEFORE_RUN_VIEW
    const stubs = investigationStubs(async () => view)
    install(stubs)
    mount()
    await screen.findByRole('heading', { name: 'Ask the Case' }, SLOW)

    expect(runButton().hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Inquiry or claim'), { target: { value: '   ' } })
    expect(runButton().hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add Jun Sato' }))
    expect(runButton().hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add M. Calloway' }))
    fireEvent.change(screen.getByLabelText('Inquiry or claim'), {
      target: { value: `  ${FIXTURE_POPULATED_INQUIRY}  ` }
    })

    fireEvent.click(runButton())
    await waitFor(
      () =>
        expect(stubs.startRun).toHaveBeenCalledWith({
          caseId: CASE_ID,
          from: 'inquiry',
          inquiry: FIXTURE_POPULATED_INQUIRY,
          startingSubjectIds: [FIXTURE_IDS.subjects.sato, FIXTURE_IDS.subjects.calloway]
        }),
      SLOW
    )
    expect(stubs.startRun).toHaveBeenCalledTimes(1)
    expect(runButton().hasAttribute('disabled')).toBe(true)

    // Another run's end, and this run's progress, leave it waiting.
    finishRun('someone-else', 'stored')
    act(() =>
      progress?.({
        caseId: CASE_ID,
        runId: 'run-1',
        phase: 'search',
        exhibitsRead: 5,
        exhibitsWithheld: 2,
        exhibitsTotal: 15,
        status: 'running',
        reason: null
      })
    )
    expect(runButton().hasAttribute('disabled')).toBe(true)
    expect(stubs.getView).toHaveBeenCalledTimes(1)

    view = FIXTURE_POPULATED_VIEW
    finishRun('run-1', 'stored')
    expect(await screen.findByTestId('investigate-header', undefined, SLOW)).toBeTruthy()
    expect(stubs.getView).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Ask the Case')).toBeNull()
  })

  it('ends a run whose last event arrived before its id, and stays in setup when it was canceled', async () => {
    const stubs = investigationStubs(async () => FIXTURE_BEFORE_RUN_VIEW)
    stubs.startRun.mockImplementation(async () => {
      finishRun('run-early', 'canceled')
      return 'run-early'
    })
    install(stubs)
    mount()
    await screen.findByRole('heading', { name: 'Ask the Case' }, SLOW)
    fireEvent.click(screen.getByRole('button', { name: 'Add Jun Sato' }))
    fireEvent.click(runButton())

    await waitFor(() => expect(stubs.getView).toHaveBeenCalledTimes(2), SLOW)
    expect(runButton().hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('heading', { name: 'Ask the Case' })).toBeTruthy()
  })

  it('lets the Operator run again after the run fails to start', async () => {
    const stubs = investigationStubs(async () => FIXTURE_BEFORE_RUN_VIEW)
    stubs.startRun.mockRejectedValue(new Error('A run is already running in this Case'))
    install(stubs)
    mount()
    await screen.findByRole('heading', { name: 'Ask the Case' }, SLOW)
    fireEvent.click(screen.getByRole('button', { name: 'Add Jun Sato' }))
    fireEvent.click(runButton())

    await waitFor(() => expect(stubs.startRun).toHaveBeenCalledTimes(1), SLOW)
    await waitFor(() => expect(runButton().hasAttribute('disabled')).toBe(false), SLOW)
  })
})

describe('InvestigateView, header', () => {
  it('states what the stored run used', async () => {
    install(investigationStubs(async () => FIXTURE_POPULATED_VIEW))
    mount()
    const header = await screen.findByTestId('investigate-header', undefined, SLOW)
    const run = FIXTURE_POPULATED_VIEW.run as RunSummary

    expect(within(header).getByText('Joint map')).toBeTruthy()
    expect(within(header).getByText(FIXTURE_POPULATED_INQUIRY)).toBeTruthy()
    expect(within(header).getByText('Case as of 14:02 UTC, October 3, 2026')).toBeTruthy()
    expect(within(header).getByRole('button', { name: 'New run' })).toBeTruthy()
    expect(within(header).getByText('Starting from')).toBeTruthy()
    expect(
      within(header)
        .getAllByTestId('investigate-header-subject')
        .map((chip) => chip.textContent)
    ).toEqual(['M. Calloway person', 'Jun Sato person', 'The Ferryman pseudonym'])
    expect(screen.getByTestId('investigate-header-counts').textContent).toBe(
      `${run.counts.read} Exhibits read · ${run.counts.withheld} withheld · 2 not read`
    )
    expect(within(header).getByText('Sources: stored Case only')).toBeTruthy()
    expect(
      within(header).getByText('Followed: 2 Joints out from each starting Subject')
    ).toBeTruthy()
    expect(within(header).getByText('AI analysis off')).toBeTruthy()
  })

  it('takes the singular for one Exhibit and one Joint out, and shows a zero not-read count plainly', async () => {
    const run = FIXTURE_POPULATED_VIEW.run as RunSummary
    install(
      investigationStubs(async () => ({
        ...FIXTURE_POPULATED_VIEW,
        run: {
          ...run,
          parameters: { ...run.parameters, followDepth: 1 },
          counts: { ...run.counts, read: 1, notRead: [] }
        }
      }))
    )
    mount()
    expect(
      (await screen.findByTestId('investigate-header-counts', undefined, SLOW)).textContent
    ).toBe(`1 Exhibit read · ${run.counts.withheld} withheld · 0 not read`)
    expect(screen.queryByRole('button', { name: /not read/ })).toBeNull()
    expect(screen.getByText('Followed: 1 Joint out from each starting Subject')).toBeTruthy()
  })

  it('names the claim a Find more material run looked for', async () => {
    const run = FIXTURE_POPULATED_VIEW.run as RunSummary
    const joint = FIXTURE_POPULATED_VIEW.joints[0]
    install(
      investigationStubs(async () => ({
        ...FIXTURE_POPULATED_VIEW,
        run: { ...run, from: 'find-more', inquiry: null, jointId: joint.id }
      }))
    )
    mount()
    expect(
      await screen.findByText(`Find material for: ${joint.claim}`, undefined, SLOW)
    ).toBeTruthy()
  })

  it('opens the not-read breakdown with the reasons and no Show control', async () => {
    install(investigationStubs(async () => FIXTURE_POPULATED_VIEW))
    mount()
    const count = await screen.findByRole('button', { name: '2 not read' }, SLOW)
    expect(count.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(count)
    expect(count.getAttribute('aria-expanded')).toBe('true')
    const breakdown = screen.getByRole('group', { name: 'Exhibits this run did not read' })
    expect(count.getAttribute('aria-controls')).toBe(breakdown.id)
    expect(within(breakdown).getByText('This run did not read these Exhibits')).toBeTruthy()
    const info = within(breakdown).getByRole('img', {
      name: "What they hold is unknown to this run. They can still hold a Subject's identifiers."
    })
    expect(info.getAttribute('title')).toBe(info.getAttribute('aria-label'))
    expect(
      within(breakdown)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual([
      '1 Attachment · the run cannot read this kind',
      '1 Document · the run cannot read this kind'
    ])
    expect(screen.queryAllByRole('button', { name: /^Show/ })).toHaveLength(0)
    expect(screen.queryAllByRole('link', { name: /^Show/ })).toHaveLength(0)

    fireEvent.keyDown(breakdown, { key: 'Escape' })
    expect(count.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(count)
    fireEvent.click(count)
    fireEvent.click(count)
    expect(screen.queryByRole('group', { name: 'Exhibits this run did not read' })).toBeNull()
  })

  it('opens a new run setup and cancels back to the results', async () => {
    const stubs = investigationStubs(async () => FIXTURE_POPULATED_VIEW)
    install(stubs)
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'New run' }, SLOW))

    expect(screen.getByRole('heading', { name: 'Ask the Case' })).toBeTruthy()
    expect((screen.getByLabelText('Inquiry or claim') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryAllByTestId('investigate-picked-subject')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('investigate-header')).toBeTruthy()
    expect(stubs.startRun).not.toHaveBeenCalled()
  })
})

describe('InvestigateView, narrow-window arrangement', () => {
  async function mountResults(selection: InvestigateSelection = {}) {
    install(investigationStubs(async () => FIXTURE_POPULATED_VIEW))
    mount(selection)
    await screen.findByTestId('investigate-header', undefined, SLOW)
  }

  it('shows three labelled panes on a wide view and tabs on a narrow one', async () => {
    await mountResults()
    act(() => reportWidth(1152))
    expect(screen.queryByRole('tablist')).toBeNull()
    for (const name of ['Joint map and list', 'Joint detail', 'Source inspector']) {
      expect(screen.getByRole('region', { name })).toBeTruthy()
    }

    act(() => reportWidth(1000))
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Joints', 'Joint detail', 'Source'])
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Joint map and list' })).toBeTruthy()
  })

  it('names the middle tab for a selected Subject', async () => {
    await mountResults({ subjectId: FIXTURE_IDS.subjects.sato })
    act(() => reportWidth(1000))
    expect(screen.getByRole('tab', { name: 'Subject' })).toBeTruthy()
  })

  it('keeps the chosen tab across a change of width', async () => {
    await mountResults()
    act(() => reportWidth(1000))
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Source' }), { button: 0 })
    expect(screen.getByRole('region', { name: 'Source inspector' })).toBeTruthy()

    act(() => reportWidth(1152))
    expect(screen.queryByRole('tablist')).toBeNull()
    act(() => reportWidth(1000))
    expect(screen.getByRole('tab', { name: 'Source' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('region', { name: 'Source inspector' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Joint map and list' })).toBeNull()
  })

  it('measures the view, not the window', async () => {
    const innerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    try {
      await mountResults()
      act(() => reportWidth(1000))
      expect(screen.getByRole('tablist')).toBeTruthy()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth })
    }
  })
})
