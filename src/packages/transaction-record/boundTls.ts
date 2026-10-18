// Entry point: a main document's `securityDetails` in, Bound TLS Details (plan D7) out. lib/ is
// private.
export { toBoundTls } from './lib/boundTls'
export type {
  BoundTls,
  BoundTlsTimestamp,
  CertificateTransparencyCompliance,
  SecurityDetails,
  SignedCertificateTimestamp
} from './lib/types'
