import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { generateKeyPairSync, createSign } from 'crypto'
import { verifyEntrySignature as verifyEntrySignatureCore } from '@shared/verify'
import type { KeyProtectionState } from '@shared/types'

const PRIVATE_KEY_FILENAME = 'signing-key.pem'
const PUBLIC_KEY_FILENAME = 'signing-public-key.pem'

// Wrap the private key at rest with Electron's OS credential store (DPAPI /
// Keychain). Falls back to plaintext when safeStorage is unavailable (e.g.
// tests, headless Linux), except that generating a fresh key while
// unprotected is gated on an explicit operator acknowledgement (see
// initSigningKey below). Decided in #289/#414: the signing key is evidence
// and the threat model asserts it is wrapped at rest, so silently degrading
// would be a mis-attestation.
//
// electron/safeStorage/dialog are reached only through this guarded
// require — never a static top-level `import` — because this module is
// pulled in by tests/setup/signing-key.ts for every unit test file. A static
// import of anything that itself statically imports 'electron' (e.g.
// @main/services/logger, via ipcWrap) gets evaluated during that shared
// setup phase, before a test file's own `vi.mock('electron', ...)` is
// established, and permanently shadows it for the rest of that file's run.
// initSigningKeyDeps.logEvent below exists for the same reason: production
// wires the real logger in from index.ts; nothing here imports it directly.
let _safeStorage: typeof import('electron').safeStorage | null = null
let _dialog: typeof import('electron').dialog | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron')
  _safeStorage = electron.safeStorage
  _dialog = electron.dialog
} catch {
  /* not in Electron context (e.g. tests) */
}

let privateKeyPem: string | null = null
let publicKeyPem: string | null = null
// Whether the currently loaded private key is wrapped by the OS credential
// store, or sitting on disk unprotected. Backs isSigningKeyProtected() below.
let signingKeyProtected: KeyProtectionState = 'plaintext'

// Thrown when key generation would leave the private key unprotected at rest
// and the operator declined the acknowledgement prompt. Caught by name in
// src/main/index.ts so a deliberate "quit" reads as a deliberate quit, not a
// generic startup crash.
export class SigningKeyUnacknowledgedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SigningKeyUnacknowledgedError'
  }
}

// Electron's docs describe this as a plain synchronous getter, not a call
// that can throw — unlike encryptString/decryptString below, which do carry
// their own try/catch because they touch the OS credential store for real.
function isEncryptionAvailable(): boolean {
  return _safeStorage?.isEncryptionAvailable() ?? false
}

function wrapPrivateKey(pem: string): string {
  try {
    if (_safeStorage?.isEncryptionAvailable()) {
      return 'enc:' + _safeStorage.encryptString(pem).toString('base64')
    }
  } catch {
    /* encryption not available */
  }
  return pem
}

function unwrapPrivateKey(stored: string): string | null {
  if (!stored.startsWith('enc:')) return stored
  try {
    if (_safeStorage?.isEncryptionAvailable()) {
      return _safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
  } catch {
    /* decryption not available */
  }
  return null
}

// Module scope, not inlined into the function below, so this is exercised
// (and type-checked as a value) every time signingKey.ts loads — including
// under vitest, where _dialog is always null and the function body that
// actually shows it never runs. Keeping the text out of that dead branch
// keeps it covered by the diff-coverage gate instead of invisible to it.
const UNPROTECTED_KEY_DIALOG_OPTIONS = {
  type: 'warning' as const,
  buttons: ['Continue unprotected', 'Quit Birdbrain'],
  defaultId: 1,
  cancelId: 1,
  noLink: true,
  title: 'Signing key cannot be protected at rest',
  message: "This installation's signing key will not be encrypted at rest.",
  detail:
    'Birdbrain could not find an OS credential store (Keychain, DPAPI, or a Linux Secret ' +
    'Service such as gnome-keyring) on this machine. The private key that signs every capture ' +
    'manifest entry will be written to disk in the clear instead of wrapped by it — anyone with ' +
    'file access to this machine can read it and forge signed entries.\n\n' +
    'This is expected on headless or keyring-less Linux installs (e.g. over SSH). If that is not ' +
    'intended, install and unlock a Secret Service provider and restart Birdbrain.\n\n' +
    'Continue only if you accept the signing key will not be protected at rest on this ' +
    'installation. This state is shown afterward in Settings → Diagnostics.'
}

// Blocks — a native modal, no parent window, since this runs before the main
// window exists — until the operator explicitly accepts that this
// installation's signing key will be written unprotected at rest. Decided
// 2026-08-12 in #289: "warn and require acknowledgement", not silently
// degrading (the prior behaviour) or refusing to run at all. Returns false
// (refuse) when there is no way to show the dialog, e.g. outside a real
// Electron GUI process — tests inject their own confirmUnprotectedKey instead
// of relying on this default.
function requestUnprotectedKeyAcknowledgement(): boolean {
  if (!_dialog) return false
  return _dialog.showMessageBoxSync(UNPROTECTED_KEY_DIALOG_OPTIONS) === 0
}

export interface InitSigningKeyDeps {
  // Overrides the acknowledgement gate above. Tests inject a stub since there
  // is no real Electron GUI to show a modal against.
  confirmUnprotectedKey?: () => boolean
  // Durable-log hook for the two events below. Defaults to a no-op: this
  // module must not statically depend on @main/services/logger (see the
  // top-of-file note), so index.ts wires the real logger in explicitly.
  logEvent?: (
    code: 'signingKey.unprotected_key_acknowledged' | 'signingKey.generation_declined'
  ) => void
  // Overrides the gate's pre-generation availability check. Test seam for the
  // TOCTOU case below: production has no way to make isEncryptionAvailable()
  // and wrapPrivateKey()'s own safeStorage call disagree, since tests always
  // run with safeStorage unavailable — this lets a test report "available" at
  // the gate while the real wrap still falls back to plaintext.
  isEncryptionAvailable?: () => boolean
}

const noopLogEvent: NonNullable<InitSigningKeyDeps['logEvent']> = () => {}

// Confirms with the operator (or throws) before a plaintext key is persisted.
// Shared by both acknowledgement points in initSigningKey below: the normal
// pre-generation gate, and the TOCTOU fallback when wrapping degrades to
// plaintext despite the gate reporting encryption as available.
function requireAcknowledgementOrThrow(
  confirmUnprotectedKey: () => boolean,
  logEvent: NonNullable<InitSigningKeyDeps['logEvent']>
): void {
  if (confirmUnprotectedKey()) return
  logEvent('signingKey.generation_declined')
  throw new SigningKeyUnacknowledgedError(
    'Signing key generation was not acknowledged. Birdbrain could not find an OS credential ' +
      'store on this machine, so the installation signing key would be written unprotected at ' +
      'rest, and generation was refused pending operator acknowledgement. Restart Birdbrain and ' +
      'acknowledge the warning to continue, or make a credential store available (e.g. install ' +
      'and unlock gnome-keyring on Linux) and restart.'
  )
}

// Load the installation signing keypair, generating + persisting it on first
// run. The public key is stored in plaintext so it can feed `openssl`
// verification and later be bundled into exports.
export function initSigningKey(userDataPath: string, deps: InitSigningKeyDeps = {}): void {
  const confirmUnprotectedKey = deps.confirmUnprotectedKey ?? requestUnprotectedKeyAcknowledgement
  const logEvent = deps.logEvent ?? noopLogEvent
  const checkEncryptionAvailable = deps.isEncryptionAvailable ?? isEncryptionAvailable
  const privPath = join(userDataPath, PRIVATE_KEY_FILENAME)
  const pubPath = join(userDataPath, PUBLIC_KEY_FILENAME)

  if (existsSync(privPath) && existsSync(pubPath)) {
    const stored = readFileSync(privPath, 'utf-8')
    const unwrapped = unwrapPrivateKey(stored)
    if (!unwrapped) {
      // Fail closed: the keypair exists but the private key could not be
      // unwrapped (OS credential store unavailable). Regenerating here would
      // silently rotate the installation key and invalidate every previously
      // signed manifest entry — refuse instead.
      throw new Error(
        `Failed to unwrap installation signing key at ${privPath} ` +
          `(public key: ${pubPath}). The OS credential store may be ` +
          `unavailable; refusing to generate a new keypair to avoid silently ` +
          `rotating the installation signing key.`
      )
    }
    signingKeyProtected = stored.startsWith('enc:') ? 'protected' : 'plaintext'
    privateKeyPem = unwrapped
    publicKeyPem = readFileSync(pubPath, 'utf-8')
    return
  }

  // First run (or a wiped userData dir): about to generate a fresh key. If it
  // cannot be protected at rest, block on operator acknowledgement before
  // writing anything — see #289/#414. No acknowledgement, no key.
  let acknowledged = false
  if (!checkEncryptionAvailable()) {
    requireAcknowledgementOrThrow(confirmUnprotectedKey, logEvent)
    acknowledged = true
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  const wrapped = wrapPrivateKey(privateKey)
  const nowProtected = wrapped.startsWith('enc:')

  // TOCTOU: the gate above can report encryption as available while
  // wrapPrivateKey's own (separate) safeStorage call still falls back to
  // plaintext moments later — e.g. a keyring that locks between the two
  // calls. The operator was never asked in that case; ask now, before
  // touching module state or disk, so a decline leaves both unchanged.
  if (!nowProtected && !acknowledged) {
    requireAcknowledgementOrThrow(confirmUnprotectedKey, logEvent)
  }

  privateKeyPem = privateKey
  publicKeyPem = publicKey
  signingKeyProtected = nowProtected ? 'protected' : 'plaintext'
  if (signingKeyProtected === 'plaintext') {
    logEvent('signingKey.unprotected_key_acknowledged')
  }
  writeFileSync(privPath, wrapped, 'utf-8')
  writeFileSync(pubPath, publicKey, 'utf-8')
}

// The MCP server's key (ADR-0038): the public half only, read without the OS
// credential store that node mode lacks. The private key stays unset, so
// signEntryHash throws and that process can never sign a manifest entry.
export function initVerifyOnlyKey(userDataPath: string): void {
  privateKeyPem = null
  publicKeyPem = readFileSync(join(userDataPath, PUBLIC_KEY_FILENAME), 'utf-8')
}

// Backs the Settings/Diagnostics indicator from #414: whether the currently
// loaded signing key is wrapped by the OS credential store, or was written to
// disk unprotected. Meaningless before initSigningKey has run.
export function isSigningKeyProtected(): KeyProtectionState {
  return signingKeyProtected
}

// RSA-SHA256 (PKCS#1 v1.5) signature over the entryHash hex string, base64.
// Verifiable by stock `openssl dgst -sha256 -verify`.
export function signEntryHash(entryHashHex: string): string {
  if (!privateKeyPem) throw new Error('Signing key not initialized')
  return createSign('sha256').update(entryHashHex).sign(privateKeyPem, 'base64')
}

// Resolves the PEM (override or this installation's key) and delegates the
// actual check to the shared verify-core, which is fail-closed on crypto
// errors. Key management stays here; verification logic lives in one place.
export function verifyEntrySignature(
  entryHashHex: string,
  signatureB64: string,
  publicKeyOverridePem?: string
): boolean {
  const pem = publicKeyOverridePem ?? publicKeyPem
  if (!pem) throw new Error('Signing key not initialized')
  return verifyEntrySignatureCore(entryHashHex, signatureB64, pem)
}

export function getPublicKeyPem(): string {
  if (!publicKeyPem) throw new Error('Signing key not initialized')
  return publicKeyPem
}

// For testing - clears cached module state between test cases.
export function resetSigningKey(): void {
  privateKeyPem = null
  publicKeyPem = null
  signingKeyProtected = 'plaintext'
}
