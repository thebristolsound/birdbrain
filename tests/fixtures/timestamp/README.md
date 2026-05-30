# RFC 3161 timestamp fixtures (#120)

A **real** DigiCert RFC 3161 timestamp over a fixed content hash, used to prove
that Birdbrain's request format produces a token that validates under the
canonical court-verification path `openssl ts -verify` (acceptance criterion 7),
and to exercise `parseTimestampToken` against a genuine commercial-TSA token
(not just the synthetic tokens the unit tests build).

## Files

| File | What it is |
| --- | --- |
| `content-hash.txt` | The SHA-256 imprint that was timestamped (hex). |
| `request.tsq` | The DER `TimeStampReq` Birdbrain produced (`buildTimestampRequest`). |
| `digicert-response.tsr` | DigiCert's full `TimeStampResp` (the on-the-wire reply). |
| `digicert-token.der` | The extracted `TimeStampToken` (CMS SignedData) — what `parseTimestampToken` consumes. |
| `digicert-trusted-root-g4.pem` | The self-signed *DigiCert Trusted Root G4* trust anchor, so verification needs no network and no system trust store. |
| `embedded-chain.pem` | The certificate chain DigiCert embedded in the token (responder → intermediate → root), for reference. |

The token was obtained by POSTing `request.tsq` to `http://timestamp.digicert.com`
(`Content-Type: application/timestamp-query`). TSA policy `2.16.840.1.114412.7.1`.

## Canonical verification (offline, no system trust store)

```sh
openssl ts -verify \
  -in   digicert-response.tsr \
  -queryfile request.tsq \
  -CAfile digicert-trusted-root-g4.pem
# => Verification: OK
```

The standalone token form verifies identically:

```sh
openssl ts -verify -token_in \
  -in   digicert-token.der \
  -queryfile request.tsq \
  -CAfile digicert-trusted-root-g4.pem
# => Verification: OK
```

Both were confirmed `Verification: OK` on OpenSSL 3.5.4. Intermediates are taken
from the certificates embedded in the token; only the self-signed root anchor is
supplied. The DigiCert Trusted Root G4 anchor is also present in OS/browser/court
trust stores, which is why `-CAfile` can be omitted in favour of the system
bundle in a real forensic workflow.

## Note on TSA identity

DigiCert leaves TSTInfo's optional `tsa` field unspecified; the TSA identity is
carried by the embedded responder certificate
(`CN=DigiCert SHA256 RSA4096 Timestamp Responder 2025 1`). `parseTimestampToken`
falls back to that certificate's subject CN, which is what this fixture's parse
test asserts.
