import { Card, CardContent } from '@renderer/components/ui'

export function About() {
  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 text-lg font-semibold text-text-primary">About</h2>
        <div className="space-y-2 text-sm text-text-muted">
          <p>
            <span className="text-text-secondary">Birdbrain</span> v0.1.0
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
        </div>
      </CardContent>
    </Card>
  )
}
