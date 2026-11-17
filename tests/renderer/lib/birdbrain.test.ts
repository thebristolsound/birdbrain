// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { refusalError } from '@shared/bridgeAdapter'
import { birdbrain } from '@renderer/lib/birdbrain'
import { fakeBridge } from '../fakeBridge'

// The renderer's bridge adapter: every call goes through it, and a refusal the
// preload sent as a plain object comes out as an Error that keeps main's code.

const coded = (code: string): Error => Object.assign(new Error(`refused: ${code}`), { code })

describe('birdbrain', () => {
  it('forwards a call and its arguments to the bridge, and resolves with its result', async () => {
    const update = vi.fn(async () => ({ id: 'case-1' }))
    const search = vi.fn(async () => [])
    fakeBridge({ cases: { update }, search })

    await expect(birdbrain.cases.update({ id: 'case-1', name: 'Harbor' })).resolves.toEqual({
      id: 'case-1'
    })
    expect(update).toHaveBeenCalledWith({ id: 'case-1', name: 'Harbor' })
    await expect(birdbrain.search('case-1', 'acme')).resolves.toEqual([])
    expect(search).toHaveBeenCalledWith('case-1', 'acme')
  })

  it('rejects a refused call with an Error that keeps the code', async () => {
    const importCookies = vi.fn(async () => {
      throw { message: 'Only a Netscape cookies.txt export', code: 'PERSONA_FILE' }
    })
    const search = vi.fn(async () => {
      throw { message: 'Search could not run', code: 'SEARCH_FAILED' }
    })
    fakeBridge({ persona: { import: importCookies }, search })

    const refused = await birdbrain.persona.import('p-1').catch((err: unknown) => err)
    expect(refused).toBeInstanceOf(Error)
    expect(refused).toMatchObject({
      message: 'Only a Netscape cookies.txt export',
      code: 'PERSONA_FILE'
    })
    // A root-level method takes the same path as a namespaced one.
    const rootRefused = await birdbrain.search('case-1', 'x').catch((err: unknown) => err)
    expect(rootRefused).toBeInstanceOf(Error)
    expect(rootRefused).toMatchObject({ message: 'Search could not run', code: 'SEARCH_FAILED' })
  })

  it('rejects a refusal that has no code with an Error that has none', async () => {
    const setAutoCapturePolicy = vi.fn(async () => {
      throw { message: 'Case not found', code: undefined }
    })
    fakeBridge({ cases: { setAutoCapturePolicy } })

    const refused = await birdbrain.cases
      .setAutoCapturePolicy({ caseId: 'c1', mode: 'stack', exclusions: [] })
      .catch((err: unknown) => err)
    expect(refused).toBeInstanceOf(Error)
    expect(refused).toMatchObject({ message: 'Case not found' })
    expect(refused).not.toHaveProperty('code')
  })

  it('passes an Error rejection through as the same object', async () => {
    const defect = new Error("Error invoking remote method 'cases:list': boom")
    fakeBridge({ cases: { list: vi.fn(async () => Promise.reject(defect)) } })

    await expect(birdbrain.cases.list()).rejects.toBe(defect)
  })

  it('returns what a subscription returns, which is not a promise', () => {
    const unsubscribe = vi.fn()
    const onNewCapture = vi.fn(() => unsubscribe)
    fakeBridge({ onNewCapture })
    const callback = vi.fn()

    expect(birdbrain.onNewCapture(callback)).toBe(unsubscribe)
    expect(onNewCapture).toHaveBeenCalledWith(callback)
  })

  it('reads the bridge at each call, so it reaches the one installed last', async () => {
    fakeBridge({ app: { getVersion: vi.fn(async () => '1.0.0') } })
    await expect(birdbrain.app.getVersion()).resolves.toBe('1.0.0')
    fakeBridge({ app: { getVersion: vi.fn(async () => '2.0.0') } })
    await expect(birdbrain.app.getVersion()).resolves.toBe('2.0.0')
  })
})

describe('refusalError', () => {
  it('rebuilds the Error from the plain object the preload sent', () => {
    const rebuilt = refusalError({ message: 'Not a Birdbrain invite', code: 'invite-malformed' })
    expect(rebuilt).toBeInstanceOf(Error)
    expect(rebuilt).toMatchObject({ message: 'Not a Birdbrain invite', code: 'invite-malformed' })
  })

  it('passes any other rejection through unchanged', () => {
    const error = coded('invite-expired')
    expect(refusalError(error)).toBe(error)
    const odd = { reason: 'no message' }
    expect(refusalError(odd)).toBe(odd)
    expect(refusalError('text')).toBe('text')
    expect(refusalError(null)).toBeNull()
    const uncoded = refusalError({ message: 'disk full' })
    expect(uncoded).toBeInstanceOf(Error)
    expect(uncoded).not.toHaveProperty('code')
  })
})
