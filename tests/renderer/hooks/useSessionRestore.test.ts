// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { resolveStartRoute } from '@renderer/hooks/useSessionRestore'

describe('resolveStartRoute', () => {
  it('returns onboarding route when no cases exist', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: null,
      lastActiveSection: 'captures',
      cases: []
    })
    expect(result).toEqual({ to: '/' })
  })

  it('returns last active case + section when case exists', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: 'case-1',
      lastActiveSection: 'notes',
      cases: [{ id: 'case-1' }]
    })
    expect(result).toEqual({
      to: '/cases/$caseId/notes',
      params: { caseId: 'case-1' }
    })
  })

  it('returns captures as default section', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: 'case-1',
      lastActiveSection: 'captures',
      cases: [{ id: 'case-1' }]
    })
    expect(result).toEqual({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-1' }
    })
  })

  it('falls back to first case when lastActiveCaseId no longer exists', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: 'deleted-case',
      lastActiveSection: 'captures',
      cases: [{ id: 'case-2' }]
    })
    expect(result).toEqual({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-2' }
    })
  })

  it('falls back to first case when lastActiveCaseId is null', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: null,
      lastActiveSection: 'captures',
      cases: [{ id: 'case-2' }]
    })
    expect(result).toEqual({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-2' }
    })
  })

  it('handles settings section by routing to /settings', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: 'case-1',
      lastActiveSection: 'settings',
      cases: [{ id: 'case-1' }]
    })
    expect(result).toEqual({ to: '/settings' })
  })

  it('handles data section by routing to /cases/$caseId/data', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: 'case-1',
      lastActiveSection: 'data',
      cases: [{ id: 'case-1' }]
    })
    expect(result).toEqual({
      to: '/cases/$caseId/data',
      params: { caseId: 'case-1' }
    })
  })

  it('routes the signals section to /cases/$caseId/signals', () => {
    const result = resolveStartRoute({
      lastActiveCaseId: 'case-1',
      lastActiveSection: 'signals',
      cases: [{ id: 'case-1' }]
    })
    expect(result).toEqual({
      to: '/cases/$caseId/signals',
      params: { caseId: 'case-1' }
    })
  })

  // #400/#700 removed both routes. A settings file written by an earlier
  // release still names them, and landing such an operator on Captures would
  // read as the app forgetting where they were rather than as a screen moving.
  it.each(['selectors', 'tags'] as const)(
    'sends a stored %s section to the screen that replaced it',
    (section) => {
      const result = resolveStartRoute({
        lastActiveCaseId: 'case-1',
        lastActiveSection: section,
        cases: [{ id: 'case-1' }]
      })
      expect(result).toEqual({
        to: '/cases/$caseId/signals',
        params: { caseId: 'case-1' }
      })
    }
  )
})
