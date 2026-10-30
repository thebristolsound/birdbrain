// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { useLayoutEffect, useState } from 'react'
import { Group, Panel } from 'react-resizable-panels'
import { useListColumnWidth } from '@renderer/hooks/useListColumnWidth'
import { stubResizeObserver } from './resizeObserverStub'

// The real panel library, not a stand-in: the failure is in how the hook's panel handle
// lines up with the Group's own registration, which a mock cannot show.

let showList: (show: boolean) => void = () => {}

// A deep link into another case with the Wayback tab open: the list mounts for one render while the
// route still holds the old case's selection, and the next render, which also delivers the
// panel handle, takes it away again.
function FlickeringList() {
  const [show, setShow] = useState(false)
  showList = setShow
  const listWidth = useListColumnWidth('list')
  useLayoutEffect(() => {
    if (show) setShow(false)
  }, [show])
  return (
    <Group id="columns" orientation="horizontal" onLayoutChanged={listWidth.onLayoutChanged}>
      {show && (
        <Panel
          id="list"
          defaultSize={316}
          minSize={240}
          maxSize={560}
          panelRef={listWidth.panelRef}
        >
          list
        </Panel>
      )}
      <Panel id="viewer" minSize={360}>
        viewer
      </Panel>
    </Group>
  )
}

beforeEach(() => {
  stubResizeObserver()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('useListColumnWidth with a real panel Group', () => {
  it('does not resize a list panel that unmounted before its handle arrived', () => {
    render(<FlickeringList />)
    expect(() => act(() => showList(true))).not.toThrow()
  })
})
