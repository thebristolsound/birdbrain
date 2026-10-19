// Entry point: the CDP events of one render in, its exchanges and the Transaction Record counts
// (plan D4 and D17) out. lib/ is private.
export { collectExchanges } from './lib/collect'
export type {
  BodyData,
  CollectedExchanges,
  CollectorInput,
  Exchange,
  ExchangeRequest,
  ExchangeResponse,
  ExchangeState,
  HeaderMap,
  RecordedEvent,
  RequestBody,
  RequestPostDataResult,
  ResponseBodyResult,
  TransactionRecordCounts
} from './lib/types'
