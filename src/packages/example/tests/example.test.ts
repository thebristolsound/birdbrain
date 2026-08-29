import { describe, expect, it } from 'vitest'
import { greet } from '../index'

describe('greet', () => {
  it('capitalizes the name', () => {
    expect(greet('ada')).toBe('Hello, Ada!')
  })

  it('falls back when the name is blank', () => {
    expect(greet('   ')).toBe('Hello, stranger!')
  })
})
