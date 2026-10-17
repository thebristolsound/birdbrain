// Invented data for the fake investigation engine (engine plan E10; issue #1885). The fake in
// src/main/services/investigation/fakeEngine.ts serves every `investigation:` channel from this
// module, and renderer tests import the same views. It lives under src/shared because the renderer
// test project has no @main path. CI-V5 removes it with the fake (ruling 63).
//
// Every person is named with one of the engine spec's invented names, and every host is
// example.com, example.net or example.org or a subdomain of one (E14), the Wayback snapshot URL
// included, so following a fixture link never reaches a real site. A handle appears only as a
// profile URL on an invented platform under one of those hosts. The populated result seeds
// decisions and marks for the view to render; they are not a history a run could produce.

import {
  compareMembers,
  compareSourceClassHeads,
  sortInvestigationView
} from '@shared/investigation'
import type {
  AcceptanceContext,
  CaseRevision,
  ClaimCheck,
  ExhibitRef,
  GapGroup,
  GapTarget,
  InvestigationView,
  JointDecisionView,
  JointStatus,
  JointView,
  MemberRef,
  OutOfDate,
  OwnIdentifierEntry,
  PathView,
  Producer,
  Reading,
  RuleId,
  RunParameters,
  RunRequest,
  RunSummary,
  SourceClass,
  SourceClassHead,
  SpanDate,
  SpanDetail,
  SpanLocator,
  SpanView,
  StrengthSummary,
  SubjectView,
  WaitingSpanView,
  WaybackRefView
} from '@shared/investigation'
import type { ExhibitVerification } from '@shared/types'

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

// A deterministic 64-hex stand-in for a hash (FNV-1a, eight salted rounds). Not a digest of
// anything stored: the fixture has no stored bytes.
export function fixtureHash(input: string): string {
  let out = ''
  for (let round = 0; round < 8; round += 1) {
    let h = (0x811c9dc5 ^ round) >>> 0
    for (let i = 0; i < input.length; i += 1) {
      h = Math.imul(h ^ input.charCodeAt(i), 0x01000193) >>> 0
    }
    out += h.toString(16).padStart(8, '0')
  }
  return out
}

export const FIXTURE_IDS = {
  exhibits: {
    newsreader: uuid(0x101),
    ledger: uuid(0x102),
    article: uuid(0x103),
    copy: uuid(0x104),
    forum: uuid(0x105),
    aiSummary: uuid(0x106),
    mailArchive: uuid(0x107),
    byline: uuid(0x108),
    withheldAfter: uuid(0x109),
    tampered: uuid(0x10a),
    missing: uuid(0x10b),
    headersOnly: uuid(0x10c),
    events: uuid(0x10d),
    withheldBefore: uuid(0x10e),
    forwarded: uuid(0x10f)
  },
  subjects: {
    calloway: uuid(0x201),
    sato: uuid(0x202),
    ferryman: uuid(0x203),
    pikeByline: uuid(0x204),
    pikeMinutes: uuid(0x205),
    hale: uuid(0x206),
    account: uuid(0x207),
    article: uuid(0x208),
    copy: uuid(0x209),
    ledgerSite: uuid(0x20a)
  },
  joints: {
    satoAddress: uuid(0x301),
    callowaySato: uuid(0x302),
    satoFerryman: uuid(0x303),
    ferrymanArticle: uuid(0x304),
    sharedPassage: uuid(0x305),
    citation: uuid(0x306),
    earlierRun: uuid(0x307),
    haleAddress: uuid(0x308),
    ledgerLostSide: uuid(0x309),
    noteClaim: uuid(0x30a),
    noteClaimRun: uuid(0x30b)
  },
  passageGroup: uuid(0x501),
  note: uuid(0x601),
  persona: uuid(0x701),
  earlierRun: uuid(0x801),
  populatedRun: uuid(0x802),
  ownIdentifiers: { personaMail: uuid(0x901), teammateHandle: uuid(0x902) }
} as const

export const FIXTURE_SELF: MemberRef = { memberCode: 'MB', operatorName: 'Operator MB', self: true }
export const FIXTURE_TEAMMATE: MemberRef = {
  memberCode: 'NK',
  operatorName: 'Operator NK',
  self: false
}

export const FIXTURE_POPULATED_INQUIRY =
  'Are M. Calloway, Jun Sato, and The Ferryman the same writer?'
// The engine plan's I3: a relation stated only in prose, which the base layer cannot find.
export const FIXTURE_NO_JOINTS_INQUIRY = 'Who owned the Marlow Star between 2019 and 2022?'
// The claim a Note-claim run records; the fake reads no Note, so the text is the fixture's.
export const FIXTURE_NOTE_CLAIM = 'M. Calloway also writes as The Ferryman.'
export const FIXTURE_FOOTER = 'This page is part of the Harrow community archive.'

export const FIXTURE_DEFAULT_PARAMETERS: RunParameters = {
  version: 'params/1',
  followDepth: 2,
  sharedPassageMinWords: 12,
  passageGroupCeiling: 8,
  commonHostShare: 0.05,
  sharedHostListVersion: 'hosts/1'
}

export const FIXTURE_VERSIONS: RunSummary['versions'] = {
  rules: [
    { rule: 'reply-or-citation', version: '1' },
    { rule: 'same-field', version: '1' },
    { rule: 'shared-identifier', version: '1' },
    { rule: 'shared-passage', version: '1' }
  ],
  normalizer: 'idnorm/1',
  extractor: 'fields/2'
}

export const FIXTURE_MANIFEST_HEAD: CaseRevision['manifestHead'] = {
  index: 41,
  entryHash: fixtureHash('manifest-head')
}

const EARLIER_RUN_AT = '2026-10-01T09:00:00.000Z'
// Exhibits the Case holds beyond the fixture's, which the first slice does not read (E12).
const NOT_READ: RunSummary['counts']['notRead'] = [
  { kind: 'attachment', reason: 'kind-not-read', count: 1 },
  { kind: 'document', reason: 'kind-not-read', count: 1 }
]

// --- Exhibits ---------------------------------------------------------------------------------

export interface FixtureExhibit extends ExhibitRef {
  kind: string
  name: string
  url: string | null
  integrity: ExhibitVerification['status']
  bodyAcquired: boolean
  dates: SpanDate[]
  waybackRefs: WaybackRefView[]
  // The stored representation the fixture's spans and excerpts are cut from.
  text: string
}

const E = FIXTURE_IDS.exhibits
const captured = (at: string): SpanDate => ({ kind: 'captured', at })

function exhibit(
  exhibitId: string,
  exhibitNumber: number,
  memberCode: string,
  name: string,
  url: string | null,
  body: string,
  extra: Partial<FixtureExhibit> = {}
): FixtureExhibit {
  return {
    exhibitId,
    exhibitNumber,
    memberCode,
    kind: 'capture',
    name,
    url,
    integrity: 'verified',
    bodyAcquired: true,
    dates: [captured('2026-09-20T10:00:00.000Z')],
    waybackRefs: [],
    text: body,
    ...extra
  }
}

const withFooter = (body: string): string => `${body}\n\n${FIXTURE_FOOTER}`
const ARTICLE_URL = 'https://gazette.example.com/2026/03/12/old-ferry'
const PASSAGE = 'The old ferry ran twice a day until the bridge opened'
const ADDRESS = 'calloway@harrow.example.net'
const PROFILE = 'https://social.example.org/@ferryman'

const EXHIBITS: FixtureExhibit[] = [
  exhibit(
    E.newsreader,
    1,
    'MB',
    'local.history: the old ferry timetable',
    'https://news.harrow.example.net/local.history/123',
    withFooter(
      `Path: news.harrow.example.net!not-for-mail\nFrom: Jun Sato <${ADDRESS}>\n` +
        'Newsgroups: local.history\nSubject: The old ferry timetable\n' +
        'NNTP-Posting-Host: 192.0.2.44\n\nDoes anyone still have the 1987 timetable for the ferry?'
    )
  ),
  exhibit(
    E.ledger,
    2,
    'MB',
    'Contributors: M. Calloway',
    'https://ledger.example.org/contributors/m-calloway',
    withFooter(
      '<h1>M. Calloway</h1><p>M. Calloway writes the river column.</p>' +
        `<p><a href="mailto:${ADDRESS}">Write to M. Calloway</a></p>`
    )
  ),
  exhibit(
    E.article,
    3,
    'MB',
    'Tide tables and the old ferry',
    ARTICLE_URL,
    withFooter(
      `<h1>Tide tables and the old ferry</h1><p>By The Ferryman</p><p>${PASSAGE}, and the ` +
        'timetable changed with the tides.</p><img alt="Ferry timetable, 1987" src="t.png">' +
        `<p>Follow the author at <a href="${PROFILE}">${PROFILE}</a></p>`
    ),
    {
      dates: [
        captured('2026-09-20T10:00:00.000Z'),
        { kind: 'stated', at: '2026-03-12' },
        { kind: 'stamped', at: '2026-09-20T10:00:05.000Z' }
      ],
      waybackRefs: [
        {
          snapshotUrl: `https://archive.example.org/web/20260312090000/${ARTICLE_URL}`,
          originalUrl: ARTICLE_URL,
          snapshotTimestamp: '2026-03-12T09:00:00.000Z',
          checkedAt: '2026-09-21T08:30:00.000Z',
          pinnedAt: '2026-09-21T08:31:00.000Z'
        }
      ]
    }
  ),
  exhibit(
    E.copy,
    1,
    'NK',
    'The old ferry (reposted)',
    'https://reposter.example.net/ferry-copy',
    withFooter(
      `<p>Reposted: ${PASSAGE}, and the timetable changed with the tides.</p>` +
        `<p>Original: <a href="${ARTICLE_URL}">${ARTICLE_URL}</a></p>`
    ),
    { dates: [captured('2026-09-22T14:00:00.000Z'), { kind: 'stated', at: null }] }
  ),
  exhibit(
    E.forum,
    4,
    'MB',
    'Forum profile: The Ferryman',
    'https://forum.example.org/u/ferryman',
    withFooter(
      `<p>The Ferryman. Elsewhere: <a href="${PROFILE}">${PROFILE}</a></p><p>Contact: ${ADDRESS}</p>`
    )
  ),
  exhibit(
    E.aiSummary,
    5,
    'MB',
    'Summary: who is The Ferryman?',
    'https://summaries.example.com/ferryman',
    withFooter(
      `<p>The Ferryman is Jun Sato's pen name. Reach the writer at ${ADDRESS}.</p>` +
        '<p>This summary was generated automatically.</p>'
    )
  ),
  exhibit(
    E.mailArchive,
    6,
    'MB',
    'harbour-list: minutes for May',
    'https://lists.example.net/archive/2024/msg00042',
    withFooter(
      'From: Rowan Pike <rpike@lists.example.net>\nTo: harbour-list@lists.example.net\n' +
        'Subject: Minutes for May\n\nThe minutes are attached.'
    )
  ),
  exhibit(
    E.byline,
    7,
    'MB',
    'Harbour works begin',
    'https://gazette.example.com/2024/05/02/harbour',
    withFooter('<h1>Harbour works begin</h1><p>By Rowan Pike</p><p>Work starts on Monday.</p>')
  ),
  exhibit(
    E.withheldAfter,
    8,
    'MB',
    'Private notes page',
    'https://notes.example.org/private/ferryman',
    `<p>Contact for The Ferryman: ${ADDRESS}</p>`
  ),
  exhibit(
    E.tampered,
    9,
    'MB',
    'ledger.example.org: contact',
    'https://ledger.example.org/contact',
    `<p>Contact the ledger at ${ADDRESS}.</p>`,
    { integrity: 'tampered' }
  ),
  exhibit(
    E.missing,
    10,
    'MB',
    'ledger.example.org: about',
    'https://ledger.example.org/about',
    `<p>About the ledger. Editor: ${ADDRESS}.</p>`,
    { integrity: 'missing' }
  ),
  exhibit(
    E.headersOnly,
    11,
    'MB',
    'ledger.example.org (headers only)',
    'https://ledger.example.org/',
    'https://ledger.example.org/',
    { bodyAcquired: false }
  ),
  exhibit(
    E.events,
    12,
    'MB',
    'Readings and talks, 3 May',
    'https://events.example.com/2026/05/03',
    withFooter(
      '<p>M. Calloway gave a reading in Lisbon on 3 May.</p>' +
        '<p>Jun Sato spoke in Toronto on 3 May.</p><p>A J. Sato from another city sent apologies.</p>'
    )
  ),
  exhibit(
    E.withheldBefore,
    13,
    'MB',
    'Source contact sheet',
    'https://notes.example.org/private/sheet',
    '<p>Do not analyse.</p>'
  ),
  exhibit(
    E.forwarded,
    14,
    'MB',
    'Fwd: lantern newsletter',
    'https://mail.example.com/view/fwd-lantern',
    withFooter(
      '---------- Forwarded message ----------\nFrom: Imogen Hale <ihale@lantern.example.org>\n' +
        'Subject: Lantern newsletter\n\nThe next issue is out on Friday.'
    )
  )
]

// --- Spans ------------------------------------------------------------------------------------

export interface FixtureSpanBase {
  id: string
  exhibitId: string
  locator: SpanLocator
  value: string
  check: ClaimCheck | null
  holders: { count: number; of: number } | null
  identifier: { kind: string; platform: string | null; value: string } | null
}

export interface FixtureJointSpan extends FixtureSpanBase {
  side: 'a' | 'b' | null
  reading: Reading
  review: SpanView['review']
  addedBy: MemberRef | null
}

const VERIFIED: ClaimCheck = { text: 'present', basis: 'hash-verified', reason: null }
const READ_OF = 13
const ADDRESS_HOLDERS = { count: 4, of: READ_OF }
const MAIL = { kind: 'mail', platform: null, value: ADDRESS }
const HANDLE = { kind: 'handle', platform: 'social.example.org', value: PROFILE }

let spanSeq = 0x400

function baseSpan(
  exhibitId: string,
  field: string,
  value: string,
  extra: Partial<FixtureSpanBase> = {}
): FixtureSpanBase {
  const ex = EXHIBITS.find((e) => e.exhibitId === exhibitId)
  const start = ex ? ex.text.indexOf(value) : -1
  if (!ex || start < 0) throw new Error(`fixture: "${value}" is not in exhibit ${exhibitId}`)
  spanSeq += 1
  const representation: SpanLocator['representation'] =
    field === 'capture.url' ? 'capture-url' : field.startsWith('link.') ? 'html-part' : 'text'
  return {
    id: uuid(spanSeq),
    exhibitId,
    locator: {
      representation,
      field,
      part: representation === 'html-part' ? 0 : null,
      start,
      end: start + value.length,
      extractor: 'fields/2'
    },
    value,
    check: VERIFIED,
    holders: null,
    identifier: null,
    ...extra
  }
}

function jointSpan(
  side: 'a' | 'b' | null,
  review: SpanView['review'],
  addedBy: MemberRef | null,
  base: FixtureSpanBase,
  reading: Reading = 'supports'
): FixtureJointSpan {
  return { ...base, side, reading, review, addedBy }
}

const addressSpan = (exhibitId: string, field = 'text.address'): FixtureSpanBase =>
  baseSpan(exhibitId, field, ADDRESS, { holders: ADDRESS_HOLDERS, identifier: MAIL })

// --- Subjects and Joints ------------------------------------------------------------------------

export interface FixtureSubject {
  id: string
  name: string
  kind: string
  detail: string | null
  boundExhibitId: string | null
  createdByRunId: string | null // null: the Operator added it
  kept: boolean
}

export interface FixtureJoint {
  id: string
  identityHash: string
  claim: string
  subjectIds: [string] | [string, string]
  producer: Producer
  // Null for a Joint a same-name choice started, which no run created.
  createdByRunId: string | null
  spans: FixtureJointSpan[]
  decisions: JointDecisionView[]
  strength: StrengthSummary | null
  weak: boolean
}

export interface FixtureWaitingGroup {
  groupKey: string
  span: FixtureSpanBase
  rows: { id: string; subjectId: string }[]
  choice: WaitingSpanView['choice']
  createdByRunId: string | null
}

export interface FixturePassageGroup {
  id: string
  passage: string
  holders: FixtureSpanBase[]
}

interface FixturePath {
  fromSubjectId: string
  toSubjectId: string
  jointIds: string[]
  throughSubjectIds: string[]
  directJointId: string | null
}

const S = FIXTURE_IDS.subjects
const J = FIXTURE_IDS.joints

// A run-created template carries a null run id until applyPopulatedResult stamps the run's.
function subject(
  id: string,
  name: string,
  kind: string,
  detail: string | null = null,
  boundExhibitId: string | null = null
): FixtureSubject {
  return { id, name, kind, detail, boundExhibitId, createdByRunId: null, kept: false }
}

const OPERATOR_SUBJECTS: FixtureSubject[] = [
  subject(S.calloway, 'M. Calloway', 'person'),
  subject(S.sato, 'Jun Sato', 'person'),
  subject(S.ferryman, 'The Ferryman', 'pseudonym'),
  subject(S.pikeByline, 'Rowan Pike', 'person', 'byline, gazette.example.com'),
  subject(S.pikeMinutes, 'Rowan Pike', 'person', 'harbour board minutes'),
  subject(S.hale, 'Imogen Hale', 'person')
]

const RUN_SUBJECTS: FixtureSubject[] = [
  subject(S.account, ADDRESS, 'account'),
  subject(S.article, 'Tide tables and the old ferry', 'document', 'MB-3', E.article),
  subject(S.copy, 'The old ferry (reposted)', 'document', 'NK-1', E.copy),
  subject(S.ledgerSite, 'ledger.example.org', 'site')
]

const rule = (r: RuleId): Producer => ({ kind: 'rule', rule: r, version: '1' })

function decision(
  n: number,
  member: MemberRef,
  seq: number,
  kind: JointDecisionView['decision'],
  extra: { reason?: string; context?: AcceptanceContext } = {}
): JointDecisionView {
  return {
    id: uuid(0x1000 + n),
    member,
    seq,
    decision: kind,
    reason: extra.reason ?? null,
    context: extra.context ?? null,
    decidedAt: `2026-10-0${2 + (n % 7)}T12:00:00.000Z`
  }
}

const accepted = (n: number, member: MemberRef): JointDecisionView =>
  decision(n, member, 1, 'accept', {
    context: {
      assumptions: 'The address is not shared by a household.',
      confidence: 'Fairly sure, in my own words.',
      alternatives: 'A shared office mailbox.'
    }
  })

function joint(
  id: string,
  key: string,
  claim: string,
  subjectIds: FixtureJoint['subjectIds'],
  producer: Producer,
  spans: FixtureJointSpan[],
  extra: Partial<FixtureJoint> = {}
): FixtureJoint {
  return {
    id,
    identityHash: fixtureHash(`identity:${key}`),
    claim,
    subjectIds,
    producer,
    createdByRunId: null,
    spans,
    decisions: [],
    strength: null,
    weak: false,
    ...extra
  }
}

function runJoints(): FixtureJoint[] {
  return [
    joint(
      J.satoAddress,
      'sato-address',
      `Jun Sato used ${ADDRESS}`,
      [S.sato],
      rule('same-field'),
      [jointSpan(null, 'support', FIXTURE_SELF, addressSpan(E.newsreader, 'header.from'))],
      {
        decisions: [accepted(1, FIXTURE_SELF)],
        strength: {
          sourceClasses: [{ sourceClass: 'unclassified', count: 1 }],
          independentSources: 1,
          distinctiveMatches: 1,
          conflicts: 0
        },
        weak: true
      }
    ),
    joint(
      J.callowaySato,
      'calloway-sato',
      `M. Calloway and Jun Sato used ${ADDRESS}`,
      [S.calloway, S.sato],
      rule('shared-identifier'),
      [
        jointSpan(
          'a',
          'support',
          FIXTURE_SELF,
          baseSpan(E.ledger, 'link.href', `mailto:${ADDRESS}`, {
            holders: ADDRESS_HOLDERS,
            identifier: MAIL
          })
        ),
        jointSpan('b', 'support', FIXTURE_TEAMMATE, addressSpan(E.newsreader, 'header.from')),
        jointSpan(
          'a',
          'conflict',
          FIXTURE_SELF,
          baseSpan(E.events, 'text.passage', 'M. Calloway gave a reading in Lisbon on 3 May'),
          'unclear'
        ),
        jointSpan(
          'b',
          'unreviewed',
          null,
          baseSpan(E.events, 'text.passage', 'Jun Sato spoke in Toronto on 3 May'),
          'unclear'
        )
      ],
      {
        decisions: [accepted(2, FIXTURE_TEAMMATE), accepted(3, FIXTURE_SELF)],
        strength: {
          sourceClasses: [
            { sourceClass: 'contemporaneous', count: 1 },
            { sourceClass: 'unclassified', count: 1 }
          ],
          independentSources: 2,
          distinctiveMatches: 1,
          conflicts: 1
        }
      }
    ),
    joint(
      J.satoFerryman,
      'sato-ferryman',
      `Jun Sato and The Ferryman used ${ADDRESS}`,
      [S.sato, S.ferryman],
      rule('shared-identifier'),
      [
        jointSpan('a', 'support', FIXTURE_SELF, addressSpan(E.newsreader, 'header.from')),
        jointSpan(
          'b',
          'support',
          FIXTURE_SELF,
          baseSpan(E.forum, 'text.address', ADDRESS, {
            holders: ADDRESS_HOLDERS,
            identifier: MAIL,
            check: { text: 'present', basis: 'unattested', reason: null }
          })
        ),
        jointSpan(
          'b',
          'unreviewed',
          null,
          baseSpan(E.aiSummary, 'text.passage', "The Ferryman is Jun Sato's pen name"),
          'unclear'
        ),
        jointSpan(
          'a',
          'dismissed',
          FIXTURE_SELF,
          baseSpan(E.events, 'text.passage', 'A J. Sato from another city sent apologies'),
          'unclear'
        )
      ],
      {
        decisions: [accepted(4, FIXTURE_SELF), accepted(5, FIXTURE_TEAMMATE)],
        strength: {
          sourceClasses: [{ sourceClass: 'unclassified', count: 2 }],
          independentSources: 2,
          distinctiveMatches: 1,
          conflicts: 0
        }
      }
    ),
    joint(
      J.ferrymanArticle,
      'ferryman-article',
      `The Ferryman and "Tide tables and the old ferry" link to ${PROFILE}`,
      [S.ferryman, S.article],
      rule('shared-identifier'),
      [
        jointSpan(
          'a',
          'support',
          FIXTURE_TEAMMATE,
          baseSpan(E.forum, 'link.href', PROFILE, { identifier: HANDLE })
        ),
        jointSpan(
          'b',
          'support',
          FIXTURE_TEAMMATE,
          baseSpan(E.article, 'link.href', PROFILE, { identifier: HANDLE })
        )
      ],
      {
        decisions: [accepted(6, FIXTURE_TEAMMATE)],
        strength: {
          sourceClasses: [{ sourceClass: 'unclassified', count: 2 }],
          independentSources: 2,
          distinctiveMatches: 1,
          conflicts: 0
        }
      }
    ),
    joint(
      J.sharedPassage,
      'shared-passage',
      'Both contain the passage beginning "The old ferry ran twice a day"',
      [S.article, S.copy],
      rule('shared-passage'),
      [
        jointSpan('a', 'unreviewed', null, baseSpan(E.article, 'text.passage', PASSAGE)),
        jointSpan('b', 'unreviewed', null, baseSpan(E.copy, 'text.passage', PASSAGE)),
        jointSpan(
          'a',
          'unreviewed',
          null,
          baseSpan(E.article, 'link.alt', 'Ferry timetable, 1987', {
            check: {
              text: 'cannot-check',
              basis: null,
              reason: 'The timetable text sits in an image the run cannot read.'
            }
          }),
          'unclear'
        )
      ]
    ),
    joint(
      J.citation,
      'citation',
      'The reposted copy links to "Tide tables and the old ferry"',
      [S.copy, S.article],
      rule('reply-or-citation'),
      [jointSpan('a', 'support', FIXTURE_SELF, baseSpan(E.copy, 'link.href', ARTICLE_URL))],
      {
        decisions: [
          decision(7, FIXTURE_SELF, 1, 'reject', {
            reason: "The link is the copy's credit line, not a citation of a claim."
          })
        ]
      }
    ),
    joint(
      J.earlierRun,
      'calloway-ferryman',
      `M. Calloway and The Ferryman used ${ADDRESS}`,
      [S.calloway, S.ferryman],
      rule('shared-identifier'),
      [
        jointSpan(
          'a',
          'unreviewed',
          null,
          baseSpan(E.ledger, 'link.href', `mailto:${ADDRESS}`, {
            holders: ADDRESS_HOLDERS,
            identifier: MAIL
          })
        ),
        jointSpan('b', 'support', FIXTURE_TEAMMATE, addressSpan(E.aiSummary)),
        jointSpan('b', 'support', FIXTURE_SELF, addressSpan(E.withheldAfter))
      ],
      { createdByRunId: FIXTURE_IDS.earlierRun }
    ),
    joint(
      J.haleAddress,
      'hale-address',
      'Imogen Hale used ihale@lantern.example.org',
      [S.hale],
      rule('same-field'),
      [
        jointSpan(
          null,
          'support',
          FIXTURE_TEAMMATE,
          baseSpan(E.forwarded, 'header.from', 'ihale@lantern.example.org', {
            holders: { count: 1, of: READ_OF },
            identifier: { kind: 'mail', platform: null, value: 'ihale@lantern.example.org' }
          })
        )
      ],
      {
        decisions: [
          decision(8, FIXTURE_TEAMMATE, 1, 'accept', {
            context: {
              assumptions: 'The newsletter is her own.',
              confidence: 'Moderate.',
              alternatives: null
            }
          }),
          decision(9, FIXTURE_SELF, 1, 'reject', {
            reason: 'The address sits in a quoted header of a forwarded message.'
          })
        ]
      }
    ),
    joint(
      J.ledgerLostSide,
      'ledger-lost-side',
      `M. Calloway and ledger.example.org use ${ADDRESS}`,
      [S.calloway, S.ledgerSite],
      rule('shared-identifier'),
      [
        jointSpan(
          'a',
          'support',
          FIXTURE_SELF,
          baseSpan(E.headersOnly, 'capture.url', 'https://ledger.example.org/')
        ),
        jointSpan('b', 'support', FIXTURE_SELF, {
          ...addressSpan(E.tampered),
          check: null
        }),
        jointSpan('b', 'support', FIXTURE_SELF, { ...addressSpan(E.missing), check: null })
      ],
      { decisions: [accepted(10, FIXTURE_SELF)] }
    ),
    joint(
      J.noteClaim,
      'note-claim',
      'M. Calloway edited the letters page of the ledger in 2023.',
      [S.calloway],
      { kind: 'operator', noteId: FIXTURE_IDS.note },
      []
    )
  ]
}

// Built once, so every fake and every plain view carries the same span ids.
const RUN_JOINTS = runJoints()

const PATHS: FixturePath[] = [
  {
    fromSubjectId: S.calloway,
    toSubjectId: S.ferryman,
    jointIds: [J.callowaySato, J.satoFerryman],
    throughSubjectIds: [S.sato],
    directJointId: J.earlierRun
  },
  {
    fromSubjectId: S.ferryman,
    toSubjectId: S.copy,
    jointIds: [J.ferrymanArticle, J.sharedPassage],
    throughSubjectIds: [S.article],
    directJointId: null
  }
]

// Three gap kinds (missing-date, missing-original, same-name-unjoined) are fixed entries of the
// populated result and do not follow later writes; every other gap kind is derived at read time.
const STATIC_GAPS: GapGroup[] = [
  {
    kind: 'missing-date',
    entries: [{ kind: 'exhibit', exhibitId: E.copy, spanId: null, field: 'date' }]
  },
  {
    kind: 'missing-original',
    entries: [{ kind: 'exhibit', exhibitId: E.forwarded, spanId: null, field: null }]
  },
  {
    kind: 'same-name-unjoined',
    entries: [{ kind: 'subjects', subjectIds: [S.pikeByline, S.pikeMinutes] }]
  }
]

// --- State --------------------------------------------------------------------------------------

// One Case's investigation data as the fake holds it. Plain records, so the fake can change them
// and the view builder below derives every list, status and path from them at read time (E9), and
// every gap except the three in STATIC_GAPS.
export interface FixtureState {
  populated: boolean
  subjects: FixtureSubject[]
  joints: FixtureJoint[]
  waiting: FixtureWaitingGroup[]
  passageGroups: FixturePassageGroup[]
  withheld: Record<string, MemberRef[]>
  sourceClass: Record<string, SourceClassHead[]>
  copyMarks: { copyExhibitId: string; originalExhibitId: string; member: MemberRef }[]
  ownIdentifiers: OwnIdentifierEntry[]
  // Each run's start time, for a Joint's "proposed from the Case as of" label.
  runStarts: Record<string, string>
}

export interface FixtureRun {
  id: string
  startedAt: string
}

const head = (value: SourceClass, member: MemberRef, reason: string | null): SourceClassHead => ({
  value,
  member,
  reason,
  actedAt: '2026-10-01T08:00:00.000Z'
})

const WAITING_SPAN = baseSpan(E.mailArchive, 'header.from', 'Rowan Pike')
const PASSAGE_HOLDERS = [
  E.newsreader,
  E.ledger,
  E.article,
  E.copy,
  E.forum,
  E.aiSummary,
  E.mailArchive,
  E.byline,
  E.events,
  E.forwarded
].map((id) => baseSpan(id, 'text.passage', FIXTURE_FOOTER))

export function createFixtureState(): FixtureState {
  return structuredClone({
    populated: false,
    subjects: OPERATOR_SUBJECTS,
    joints: [],
    waiting: [],
    passageGroups: [],
    withheld: {
      [E.withheldAfter]: [FIXTURE_SELF],
      [E.withheldBefore]: [FIXTURE_TEAMMATE, FIXTURE_SELF]
    },
    sourceClass: {
      [E.ledger]: [head('contemporaneous', FIXTURE_SELF, null)],
      [E.article]: [
        head('original', FIXTURE_SELF, 'The byline and date match the paper.'),
        head('later-copy', FIXTURE_TEAMMATE, 'The paper reprints wire copy.')
      ],
      [E.copy]: [head('later-copy', FIXTURE_SELF, null)],
      [E.aiSummary]: [head('ai-origin', FIXTURE_TEAMMATE, 'The page says it was generated.')],
      [E.events]: [head('commercial', FIXTURE_SELF, null)]
    },
    copyMarks: [{ copyExhibitId: E.copy, originalExhibitId: E.article, member: FIXTURE_SELF }],
    ownIdentifiers: [
      {
        id: FIXTURE_IDS.ownIdentifiers.personaMail,
        kind: 'mail',
        platform: null,
        value: 'mb.operator@post.example.com',
        personaId: FIXTURE_IDS.persona,
        member: FIXTURE_SELF
      },
      {
        id: FIXTURE_IDS.ownIdentifiers.teammateHandle,
        kind: 'handle',
        platform: 'social.example.org',
        value: 'https://social.example.org/@harbourwatch',
        personaId: null,
        member: FIXTURE_TEAMMATE
      }
    ],
    runStarts: { [FIXTURE_IDS.earlierRun]: EARLIER_RUN_AT }
  })
}

// The populated run's result: Subjects, Joints, the same-name span and the passage group, each
// stamped as created by `run`. A second populated run finds them in place and creates nothing.
export function applyPopulatedResult(state: FixtureState, run: FixtureRun): void {
  state.runStarts[run.id] = run.startedAt
  if (state.populated) return
  const fresh = structuredClone({
    subjects: RUN_SUBJECTS,
    joints: RUN_JOINTS,
    waiting: [
      {
        groupKey: fixtureHash('same-name:rowan-pike'),
        span: WAITING_SPAN,
        rows: [
          { id: uuid(0x4f1), subjectId: S.pikeByline },
          { id: uuid(0x4f2), subjectId: S.pikeMinutes }
        ],
        choice: null,
        createdByRunId: null
      }
    ],
    passageGroups: [
      { id: FIXTURE_IDS.passageGroup, passage: FIXTURE_FOOTER, holders: PASSAGE_HOLDERS }
    ]
  })
  for (const item of [...fresh.subjects, ...fresh.joints, ...fresh.waiting]) {
    item.createdByRunId ??= run.id
  }
  state.subjects.push(...fresh.subjects)
  state.joints.push(...fresh.joints)
  state.waiting.push(...fresh.waiting)
  state.passageGroups.push(...fresh.passageGroups)
  state.populated = true
}

// A Note-claim run adds the populated result and one Operator-started Joint with no support.
export function applyNoteClaimResult(
  state: FixtureState,
  run: FixtureRun,
  request: Extract<RunRequest, { from: 'note-claim' }>
): void {
  applyPopulatedResult(state, run)
  const subjectIds = request.subjectIds.slice(0, 2) as FixtureJoint['subjectIds']
  const existing = state.joints.find((j) => j.id === J.noteClaimRun)
  const producer: Producer = { kind: 'operator', noteId: request.noteId }
  if (existing) {
    existing.subjectIds = subjectIds
    existing.producer = producer
    return
  }
  state.joints.push(
    joint(J.noteClaimRun, 'note-claim-run', FIXTURE_NOTE_CLAIM, subjectIds, producer, [], {
      createdByRunId: run.id
    })
  )
}

// The ids a stored run counts as its own proposals: the Joints, Subjects and spans it created.
// A decision on one of them leaves that run current (ADR-0042).
export function runCreatedIds(state: FixtureState, runId: string): Set<string> {
  const ids = new Set<string>()
  for (const s of state.subjects) if (s.createdByRunId === runId) ids.add(s.id)
  for (const j of state.joints) {
    if (j.createdByRunId !== runId) continue
    ids.add(j.id)
    for (const span of j.spans) ids.add(span.id)
  }
  for (const group of state.waiting) {
    if (group.createdByRunId === runId) for (const row of group.rows) ids.add(row.id)
  }
  return ids
}

export function fixtureExhibit(exhibitId: string): FixtureExhibit | undefined {
  return EXHIBITS.find((e) => e.exhibitId === exhibitId)
}

export function fixtureRunCounts(state: FixtureState): RunSummary['counts'] {
  const withheld = Object.values(state.withheld).filter((holders) => holders.length > 0).length
  const notRead = NOT_READ.reduce((sum, n) => sum + n.count, 0)
  const total = EXHIBITS.length + notRead
  return { total, read: total - withheld - notRead, withheld, notRead: structuredClone(NOT_READ) }
}

// --- Derivation ---------------------------------------------------------------------------------

export function effectiveSourceClass(heads: SourceClassHead[]): SourceClass {
  const values = [...new Set(heads.map((h) => h.value))]
  if (values.length === 0) return 'unclassified'
  if (values.length === 1) return values[0]
  return values.includes('ai-origin') ? 'ai-origin' : 'unclassified'
}

function exhibitOf(exhibitId: string): FixtureExhibit {
  const ex = fixtureExhibit(exhibitId)
  if (!ex) throw new Error(`fixture: no exhibit ${exhibitId}`)
  return ex
}

const refOf = ({ exhibitId, exhibitNumber, memberCode }: ExhibitRef): ExhibitRef => ({
  exhibitId,
  exhibitNumber,
  memberCode
})

function availability(state: FixtureState, exhibitId: string): SpanView['availability'] {
  const ex = exhibitOf(exhibitId)
  if (ex.integrity === 'tampered' || ex.integrity === 'missing') return 'unavailable'
  if ((state.withheld[exhibitId] ?? []).length > 0) return 'withheld'
  if (effectiveSourceClass(state.sourceClass[exhibitId] ?? []) === 'ai-origin') {
    return 'no-longer-counted'
  }
  return 'available'
}

function copyOf(state: FixtureState, exhibitId: string): ExhibitRef | null {
  const mark = state.copyMarks.find((m) => m.copyExhibitId === exhibitId)
  return mark ? refOf(exhibitOf(mark.originalExhibitId)) : null
}

function spanView(state: FixtureState, span: FixtureJointSpan): SpanView {
  const ex = exhibitOf(span.exhibitId)
  return {
    id: span.id,
    exhibitId: ex.exhibitId,
    exhibitNumber: ex.exhibitNumber,
    memberCode: ex.memberCode,
    contentHash: fixtureHash(`content:${ex.exhibitId}`),
    locator: span.locator,
    value: span.value,
    side: span.side,
    reading: span.reading,
    review: span.review,
    availability: availability(state, ex.exhibitId),
    check: span.check,
    holders: span.holders,
    sourceClass: effectiveSourceClass(state.sourceClass[ex.exhibitId] ?? []),
    dates: ex.dates,
    addedBy: span.addedBy,
    copyOf: copyOf(state, ex.exhibitId)
  }
}

const memberKey = (m: MemberRef): string => m.memberCode ?? m.operatorName

export function jointStatus(decisions: JointDecisionView[]): JointStatus {
  const heads = new Map<string, JointDecisionView['decision']>()
  for (const d of [...decisions].sort((a, b) => a.seq - b.seq))
    heads.set(memberKey(d.member), d.decision)
  const values = [...heads.values()]
  if (values.includes('accept') && values.includes('reject')) return 'contested'
  if (values.includes('accept')) return 'accepted'
  if (values.includes('reject')) return 'rejected'
  return 'proposed'
}

export interface ViewContext {
  revision: CaseRevision
  run: RunSummary | null
  outOfDate: OutOfDate | null
}

function jointView(state: FixtureState, joint: FixtureJoint): JointView {
  const lists: Pick<
    JointView,
    'support' | 'conflicts' | 'unreviewed' | 'noLongerCounted' | 'dismissed'
  > = { support: [], conflicts: [], unreviewed: [], noLongerCounted: [], dismissed: [] }
  for (const span of joint.spans.map((s) => spanView(state, s))) {
    // An AI-origin span stays unreviewed material, without Add as support (view brief, decision
    // 14); once reviewed it stops counting, as a withheld or unavailable span does at once.
    if (span.review === 'dismissed') lists.dismissed.push(span)
    else if (span.availability === 'withheld' || span.availability === 'unavailable') {
      lists.noLongerCounted.push(span)
    } else if (span.availability === 'no-longer-counted' && span.review !== 'unreviewed') {
      lists.noLongerCounted.push(span)
    } else if (span.review === 'support') lists.support.push(span)
    else if (span.review === 'conflict') lists.conflicts.push(span)
    else lists.unreviewed.push(span)
  }
  const status = jointStatus(joint.decisions)
  const lostSide =
    status === 'accepted' && joint.subjectIds.length === 2
      ? ((['a', 'b'] as const).find((side) => !lists.support.some((s) => s.side === side)) ?? null)
      : null
  const runId = joint.createdByRunId
  const asOf = runId ? (state.runStarts[runId] ?? null) : null
  return {
    id: joint.id,
    identityHash: joint.identityHash,
    claim: joint.claim,
    subjectIds: joint.subjectIds,
    producer: joint.producer,
    basis: { runId, asOf },
    proposalHash:
      runId === null
        ? null
        : fixtureHash(`proposal:${joint.identityHash}:${joint.spans.map((s) => s.id).join(',')}`),
    createdByRunId: runId,
    status,
    decisions: joint.decisions,
    ...lists,
    strength: joint.strength,
    weak: joint.weak,
    lostSide
  }
}

function waitingView(
  group: FixtureWaitingGroup,
  row: { id: string; subjectId: string }
): WaitingSpanView {
  const ex = exhibitOf(group.span.exhibitId)
  return {
    id: row.id,
    groupKey: group.groupKey,
    subjectId: row.subjectId,
    candidateSubjectIds: group.rows.map((r) => r.subjectId),
    ...refOf(ex),
    contentHash: fixtureHash(`content:${ex.exhibitId}`),
    locator: group.span.locator,
    value: group.span.value,
    choice: group.choice
  }
}

function subjectView(state: FixtureState, s: FixtureSubject, ctx: ViewContext): SubjectView {
  const rows = state.waiting.flatMap((g) =>
    g.rows.filter((r) => r.subjectId === s.id).map((r) => waitingView(g, r))
  )
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    detail: s.detail,
    boundExhibitId: s.boundExhibitId,
    starting: ctx.run?.startingSubjectIds.includes(s.id) ?? false,
    createdByRunId: s.createdByRunId,
    kept: s.kept,
    waiting: rows.filter((r) => r.choice === null),
    placed: rows.filter((r) => r.choice !== null)
  }
}

function derivedGaps(joints: JointView[]): GapGroup[] {
  const entries = (pick: (j: JointView) => boolean): GapTarget[] =>
    joints.filter(pick).map((j) => ({ kind: 'joint', jointId: j.id }))
  return [
    {
      kind: 'claim-without-support',
      entries: entries((j) => j.producer.kind === 'operator' && j.support.length === 0)
    },
    {
      kind: 'accepted-with-unreviewed',
      entries: entries((j) => j.status === 'accepted' && j.unreviewed.length > 0)
    },
    {
      kind: 'accepted-lost-support',
      entries: entries(
        (j) => j.status === 'accepted' && (j.support.length === 0 || j.lostSide !== null)
      )
    },
    { kind: 'contested', entries: entries((j) => j.status === 'contested') },
    { kind: 'weak', entries: entries((j) => j.weak && j.status !== 'rejected') }
  ]
}

// A possible path names each Joint on it not yet accepted; a path's far end is reached only through
// another Subject unless an accepted Joint joins the two ends directly.
function pathGaps(paths: PathView[], joints: JointView[]): GapGroup[] {
  const unaccepted = new Set(
    paths
      .filter((p) => !p.accepted)
      .flatMap((p) => p.jointIds)
      .filter((id) => joints.find((j) => j.id === id)?.status !== 'accepted')
  )
  const joinedDirectly = (path: PathView): boolean =>
    joints.some(
      (j) =>
        j.status === 'accepted' &&
        j.subjectIds.includes(path.fromSubjectId) &&
        j.subjectIds.includes(path.toSubjectId)
    )
  const farEnds = new Set(paths.filter((p) => !joinedDirectly(p)).map((p) => p.toSubjectId))
  return [
    {
      kind: 'reached-only-through-another',
      entries: [...farEnds].map((id) => ({ kind: 'subjects', subjectIds: [id] }))
    },
    {
      kind: 'path-on-unaccepted-joint',
      entries: [...unaccepted].map((jointId) => ({ kind: 'joint', jointId }))
    }
  ]
}

function pathViews(joints: JointView[]): PathView[] {
  const byId = new Map(joints.map((j) => [j.id, j]))
  const paths: PathView[] = []
  for (const path of PATHS) {
    const onPath = path.jointIds.map((id) => byId.get(id))
    // A rejected Joint, or an accepted one that lost support, never forms part of a path.
    if (
      onPath.some(
        (j) => !j || j.status === 'rejected' || (j.status === 'accepted' && j.lostSide !== null)
      )
    ) {
      continue
    }
    const direct = path.directJointId ? byId.get(path.directJointId) : undefined
    paths.push({
      ...path,
      jointIds: [...path.jointIds],
      throughSubjectIds: [...path.throughSubjectIds],
      accepted: onPath.every((j) => j?.status === 'accepted'),
      directJointId: direct && direct.status !== 'accepted' ? direct.id : null
    })
  }
  return paths
}

export function buildInvestigationView(state: FixtureState, ctx: ViewContext): InvestigationView {
  const joints = state.joints.map((j) => jointView(state, j))
  const paths = pathViews(joints)
  const ceiling =
    ctx.run?.parameters.passageGroupCeiling ?? FIXTURE_DEFAULT_PARAMETERS.passageGroupCeiling
  const gaps: GapGroup[] = ctx.run
    ? [
        ...derivedGaps(joints),
        ...pathGaps(paths, joints),
        ...(state.populated ? structuredClone(STATIC_GAPS) : []),
        {
          kind: 'search-not-run',
          entries: ctx.run.counts.notRead.map((n) => ({
            kind: 'unread',
            exhibitKind: n.kind,
            reason: n.reason,
            count: n.count
          }))
        }
      ]
    : []
  return sortInvestigationView({
    revision: ctx.revision,
    run: ctx.run,
    outOfDate: ctx.outOfDate,
    subjects: state.subjects.map((s) => subjectView(state, s, ctx)),
    joints,
    passageGroups: state.passageGroups.map((g) => ({
      id: g.id,
      passageHash: fixtureHash(`passage:${g.passage}`),
      passage: g.passage,
      holders: g.holders.map((h) => ({ ...refOf(exhibitOf(h.exhibitId)), spanId: h.id })),
      count: g.holders.length,
      ceiling
    })),
    paths,
    gaps: gaps.filter((g) => g.entries.length > 0),
    withheld: Object.entries(state.withheld)
      .filter(([, holders]) => holders.length > 0)
      .map(([exhibitId, holders]) => {
        const ex = exhibitOf(exhibitId)
        return { ...refOf(ex), name: ex.name, holders }
      })
  })
}

// Every span the view can name: a Joint's spans, the same-name rows and the passage group's.
export function findFixtureSpan(
  state: FixtureState,
  spanId: string
): { base: FixtureSpanBase; joint: FixtureJointSpan | null } | null {
  for (const j of state.joints) {
    const span = j.spans.find((s) => s.id === spanId)
    if (span) return { base: span, joint: span }
  }
  for (const g of state.waiting) {
    if (g.rows.some((r) => r.id === spanId)) return { base: { ...g.span, id: spanId }, joint: null }
  }
  for (const g of state.passageGroups) {
    const span = g.holders.find((h) => h.id === spanId)
    if (span) return { base: span, joint: null }
  }
  return null
}

export function buildSpanDetail(state: FixtureState, spanId: string): SpanDetail | null {
  const found = findFixtureSpan(state, spanId)
  if (!found) return null
  const { base } = found
  const ex = exhibitOf(base.exhibitId)
  const avail = availability(state, ex.exhibitId)
  const heads = state.sourceClass[ex.exhibitId] ?? []
  const holders = state.withheld[ex.exhibitId] ?? []
  const own = base.identifier
    ? state.ownIdentifiers.find(
        (o) =>
          o.kind === base.identifier?.kind &&
          o.platform === base.identifier.platform &&
          o.value === base.identifier.value
      )
    : undefined
  const window = 60
  const from = Math.max(0, base.locator.start - window)
  return {
    spanId,
    locator: base.locator,
    value: base.value,
    availability: avail,
    check: base.check,
    holders: base.holders,
    exhibit: {
      ...refOf(ex),
      kind: ex.kind,
      name: ex.name,
      contentHash: fixtureHash(`content:${ex.exhibitId}`),
      integrity: ex.integrity,
      bodyAcquired: ex.bodyAcquired
    },
    excerpt:
      avail === 'unavailable'
        ? null
        : {
            text: ex.text.slice(from, base.locator.end + window),
            start: base.locator.start - from,
            end: base.locator.end - from
          },
    sourceClass: {
      effective: effectiveSourceClass(heads),
      heads: [...heads].sort(compareSourceClassHeads)
    },
    withheld: { withheld: holders.length > 0, holders: [...holders].sort(compareMembers) },
    copyMarks: state.copyMarks
      .filter((m) => m.copyExhibitId === ex.exhibitId || m.originalExhibitId === ex.exhibitId)
      .map((m) => ({
        copy: refOf(exhibitOf(m.copyExhibitId)),
        original: refOf(exhibitOf(m.originalExhibitId)),
        member: m.member
      })),
    sourceTrail: { url: ex.url, waybackRefs: ex.waybackRefs },
    identifier: base.identifier && { ...base.identifier, ownIdentifierId: own?.id ?? null }
  }
}

// --- Plain views for renderer tests -------------------------------------------------------------

const PLAIN_GENERATION = fixtureHash('generation')
const PLAIN_STARTED_AT = '2026-10-03T14:02:00.000Z'

function plainSummary(state: FixtureState): RunSummary {
  return {
    id: FIXTURE_IDS.populatedRun,
    from: 'inquiry',
    inquiry: FIXTURE_POPULATED_INQUIRY,
    noteId: null,
    jointId: null,
    startingSubjectIds: [S.calloway, S.sato, S.ferryman],
    basis: { generation: PLAIN_GENERATION, counter: 0, manifestHead: FIXTURE_MANIFEST_HEAD },
    stored: { generation: PLAIN_GENERATION, counter: 1, manifestHead: FIXTURE_MANIFEST_HEAD },
    startedAt: PLAIN_STARTED_AT,
    endedAt: '2026-10-03T14:02:04.000Z',
    parameters: { ...FIXTURE_DEFAULT_PARAMETERS },
    versions: structuredClone(FIXTURE_VERSIONS),
    counts: fixtureRunCounts(state)
  }
}

export const FIXTURE_BEFORE_RUN_VIEW: InvestigationView = buildInvestigationView(
  createFixtureState(),
  {
    revision: { generation: PLAIN_GENERATION, counter: 0, manifestHead: FIXTURE_MANIFEST_HEAD },
    run: null,
    outOfDate: null
  }
)

export const FIXTURE_POPULATED_VIEW: InvestigationView = (() => {
  const state = createFixtureState()
  applyPopulatedResult(state, { id: FIXTURE_IDS.populatedRun, startedAt: PLAIN_STARTED_AT })
  const run = plainSummary(state)
  return buildInvestigationView(state, { revision: run.stored, run, outOfDate: null })
})()
