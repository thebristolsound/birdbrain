import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Generates a fresh self-signed cert + key for 127.0.0.1 / localhost at test
// time, so no private key material is committed to the repository (#157). SANs:
// DNS:localhost, DNS:birdbrain.test, IP:127.0.0.1. Long-lived (100y) so a single
// run never hits expiry. Test-only material — never used by production code.
//
// Requires the `openssl` CLI; callers must gate on HAS_OPENSSL (tests/helpers
// /openssl.ts) so this skips gracefully where openssl is absent.

export interface LocalhostCert {
  key: string
  cert: string
}

export function createLocalhostCert(): LocalhostCert {
  const dir = mkdtempSync(join(tmpdir(), 'birdbrain-tls-'))
  try {
    const keyPath = join(dir, 'key.pem')
    const certPath = join(dir, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '36500',
        '-subj',
        '/CN=localhost/O=Birdbrain Test',
        '-addext',
        'subjectAltName=DNS:localhost,DNS:birdbrain.test,IP:127.0.0.1'
      ],
      { stdio: 'pipe' }
    )
    return { key: readFileSync(keyPath, 'utf8'), cert: readFileSync(certPath, 'utf8') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
