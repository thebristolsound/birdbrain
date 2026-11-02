# A launched browser's Transaction Record holds no request body

**Status:** Accepted, amended 2026-10-31 (the inventory counts withheld bodies)

**Date:** 2026-10-11

Amends [ADR-0035](0035-one-transaction-record-per-capture.md) (the Decision paragraph that gives
the record "that tab's current navigation, from its first request to the moment of Capture") and
[ADR-0036](0036-credential-header-values-never-enter-a-transaction-record.md) (its Decision, which
replaces the values of four headers only, and its Consequences "Tokens inside a response body, a
URL, or any header not on the list stay in the record" and "The header list is part of the
Evidence Profile"). The source is the maintainer's ruling 39 of 2026-10-10, decision D3 in
[the stage-2 spec's Decisions and rulings](../specs/2026-10-10-capture-engine-launched-browser-design.md#decisions-and-rulings);
the spec gives the reasoning under
[Credentials and passwords](../specs/2026-10-10-capture-engine-launched-browser-design.md#credentials-and-passwords).
Nothing in this record is implemented: no launched browser exists yet.

**Amended 2026-10-31 by the maintainer's rulings on the schema-7 verifier (#1830):** the inventory
counts the request bodies the engine withheld, as a non-negative integer on the signed entry, and
names no request: no request id or URL enters the Manifest. The inventory has no "request body
withheld" reason. The Decision, "What this amends" and the Consequences say so.

## Context

[ADR-0034](0034-the-app-acquires-and-the-extension-is-a-companion.md) adds a browser Birdbrain
launches, where the Operator browses and signs in to sites. ADR-0035 gives each Capture taken
there a Transaction Record of the tab's navigation from its first request, and ADR-0036 replaces
the values of four credential headers and leaves the rest of each exchange in the record. The
first slice is designed to record request bodies, fetching a long one with
`Network.getRequestPostData`
([the capture engine spec](../specs/2026-09-30-capture-engine-design.md)).

In the background renderer nobody submits a sign-in form. In a launched browser the Operator does.
A sign-in form's `POST` is the first request of the navigation that lands on the signed-in page,
and a sign-in sent by `fetch` is a request inside the current navigation. Either way, a Capture of
the signed-in page would hold the Persona's password in its Transaction Record.
[ADR-0030](0030-persona-is-a-provenance-axis-beside-operator.md) rules that "Passwords are never
stored", and an export carries the record to people the Operator does not control (ADR-0036,
Decision).

The network layer cannot tell a password field from any other form field, so the engine cannot
remove the password and keep the rest of the body.

## Decision

**No request body enters a launched browser's Transaction Record.** The engine records no request
body in a `launched` or `launched-passive` Transaction Record. The Capture's inventory counts the
withheld bodies, so the record never reads as complete beyond what the inventory supports.

**`background` records keep request bodies.** The ruling names launched-browser records only. A
`background` Transaction Record holds request bodies as ADR-0035 and the first slice have them.

## What this amends

**ADR-0035.** A launched browser's record still covers the tab's navigation from its first request
to the moment of Capture, but no request in it carries its body. The inventory that accounts for
every exchange the record lacks also counts the request bodies the engine withheld.

**ADR-0036.** In a launched browser's record the engine withholds every request body as well as
the four header values. A token in a request body no longer stays in that record; a token in a
response body, a URL, or a header not on the list still does. The request-body rule is part of
the Evidence Profile beside the header list.

## Considered options

- **Keep request bodies.** Rejected: a sign-in puts the Persona's password in the record, against
  ADR-0030, and an export hands it to whoever holds the file.
- **Remove only the fields that hold a password.** Rejected: the network layer cannot tell a
  password field from any other form field.

## Consequences

- A search or form submission sent by `POST` loses its body. A reviewer can see that the request
  was sent, with its URL and headers, but not what it submitted.
- The rule covers request bodies only. A password in a URL, for example from a sign-in form a site
  submits by `GET`, stays in the record, as ADR-0036 says of any token in a URL.
- `background` and launched-browser records follow different rules. A reviewer reads which rule
  applies from the Capture Method, and the inventory counts the withheld bodies.
- The inventory gains a count of withheld request bodies, `requestBodiesWithheld` at schema 7.
  Manifest Entry schemas are strict, so the verifier learns the count in a release before any
  build writes it (ADR-0035, Consequences; the stage-2 spec, "Manifest, schema, and verifier").
- The Transaction Record entry in `CONTEXT.md` states that a launched browser's record holds no
  request body.
