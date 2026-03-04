# Birdbrain

An open source web investigation & capture tool. Automatically captures, preserves, and analyzes your web research with AI-powered entity extraction, relationship mapping, and pattern detection.

## Features

- **Chrome Extension** — Capture pages as you browse, with one click
- **SHA-256 Hashing** — Prove capture integrity and chain of custody
- **AI Analysis** — Entity extraction, relationship mapping, pattern detection via OpenRouter (BYOK)
- **Export** — Generate professional PDF/HTML reports with full audit trail
- **Local-First** — All data stays on your machine

## Development

```bash
# Install dependencies
pnpm install

# Run in dev mode (Electron + hot reload)
pnpm dev

# Build for distribution
pnpm build

# Build Chrome extension
pnpm build:extension

# Run tests
pnpm test
```

## License

MIT
