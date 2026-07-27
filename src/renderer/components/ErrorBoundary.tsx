import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@renderer/components/ui'

// A closed union, not `string`. `source` is written to the durable log as the
// `boundary` context value, and `source={capture.title}` would compile against
// `string` and put a page title on disk. Adding a boundary means adding its
// name here AND to ERROR_BOUNDARIES in logSafe.ts — the compile-time half and
// the untrusted-boundary half of the same allowlist.
export type ErrorBoundarySource = 'root' | 'captureViewer'

interface Props {
  source: ErrorBoundarySource
  children: ReactNode
}

interface State {
  failed: boolean
}

// Without this a render error is a white screen with no trace. The component
// stack is sent to main, where sanitizeError strips paths before it reaches disk.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Neither error.message nor the component stack is sent. The message is
    // prose written by whatever threw; the component stack reads like a safe
    // list of component names but is built from displayName, which several
    // components set from data (a case title, a capture name). The code plus
    // the boundary identifies the failure well enough to find it.
    void window.birdbrain.diagnostics
      .log({
        level: 'error',
        code: 'react.render_error',
        context: { boundary: this.props.source },
        error: error.name
      })
      .catch(() => {
        /* best effort */
      })
    // The full detail still reaches a developer running with devtools open,
    // where it never touches disk.
    if (import.meta.env.DEV) console.error(error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p className="text-sm font-medium text-text-primary">Something went wrong</p>
        <p className="max-w-sm text-sm text-text-muted">
          This part of Birdbrain failed to render. Your captures are unaffected.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => this.setState({ failed: false })}>
            Try again
          </Button>
          <Button size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    )
  }
}
