import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col justify-center px-4 py-16 text-center">
      <h1 className="mb-4 text-3xl font-bold">Birdbrain</h1>
      <p className="text-fd-muted-foreground mx-auto mb-8 max-w-xl text-balance">
        Local-first web evidence capture for OSINT investigations. Every capture is hashed,
        timestamped, and chained into a verifiable audit manifest.
      </p>
      <div className="flex flex-row flex-wrap justify-center gap-3">
        <Link
          href="/docs"
          className="bg-fd-primary text-fd-primary-foreground rounded-lg px-4 py-2 text-sm font-medium"
        >
          Read the docs
        </Link>
        <a
          href="https://github.com/thebristolsound/birdbrain/releases/latest"
          className="border-fd-border rounded-lg border px-4 py-2 text-sm font-medium"
        >
          Download
        </a>
      </div>
    </main>
  );
}
