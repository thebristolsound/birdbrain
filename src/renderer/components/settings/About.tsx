export function About() {
  return (
    <section className="neu-card rounded-2xl p-5">
      <h2 className="mb-4 text-lg font-semibold text-slate-200">About</h2>
      <div className="space-y-2 text-sm text-slate-400">
        <p>
          <span className="text-slate-300">Birdbrain</span> v0.1.0
        </p>
        <p>Open source web investigation & capture tool</p>
        <p>
          <a className="text-indigo-400 hover:text-indigo-300">GitHub</a> &middot;{' '}
          <span className="text-slate-500">MIT License</span>
        </p>
      </div>
    </section>
  )
}
