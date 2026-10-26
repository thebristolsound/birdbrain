// The CDP shapes this package reads, under the names the protocol gives them, and the shapes it
// hands on. Only the fields a Transaction Record or Bound TLS Details use are listed.

import type { EgressKind } from '@shared/types'

export type HeaderMap = Record<string, string>

/**
 * One event as the debugger reported it. The page's own session has the empty id `''` (renderer
 * spike, "The event file"); a frame's or worker's session has the id its attach reported.
 */
export interface RecordedEvent {
  sessionId: string
  method: string
  params: unknown
}

/** What `Network.getResponseBody` returned for a request id. */
export interface ResponseBodyResult {
  body: string
  base64Encoded: boolean
}

/** What `Network.getRequestPostData` returned for a request id. */
export interface RequestPostDataResult {
  postData: string
  base64Encoded: boolean
}

export interface CollectorInput {
  /** Every event in arrival order, from the page's session and each child session. */
  events: readonly RecordedEvent[]
  /** Keyed by request id. A finished request missing here had no body returned. */
  responseBodies?: ReadonlyMap<string, ResponseBodyResult>
  /** Keyed by request id. */
  requestPostData?: ReadonlyMap<string, RequestPostDataResult>
  /**
   * The targets whose setup answered, by session id (plan D17, "The two counts"): the page's own
   * session `''` when its `Target.setAutoAttach` answered, and each attached frame, dedicated
   * worker or service worker whose `Network.enable` and `Target.setAutoAttach` both answered. A
   * target not listed here, the page included, counts as unrecorded; so does an attached target of
   * any other type, listed or not. Absent, every target counts as unrecorded.
   */
  recordedSessions?: ReadonlySet<string>
}

export interface SignedCertificateTimestamp {
  status: string
  origin: string
  logDescription: string
  logId: string
  /** Milliseconds since the epoch. */
  timestamp: number
  hashAlgorithm: string
  signatureAlgorithm: string
  signatureData: string
}

export type CertificateTransparencyCompliance = 'unknown' | 'not-compliant' | 'compliant'

/** `Network.SecurityDetails`, as `Network.responseReceived` reports it. */
export interface SecurityDetails {
  protocol: string
  keyExchange: string
  keyExchangeGroup?: string
  cipher: string
  mac?: string
  certificateId: number
  subjectName: string
  sanList: string[]
  issuer: string
  /** Seconds since the epoch. */
  validFrom: number
  /** Seconds since the epoch. */
  validTo: number
  signedCertificateTimestampList: SignedCertificateTimestamp[]
  certificateTransparencyCompliance: CertificateTransparencyCompliance
  serverSignatureAlgorithm?: number
  encryptedClientHello: boolean
}

export interface BoundTlsTimestamp extends Omit<SignedCertificateTimestamp, 'timestamp'> {
  timestamp: string
}

/** Bound TLS Details (plan D7): `SecurityDetails` without `certificateId`, times as ISO 8601. */
export interface BoundTls extends Omit<
  SecurityDetails,
  'certificateId' | 'validFrom' | 'validTo' | 'signedCertificateTimestampList'
> {
  validFrom: string
  validTo: string
  signedCertificateTimestampList: BoundTlsTimestamp[]
}

export interface CdpRequest {
  url: string
  method: string
  headers: HeaderMap
  hasPostData?: boolean
  postData?: string
  postDataEntries?: Array<{ bytes?: string }>
}

export interface CdpResponse {
  url: string
  status: number
  statusText: string
  headers: HeaderMap
  mimeType: string
  protocol?: string
  remoteIPAddress?: string
  fromDiskCache?: boolean
  securityDetails?: SecurityDetails
}

export interface RequestWillBeSent {
  requestId: string
  frameId?: string
  type?: string
  /** Seconds since the epoch. */
  wallTime: number
  request: CdpRequest
  redirectResponse?: CdpResponse
  redirectHasExtraInfo?: boolean
}

export interface ResponseReceived {
  requestId: string
  response: CdpResponse
}

export interface ResponseReceivedExtraInfo {
  requestId: string
  statusCode: number
  headers: HeaderMap
}

export interface LoadingFailed {
  requestId: string
  errorText: string
  canceled?: boolean
  blockedReason?: string
}

export interface AttachedToTarget {
  sessionId: string
  targetInfo: { type: string }
}

/**
 * Where an exchange ended. Each exchange has exactly one. When an exchange shows more than one
 * signal, the first that applies wins: `loadingFailed` (`cancelled` or `failed`), a cache signal
 * (`cached`), a redirect (`redirected`), `loadingFinished` (`complete` or `body-omitted`), and
 * otherwise `in-flight`.
 */
export type ExchangeState =
  'complete' | 'redirected' | 'body-omitted' | 'cached' | 'cancelled' | 'failed' | 'in-flight'

export interface BodyData {
  data: string
  base64Encoded: boolean
}

export interface RequestBody extends BodyData {
  complete: boolean
}

export interface ExchangeRequest {
  method: string
  url: string
  headers: HeaderMap
  /** From `Network.requestWillBeSentExtraInfo`. */
  extraInfo?: { headers: HeaderMap }
}

export interface ExchangeResponse {
  url: string
  status: number
  statusText: string
  protocol?: string
  mimeType: string
  remoteIPAddress?: string
  headers: HeaderMap
  /** From `Network.responseReceivedExtraInfo`. */
  extraInfo?: { statusCode: number; headers: HeaderMap }
  securityDetails?: BoundTls
}

/** One `Network.requestWillBeSent` and what followed it. */
export interface Exchange {
  requestId: string
  /** Where its `Network.requestWillBeSent` falls among those under the request id, from 0. */
  hop: number
  state: ExchangeState
  /** A complete or redirected exchange whose request body, if any, is complete. */
  complete: boolean
  /** The request's `wallTime`. */
  startedAt: string
  type?: string
  frameId?: string
  request: ExchangeRequest
  requestBody?: RequestBody
  response?: ExchangeResponse
  /** Present only on a `complete` exchange. */
  responseBody?: BodyData
  failure?: { errorText: string; canceled: boolean; blockedReason?: string }
}

/**
 * The Transaction Record counts of the inventory (plan D4 and D17). Every exchange falls in exactly
 * one of `exchanges`, `cached`, `cancelled`, `failed`, and `inFlight`. `bodiesOmitted` is part of
 * `exchanges`, and `incompleteRequestBodies` counts request bodies whatever state their exchange
 * ended in.
 */
export interface TransactionRecordCounts {
  exchanges: number
  cached: number
  cancelled: number
  failed: number
  inFlight: number
  bodiesOmitted: number
  incompleteRequestBodies: number
  webSockets: number
  recordedTargets: number
  unrecordedTargets: number
}

export interface CollectedExchanges {
  exchanges: Exchange[]
  counts: TransactionRecordCounts
}

export interface WriterInput {
  /** Written in this order. */
  exchanges: readonly Exchange[]
  captureId: string
  birdbrainVersion: string
  browserVersion: string
  userAgent: string
  /** The Egress the render went through. Only `direct` lets a record carry a remote address. */
  egress: 'direct' | EgressKind
  /** The `warcinfo` record's `WARC-Date`, as ISO 8601. */
  date: string
}

export interface WrittenTransactionRecord {
  /** The `.warc.gz` file: one gzip member per record. */
  bytes: Uint8Array
  /** The lower-case names of the headers whose values the record holds replaced, sorted. */
  replacedHeaders: string[]
}
