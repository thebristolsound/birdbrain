import { TopBar } from '@renderer/components/layout/TopBar'
import { MainContent } from '@renderer/components/layout/MainContent'
import { useServerStatus } from '@renderer/hooks/useServerStatus'

function App(): React.JSX.Element {
  useServerStatus()

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <MainContent />
      </div>
    </div>
  )
}

export default App
