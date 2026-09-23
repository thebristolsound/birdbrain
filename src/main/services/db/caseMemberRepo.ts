import { getDb } from '@main/services/db/core'
import { getInstallationId } from '@main/services/installationId'
import { MEMBER_CODE_PATTERN } from '@shared/schemas'
import { formatExhibitCitation } from '@shared/exhibitCitation'
import type { CaseMember, Exhibit } from '@shared/types'

// The roster cache of a Shared Case (#1510). `case_members` mirrors the
// `member-add` and `member-revoke` entries in the Owner's chain and is rebuilt
// from it; nothing here is evidence. A Case nobody shared has no rows, and
// every read below treats that as "one member, this installation".

interface CaseMemberRow {
  case_id: string
  installation_id: string
  public_key_pem: string
  member_code: string
  operator_name: string
  node_id: string
  role: string
  added_at_index: number
  revoked_at_index: number | null
}

function toCaseMember(row: CaseMemberRow): CaseMember {
  return {
    caseId: row.case_id,
    installationId: row.installation_id,
    publicKeyPem: row.public_key_pem,
    memberCode: row.member_code,
    operatorName: row.operator_name,
    nodeId: row.node_id,
    role: row.role === 'owner' ? 'owner' : 'member',
    addedAtIndex: row.added_at_index,
    revokedAtIndex: row.revoked_at_index
  }
}

export function listCaseMembers(caseId: string): CaseMember[] {
  const rows = getDb()
    .prepare('SELECT * FROM case_members WHERE case_id = ? ORDER BY added_at_index')
    .all(caseId) as CaseMemberRow[]
  return rows.map(toCaseMember)
}

// Why a Member Code was refused, or null when it is usable. One to three
// characters from [A-Z0-9] (decision 8, assessment item 22) and not already
// another member's in this Case. `installationId` exempts the member's own row
// so re-recording a roster is not a collision with itself.
export function memberCodeProblem(
  caseId: string,
  memberCode: string,
  installationId: string
): string | null {
  if (!MEMBER_CODE_PATTERN.test(memberCode)) {
    return `Member Code "${memberCode}" must be one to three characters from A-Z and 0-9`
  }
  const taken = getDb()
    .prepare(
      'SELECT installation_id FROM case_members WHERE case_id = ? AND member_code = ? AND installation_id <> ?'
    )
    .get(caseId, memberCode, installationId) as { installation_id: string } | undefined
  return taken ? `Member Code "${memberCode}" is already used in this Case` : null
}

export function upsertCaseMember(member: CaseMember): CaseMember {
  const problem = memberCodeProblem(member.caseId, member.memberCode, member.installationId)
  if (problem) throw new Error(problem)
  getDb()
    .prepare(
      `INSERT INTO case_members (
         case_id, installation_id, public_key_pem, member_code, operator_name,
         node_id, role, added_at_index, revoked_at_index
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (case_id, installation_id) DO UPDATE SET
         public_key_pem = excluded.public_key_pem,
         member_code = excluded.member_code,
         operator_name = excluded.operator_name,
         node_id = excluded.node_id,
         role = excluded.role,
         added_at_index = excluded.added_at_index,
         revoked_at_index = excluded.revoked_at_index`
    )
    .run(
      member.caseId,
      member.installationId,
      member.publicKeyPem,
      member.memberCode,
      member.operatorName,
      member.nodeId,
      member.role,
      member.addedAtIndex,
      member.revokedAtIndex
    )
  return listCaseMembers(member.caseId).find((row) => row.installationId === member.installationId)!
}

// The read-time citation rule for one Case, resolved once per read so a list
// of a thousand rows costs one roster query.
//
// A row whose `author_installation_id` is NULL is this installation's, and its
// code is the local member's from the roster; a remote row carries the code it
// was received with. `prefixed` is decision 7: the app hides the prefix while
// the Case has one unrevoked member, an export shows it whenever the Case has
// a roster at all.
export interface ExhibitCitationResolver {
  (exhibit: Pick<Exhibit, 'exhibitNumber' | 'memberCode' | 'authorInstallationId'>): string
}

export function exhibitCitationResolver(
  caseId: string,
  surface: 'app' | 'export'
): ExhibitCitationResolver {
  const members = listCaseMembers(caseId)
  if (members.length === 0) {
    return (exhibit) => formatExhibitCitation(exhibit, { prefixed: false })
  }
  const localId = getInstallationId()
  const localCode = members.find((m) => m.installationId === localId)?.memberCode ?? null
  const active = members.filter((m) => m.revokedAtIndex === null).length
  const prefixed = surface === 'export' || active > 1
  return (exhibit) =>
    formatExhibitCitation(
      {
        exhibitNumber: exhibit.exhibitNumber,
        memberCode:
          exhibit.authorInstallationId === null
            ? (exhibit.memberCode ?? localCode)
            : exhibit.memberCode
      },
      { prefixed }
    )
}
