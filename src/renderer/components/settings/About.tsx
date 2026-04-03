export function About() {
  return (
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-text-primary">About</h2>
      <div className="space-y-2 text-sm text-text-muted">
        <p>
          <span className="text-text-secondary">Birdbrain</span> v0.1.0
        </p>
        <p>Open source web investigation & capture tool</p>
        <p>
          <a className="text-accent hover:text-accent">GitHub</a> &middot;{' '}
          <span className="text-text-muted">MIT License</span>
        </p>
      </div>
    </section>
  )
}
