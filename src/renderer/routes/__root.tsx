import {
  createRootRoute,
  createRoute,
  Outlet,
  redirect,
  useMatchRoute,
  useNavigate
} from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import { TopBar } from '@renderer/components/layout/TopBar'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { MotionProvider } from '@renderer/lib/motion'
import { OnboardingWizard } from '@renderer/components/layout/OnboardingWizard'
import { Dashboard } from '@renderer/components/dashboard/Dashboard'
import { useQuery } from '@tanstack/react-query'
import { casesQueryOptions, settingsQueryOptions } from '@renderer/lib/queries'
import { NewCaseWizard } from '@renderer/components/dashboard/cases/NewCaseWizard'
import { CaseWorkspace } from '@renderer/components/dashboard/cases/CaseWorkspace'
import { CaseOverview } from '@renderer/components/overview/CaseOverview'
import { CapturesRoute } from '@renderer/routes/cases/$caseId/captures'
import { SelectorsOverview } from '@renderer/components/selectors/SelectorsOverview'
import { NotesOverview } from '@renderer/components/notes/NotesOverview'
import { TagsOverview } from '@renderer/components/tags/TagsOverview'
import { DataExplorer } from '@renderer/components/dashboard/cases/DataExplorer'
import { InstallExtensionGuide } from '@renderer/components/extension/InstallExtensionGuide'
import { SettingsView } from '@renderer/components/settings/SettingsView'
import { useSessionRestore } from '@renderer/hooks/useSessionRestore'
import { useCommandPalette } from '@renderer/hooks/useCommandPalette'
import { CommandPalette } from '@renderer/components/layout/CommandPalette'
import { Toaster } from 'sonner'
import { useAppStore } from '@renderer/stores/appStore'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { subscribeToMainLog } from '@renderer/lib/mainLogBridge'
import { ReportProblemDialog } from '@renderer/components/diagnostics/ReportProblemDialog'
import { CrashRecoveryPrompt } from '@renderer/components/diagnostics/CrashRecoveryPrompt'

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

// Generic error component for routes
function RouteErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const navigate = useNavigate()
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold text-text-primary">Something went wrong</h1>
      <p className="text-center text-text-muted">{message}</p>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
        >
          Try Again
        </button>
        <button
          onClick={() => navigate({ to: '/' })}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary hover:bg-elevated"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  )
}

// Root layout
const rootRoute = createRootRoute({
  component: function RootLayout() {
    const { restoring } = useSessionRestore()
    useCommandPalette()
    useEffect(() => subscribeToMainLog(), [])
    const matchRoute = useMatchRoute()
    const onboardingOverlayOpen = useAppStore((s) => s.onboardingOverlayOpen)
    const setOnboardingOverlayOpen = useAppStore((s) => s.setOnboardingOverlayOpen)

    const [reportOpen, setReportOpen] = useState(false)
    const [reportCorrelationId, setReportCorrelationId] = useState<string | undefined>(undefined)

    // The single wiring point between every "Report this" trigger — the toast
    // action in notify.ts/mainLogBridge.ts, the DiagnosticsPanel button, and
    // the CommandPalette entry — and the one ReportProblemDialog instance
    // mounted here. Each trigger just dispatches this event; only this
    // listener owns open/correlationId state.
    useEffect(() => {
      function onReport(e: Event): void {
        const detail = (e as CustomEvent<{ correlationId?: string }>).detail
        setReportCorrelationId(detail?.correlationId)
        setReportOpen(true)
      }
      window.addEventListener('birdbrain:report', onReport)
      return () => window.removeEventListener('birdbrain:report', onReport)
    }, [])

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
        {/* Two nested boundaries, deliberately. The inner one around <Outlet />
            keeps the chrome alive when a route blows up — the tester can still
            navigate away. This outer one is the last resort: a render failure in
            TopBar, Sidebar, CommandPalette, the onboarding overlay or the
            diagnostic components is outside the inner boundary and would
            otherwise blank the renderer with no react.render_error recorded. */}
        <ErrorBoundary source="root">
          <div
            data-testid="app-ready"
            className="flex h-screen flex-col bg-canvas text-text-secondary"
          >
            <TopBar />
            <div className="flex flex-1 overflow-hidden">
              {showSidebar && <Sidebar />}
              <main className="flex-1 overflow-hidden bg-canvas">
                <ErrorBoundary source="content">
                  <Outlet />
                </ErrorBoundary>
              </main>
            </div>
          </div>
          <CommandPalette />
          <CrashRecoveryPrompt />
          <ReportProblemDialog
            open={reportOpen}
            onOpenChange={setReportOpen}
            correlationId={reportCorrelationId}
          />
          {onboardingOverlayOpen && (
            <OnboardingWizard mode="overlay" onClose={() => setOnboardingOverlayOpen(false)} />
          )}
        </ErrorBoundary>
        {/* Every user-visible failure notice routes through notify.ts, which
            renders here. Mounted once at the root so a toast raised from a
            mutation, a query, or the main-process bridge survives navigation —
            and kept OUTSIDE the boundary above so the toast describing a shell
            crash can still render after that shell is gone. */}
        <Toaster
          position="bottom-right"
          closeButton
          toastOptions={{
            classNames: {
              toast: 'bg-surface border border-border text-text-primary',
              description: 'text-text-muted',
              actionButton: 'bg-accent text-white'
            }
          }}
        />
        <Suspense>
          <ReactQueryDevtools buttonPosition="bottom-left" />
          <TanStackRouterDevtools position="bottom-right" />
        </Suspense>
      </MotionProvider>
    )
  },
  notFoundComponent: function NotFoundPage() {
    const navigate = useNavigate()
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold text-text-primary">Page Not Found</h1>
        <p className="text-text-muted">The page you're looking for doesn't exist.</p>
        <button
          onClick={() => navigate({ to: '/' })}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
        >
          Go to Dashboard
        </button>
      </div>
    )
  }
})

// Home / index — shows Dashboard, or OnboardingWizard on very first launch
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function IndexPage() {
    const { isLoading: casesLoading } = useQuery(casesQueryOptions)
    const { data: settings, isLoading: settingsLoading } = useQuery(settingsQueryOptions)

    if (casesLoading || settingsLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <span className="text-sm text-text-muted">Loading...</span>
        </div>
      )
    }

    if (settings && !settings.hasCompletedOnboarding) {
      return <OnboardingWizard />
    }

    return (
      <div className="h-full overflow-y-auto">
        <Dashboard />
      </div>
    )
  },
  errorComponent: RouteErrorComponent
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
  },
  errorComponent: RouteErrorComponent
})

// Extension setup guide
const extensionSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/extension-setup',
  component: function ExtensionSetupPage() {
    return (
      <div className="h-full overflow-y-auto">
        <InstallExtensionGuide />
      </div>
    )
  },
  errorComponent: RouteErrorComponent
})

// New case wizard
const newCaseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cases/new',
  component: NewCaseWizard,
  errorComponent: RouteErrorComponent
})

// Case workspace layout (with tabs)
const caseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cases/$caseId',
  component: CaseWorkspace,
  errorComponent: RouteErrorComponent
})

// Redirect case index to the overview landing page
const caseIndexRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/cases/$caseId/overview',
      params: { caseId: params.caseId }
    })
  }
})

// Overview tab (case landing page)
const overviewRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/overview',
  component: CaseOverview,
  errorComponent: RouteErrorComponent
})

// Captures tab
const capturesRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/captures',
  component: CapturesRoute,
  errorComponent: RouteErrorComponent
})

// Selectors tab
const selectorsRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/selectors',
  component: SelectorsOverview,
  errorComponent: RouteErrorComponent
})

// Notes tab
const notesRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/notes',
  component: NotesOverview,
  errorComponent: RouteErrorComponent
})

// Tags tab
const tagsRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/tags',
  component: TagsOverview,
  errorComponent: RouteErrorComponent
})

// Data tab
const dataRoute = createRoute({
  getParentRoute: () => caseRoute,
  path: '/data',
  component: DataExplorer,
  errorComponent: RouteErrorComponent
})

// Build the tree
export const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute,
  extensionSetupRoute,
  newCaseRoute,
  caseRoute.addChildren([
    caseIndexRoute,
    overviewRoute,
    capturesRoute,
    selectorsRoute,
    notesRoute,
    tagsRoute,
    dataRoute
  ])
])
