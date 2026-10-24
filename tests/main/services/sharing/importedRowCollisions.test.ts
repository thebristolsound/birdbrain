import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { listCaseMembers, upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createNote, deleteNote, listNotes, updateNote } from '@main/services/db/noteRepo'
import { readRow } from '@main/services/db/workingRowRepo'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { addMember, shareCase } from '@main/services/sharing/membership'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import {
  activate,
  caseDirOf,
  createPeer,
  pull,
  recordSource,
  seedSharedCase,
  type Peer
} from '../../../helpers/syncPeers'

describe('archive-imported working row collisions (#1955)', () => {
  let root: string
  let owner: Peer
  let member: Peer

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-imported-row-collision-'))
    member = await createPeer(root, 'bob', 'Bob Member', 'BM')
    owner = await createPeer(root, 'alice', 'Alice Owner', 'AO')
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  it.each(['edit', 'delete', 'already-signed'] as const)(
    'refuses an imported note collision individually after %s and keeps syncing later notes',
    async (mode) => {
      const caseId = createCase({ name: 'Before sharing' }).id
      mkdirSync(caseDirOf(caseId), { recursive: true })
      const older = createNote({ caseId, title: 'Archived note', body: 'Original text' })
      if (mode !== 'already-signed') {
        getDb()
          .prepare('UPDATE notes SET version = 0, row_signature = NULL WHERE id = ?')
          .run(older.id)
      }
      const archive = join(root, 'owner.birdbrain')
      await exportCaseArchive(caseId, archive)
      await activate(member)
      const { newCaseId: importedCaseId } = await importCaseArchive(archive)
      expect(listNotes(importedCaseId).map(({ id }) => id)).toEqual([older.id])
      const imported = readRow('notes', { id: older.id }, null)

      await activate(owner)
      await shareCase(caseId, { nodeId: `node-${owner.name}` })
      await addMember(caseId, {
        installationId: member.installationId,
        publicKeyPem: member.publicKeyPem,
        operatorName: member.operatorName,
        nodeId: `node-${member.name}`,
        memberCode: member.memberCode
      })
      const roster = listCaseMembers(caseId)
      const first = createNote({ caseId, title: 'First shared note' })
      const initial = recordSource(caseId, owner)
      await activate(member)
      seedSharedCase(caseId, owner, [])
      roster.forEach(upsertCaseMember)
      expect
        .soft((await pull(caseId, initial)).errors.some(({ kind }) => kind === 'peer'))
        .toBe(false)

      await activate(owner)
      if (mode === 'edit') updateNote({ id: older.id, title: 'Edited by Owner' })
      if (mode === 'delete') deleteNote(older.id)
      const later = createNote({ caseId, title: 'Later shared note' })
      const source = recordSource(caseId, owner)
      await activate(member)
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await pull(caseId, source)
        expect.soft(result.errors.some(({ kind }) => kind === 'peer')).toBe(false)
        expect
          .soft(
            listNotes(caseId)
              .map(({ id }) => id)
              .sort()
          )
          .toEqual([first.id, later.id].sort())
        expect.soft(readRow('notes', { id: older.id }, null)).toEqual(imported)
      }
    }
  )
})
