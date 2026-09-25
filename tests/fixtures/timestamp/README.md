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

## Tokens from other authorities (#1142)

Three further **real** responses, taken from the
Bellingcat [auto-archiver](https://github.com/bellingcat/auto-archiver) test corpus
(`tests/data/timestamping` at commit `5a56b80`, MIT licence, copyright Bellingcat).
They exist so the verify-core parser is proven against token layouts other than
DigiCert's, and so a strict-DER-clean authority is on hand for the second-authority
question in #587. `timestampTokenAuthorities.test.ts` pins their parse results.
Upstream file names are given below, since these were renamed on the way in.

| File | Upstream name | What it is |
| --- | --- | --- |
| `identrust-response.tsr` | `valid_timestamp.tsr` | IdenTrust `TimeStampResp` from `http://timestamp.identrust.com`. Responder `CN=TrustID Timestamp Authority`, issued by `CN=TrustID Timestamping CA 3`; the `IdenTrust Commercial Root CA 1` anchor is not embedded. |
| `identrust-response-2.tsr` | `rfc3161-client-issue-104.tsr` | A second IdenTrust response, over a different message, and with a different serial. Upstream keeps it as the reproduction for trailofbits/rfc3161-client#104. |
| `sinpe-response.tsr` | `self_signed.tsr` | A response from `TSA SINPE v3` (subject `O=BANCO CENTRAL DE COSTA RICA`), chained to a national-government root that no bundled trust store carries. Despite the upstream name it is not self-signed; its root is unbundled. |

All three imprint with `SHA-512`, not `SHA-256`. The stamped message for
`identrust-response.tsr` and `sinpe-response.tsr` is the 64-character ASCII text
`4b7b4e39f12b8c725e6e603e6d4422500316df94211070682ef10260ff5759ef`, so the
expected imprint is `sha512` of that string, which the test derives rather than
stores. Upstream kept no record of the message behind `identrust-response-2.tsr`, so
the test pins that one's imprint as a literal instead. No `.tsq` was kept upstream either, so the
`openssl ts -verify -queryfile` path in the preceding section does not apply;
`openssl ts -reply -in <file> -text` still prints each one, and `-token_out`
extracts the bare token.

Why these matter to #1142: DigiCert's responses carry BER-ordered `SET`s that
strict-DER parsers reject; IdenTrust's do not. Having both in the corpus lets a
test show which property the in-app parser actually enforces.

`timestampTokenDerStrictness.test.ts` pins that property per fixture: the
DigiCert token is not strict DER (two out-of-order members in the CMS
`certificates` set, and nothing else), and all three tokens above are. It also
pins that `AsnConvert` round-trips the DigiCert token byte for byte, which is why
the checker reads the encoding rather than re-encoding and comparing.

### What these fixtures do not cover

One thread of trailofbits/rfc3161-client#104 is a client that assumed the signer
certificate is the first one embedded in the response, which is wrong because
RFC 5652 leaves the `certificates` SET unordered. The fixture named after that
issue does not itself demonstrate the fault: in all three responses here the
responder certificate is encoded first, verified by reading the raw DER. The
out-of-order case is therefore constructed in the test, by re-encoding
`identrust-response.tsr` with its two certificates reversed.
