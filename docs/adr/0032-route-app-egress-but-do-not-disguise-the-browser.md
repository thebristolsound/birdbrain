# Route app egress through a proxy, but do not disguise the browser

**Status:** Proposed

**Date:** 2026-09-28

Amends [ADR-0030](0030-persona-is-a-provenance-axis-beside-operator.md) (the sentence "Fingerprint
or user-agent spoofing stays excluded: it is evasion, and the research also shows it breaks
Cloudflare challenges"). The Persona model, the Manifest fields and the terms-of-service ruling in
ADR-0030 are unchanged. The evidence is
[the identity-masking research](../specs/2026-09-28-recapture-identity-masking-research.md).

## Context

A probe on 2026-09-27 ran two background Recaptures against a logging server. Every request left
from the Operator's own IP address and announced the tool by name:
`birdbrain/1.0.1-beta.21 Chrome/152.0.7977.130 Electron/44.4.5`. An Operator without a system VPN
therefore discloses to every target site who is looking and from where.

ADR-0030's exclusion names one thing, "spoofing," and gives one reason, "evasion." The research
separates three changes that the word covers, and they do not share a reason:

- **Routing** changes where the Operator appears to be and nothing the browser says about itself.
  The Berkeley Protocol (para. 101) and SWGDE 21-F-001 (section 4.1) recommend it for open source
  investigators, and the practice Michael Bazzell publishes routes all investigation traffic through
  a VPN.
- **Removing Birdbrain's own name and version** drops detail from the app's own product token,
  which RFC 9110 section 10.1.5 recommends. It is not impersonation. The one primary measurement
  of this exact change (t3code on Electron 41) broke Cloudflare Turnstile, and Electron cannot
  change the client-hint brands, so the render still reads as embedded Chromium.
- **Fingerprint impersonation** presents a browser that did not exist. The Tor Project says
  perfect spoofing is not possible, Orca measured a Chrome-shaped user agent with matching
  metadata failing Turnstile, and the Berkeley Protocol (para. 38) warns that misrepresentation
  can contaminate the collection.

## Decision

**Egress is a setting, and routing is allowed.** The Egress is Direct, a Proxy, or Tor. The
maintainer ruled on 2026-09-28:

1. **Everything follows it.** While the Egress is not Direct, nothing Birdbrain sends leaves
   directly: renders, the TLS Cert Chain re-fetch, the Wayback lookup and replay pane, the TSA
   request, and the consent filter-list download. Each path already tolerates an outage: a
   render fails, a Timestamp Token stays pending, a Wayback lookup reports an error, and a
   render without filter lists proceeds without Consent Suppression.
2. **It fails closed.** SOCKS5 or HTTP only, never SOCKS4, which resolves names locally. No
   `direct://` fallback: an unreachable proxy fails the request instead of exposing the Operator.
   WebRTC runs with `disable_non_proxied_udp`.
3. **The TLS Cert Chain is skipped, not routed.** The re-fetch opens a raw socket that cannot use
   a SOCKS proxy without a new dependency, so it does not run while the Egress is not Direct, and
   the Manifest Entry says it was skipped. Recording the certificate the render itself received
   would change [ADR-0002](0002-tls-capture-corroboration-only.md) and is a separate decision.
4. **One setting per installation.** A Persona may override it later, so a pseudonym always
   appears from the same place; that override belongs to the Persona work under #541, not here.
5. **The record names the kind and a label.** The signed `capture` entry records the Egress kind
   and a label the Operator chooses for it (for example "Frankfurt VPN"), plus the user-agent
   string sent, as optional fields omitted for Direct so existing chain hashes are unchanged. It
   never records the proxy host, port, or credentials, which could expose the Operator's own
   infrastructure in an export, and it does not look up the exit address, which would send every
   Capture's traffic to an address-echo service. The record states what Birdbrain asked Chromium
   to do, not which address the target saw. The verifier learns the fields before any build
   writes them (the ADR-0023 sequencing).
6. **Tor is the Operator's own.** Birdbrain does not bundle Tor. It offers the two local SOCKS
   ports as presets, 9150 for Tor Browser and 9050 for the Tor service, and describes Tor as
   hiding the IP address only.
7. **A challenge is a faithful capture.** Tor and shared VPN addresses draw more challenges, and
   a hidden window cannot answer one. A capture of the challenge page is recorded as what the
   site served, not as a failure to reach it.

**The user agent stays as Electron builds it.** Removing `birdbrain/<version>` is excluded
because it was measured to break Turnstile, not because it is evasion. It is reopened by one
measurement: the Birdbrain renderer on the shipping Electron version, comparing the stock string
with the stripped string on the pages Orca and t3code used. Until then the docs say that a background
Recapture names Birdbrain and its version to the site, and that the Chrome extension in the
Operator's own browser is the path for a target that must not see it.

**Fingerprint impersonation stays excluded.** That covers a Chrome-shaped user agent, forged
client hints, and aligning the time zone or `Accept-Language` with the exit location. The docs
say that the time zone and language still reveal the Operator's region through a proxy.

## Considered options

- **Keep ADR-0030's exclusion as written.** Rejected: it leaves the Operator's IP address exposed
  on every Recapture, the one leak the investigation standards all address, to guard against a
  change that routing does not make.
- **Allow removing the app token now.** Rejected until measured: the only measurement failed, and
  the gain is small while `Electron/` and the Chromium-only brands remain.
- **Route only traffic that touches the target, or only traffic that carries case information.**
  Rejected: the Operator has to read a table to know what leaves directly. "Nothing leaves
  directly" is a rule the Operator can check.
- **Bundle Tor.** Rejected for now: a bundled Tor carries its own update and security obligations.

## Consequences

- The `capture` entry schema, `captureLifecycle.ingest`, the shared verifier, and the standalone
  verifier change; each is evidence-affecting.
- Extension Captures change too: their TLS Cert Chain is skipped and their TSA request is routed
  while the Egress is not Direct. The page itself still loads in the Operator's own browser,
  whose network path Birdbrain does not control.
- Routed TSA requests add latency, so the gap between capture time and the trusted timestamp
  grows, most over Tor.
- A deny-all permission check handler and the move of the user agent into the signed entry need
  no amendment and can ship before routing does.
- The threat-model delta (#546) gains network attribution as a guarantee with stated limits,
  where ADR-0030 listed it as not promised.
