import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, listCaptures } from '@main/services/db/captureRepo'
import { listCaseMembers, upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createNote, listNotes } from '@main/services/db/noteRepo'
import { addTagToCapture, addTagToNote, createTag } from '@main/services/db/tagRepo'
import { getAnnotations, saveAnnotations, upsertPin } from '@main/services/annotations'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { addMember, shareCase } from '@main/services/sharing/membership'
import { liveSyncSource } from '@main/services/sharing/session'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import {
  activate,
  addCapture,
  caseDirOf,
  createPeer,
  pull,
  recordSource,
  seedSharedCase,
  TIME,
  type Peer
} from '../../../helpers/syncPeers'

describe('working rows on Captures that members cannot receive (#1951)', () => {
  let root: string
  let owner: Peer
  let member: Peer

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-unreachable-rows-'))
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

  it('refreshes eligibility after a Capture is written during a live connection', async () => {
    const caseId = createCase({ name: 'Live source' }).id
    mkdirSync(caseDirOf(caseId), { recursive: true })
    await shareCase(caseId, { nodeId: `node-${owner.name}` })
    await addMember(caseId, {
      installationId: member.installationId,
      publicKeyPem: member.publicKeyPem,
      operatorName: member.operatorName,
      nodeId: `node-${member.name}`,
      memberCode: member.memberCode
    })
    const roster = listCaseMembers(caseId)
    const live = liveSyncSource(caseId)!
    const { captureId } = await addCapture(caseId, owner, 1)
    const linked = createNote({ caseId, captureId, title: 'New Capture note' })
    const loose = createNote({ caseId, title: 'Later loose note' })
    const source = recordSource(caseId, owner)
    source.rows.set(
      owner.installationId,
      live.rowsSince(owner.installationId, 0, Number.POSITIVE_INFINITY).rows
    )
    await activate(member)
    seedSharedCase(caseId, owner, [])
    roster.forEach(upsertCaseMember)
    expect((await pull(caseId, source)).errors).toEqual([])
    expect
      .soft(
        listNotes(caseId)
          .map(({ id }) => id)
          .sort()
      )
      .toEqual([linked.id, loose.id].sort())

    await activate(owner)
    const next = recordSource(caseId, owner)
    await activate(member)
    expect((await pull(caseId, next)).errors).toEqual([])
    expect(
      listNotes(caseId)
        .map(({ id }) => id)
        .sort()
    ).toEqual([linked.id, loose.id].sort())
  })

  it.each(['imported', 'legacy'] as const)(
    'keeps rows on an %s Capture local while later rows keep syncing',
    async (kind) => {
      let caseId = createCase({ name: 'Unreachable Capture' }).id
      mkdirSync(caseDirOf(caseId), { recursive: true })
      let unreachableId: string
      if (kind === 'imported') {
        await addCapture(caseId, owner, 1)
        const archive = join(root, 'source.birdbrain')
        await exportCaseArchive(caseId, archive)
        caseId = (await importCaseArchive(archive)).newCaseId
        unreachableId = listCaptures(caseId)[0].id
      } else {
        unreachableId = insertCapture({
          caseId,
          url: 'https://example.com/legacy',
          title: 'Legacy page',
          hash: 'a'.repeat(64),
          timestamp: TIME,
          format: 'html'
        }).id
      }
      await shareCase(caseId, { nodeId: `node-${owner.name}` })
      await addMember(caseId, {
        installationId: member.installationId,
        publicKeyPem: member.publicKeyPem,
        operatorName: member.operatorName,
        nodeId: `node-${member.name}`,
        memberCode: member.memberCode
      })
      const roster = listCaseMembers(caseId)
      const initial = recordSource(caseId, owner)
      await activate(member)
      seedSharedCase(caseId, owner, [])
      roster.forEach(upsertCaseMember)
      expect((await pull(caseId, initial)).errors).toEqual([])

      await activate(owner)
      const localNote = createNote({ caseId, captureId: unreachableId, title: 'Local only' })
      const tag = createTag({ name: 'Local capture tag' })
      addTagToCapture({ captureId: unreachableId, tagId: tag.id })
      addTagToNote({ noteId: localNote.id, tagId: tag.id })
      saveAnnotations({ captureId: unreachableId, shapes: [], imageWidth: 800, imageHeight: 600 })
      upsertPin({ captureId: unreachableId, body: 'Local pin' })
      const { captureId: sharedId } = await addCapture(caseId, owner, 2)
      const sharedNote = createNote({ caseId, captureId: sharedId, title: 'Shared note' })
      const source = recordSource(caseId, owner)

      await activate(member)
      for (let attempt = 0; attempt < 2; attempt++) {
        expect.soft((await pull(caseId, source)).errors).toEqual([])
        expect.soft(listNotes(caseId).map(({ id }) => id)).toEqual([sharedNote.id])
      }
      expect(listCaptures(caseId).map(({ id }) => id)).toEqual([sharedId])

      await activate(owner)
      expect(
        listNotes(caseId)
          .map(({ id }) => id)
          .sort()
      ).toEqual([localNote.id, sharedNote.id].sort())
      expect(getAnnotations(unreachableId).pins.map(({ body }) => body)).toEqual(['Local pin'])
      const offered = source.rows.get(owner.installationId) ?? []
      expect(offered.some(({ fields }) => Object.values(fields).includes(unreachableId))).toBe(
        false
      )
      expect(offered.some(({ fields }) => fields.note_id === localNote.id)).toBe(false)
    }
  )
})
