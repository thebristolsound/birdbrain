import type { BodyData, CdpRequest, HeaderMap, RequestBody, RequestPostDataResult } from './types'

// A request body is complete only when the bytes held add up to the `Content-Length` the request
// declared: in the headers `Network.requestWillBeSentExtraInfo` reported as sent, or in the
// request's own headers when that event did not arrive. `Network.getRequestPostData` returns a
// multipart body without its files ("omitting files from multipart requests", the protocol says)
// and its answer has no field that marks the gap, so the declared length is what tells a short
// body from a whole one. A request with no single declared length cannot be shown complete, and
// counts as incomplete.

const DECIMAL = /^\d+$/

const declaredLength = (headers: HeaderMap): number | undefined => {
  const values = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === 'content-length')
    .map(([, value]) => value.trim())
  const [first] = values
  if (first === undefined || !DECIMAL.test(first) || values.some((value) => value !== first)) {
    return undefined
  }
  const length = Number(first)
  return Number.isSafeInteger(length) ? length : undefined
}

const byteLength = ({ data, base64Encoded }: BodyData): number =>
  base64Encoded ? Buffer.from(data, 'base64').length : Buffer.byteLength(data, 'utf8')

const fromEvent = ({ postDataEntries, postData }: CdpRequest): BodyData => {
  if (postDataEntries !== undefined) {
    const bytes = postDataEntries.map(({ bytes: entry }) =>
      entry === undefined ? Buffer.alloc(0) : Buffer.from(entry, 'base64')
    )
    return { data: Buffer.concat(bytes).toString('base64'), base64Encoded: true }
  }
  return { data: postData ?? '', base64Encoded: false }
}

/**
 * The body a request reported with `hasPostData`: what `Network.getRequestPostData` returned when
 * it was asked, otherwise what the event itself carried.
 */
export const holdRequestBody = (
  request: CdpRequest,
  sentHeaders: HeaderMap | undefined,
  fetched: RequestPostDataResult | undefined
): RequestBody => {
  const held = fetched
    ? { data: fetched.postData, base64Encoded: fetched.base64Encoded }
    : fromEvent(request)
  const declared = declaredLength(sentHeaders ?? request.headers)
  return { ...held, complete: declared !== undefined && byteLength(held) === declared }
}
