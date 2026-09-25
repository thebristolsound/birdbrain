// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui'

afterEach(cleanup)

// Tailwind's dark: variant compiles to the operating-system colour-scheme query
// here, not the app theme, so a dark: class on the trigger would override the
// selection colours a view passes in whenever the OS runs dark.
describe('TabsTrigger', () => {
  it('derives its colours from selection state alone', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a" className="data-[state=active]:text-accent">
            A
          </TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>
    )

    for (const name of ['A', 'B']) {
      const classes = screen.getByRole('tab', { name }).className.split(/\s+/)
      expect(classes.filter((c) => c.startsWith('dark:'))).toEqual([])
    }
    const active = screen.getByRole('tab', { name: 'A' })
    expect(active.getAttribute('data-state')).toBe('active')
    expect(active.className).toContain('data-[state=active]:text-accent')
  })
})
