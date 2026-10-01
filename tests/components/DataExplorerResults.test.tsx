// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ExhibitVerification } from '@shared/types'
import type { CaseManifestSnapshot } from '@shared/manifestSnapshot'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case1' }),
  useNavigate: () => vi.fn()
}))
vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

import { DataExplorer } from '@renderer/components/dashboard/cases/DataExplorer'
import { certRole, commonName, parseHeaders } from '@renderer/components/data/HeadersTlsTab'
import { splitLine, highlightRegex } from '@renderer/components/data/ExtractedTextTab'
import { fakeBridge } from '../renderer/fakeBridge'
import { CAPTURES, HASH_A, INVENTORY } from '../renderer/dataFixtures'

const SNAPSHOT: CaseManifestSnapshot = {
  caseId: 'case1',
  entries: [
    {
      index: 0,
      parsed: true,
      entry: {
        type: 'capture',
        captureId: 'cap-a',
        caseId: 'case1',
        url: 'https://example.com/page',
        timestamp: '2026-09-01T10:00:00.000Z',
        contentHash: HASH_A,
        sizeBytes: 2048,
        operatorId: 'op',
        operatorName: 'Op',
        toolVersion: '1.0.0',
        index: 0,
        prevHash: '',
        schemaVersion: 2,
        entryHash: 'e'.repeat(64)
      }
    },
    {
      index: 1,
      parsed: true,
      entry: {
        type: 'derivation',
        caseId: 'case1',
        parentExhibitId: 'cap-a',
        parentContentHash: HASH_A,
        derivation: 'thumbnail',
        derivationToolVersion: '1.0.0',
        outputHash: 'c'.repeat(64),
        outputPath: 'case1/cap-a_thumb.jpg',
        timestamp: '2026-09-01T10:00:05.000Z',
        operatorId: 'op',
        operatorName: 'Op',
        toolVersion: '1.0.0',
        index: 1,
        prevHash: 'e'.repeat(64),
        schemaVersion: 3,
        entryHash: 'f'.repeat(64)
      }
    }
  ],
  chain: { valid: true },
  signers: [{ fromIndex: 0, toIndex: 1, fingerprint: 'ab'.repeat(32), source: 'local' }],
  head: { index: 1, entryHash: 'f'.repeat(64) },
  citationRule: { prefixed: false, localMemberCode: null }
}

const SELECTORS = [
  {
    id: 's1',
    caseId: 'case1',
    pattern: 'proton',
    isRegex: false,
    enabled: true,
    label: 'proton.me'
  },
  { id: 's2', caseId: 'case1', pattern: 'bc1q\\w+', isRegex: true, enabled: true }
]

let verify: ReturnType<typeof vi.fn>
let matchingCaptures: ReturnType<typeof vi.fn>
let getContent: ReturnType<typeof vi.fn>
let snapshotStub: CaseManifestSnapshot

function renderExplorer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<DataExplorer />, { wrapper: Wrapper })
}

function text(node: Element | ChildNode | null | undefined): string {
  return node?.textContent ?? ''
}

async function tree() {
  return within(await screen.findByRole('tree', { name: 'Case data' }))
}

async function select(key: string) {
  fireEvent.click(
    (await tree()).getByTestId(`data-tree-node-${key}`).querySelector('button:last-of-type')!
  )
}

beforeEach(() => {
  snapshotStub = SNAPSHOT
  verify = vi.fn(async (_caseId: string, exhibitId: string): Promise<ExhibitVerification> => ({
    exhibitId,
    caseId: 'case1',
    kind: 'capture',
    status: exhibitId === 'cap-a' ? 'verified' : 'legacy',
    derived:
      exhibitId === 'cap-a'
        ? [{ derivedFileId: 'thumb-a', derivation: 'thumbnail', status: 'verified' }]
        : []
  }))
  matchingCaptures = vi.fn(async () => ['cap-legacy'])
  getContent = vi.fn(async (id: string, type: string) =>
    id === 'cap-a' && type === 'txt' ? 'first line\nmail me at proton.me today\nlast' : null
  )
  fakeBridge({
    exhibits: {
      inventory: vi.fn(async () => ({ caseId: 'case1', rows: INVENTORY })),
      verify
    },
    captures: {
      list: vi.fn(async () =>
        CAPTURES.map((c) =>
          c.id === 'cap-a'
            ? {
                ...c,
                httpStatus: 200,
                headers: JSON.stringify({ server: 'nginx', 'content-type': 'text/html' }),
                tlsCertChain: {
                  url: 'https://example.com/page',
                  refetchedAt: '2026-09-01T10:00:02.000Z',
                  chain: [
                    {
                      subject: 'CN=example.com',
                      issuer: 'CN=Test CA',
                      validFrom: '2026-01-01',
                      validTo: '2027-01-01',
                      fingerprint256: 'ab'.repeat(32),
                      serialNumber: '1',
                      subjectAltNames: ['example.com']
                    }
                  ]
                }
              }
            : c
        )
      ),
      getContent
    },
    selectors: {
      list: vi.fn(async () => SELECTORS),
      matchCounts: vi.fn(async () => ({ s1: 1 })),
      matchingCaptures
    },
    manifest: { snapshot: vi.fn(async () => snapshotStub) },
    extractedData: { count: vi.fn(async () => 5) }
  })
})

afterEach(() => cleanup())

describe('DataExplorer results and tabs (#1150)', () => {
  it('shows the five-minus-one tabs for a Capture and only Properties for a pooled row', async () => {
    renderExplorer()
    fireEvent.click(await screen.findByTestId('artifact-row-cap-a'))
    const strip = within(await screen.findByTestId('artifact-tabs'))
    await waitFor(() =>
      expect(strip.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Extracted Text',
        'Headers & TLS',
        'Manifest Ledger',
        'Properties'
      ])
    )
    // No MHTML Parts tab: #991 owns it, and a tab with no data is absent.
    expect(strip.queryByRole('tab', { name: /MHTML/ })).toBeNull()

    // The strip opens on the leading tab once the text arrives; it used to
    // keep the tab that was first when it mounted, before the text (#1552).
    expect(strip.getByRole('tab', { name: 'Extracted Text' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    const textTab = within(strip.getByTestId('extracted-text-tab'))
    expect(text(textTab.getByText('mail me at proton.me today'))).toBeTruthy()
    expect(getContent).toHaveBeenCalledWith('cap-a', 'txt')

    fireEvent.click(strip.getByRole('tab', { name: 'Headers & TLS' }))
    const headers = within(strip.getByTestId('headers-tls-tab'))
    expect(text(headers.getByText('server').nextSibling)).toBe('nginx')
    expect(headers.getByTestId('tls-chain')).toBeTruthy()
    // The card heads with the role pill and the common name, the full subject
    // on its title, then labelled issuer, validity and fingerprint (#1552).
    const cert = within(headers.getByTestId('tls-cert-0'))
    expect(text(cert.getByTestId('tls-cert-role'))).toBe('leaf')
    expect(text(cert.getByTitle('CN=example.com'))).toBe('example.com')
    expect(text(cert.getByText('issuer').nextSibling)).toBe('CN=Test CA')
    expect(text(cert.getByText('valid').nextSibling)).toBe('2026-01-01 → 2027-01-01')
    expect(text(cert.getByText('fingerprint').nextSibling)).toBe('ab'.repeat(32))
    expect(headers.getByText(/Corroboration only/)).toBeTruthy()

    fireEvent.click(strip.getByRole('tab', { name: 'Manifest Ledger' }))
    const ledger = within(strip.getByTestId('manifest-ledger-tab'))
    expect(ledger.getByTestId('ledger-row-0').getAttribute('data-entry-type')).toBe('capture')
    expect(ledger.getByTestId('ledger-row-1').getAttribute('data-entry-type')).toBe('derivation')
    expect(text(ledger.getByTestId('chain-verdict'))).toBe('Chain intact through seq 0001')
  })

  // The tab used to list only the entries naming the row; the mock shows the
  // whole ledger and tints those entries instead (#1552).
  it('shows the whole ledger in the row’s tab and tints the entries naming the row', async () => {
    const [capture, other] = SNAPSHOT.entries
    if (!other.parsed || other.entry.type !== 'derivation') throw new Error('fixture shape')
    snapshotStub = {
      ...SNAPSHOT,
      entries: [
        capture,
        {
          ...other,
          entry: { ...other.entry, parentExhibitId: 'cap-other', outputHash: 'd'.repeat(64) }
        }
      ]
    }
    renderExplorer()
    fireEvent.click(await screen.findByTestId('artifact-row-cap-a'))
    fireEvent.click(await screen.findByRole('tab', { name: 'Manifest Ledger' }))
    const ledger = within(await screen.findByTestId('manifest-ledger-tab'))
    expect(ledger.getByTestId('ledger-row-0').getAttribute('data-highlighted')).toBe('true')
    expect(ledger.getByTestId('ledger-row-0').className).toContain('bg-accent-subtle')
    expect(ledger.getByTestId('ledger-row-1').getAttribute('data-highlighted')).toBeNull()
    expect(text(ledger.getByTestId('ledger-row-1'))).toContain('0001')
    const heads = ledger.getByTestId('ledger-rows').firstElementChild
    expect(Array.from(heads?.children ?? []).map((el) => el.textContent)).toEqual([
      'Seq',
      'Time (UTC)',
      'Event',
      'Target',
      'Entry hash',
      'Prev hash'
    ])
  })

  it('gives a legacy Capture with no text and no headers only the Properties tab', async () => {
    renderExplorer()
    fireEvent.click(await screen.findByTestId('artifact-row-cap-legacy'))
    const strip = within(await screen.findByTestId('artifact-tabs'))
    await waitFor(() => expect(getContent).toHaveBeenCalledWith('cap-legacy', 'txt'))
    expect(strip.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Properties'])
  })

  it('filters the table to a Selector’s matched Exhibits with no snippet, and highlights the text', async () => {
    renderExplorer()
    const rail = await tree()
    await waitFor(() => expect(rail.getByLabelText('Expand Keyword Hits')).toBeTruthy())
    fireEvent.click(rail.getByLabelText('Expand Keyword Hits'))
    expect(text(rail.getByTestId('data-tree-count-keyword:s1'))).toBe('1')
    expect(text(rail.getByTestId('data-tree-node-keyword:s2'))).toContain('bc1q\\w+')

    await select('keyword:s1')
    await waitFor(() => expect(matchingCaptures).toHaveBeenCalledWith('case1', ['s1']))
    expect(await screen.findByTestId('artifact-row-cap-legacy')).toBeTruthy()
    expect(screen.queryByTestId('artifact-row-cap-a')).toBeNull()
    expect(screen.queryByTestId('artifact-row-thumb-a')).toBeNull()
    expect(screen.queryByTestId('text-hit')).toBeNull()

    // The highlight is live from the Selector when a row with text is open.
    matchingCaptures.mockResolvedValue(['cap-a'])
    await select('data-sources')
    await select('keyword:s1')
    fireEvent.click(await screen.findByTestId('artifact-row-cap-a'))
    fireEvent.click(await screen.findByRole('tab', { name: 'Extracted Text' }))
    expect((await screen.findAllByTestId('text-hit')).map((m) => m.textContent)).toEqual(['proton'])
  })

  it('shows the three buckets, runs Verify all in sequence with progress, and re-buckets', async () => {
    renderExplorer()
    await select('integrity-exceptions')
    const strip = within(await screen.findByTestId('integrity-strip'))
    // Persisted state: cap-a tampered, cap-legacy legacy; the thumbnail has no
    // state of its own and none is inferred.
    expect(text(strip.getByTestId('bucket-verified'))).toBe('0 verified')
    expect(text(strip.getByTestId('bucket-exception'))).toBe(
      '1 tampered, missing, chain-broken or with a repeated number'
    )
    expect(text(strip.getByTestId('bucket-unverified'))).toBe('2 unverified')
    expect(screen.getByTestId('artifact-row-cap-a')).toBeTruthy()
    expect(screen.queryByTestId('artifact-row-thumb-a')).toBeNull()
    expect(text(screen.getByTestId('chain-verdict'))).toBe('Chain intact through seq 0001')

    // Sequential (X37): the second verify is not requested until the first
    // resolves, and the progress counter advances between them.
    let releaseFirst: (() => void) | undefined
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const original = verify.getMockImplementation() as (
      caseId: string,
      exhibitId: string
    ) => Promise<ExhibitVerification>
    verify.mockImplementation(async (caseId: string, exhibitId: string) => {
      if (exhibitId === 'cap-a') await firstDone
      return original(caseId, exhibitId)
    })
    fireEvent.click(strip.getByTestId('verify-all'))
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1))
    expect(text(strip.getByTestId('verify-all-progress'))).toBe('0 / 2')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(verify).toHaveBeenCalledTimes(1)
    releaseFirst!()
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(2))
    // One call per anchored Exhibit, in inventory order, never for the pool.
    expect(verify.mock.calls.map((c) => c[1])).toEqual(['cap-a', 'cap-legacy'])
    await waitFor(() => expect(text(strip.getByTestId('bucket-verified'))).toBe('2 verified'))
    expect(text(strip.getByTestId('bucket-exception'))).toBe(
      '0 tampered, missing, chain-broken or with a repeated number'
    )
    expect(text(strip.getByTestId('bucket-unverified'))).toBe('1 unverified')
    expect(screen.queryByTestId('artifact-row-cap-a')).toBeNull()
    expect(screen.getByText('No exceptions among the verified rows.')).toBeTruthy()
    const rail = await tree()
    await waitFor(() =>
      expect(text(rail.getByTestId('data-tree-count-integrity-exceptions'))).toBe('0')
    )
  })

  it('files a verify that threw as unverified for the session, not as its stale persisted state', async () => {
    verify.mockImplementation(async (_caseId: string, exhibitId: string) => {
      if (exhibitId === 'cap-a') throw new Error('EBUSY')
      return { exhibitId, caseId: 'case1', kind: 'capture', status: 'verified' }
    })
    renderExplorer()
    await select('integrity-exceptions')
    const strip = within(await screen.findByTestId('integrity-strip'))
    expect(text(strip.getByTestId('bucket-exception'))).toBe(
      '1 tampered, missing, chain-broken or with a repeated number'
    )
    fireEvent.click(strip.getByTestId('verify-all'))
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(text(strip.getByTestId('bucket-verified'))).toBe('1 verified'))
    // cap-a's persisted "tampered" is not repeated and it is not verified either.
    expect(text(strip.getByTestId('bucket-exception'))).toBe(
      '0 tampered, missing, chain-broken or with a repeated number'
    )
    expect(text(strip.getByTestId('bucket-unverified'))).toBe('2 unverified')
  })

  it('omits the text tab for a zero-byte sidecar and the ledger tab when only an unreadable line names the row', async () => {
    getContent.mockResolvedValue('')
    snapshotStub = {
      ...SNAPSHOT,
      entries: [{ index: 0, parsed: false, reason: 'Entry does not match the manifest schema' }],
      chain: { valid: false, unsupported: { index: 0, supportedSchemaVersion: 3 } },
      signers: [],
      head: { index: 0, entryHash: 'z'.repeat(64) }
    }
    renderExplorer()
    fireEvent.click(await screen.findByTestId('artifact-row-cap-a'))
    const strip = within(await screen.findByTestId('artifact-tabs'))
    await waitFor(() => expect(getContent).toHaveBeenCalledWith('cap-a', 'txt'))
    expect(strip.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Headers & TLS',
      'Properties'
    ])
  })

  it('renders the whole ledger with the verdict and the signer fingerprint', async () => {
    renderExplorer()
    await select('manifest-ledger')
    const view = within(await screen.findByTestId('manifest-ledger-view'))
    expect(text(view.getByTestId('chain-verdict'))).toBe('Chain intact through seq 0001')
    expect(text(view.getByTestId('ledger-signer'))).toBe(
      'seq 0–1: abababababab (this installation)'
    )
    expect(view.getByTestId('ledger-signer').getAttribute('title')).toBe('ab'.repeat(32))
    expect(view.getByTestId('ledger-row-0').getAttribute('data-entry-type')).toBe('capture')
    expect(text(view.getByTestId('ledger-row-0'))).toContain('cap-a · https://example.com/page')
    expect(screen.queryByTestId('artifact-table')).toBeNull()
  })

  it('shows a too-old verdict as its own outcome and never as tampering', async () => {
    snapshotStub = {
      ...SNAPSHOT,
      entries: [
        ...SNAPSHOT.entries,
        { index: 2, parsed: false, reason: 'Entry does not match the manifest schema' }
      ],
      chain: {
        valid: false,
        unsupported: {
          index: 2,
          entryType: 'hologram',
          schemaVersionSeen: 4,
          supportedSchemaVersion: 3
        }
      },
      signers: [],
      head: { index: 2, entryHash: 'g'.repeat(64) }
    }
    renderExplorer()
    await select('manifest-ledger')
    const view = within(await screen.findByTestId('manifest-ledger-view'))
    const verdict = view.getByTestId('chain-verdict')
    expect(verdict.getAttribute('data-tone')).toBe('unsupported')
    expect(text(verdict)).toContain('verifier too old')
    expect(text(verdict)).not.toMatch(/broken|tamper/i)
    expect(text(view.getByTestId('ledger-signers'))).toBe('Signers not attributed on this chain.')
    expect(view.getByTestId('ledger-row-2').getAttribute('data-entry-type')).toBe('unreadable')
  })
})

describe('TLS card helpers (#1552)', () => {
  const cert = (subject: string, issuer: string) => ({
    subject,
    issuer,
    validFrom: '',
    validTo: '',
    fingerprint256: '',
    serialNumber: '',
    subjectAltNames: []
  })

  it('reads the role from the chain position and a self-named issuer only', () => {
    expect(certRole(cert('CN=a.example', 'CN=R11'), 0)).toBe('leaf')
    // A self-named leaf is still the leaf: position 0 is what was served.
    expect(certRole(cert('CN=self', 'CN=self'), 0)).toBe('leaf')
    expect(certRole(cert('CN=R11', 'CN=ISRG Root X1'), 1)).toBe('intermediate')
    expect(certRole(cert('CN=ISRG Root X1', 'CN=ISRG Root X1'), 2)).toBe('root')
    // A chain the origin sent without its root ends on an intermediate.
    expect(certRole(cert('CN=R11', 'CN=ISRG Root X1'), 2)).toBe('intermediate')
  })

  it('takes the common name from a recorded name, or keeps the whole name', () => {
    expect(commonName('C=US, CN=R11, O=Let’s Encrypt')).toBe('R11')
    expect(commonName('CN=*.example.com')).toBe('*.example.com')
    expect(commonName('O=No CN Here')).toBe('O=No CN Here')
    expect(commonName('')).toBe('')
  })
})

describe('tab helpers', () => {
  it('parses object and array header shapes and falls back to text', () => {
    expect(parseHeaders('{"a":"1"}')).toEqual([['a', '1']])
    expect(parseHeaders('[{"name":"x","value":"y"}]')).toEqual([['x', 'y']])
    expect(parseHeaders('raw: text')).toEqual([['headers', 'raw: text']])
    expect(parseHeaders('')).toEqual([])
    expect(parseHeaders(undefined)).toEqual([])
  })

  it('splits a line around literal and regex hits, and survives a bad regex', () => {
    expect(splitLine('a proton b', highlightRegex({ pattern: 'proton', isRegex: false }))).toEqual([
      { text: 'a ', hit: false },
      { text: 'proton', hit: true },
      { text: ' b', hit: false }
    ])
    expect(splitLine('x.y', highlightRegex({ pattern: '.', isRegex: false }))).toEqual([
      { text: 'x', hit: false },
      { text: '.', hit: true },
      { text: 'y', hit: false }
    ])
    expect(splitLine('bc1qabc', highlightRegex({ pattern: 'bc1q\\w+', isRegex: true }))).toEqual([
      { text: 'bc1qabc', hit: true }
    ])
    expect(highlightRegex({ pattern: '(', isRegex: true })).toBeNull()
    expect(splitLine('plain', null)).toEqual([{ text: 'plain', hit: false }])
  })
})
