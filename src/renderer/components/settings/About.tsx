import { useQuery } from '@tanstack/react-query'
import { appVersionQueryOptions } from '@renderer/lib/queries'
import { Card, CardContent } from '@renderer/components/ui'
import { startTour } from '@renderer/components/onboarding/startTour'

export function About() {
  const { data: version } = useQuery(appVersionQueryOptions)

  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">About</h2>
        <div className="space-y-2 text-sm text-text-muted">
          <p>
            <span className="text-text-secondary">Birdbrain</span>
            {version ? ` Version ${version}` : ''}
          </p>
          <p>Open source web investigation & capture tool</p>
          <p>
            <a
              href="https://github.com/thebristolsound/birdbrain"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover"
            >
              GitHub
            </a>{' '}
            &middot; <span className="text-text-muted">MIT License</span>
          </p>
          <p>
            <button
              data-testid="about-replay-tour"
              onClick={() => startTour('intro')}
              className="border-none bg-transparent p-0 text-xs text-accent hover:text-accent-hover"
            >
              Replay the welcome walkthrough
            </button>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
