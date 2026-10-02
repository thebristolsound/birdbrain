# Credential header values never enter a Transaction Record

**Status:** Accepted

**Date:** 2026-10-02

Confirmed by the maintainer on 2026-10-02 after an automated review of
[ADR-0035](0035-one-transaction-record-per-capture.md) raised the conflict. Nothing in this
record is implemented.

## Context

A Transaction Record holds request and response headers as the browser reported them. For a
signed-in page the request headers include `Cookie` and, on some sites, `Authorization`, and the
response headers include `Set-Cookie`. Those values are reusable account secrets. A Transaction
Record is copied by export and by Case Archive export, so the values would leave the browser
session.

[ADR-0030](0030-persona-is-a-provenance-axis-beside-operator.md) rules that the only copy of a
cookie value is Chromium's own store for that session. Today's header capture does not reach
this problem, because the extension listens without the `extraHeaders` option and Chrome
withholds `Cookie` and `Set-Cookie` from such a listener.

## Decision

**The values of credential-bearing headers are replaced before the record is written.** For
`Cookie`, `Set-Cookie`, `Authorization`, and `Proxy-Authorization`, the header name stays and
the value becomes a fixed marker. The Capture's inventory names every header the engine
replaced. The replacement happens in memory, before any byte of the record reaches disk, so no
file ever holds the original value.

**ADR-0030 is unchanged.** The alternative, recording the headers as reported and amending the
Persona decision to allow cookie values in exported evidence, was rejected: an export is shared
with people the Operator does not control, and a cookie in it is a working login for whoever
holds the file.

## Consequences

- The record is no longer the browser's full account of the exchange, and the glossary and the
  verifier say so: the headers are present, their values are not.
- A reviewer can still see that a session cookie was sent and that a cookie was set. They cannot
  replay it, and they cannot tell two sessions apart by cookie value.
- Tokens inside a response body, a URL, or any header not on the list stay in the record, as
  they stay in MHTML today. The docs state that limit beside the capability.
- The header list is part of the Evidence Profile. Adding a name to it later changes what new
  records hold and leaves older records as they were written.
