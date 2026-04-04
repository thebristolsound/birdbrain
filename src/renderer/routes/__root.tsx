import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router'
import { TopBar } from '@renderer/components/layout/TopBar'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { NewCaseWizard } from '@renderer/components/cases/NewCaseWizard'
import { CaseWorkspace } from '@renderer/components/cases/CaseWorkspace'
import { CaseOverview } from '@renderer/components/cases/CaseOverview'
import { CapturesRoute } from '@renderer/routes/cases/$caseId/captures'
import { SelectorsOverview } from '@renderer/components/selectors/SelectorsOverview'
import { NotesOverview } from '@renderer/components/notes/NotesOverview'
import { SettingsView } from '@renderer/components/settings/SettingsView'

// Root layout
const rootRoute = createRootRoute({
  component: function RootLayout() {
    return (
      <div className="flex h-screen flex-col bg-canvas text-text-secondary">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-auto bg-canvas">
            <Outlet />
          </main>
        </div>
      </div>
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

// Build the tree
export const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute,
  newCaseRoute,
  caseRoute.addChildren([caseIndexRoute, capturesRoute, selectorsRoute, notesRoute])
])
