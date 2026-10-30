import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { queryClient } from '@renderer/lib/queryClient'
import { router } from '@renderer/router'
import { useServerStatus } from '@renderer/hooks/useServerStatus'
import { reconcilePersistedTheme } from '@renderer/hooks/useTheme'
import { syncWindowControlsInset } from '@renderer/lib/windowControls'
import { logUncaughtErrors } from '@renderer/lib/globalErrorLog'
import '@renderer/styles/globals.css'

// First, so a throw anywhere below reaches the log.
logUncaughtErrors()

// Before first render, so the top bar never paints under the window controls.
syncWindowControlsInset()
void reconcilePersistedTheme(queryClient)

function App() {
  useServerStatus()

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
