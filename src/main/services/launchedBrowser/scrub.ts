import { CREDENTIAL_HEADERS, CREDENTIAL_MARKER } from '../../../packages/transaction-record/writer'

// Credential values and request bodies leave a launched browser's `Network` events before the
// recording holds them (spec, "From a session-long recording", step 4, and "Credentials and
// passwords"; ADR-0036 and ADR-0051). A Capture Session holds its recording for minutes, so the
// first slice's rule of replacing at write time moves to the event handler. Every field the spec
// lists for `devtools-protocol` 0.0.1716261 is covered: header maps, raw header text, and cookie
// lists. A request's body is removed with the flag that says it had one, and the caller counts
// it as withheld.

const CREDENTIAL = new Set(CREDENTIAL_HEADERS)

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scrubHeaderMap(headers: unknown): unknown {
  if (!isObject(headers)) return headers
  const out: Json = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = CREDENTIAL.has(name.toLowerCase()) ? CREDENTIAL_MARKER : value
  }
  return out
}

// Raw header text, `Name: value` lines. A line with no colon (a status or request line) is kept.
function scrubHeaderText(text: unknown): unknown {
  if (typeof text !== 'string') return text
  return text
    .split(/(\r\n|\n|\r)/)
    .map((line) => {
      const colon = line.indexOf(':')
      if (colon <= 0) return line
      const name = line.slice(0, colon).trim().toLowerCase()
      return CREDENTIAL.has(name) ? `${line.slice(0, colon)}: ${CREDENTIAL_MARKER}` : line
    })
    .join('')
}

function scrubCookie(cookie: unknown): unknown {
  return isObject(cookie) && 'value' in cookie ? { ...cookie, value: CREDENTIAL_MARKER } : cookie
}

// `associatedCookies`, `blockedCookies` and `exemptedCookies`: each entry carries a cookie object
// with its value, a raw `cookieLine`, or both.
function scrubCookieList(list: unknown): unknown {
  if (!Array.isArray(list)) return list
  return list.map((entry) => {
    if (!isObject(entry)) return entry
    const out: Json = { ...entry }
    if ('cookie' in out) out.cookie = scrubCookie(out.cookie)
    if (typeof out.cookieLine === 'string') out.cookieLine = CREDENTIAL_MARKER
    return out
  })
}

// `Network.Response` and `Network.WebSocketResponse`.
function scrubResponse(response: unknown): unknown {
  if (!isObject(response)) return response
  const out: Json = { ...response }
  if ('headers' in out) out.headers = scrubHeaderMap(out.headers)
  if ('headersText' in out) out.headersText = scrubHeaderText(out.headersText)
  if ('requestHeaders' in out) out.requestHeaders = scrubHeaderMap(out.requestHeaders)
  if ('requestHeadersText' in out) out.requestHeadersText = scrubHeaderText(out.requestHeadersText)
  return out
}

const BODY_FIELDS = ['postData', 'postDataEntries', 'hasPostData'] as const

// `Network.Request`: its headers, and its body removed.
function scrubRequest(request: unknown): { request: unknown; bodyWithheld: boolean } {
  if (!isObject(request)) return { request, bodyWithheld: false }
  const out: Json = { ...request, headers: scrubHeaderMap(request.headers) }
  const bodyWithheld =
    out.hasPostData === true || out.postData !== undefined || out.postDataEntries !== undefined
  for (const field of BODY_FIELDS) delete out[field]
  return { request: out, bodyWithheld }
}

export interface ScrubbedEvent {
  params: Json
  // The event announced a request body, which the scrub removed.
  bodyWithheld: boolean
}

/** The event with every credential value replaced and any request body removed. */
export function scrubNetworkEvent(method: string, params: unknown): ScrubbedEvent {
  const event: Json = isObject(params) ? { ...params } : {}
  let bodyWithheld = false
  switch (method) {
    case 'Network.requestWillBeSent': {
      const scrubbed = scrubRequest(event.request)
      event.request = scrubbed.request
      bodyWithheld = scrubbed.bodyWithheld
      if ('redirectResponse' in event)
        event.redirectResponse = scrubResponse(event.redirectResponse)
      break
    }
    case 'Network.responseReceived':
      event.response = scrubResponse(event.response)
      break
    case 'Network.requestWillBeSentExtraInfo':
      event.headers = scrubHeaderMap(event.headers)
      if ('associatedCookies' in event) {
        event.associatedCookies = scrubCookieList(event.associatedCookies)
      }
      break
    case 'Network.responseReceivedExtraInfo':
      event.headers = scrubHeaderMap(event.headers)
      if ('headersText' in event) event.headersText = scrubHeaderText(event.headersText)
      if ('blockedCookies' in event) event.blockedCookies = scrubCookieList(event.blockedCookies)
      if ('exemptedCookies' in event) event.exemptedCookies = scrubCookieList(event.exemptedCookies)
      break
    case 'Network.responseReceivedEarlyHints':
      event.headers = scrubHeaderMap(event.headers)
      break
    case 'Network.webSocketWillSendHandshakeRequest':
      if (isObject(event.request)) {
        event.request = { ...event.request, headers: scrubHeaderMap(event.request.headers) }
      }
      break
    case 'Network.webSocketHandshakeResponseReceived':
      event.response = scrubResponse(event.response)
      break
    case 'Network.signedExchangeReceived':
      if (isObject(event.info)) {
        const info: Json = { ...event.info, outerResponse: scrubResponse(event.info.outerResponse) }
        if (isObject(info.header)) {
          info.header = {
            ...info.header,
            responseHeaders: scrubHeaderMap(info.header.responseHeaders)
          }
        }
        event.info = info
      }
      break
  }
  return { params: event, bodyWithheld }
}
