# TLS certificate-chain capture is corroboration-only (binding deferred)

**Amended 2026-09-30 by
[ADR-0034](0034-the-app-acquires-and-the-extension-is-a-companion.md):** Bound TLS Details are
recorded where the capture engine is attached before the request (a `launched` Capture in a
Chromium browser, and a `background` Capture). The corroboration re-fetch described here stays
the floor for every Capture, and a session-long `chrome.debugger` attach in the Operator's
everyday browser is still not built.

The G5 TLS slice (#123) records the serving TLS certificate chain as **origin corroboration**, via a Node `tls.connect()` re-fetch from the main process after a capture is stored. It does **not** bind the cert to the specific captured HTTP transaction. Binding capture — recording the exact certificate Chrome observed on the captured response, via a session-long `chrome.debugger` CDP attach — is deferred to an explicit opt-in follow-up, not built in #123.

This ratifies the recommendation of the #114 feasibility spike (`docs/specs/2026-05-17-chrome-debugger-tls-spike.md`). The spike found binding is technically achievable but only through a session-long debugger attach, which surfaces a browser-wide "Birdbrain started debugging this browser" infobar for the entire recording session, and still falls back to re-fetch for cached responses and cross-origin navigation races (estimated 70–85% binding availability). Whether that infobar UX is acceptable is a product decision, not a technical one, so it must not be committed to implicitly by an implementation default.

**What corroboration-only proves:** at re-fetch time (seconds to minutes after capture) the origin was reachable and serving a certificate with the recorded fields (subject, SANs, issuer, validity, fingerprint), trusted by the OS/Node trust store. **What it does not prove:** that this is the same certificate served on the captured transaction — a cert rotation, CDN PoP failover, or redirect between capture and re-fetch could yield a different cert. The capture and re-fetch timestamps are both recorded so a reviewer can judge the interval. Cert-chain fields presented to a court must be labelled corroboration, never binding origin proof.

**Consequences / constraints for #123:**
- Lives entirely in `src/main` (a `tlsCertChain` service + ingest wiring). No extension manifest changes, no `chrome.debugger` permission, no infobar.
- `tls.connect({ servername, agent: false, rejectUnauthorized: true })` — `agent: false` is required so TLS session resumption does not elide the chain; `servername` must be the hostname for SNI. Re-fetch must be timeout-bounded and non-blocking to the capture path.
- Cert-chain fields are anchored into the v2 manifest capture entry (deterministic serialization — PEM newline/key-order normalized — or it breaks the hash chain) and mirrored on the captures row (a DB migration is needed).
- Only `@peculiar/asn1-*` is approved if ASN.1 parsing is needed; prefer Node's built-in `PeerCertificate` fields to avoid it.

The binding-mode design hook (opt-in session control, Chrome 118+ floor, `chrome.storage.session`, `target_closed` re-attach, graceful fallback) is documented in §7.2 of the spike for the follow-up. Recorded so a future pass does not "upgrade" corroboration to binding without re-opening the infobar UX decision.

Supersedes the open question in #114; #114 is closed by this ADR.
