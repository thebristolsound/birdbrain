import {
  createRootRoute,
  createRoute,
  Outlet,
  redirect,
  useMatchRoute
} from '@tanstack/react-router'
import { lazy, Suspense, useState, useEffect } from 'react'
import { TopBar } from '@renderer/components/layout/TopBar'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { MotionProvider } from '@renderer/lib/motion'
import { OnboardingWizard } from '@renderer/components/layout/OnboardingWizard'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions } from '@renderer/lib/queries'
import { NewCaseWizard } from '@renderer/components/dashboard/cases/NewCaseWizard'
import { CaseWorkspace } from '@renderer/components/dashboard/cases/CaseWorkspace'
import { CapturesRoute } from '@renderer/routes/cases/$caseId/captures'
import { SelectorsOverview } from '@renderer/components/selectors/SelectorsOverview'
import { NotesOverview } from '@renderer/components/notes/NotesOverview'
import { TagsOverview } from '@renderer/components/tags/TagsOverview'
import { DataExplorer } from '@renderer/components/dashboard/cases/DataExplorer'
import { SettingsView } from '@renderer/components/settings/SettingsView'
import { useSessionRestore } from '@renderer/hooks/useSessionRestore'
import { useCommandPalette } from '@renderer/hooks/useCommandPalette'
import { CommandPalette } from '@renderer/components/layout/CommandPalette'

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
    useCommandPalette()
    const matchRoute = useMatchRoute()

    const showSidebar = Boolean(matchRoute({ to: '/cases/$caseId', fuzzy: true }))

    if (restoring) {
      return (
        <div className="flex h-screen items-center justify-center bg-canvas">
          <div className="text-text-muted text-sm">Loading workspace...</div>
        </div>
      )
    }

    return (
      <MotionProvider>
        <div
          data-testid="app-ready"
          className="flex h-screen flex-col bg-canvas text-text-secondary"
        >
          <TopBar />
          <div className="flex flex-1 overflow-hidden">
            {showSidebar && <Sidebar />}
            <main className="flex-1 overflow-hidden bg-canvas">
              <Outlet />
            </main>
          </div>
        </div>
        <CommandPalette />
        <Suspense>
          <ReactQueryDevtools buttonPosition="bottom-left" />
          <TanStackRouterDevtools position="bottom-right" />
        </Suspense>
      </MotionProvider>
    )
  }
})

// Home / index — shows Dashboard, or OnboardingWizard on very first launch
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function IndexPage() {
    const { isLoading } = useQuery(casesQueryOptions)
    const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null)

    useEffect(() => {
      window.birdbrain.settings.get().then((s) => {
        setShowOnboarding(!s.hasCompletedOnboarding)
      })
    }, [])

    if (isLoading || showOnboarding === null) {
      return (
        <div className="flex h-full items-center justify-center">
          <span className="text-sm text-text-muted">Loading...</span>
        </div>
      )
    }

    if (showOnboarding) {
      return <OnboardingWizard />
    }

    return (
      <div className="h-full overflow-y-auto">
        <Dashboard />
      </div>
    )
  }
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

// Redirect case index to captures
const caseIndexRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/cases/$caseId/captures',
      params: { caseId: params.caseId }
    })
  }
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

// Data tab
const dataRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/data',
  component: DataExplorer
})

// Build the tree
export const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute,
  newCaseRoute,
  caseRoute.addChildren([
    caseIndexRoute,
    capturesRoute,
    selectorsRoute,
    notesRoute,
    tagsRoute,
    dataRoute
  ])
])
