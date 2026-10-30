import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { closeDatabase, initDatabase } from '@main/services/db/core'
import { getCase, listCases } from '@main/services/db/caseRepo'
import { listCaptures } from '@main/services/db/captureRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { exhibitCitationResolver, listCaseMembers } from '@main/services/db/caseMemberRepo'
import { listNotes } from '@main/services/db/noteRepo'
import { getSelectorMatchCounts, listSelectors } from '@main/services/db/selectorRepo'
import { getTagsForCapture, listTags } from '@main/services/db/tagRepo'
import { getInstallationId, resetInstallationId } from '@main/services/installationId'
import { getPublicKeyPem } from '@main/services/signingKey'
import { readManifestSnapshot, readSharedCaseSnapshot } from '@main/services/manifest'
import { memberChainPath } from '../src/packages/evidence-package-layout/index'
import { seedProfile, type SeededProfile } from '../scripts/dev-seed/seed'
import {
  EXCLUDE_REASON,
  MEMBER_MEMBER_CODE,
  OWNER_MEMBER_CODE,
  REVOKED_MEMBER_CODE,
  SELECTOR_PATTERN
} from '../scripts/dev-seed/constants'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { prepareProfile, profileLaunch } from '../scripts/dev-seed/profile.mjs'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { devLaunch, OPERATOR_NAME } from '../scripts/dev-seed/launch.mjs'

const RESERVED_HOST = /^https:\/\/([a-z0-9-]+\.)*example\.(com|org|net)\//

const readJsonl = (path: string): Record<string, unknown>[] =>
  readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

describe('pnpm dev:seed launch', () => {
  it("points both Birdbrain's data directory and Chromium's profile at the throwaway directory", () => {
    const dir = '/tmp/birdbrain-dev-seed-abc123'
    const { args, env } = devLaunch('/repo', dir)
    expect(args.slice(1, 3)).toEqual(['dev', '--'])
    expect(args.slice(args.indexOf('--') + 1)).toEqual([`--user-data-dir=${dir}`])
    expect(env.BIRDBRAIN_USER_DATA).toBe(dir)
  })

  it('names one directory for both the data directory and the Chromium profile', () => {
    expect(profileLaunch('/x')).toEqual({
      args: ['--user-data-dir=/x'],
      env: { BIRDBRAIN_USER_DATA: '/x' }
    })
  })
})

describe('pnpm dev:seed profile', () => {
  let dir: string
  let seeded: SeededProfile

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bb-dev-seed-'))
    await prepareProfile(dir, { operatorName: OPERATOR_NAME, completedOnboarding: true })
    seeded = await seedProfile(dir)
    // The seed closes its database; reopen it the way the app does on launch.
    await initDatabase(join(dir, 'birdbrain.db'))
  })

  afterAll(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(dir, { recursive: true, force: true })
  })

  it("opens past onboarding with the profile's own operator and key", () => {
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'))).toEqual({
      operatorName: OPERATOR_NAME,
      onboardingChapters: { share: true },
      hasCompletedOnboarding: true
    })
    expect(getPublicKeyPem()).toBe(readFileSync(join(dir, 'signing-public-key.pem'), 'utf-8'))
    expect(listCases().map((c) => c.id)).toEqual(
      expect.arrayContaining([seeded.caseId, seeded.sharedCaseId])
    )
  })

  it('fills the ordinary Case with Captures, Notes, Tags and a matching Selector', () => {
    const { caseId } = seeded
    const captures = listCaptures(caseId)
    expect(captures).toHaveLength(3)
    for (const capture of captures) {
      expect(capture.format).toBe('mhtml')
      expect(capture.url).toMatch(RESERVED_HOST)
    }
    expect(captures.filter((c) => c.screenshotPath).length).toBeGreaterThanOrEqual(1)

    const notes = listNotes(caseId)
    expect(notes).toHaveLength(2)
    const anchored = notes.filter((n) => n.captureId)
    expect(anchored).toHaveLength(1)
    expect(captures.map((c) => c.id)).toContain(anchored[0].captureId)

    expect(listTags()).toHaveLength(2)
    expect(captures.flatMap((c) => getTagsForCapture(c.id))).toHaveLength(1)

    const selectors = listSelectors(caseId)
    expect(selectors.map((s) => s.pattern)).toEqual([SELECTOR_PATTERN])
    expect(getSelectorMatchCounts(caseId)[selectors[0].id]).toBeGreaterThanOrEqual(1)
  })

  it('writes a Shared Case whose chains verify', () => {
    const { sharedCaseId, memberInstallationId, revokedInstallationId } = seeded
    const caseDir = join(dir, 'captures', sharedCaseId)
    const { verification } = readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir))
    expect(verification?.findings).toEqual([])
    expect(verification?.valid).toBe(true)
    expect(verification?.outcome).toBe('pass')

    const owner = readJsonl(join(caseDir, 'manifest.jsonl'))
    const member = readJsonl(join(caseDir, memberChainPath(memberInstallationId)))
    expect(owner.map((e) => e.type)).toEqual([
      'member-add',
      'member-add',
      'member-add',
      'exhibit',
      'merge',
      'exclude',
      'member-revoke'
    ])
    expect(owner.slice(0, 3).map((e) => e.memberInstallationId)).toEqual([
      getInstallationId(),
      memberInstallationId,
      revokedInstallationId
    ])
    expect(owner[4].heads).toEqual([
      {
        installationId: memberInstallationId,
        index: member.length - 1,
        entryHash: member.at(-1)!.entryHash,
        entriesReceived: member.length
      }
    ])
    // The exclusion names the member's Exhibit, which its chain holds (#1514); the revoked
    // member has no chain file, and the walk expects none since nothing was merged from it.
    const memberExhibitEntry = member.find((e) => e.type === 'exhibit')!
    expect(owner[5]).toMatchObject({
      exhibitId: memberExhibitEntry.exhibitId,
      authorInstallationId: memberInstallationId,
      reason: EXCLUDE_REASON
    })
    expect(owner[6].memberInstallationId).toBe(revokedInstallationId)
    expect(verification?.exclusions.map((x) => x.exhibitId)).toEqual([memberExhibitEntry.exhibitId])

    const memberExhibit = member.find((e) => e.type === 'exhibit')!
    expect(memberExhibit.operatorId).toBe(memberInstallationId)
    const bytes = readFileSync(join(dir, 'captures', memberExhibit.path as string))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(memberExhibit.contentHash)

    expect(getCase(sharedCaseId)).toMatchObject({
      sharedAt: expect.any(String),
      ownerInstallationId: getInstallationId()
    })
  })

  it('caches exactly the roster the member-add entries describe, revocation included', () => {
    const { sharedCaseId, revokedInstallationId } = seeded
    const owner = readJsonl(join(dir, 'captures', sharedCaseId, 'manifest.jsonl'))
    const adds = owner.filter((e) => e.type === 'member-add')
    const revoke = owner.find((e) => e.type === 'member-revoke')!
    expect(
      listCaseMembers(sharedCaseId).map((m) => ({
        installationId: m.installationId,
        publicKeyPem: m.publicKeyPem,
        memberCode: m.memberCode,
        role: m.role,
        addedAtIndex: m.addedAtIndex,
        revokedAtIndex: m.revokedAtIndex
      }))
    ).toEqual(
      adds.map((e) => ({
        installationId: e.memberInstallationId,
        publicKeyPem: e.memberPublicKeyPem,
        memberCode: e.memberCode,
        role: e.role,
        addedAtIndex: e.index,
        revokedAtIndex: e.memberInstallationId === revokedInstallationId ? revoke.index : null
      }))
    )
    const revoked = listCaseMembers(sharedCaseId).find(
      (m) => m.installationId === revokedInstallationId
    )
    expect(revoked).toMatchObject({ memberCode: REVOKED_MEMBER_CODE, role: 'member' })
    expect(revoked?.revokedAtIndex).toBeGreaterThan(revoked!.addedAtIndex)
  })

  it("cites each member's Exhibit with its Member Code", () => {
    const { sharedCaseId, memberInstallationId } = seeded
    const exhibits = listExhibits(sharedCaseId)
    const remote = exhibits.find((e) => e.authorInstallationId === memberInstallationId)
    expect(remote?.memberCode).toBe(MEMBER_MEMBER_CODE)
    const cite = exhibitCitationResolver(sharedCaseId, 'app')
    expect(exhibits).toHaveLength(2)
    expect(exhibits.map(cite).sort()).toEqual(
      [`${OWNER_MEMBER_CODE}-1`, `${MEMBER_MEMBER_CODE}-1`].sort()
    )
  })
})
