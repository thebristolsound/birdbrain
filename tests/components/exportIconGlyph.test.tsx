import { describe, it, expect } from 'vitest'
import { exportIconSelector } from './exportIcon'

describe('the export icon', () => {
  // The Case menu is drawn with the upload glyph on Export, and the viewer's Download menu keeps
  // the download glyph, so the two are told apart.
  it('is the upload glyph', () => {
    expect(exportIconSelector()).toBe('svg.lucide-upload')
  })
})
