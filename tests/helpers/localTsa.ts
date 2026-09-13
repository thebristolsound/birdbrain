import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// A throwaway RFC 3161 timestamp authority, built with the openssl CLI at test
// time (#584).
//
// Why this exists rather than the committed DigiCert fixture: that token stamps
// a fixed imprint nobody can reproduce a capture for, so a package built around
// it can never satisfy `openssl ts -verify -digest <the capture's contentHash>`.
// Runbook step 6 and verify.sh both feed that command the digest the SIGNED
// manifest entry binds, which is the whole point of the check — so proving they
// PASS needs a token genuinely issued over a hash we control. The DigiCert
// fixture stays the proof that Birdbrain's request format satisfies a real
// commercial TSA (exportTsaVerify.test.ts); this proves the documented command
// verifies a coherent package.
//
// Requires the `openssl` CLI; callers must gate on HAS_OPENSSL. Test-only
// material, generated fresh per run and never written to the repository.

export interface LocalTsa {
  /** PEM of the self-signed root, the `-CAfile` anchor for `openssl ts -verify`. */
  rootPem: string
  /** Issues a bare DER TimeStampToken over a hex SHA-256 imprint. */
  issueToken(imprintHex: string): Buffer
  dispose(): void
}

const LEAF_EXT = [
  'basicConstraints=critical,CA:FALSE',
  'keyUsage=critical,digitalSignature,nonRepudiation',
  // Critical timeStamping EKU: without it `openssl ts -verify` refuses the
  // signer, which is the same rule a real TSA certificate is issued under.
  'extendedKeyUsage=critical,timeStamping',
  'subjectKeyIdentifier=hash',
  'authorityKeyIdentifier=keyid,issuer'
].join('\n')

export function createLocalTsa(): LocalTsa {
  const dir = mkdtempSync(join(tmpdir(), 'bb-local-tsa-'))
  const path = (name: string): string => join(dir, name)
  const openssl = (args: string[]): void => {
    execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' })
  }

  openssl([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', path('root.key'), '-out', path('root.pem'), '-days', '3650',
    '-subj', '/CN=Birdbrain Test TSA Root/O=Birdbrain Test',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign'
  ])
  openssl([
    'req', '-new', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', path('tsa.key'), '-out', path('tsa.csr'),
    '-subj', '/CN=Birdbrain Test Timestamp Responder/O=Birdbrain Test'
  ])
  writeFileSync(path('leaf.ext'), `${LEAF_EXT}\n`)
  openssl([
    'x509', '-req', '-in', path('tsa.csr'),
    '-CA', path('root.pem'), '-CAkey', path('root.key'), '-CAcreateserial',
    '-out', path('tsa.pem'), '-days', '3650', '-extfile', path('leaf.ext')
  ])

  // Responder + root go into the token's embedded certificate set, mirroring
  // what a commercial TSA ships, so the export's own chain extraction has
  // something real to lift into tsa-intermediates.pem.
  writeFileSync(
    path('chain.pem'),
    readFileSync(path('tsa.pem'), 'utf-8') + readFileSync(path('root.pem'), 'utf-8')
  )
  writeFileSync(path('serial'), '01\n')
  writeFileSync(
    path('tsa.cnf'),
    [
      '[ tsa_config ]',
      `serial = ${path('serial')}`,
      'crypto_device = builtin',
      `signer_cert = ${path('tsa.pem')}`,
      `certs = ${path('chain.pem')}`,
      `signer_key = ${path('tsa.key')}`,
      'signer_digest = sha256',
      'default_policy = 1.3.6.1.4.1.99999.1.1',
      'digests = sha256, sha384, sha512',
      'accuracy = secs:1',
      'clock_precision_digits = 0',
      'ordering = yes',
      'tsa_name = yes',
      // ess_cert_id_chain is deliberately unset: with it openssl embeds the root
      // in the ESS signing-certificate attribute and then rejects its own token
      // with "ess cert id wrong order" at verify time.
      'ess_cert_id_alg = sha256',
      ''
    ].join('\n')
  )

  return {
    rootPem: readFileSync(path('root.pem'), 'utf-8'),
    issueToken(imprintHex: string): Buffer {
      openssl(['ts', '-query', '-digest', imprintHex, '-sha256', '-cert', '-out', path('req.tsq')])
      openssl([
        'ts', '-reply', '-config', path('tsa.cnf'), '-section', 'tsa_config',
        '-queryfile', path('req.tsq'), '-out', path('resp.tsr')
      ])
      openssl(['ts', '-reply', '-in', path('resp.tsr'), '-token_out', '-out', path('token.der')])
      return readFileSync(path('token.der'))
    },
    dispose(): void {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
