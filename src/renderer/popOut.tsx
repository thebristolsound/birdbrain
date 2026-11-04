import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@renderer/lib/queryClient'
import { followStoredTheme } from '@renderer/hooks/useTheme'
import { syncWindowControlsInset } from '@renderer/lib/windowControls'
import { logUncaughtErrors } from '@renderer/lib/globalErrorLog'
import { MotionProvider } from '@renderer/lib/motion'
import { CaptureSessionWindow } from '@renderer/components/launchedBrowser/CaptureSessionWindow'
import '@renderer/styles/globals.css'

// The Capture Session pop-out's page (pop-out.html). It mounts the panel alone, without the
// router or the main window's root layout.
logUncaughtErrors()
syncWindowControlsInset()
followStoredTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionProvider>
        <CaptureSessionWindow />
      </MotionProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
