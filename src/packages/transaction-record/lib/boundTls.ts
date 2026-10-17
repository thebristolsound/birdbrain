import { isoFromEpochMilliseconds, isoFromEpochSeconds } from './time'
import type {
  BoundTls,
  BoundTlsTimestamp,
  SecurityDetails,
  SignedCertificateTimestamp
} from './types'

const toTimestamp = ({
  status,
  origin,
  logDescription,
  logId,
  timestamp,
  hashAlgorithm,
  signatureAlgorithm,
  signatureData
}: SignedCertificateTimestamp): BoundTlsTimestamp => ({
  status,
  origin,
  logDescription,
  logId,
  timestamp: isoFromEpochMilliseconds(timestamp),
  hashAlgorithm,
  signatureAlgorithm,
  signatureData
})

// The closed set plan D7 admits; a value a later Chromium adds is refused, not passed on.
const CT_COMPLIANCE = new Set(['unknown', 'not-compliant', 'compliant'])

// Fields are copied by name, never spread, so a field a later Chromium adds stays out of the
// signed entry until a schema step admits it.
export const toBoundTls = ({
  protocol,
  keyExchange,
  keyExchangeGroup,
  cipher,
  mac,
  subjectName,
  sanList,
  issuer,
  validFrom,
  validTo,
  signedCertificateTimestampList,
  certificateTransparencyCompliance,
  serverSignatureAlgorithm,
  encryptedClientHello
}: SecurityDetails): BoundTls => {
  if (!CT_COMPLIANCE.has(certificateTransparencyCompliance)) {
    throw new RangeError(
      `certificateTransparencyCompliance is not a value plan D7 admits: ${certificateTransparencyCompliance}`
    )
  }
  if (
    serverSignatureAlgorithm !== undefined &&
    !(Number.isSafeInteger(serverSignatureAlgorithm) && serverSignatureAlgorithm >= 0)
  ) {
    throw new RangeError(
      `serverSignatureAlgorithm is not a non-negative integer: ${serverSignatureAlgorithm}`
    )
  }
  return {
    protocol,
    keyExchange,
    ...(keyExchangeGroup !== undefined ? { keyExchangeGroup } : {}),
    cipher,
    ...(mac !== undefined ? { mac } : {}),
    subjectName,
    sanList: [...sanList],
    issuer,
    validFrom: isoFromEpochSeconds(validFrom),
    validTo: isoFromEpochSeconds(validTo),
    signedCertificateTimestampList: signedCertificateTimestampList.map(toTimestamp),
    certificateTransparencyCompliance,
    ...(serverSignatureAlgorithm !== undefined ? { serverSignatureAlgorithm } : {}),
    encryptedClientHello
  }
}
