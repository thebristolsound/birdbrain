// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { AddSelectorRow, type SelectorPrefill } from '@renderer/components/signals/AddSelectorRow'
import { AddTagRow } from '@renderer/components/signals/AddTagRow'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderSelectorRow(accept = true) {
  const onAdd = vi.fn(() => accept)
  const onFocusList = vi.fn()
  const row = (prefill: SelectorPrefill | null) => (
    <AddSelectorRow onAdd={onAdd} onFocusList={onFocusList} prefill={prefill} />
  )
  const view = render(row(null))
  return {
    onAdd,
    onFocusList,
    input: screen.getByTestId('add-selector-input') as HTMLInputElement,
    prefillWith: (prefill: SelectorPrefill) => view.rerender(row(prefill))
  }
}

describe('AddSelectorRow', () => {
  it('adds an exact-text selector and clears for the next one', () => {
    const { onAdd, input } = renderSelectorRow()

    fireEvent.change(input, { target: { value: '  acme  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledWith('acme', false)
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('adds a regex selector when the chip is switched on', () => {
    const { onAdd, input } = renderSelectorRow()

    fireEvent.click(screen.getByTestId('add-selector-mode'))
    fireEvent.change(input, { target: { value: 'bc1[a-z0-9]{20,}' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledWith('bc1[a-z0-9]{20,}', true)
  })

  it('reads a /…/ value as a regex whatever the chip says', () => {
    const { onAdd, input } = renderSelectorRow()

    fireEvent.change(input, { target: { value: '/acme\\d+/' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledWith('acme\\d+', true)
  })

  it('ignores Enter on an empty value', () => {
    const { onAdd, input } = renderSelectorRow()

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).not.toHaveBeenCalled()
  })

  it('clears the field on Escape without adding', () => {
    const { onAdd, input } = renderSelectorRow()

    fireEvent.change(input, { target: { value: 'abandoned' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onAdd).not.toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('hands focus to the list on ArrowDown', () => {
    const { onFocusList, input } = renderSelectorRow()

    fireEvent.keyDown(input, { key: 'ArrowDown' })

    expect(onFocusList).toHaveBeenCalledOnce()
  })

  it('opens the match-mode drawer on focus and closes it on blur', () => {
    const { input } = renderSelectorRow()
    expect(screen.queryByRole('radiogroup', { name: 'Match mode' })).toBeNull()

    fireEvent.focus(input)
    expect(screen.getByRole('radiogroup', { name: 'Match mode' })).toBeTruthy()

    fireEvent.blur(input)
    expect(screen.queryByRole('radiogroup', { name: 'Match mode' })).toBeNull()
  })

  it('picks a mode from the drawer without stealing focus from the input', () => {
    const { onAdd, input } = renderSelectorRow()
    fireEvent.focus(input)

    // mouseDown, not click: the component preventDefaults it so the drawer
    // survives the interaction. A click would blur first and close it.
    fireEvent.mouseDown(screen.getByRole('radio', { name: /Regular expression/ }))

    expect(
      screen.getByRole('radio', { name: /Regular expression/ }).getAttribute('aria-checked')
    ).toBe('true')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith('x', true)
  })

  // #1549: a refused pattern (a duplicate) stays in the field, so the operator
  // edits it rather than retyping it.
  it('keeps the typed value when the add is refused', () => {
    const { onAdd, input } = renderSelectorRow(false)

    fireEvent.change(input, { target: { value: 'acme' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledWith('acme', false)
    expect(input.value).toBe('acme')
  })

  // A selector's Duplicate action loads its pattern and mode here, focused.
  it('loads a prefill into the field with its mode, and focuses it', () => {
    const { onAdd, input, prefillWith } = renderSelectorRow()

    prefillWith({ pattern: 'bc1[a-z0-9]+', isRegex: true, seq: 1 })

    expect(input.value).toBe('bc1[a-z0-9]+')
    expect(document.activeElement).toBe(input)
    expect(screen.getByTestId('add-selector-mode').textContent).toBe('.*')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith('bc1[a-z0-9]+', true)
  })

  it('names the mode in the placeholder', () => {
    const { input } = renderSelectorRow()
    expect(input.getAttribute('placeholder')).toBe('Add selector')

    fireEvent.click(screen.getByTestId('add-selector-mode'))
    expect(screen.getByTestId('add-selector-input').getAttribute('placeholder')).toBe(
      'Add regex selector'
    )
  })

  // #1754: an invalid regex would be saved and then match nothing.
  it('refuses an invalid regex with an inline error and keeps the value', () => {
    const { onAdd, input } = renderSelectorRow()

    fireEvent.click(screen.getByTestId('add-selector-mode'))
    fireEvent.change(input, { target: { value: '(unclosed' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).not.toHaveBeenCalled()
    expect(input.value).toBe('(unclosed')
    expect(screen.getByRole('alert').textContent).toMatch(/Not a valid regular expression/)
    expect(input.getAttribute('aria-invalid')).toBe('true')

    // Editing clears the error, and a fixed pattern goes through.
    fireEvent.change(input, { target: { value: '(closed)' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith('(closed)', true)
  })

  it('accepts the same characters as exact text', () => {
    const { onAdd, input } = renderSelectorRow()

    fireEvent.change(input, { target: { value: '(unclosed' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledWith('(unclosed', false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // #1755: folding the drawer on pointer-down moved the list under the pointer,
  // so the click meant for a row below landed elsewhere.
  it('keeps the drawer through a click elsewhere and folds it after the release', async () => {
    const { input } = renderSelectorRow()
    fireEvent.focus(input)
    const drawer = () => screen.queryByRole('radiogroup', { name: 'Match mode' })
    expect(drawer()).toBeTruthy()

    fireEvent.pointerDown(document.body)
    fireEvent.blur(input)
    expect(drawer()).toBeTruthy()

    await act(async () => {
      fireEvent.pointerUp(document.body)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(drawer()).toBeNull()
  })

  it('stays open when the press ends back in the input', async () => {
    const { input } = renderSelectorRow()
    fireEvent.focus(input)

    fireEvent.pointerDown(document.body)
    fireEvent.blur(input)
    input.focus()
    fireEvent.focus(input)
    await act(async () => {
      fireEvent.pointerUp(document.body)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByRole('radiogroup', { name: 'Match mode' })).toBeTruthy()
  })
})

describe('AddTagRow', () => {
  function renderTagRow(accept = true) {
    const onAdd = vi.fn(() => accept)
    const onFocusList = vi.fn()
    render(<AddTagRow onAdd={onAdd} onFocusList={onFocusList} nextColor="#22c55e" />)
    return { onAdd, onFocusList, input: screen.getByTestId('add-tag-input') as HTMLInputElement }
  }

  it('slugs the typed name before adding it', () => {
    const { onAdd, input } = renderTagRow()

    fireEvent.change(input, { target: { value: '#Bank Records' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledWith('bank-records')
    expect(input.value).toBe('')
  })

  it('keeps the typed value when the name is refused as taken', () => {
    const { onAdd, input } = renderTagRow(false)

    fireEvent.change(input, { target: { value: 'evidence' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledWith('evidence')
    expect(input.value).toBe('evidence')
  })

  it('ignores a name that slugs to nothing', () => {
    const { onAdd, input } = renderTagRow()

    fireEvent.change(input, { target: { value: '#' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).not.toHaveBeenCalled()
  })

  it('clears on Escape and moves to the list on ArrowDown', () => {
    const { onAdd, onFocusList, input } = renderTagRow()

    fireEvent.change(input, { target: { value: 'abandoned' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect((input as HTMLInputElement).value).toBe('')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(onFocusList).toHaveBeenCalledOnce()
    expect(onAdd).not.toHaveBeenCalled()
  })
})
