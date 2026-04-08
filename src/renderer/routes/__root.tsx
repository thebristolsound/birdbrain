import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { TopBar } from '@renderer/components/layout/TopBar'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { MotionProvider } from '@renderer/lib/motion'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { NewCaseWizard } from '@renderer/components/cases/NewCaseWizard'
import { CaseWorkspace } from '@renderer/components/cases/CaseWorkspace'
import { CaseOverview } from '@renderer/components/cases/CaseOverview'
import { CapturesRoute } from '@renderer/routes/cases/$caseId/captures'
import { SelectorsOverview } from '@renderer/components/selectors/SelectorsOverview'
import { NotesOverview } from '@renderer/components/notes/NotesOverview'
import { TagsOverview } from '@renderer/components/tags/TagsOverview'
import { SettingsView } from '@renderer/components/settings/SettingsView'
import { useSessionRestore } from '@renderer/hooks/useSessionRestore'

const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/router-devtools').then((mod) => ({
        default: mod.TanStackRouterDevtools
      }))
    )
  : () => null

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((mod) => ({
        default: mod.ReactQueryDevtools
      }))
    )
  : () => null

// Root layout
const rootRoute = createRootRoute({
  component: function RootLayout() {
    const { restoring } = useSessionRestore()

    if (restoring) {
      return (
        <div className="flex h-screen items-center justify-center bg-canvas">
          <div className="text-text-muted text-sm">Loading workspace...</div>
        </div>
      )
    }

    return (
      <MotionProvider>
        <div className="flex h-screen flex-col bg-canvas text-text-secondary">
          <TopBar />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-canvas">
              <Outlet />
            </main>
          </div>
        </div>
        <Suspense>
          <ReactQueryDevtools buttonPosition="bottom-left" />
          <TanStackRouterDevtools position="bottom-right" />
        </Suspense>
      </MotionProvider>
    )
  }
})

// Dashboard (index)
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard
})

// Settings
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: function SettingsPage() {
    return (
      <div className="p-6">
        <SettingsView />
      </div>
    )
  }
})

// New case wizard
const newCaseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cases/new',
  component: NewCaseWizard
})

// Case workspace layout (with tabs)
const caseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cases/$caseId',
  component: CaseWorkspace
})

// Case overview (index of case workspace)
const caseIndexRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/',
  component: CaseOverview
})

// Captures tab
const capturesRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/captures',
  component: CapturesRoute
})

// Selectors tab
const selectorsRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/selectors',
  component: SelectorsOverview
})

// Notes tab
const notesRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/notes',
  component: NotesOverview
})

// Tags tab
const tagsRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/tags',
  component: TagsOverview
})

// Build the tree
export const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute,
  newCaseRoute,
  caseRoute.addChildren([caseIndexRoute, capturesRoute, selectorsRoute, notesRoute, tagsRoute])
])
