// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  readHiddenActions,
  saveHiddenActions
} from '@renderer/components/contextmenu/menuPreferences'
import { duplicateTagName, tagCapturesMarkdown } from '@renderer/components/signals/tagMenuActions'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

it('recovers from malformed preferences and accepts only action IDs', () => {
  localStorage.setItem('birdbrain.context-menu.hidden-actions', '{broken')
  expect(readHiddenActions()).toEqual([])
  localStorage.setItem('birdbrain.context-menu.hidden-actions', '{}')
  expect(readHiddenActions()).toEqual([])
  localStorage.setItem('birdbrain.context-menu.hidden-actions', '["tag:tag-delete",4,null]')
  expect(readHiddenActions()).toEqual(['tag:tag-delete'])
})

it('keeps menus usable when browser storage rejects writes', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('unavailable')
  })
  expect(() => saveHiddenActions(['note:note-delete'])).not.toThrow()
})

it('avoids collisions when duplicating an already duplicated tag', () => {
  expect(duplicateTagName('Review', ['Review-copy', 'Review-copy-2'])).toBe('Review-copy-3')
})

it('keeps hostile capture titles inside their Markdown table cell', () => {
  const markdown = tagCapturesMarkdown('Review', [
    {
      id: '1',
      caseId: 'c',
      title: 'Title | <script>\nnext',
      url: 'https://example.com',
      hash: 'abc',
      timestamp: 'today',
      createdAt: 'today',
      format: 'mhtml',
      method: 'extension'
    }
  ])
  expect(markdown).toContain('Title \\| \\<script\\> next')
  expect(markdown).toContain('Capture references only.')
})
