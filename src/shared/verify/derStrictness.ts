import { AsnConvert } from '@peculiar/asn1-schema'
import { ContentInfo, SignedData, id_signedData } from '@peculiar/asn1-cms'

// DER canonicality diagnostics for RFC 3161 tokens (#1142). DIAGNOSTIC ONLY:
// nothing on the verification path reads this module, no verdict depends on it,
// and the standalone verifier's output for a package is unchanged by it. It
// exists so a property that third-party strict-DER libraries enforce — and that
// Birdbrain's lenient `@peculiar/asn1-*` parser does not — is measured in the
// repository rather than assumed.
//
// Why the encoding is read directly instead of re-encoded and compared:
// `AsnConvert.parse` followed by `AsnConvert.serialize` reproduces the DigiCert
// fixture byte for byte (pinned in `timestampTokenDerStrictness.test.ts`), so the
// library's serializer preserves the deviation rather than normalising it, and a
// round-trip comparison would call every token canonical.
//
// What is checked: the ordering of every `SET` this code can identify (X.690
// §11.6 "Set-of components" for a `SET OF`, §10.3 "Set components" for a `SET`),
// and definite-length form encoded in the fewest octets (§10.1 "Length forms").
// What is NOT checked: the default-value omission rule (§11.5), the
// primitive-value rules (§11.1–§11.4, §11.7–§11.9), any structure nested inside
// an OCTET STRING or BIT STRING, and the siblings that follow an
// indefinite-length element — an indefinite length has no computable end, so the
// walk stops at it and the deviation list from there on is partial (`strict` is
// already false by then). A `strict: true` report therefore means "no deviation
// of the kinds above was found", not a proof of full canonicality.

export type DerDeviationKind = 'set-order' | 'indefinite-length' | 'non-minimal-length'

export interface DerDeviation {
  kind: DerDeviationKind
  /** Where in the encoding, named by CMS field where the field is identifiable. */
  path: string
  /** Byte offset of the offending element within the supplied DER. */
  offset: number
  detail: string
}

export interface DerStrictnessReport {
  /** True when no deviation of the checked kinds was found. */
  strict: boolean
  deviations: DerDeviation[]
  /**
   * How many `SET` elements were order-checked. A `strict: true` report over
   * zero sets says nothing, so callers that care can tell the two apart.
   */
  setsChecked: number
}

const UNIVERSAL_SET = 0x31
const CONTEXT_0 = 0xa0
const CONTEXT_1 = 0xa1

interface Tlv {
  tag: number
  start: number
  contentStart: number
  contentEnd: number
  constructed: boolean
  indefinite: boolean
  nonMinimalLength: boolean
}

/** A CMS field this module can name, and whether it is a `SET OF` despite its tag. */
interface NamedNode {
  label: string
  /** True for the implicitly tagged `SET OF` fields, whose tag is not `SET`. */
  implicitSetOf: boolean
}

function readTlv(der: Buffer, pos: number): Tlv {
  const start = pos
  if (start + 2 > der.length) throw new Error(`Truncated DER element at offset ${start}`)
  const tag = der[pos]
  pos += 1
  if ((tag & 0x1f) === 0x1f) {
    // High-tag-number form: continuation octets until one without the top bit.
    while (pos < der.length && (der[pos] & 0x80) !== 0) pos += 1
    pos += 1
  }
  if (pos >= der.length) throw new Error(`Truncated DER length at offset ${start}`)
  const firstLengthOctet = der[pos]
  pos += 1
  let length = 0
  let indefinite = false
  let nonMinimalLength = false
  if (firstLengthOctet === 0x80) {
    indefinite = true
  } else if (firstLengthOctet < 0x80) {
    length = firstLengthOctet
  } else {
    const octetCount = firstLengthOctet & 0x7f
    if (pos + octetCount > der.length) throw new Error(`Truncated DER length at offset ${start}`)
    // DER long form carries no leading zero octet and is never used below 128.
    nonMinimalLength = der[pos] === 0x00 || (octetCount === 1 && der[pos] < 0x80)
    for (let i = 0; i < octetCount; i += 1) length = length * 256 + der[pos + i]
    pos += octetCount
  }
  const contentStart = pos
  // An indefinite-length element has no computable end; the caller stops there.
  const contentEnd = indefinite ? der.length : contentStart + length
  if (contentEnd > der.length) throw new Error(`DER element at offset ${start} runs past the end`)
  return {
    tag,
    start,
    contentStart,
    contentEnd,
    constructed: (tag & 0x20) !== 0,
    indefinite,
    nonMinimalLength
  }
}

function childrenOf(der: Buffer, node: Tlv): Tlv[] {
  const children: Tlv[] = []
  let pos = node.contentStart
  while (pos < node.contentEnd) {
    const child = readTlv(der, pos)
    children.push(child)
    // No computable end, so the next sibling cannot be located without walking
    // to this one's EOC: the rest of the list is left unscanned, and the report
    // is partial from here (see the header).
    if (child.indefinite) break
    pos = child.contentEnd
  }
  return children
}

/**
 * X.690 §11.6 ordering: encodings compared as octet strings, the shorter padded
 * at its trailing end with zero octets. The same comparison settles §10.3's tag
 * order for a `SET`, since its components carry distinct tags and the tag is the
 * leading octet.
 */
function compareEncodings(a: Buffer, b: Buffer): number {
  const width = Math.max(a.length, b.length)
  for (let i = 0; i < width; i += 1) {
    const left = i < a.length ? a[i] : 0
    const right = i < b.length ? b[i] : 0
    if (left !== right) return left - right
  }
  return 0
}

function tagLabel(tag: number): string {
  if (tag === 0x30) return 'SEQUENCE'
  if (tag === UNIVERSAL_SET) return 'SET'
  if ((tag & 0xc0) === 0x80) return `[${tag & 0x1f}]`
  return `0x${tag.toString(16).padStart(2, '0')}`
}

interface ScanState {
  der: Buffer
  named: Map<number, NamedNode>
  deviations: DerDeviation[]
  setsChecked: number
}

function checkSetOrder(state: ScanState, children: Tlv[], path: string): void {
  state.setsChecked += 1
  for (let i = 1; i < children.length; i += 1) {
    const previous = state.der.subarray(children[i - 1].start, children[i - 1].contentEnd)
    const current = state.der.subarray(children[i].start, children[i].contentEnd)
    if (compareEncodings(previous, current) > 0) {
      state.deviations.push({
        kind: 'set-order',
        path,
        offset: children[i].start,
        detail: `element ${i} sorts before element ${i - 1}`
      })
    }
  }
}

function scan(state: ScanState, node: Tlv, path: string): void {
  if (node.nonMinimalLength) {
    state.deviations.push({
      kind: 'non-minimal-length',
      path,
      offset: node.start,
      detail: 'length is not in the shortest form DER requires'
    })
  }
  if (node.indefinite) {
    state.deviations.push({
      kind: 'indefinite-length',
      path,
      offset: node.start,
      detail: 'indefinite-length form is BER only; DER requires a definite length'
    })
    return
  }
  if (!node.constructed) return

  const children = childrenOf(state.der, node)
  const named = state.named.get(node.start)
  if (node.tag === UNIVERSAL_SET || named?.implicitSetOf === true) {
    checkSetOrder(state, children, path)
  }
  children.forEach((child, index) => {
    const childName = state.named.get(child.start)
    const childPath = childName ? childName.label : `${path}/${tagLabel(child.tag)}[${index}]`
    scan(state, child, childPath)
  })
}

/**
 * Names the CMS fields whose `SET OF` nature is invisible in the encoding:
 * `certificates`, `crls`, `signedAttrs` and `unsignedAttrs` are implicitly
 * tagged, so they carry a context tag rather than the universal `SET` tag and a
 * byte-level scan cannot tell them from any other constructed field. This is
 * where DigiCert's deviation lives, so leaving them out would report every
 * token as canonical.
 */
function nameCmsNodes(der: Buffer, root: Tlv): Map<number, NamedNode> {
  const named = new Map<number, NamedNode>()
  const content = childrenOf(der, root)[1]
  const signedData = childrenOf(der, content)[0]
  let universalSets = 0
  for (const field of childrenOf(der, signedData)) {
    if (field.tag === UNIVERSAL_SET) {
      // SignedData's two universal SETs in ASN.1 order: digestAlgorithms, then signerInfos.
      universalSets += 1
      if (universalSets === 1) {
        named.set(field.start, { label: 'SignedData.digestAlgorithms', implicitSetOf: false })
      } else {
        named.set(field.start, { label: 'SignedData.signerInfos', implicitSetOf: false })
        nameSignerInfoNodes(der, field, named)
      }
    } else if (field.tag === CONTEXT_0) {
      named.set(field.start, { label: 'SignedData.certificates', implicitSetOf: true })
    } else if (field.tag === CONTEXT_1) {
      named.set(field.start, { label: 'SignedData.crls', implicitSetOf: true })
    }
  }
  return named
}

function nameSignerInfoNodes(der: Buffer, signerInfos: Tlv, named: Map<number, NamedNode>): void {
  childrenOf(der, signerInfos).forEach((signerInfo, index) => {
    for (const field of childrenOf(der, signerInfo)) {
      // `sid`'s subjectKeyIdentifier alternative is [0] IMPLICIT OCTET STRING, so
      // it is primitive (0x80) and never collides with signedAttrs here.
      if (field.tag === CONTEXT_0) {
        named.set(field.start, { label: `SignerInfo[${index}].signedAttrs`, implicitSetOf: true })
      } else if (field.tag === CONTEXT_1) {
        named.set(field.start, { label: `SignerInfo[${index}].unsignedAttrs`, implicitSetOf: true })
      }
    }
  })
}

/**
 * Scans arbitrary DER for the deviations listed at the top of this file. Only
 * universally tagged `SET`s are order-checked, because nothing here knows the
 * schema that would make an implicitly tagged field a `SET OF`.
 */
export function checkDerStrictness(der: Buffer): DerStrictnessReport {
  const root = readTlv(der, 0)
  const state: ScanState = { der, named: new Map(), deviations: [], setsChecked: 0 }
  scan(state, root, tagLabel(root.tag))
  return toReport(state)
}

/**
 * Scans an RFC 3161 timestamp token (a CMS SignedData, the `.tst` bytes) and
 * additionally order-checks the implicitly tagged `SET OF` fields of CMS.
 * Throws on bytes that are not a CMS signed-data structure, matching
 * `parseTimestampToken`.
 */
export function checkTimestampTokenDerStrictness(tokenDer: Buffer): DerStrictnessReport {
  const contentInfo = AsnConvert.parse(tokenDer, ContentInfo)
  if (contentInfo.contentType !== id_signedData) {
    throw new Error(`Unexpected token contentType: ${contentInfo.contentType}`)
  }
  AsnConvert.parse(contentInfo.content, SignedData)

  const root = readTlv(tokenDer, 0)
  const state: ScanState = {
    der: tokenDer,
    named: nameCmsNodes(tokenDer, root),
    deviations: [],
    setsChecked: 0
  }
  scan(state, root, 'ContentInfo')
  return toReport(state)
}

function toReport({ deviations, setsChecked }: ScanState): DerStrictnessReport {
  return { strict: deviations.length === 0, deviations, setsChecked }
}
