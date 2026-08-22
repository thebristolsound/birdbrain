// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AddSelectorRow } from '@renderer/components/signals/AddSelectorRow'
import { AddTagRow } from '@renderer/components/signals/AddTagRow'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderSelectorRow() {
  const onAdd = vi.fn()
  const onFocusList = vi.fn()
  render(<AddSelectorRow onAdd={onAdd} onFocusList={onFocusList} />)
  return { onAdd, onFocusList, input: screen.getByTestId('add-selector-input') }
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

    expect(screen.getByRole('radio', { name: /Regular expression/ }).getAttribute('aria-checked')).toBe(
      'true'
    )
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith('x', true)
  })

  it('describes the mode in the placeholder', () => {
    const { input } = renderSelectorRow()
    expect(input.getAttribute('placeholder')).toContain('exact text match')

    fireEvent.click(screen.getByTestId('add-selector-mode'))
    expect(
      screen.getByTestId('add-selector-input').getAttribute('placeholder')
    ).toContain('Add regex selector')
  })
})

describe('AddTagRow', () => {
  function renderTagRow() {
    const onAdd = vi.fn()
    const onFocusList = vi.fn()
    render(<AddTagRow onAdd={onAdd} onFocusList={onFocusList} nextColor="#22c55e" />)
    return { onAdd, onFocusList, input: screen.getByTestId('add-tag-input') }
  }

  it('slugs the typed name before adding it', () => {
    const { onAdd, input } = renderTagRow()

    fireEvent.change(input, { target: { value: '#Bank Records' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledWith('bank-records')
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
