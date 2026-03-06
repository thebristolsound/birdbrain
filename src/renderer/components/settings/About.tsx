export function About() {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-4 text-lg font-semibold text-neutral-200">About</h2>
      <div className="space-y-2 text-sm text-neutral-400">
        <p>
          <span className="text-neutral-300">Birdbrain</span> v0.1.0
        </p>
        <p>Open source web investigation & capture tool</p>
        <p>
          <a className="text-amber-500 hover:text-amber-400">GitHub</a> &middot;{' '}
          <span className="text-neutral-500">MIT License</span>
        </p>
      </div>
    </section>
  )
}
