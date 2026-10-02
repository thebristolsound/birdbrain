# A read-only MCP server reads a Case from a separate process

**Status:** Accepted

**Date:** 2026-10-02

Decided by the maintainer on 2026-10-02 and built on the same branch. The plan and its findings
are in [the MCP plan](../plans/2026-10-02-birdbrain-mcp-read-only.md).

## Context

The local API map (#547), seeded by #358, wants an agent to work a Case over the Model Context
Protocol (MCP). It left four questions open: how much of the surface to expose, where the server
runs, which contract is the source of truth, and whether Operator stays human-only when an agent
acts (#548). The fourth blocks any write. A Manifest Entry records who acted, so an agent's
write would currently be attested as the Operator's.

The first consumer is a fact-check. An agent tests each claim in an evidence package against the
Captures that support it, so it needs to read everything an investigator reads in the app. It
does not need to change anything.

The Manifest is a hash chain with one writer. `requestSingleInstanceLock` (#88) exists because
two writers corrupt `prev_hash`.

## Decision

**The server only reads.** It exposes what the app shows an investigator for a Case: Cases,
Captures with their page text, HTML and screenshot, Exhibits and their stored files, the
Manifest, verification, Notes and their mentions, Tags, selectors, extracted data, annotations,
and pinned Wayback snapshots. It writes no Manifest Entry, so the Operator question stays open
and blocks nothing here.

**It is a separate process that the MCP client starts, speaking stdio.** It opens no network
listener. It reads the database through a SQLite connection opened read-only, so SQLite refuses
any write, and it refuses a schema version it does not know rather than migrate. It loads only
the installation public key, so it cannot sign. It reads `settings.json` for the storage path
instead of initializing settings, which would rewrite the file. The desktop app may run at the
same time and stays the chain's only writer.

**Verification records nothing.** `verifyCapture` and `verifyExhibit` take `record: false`,
which returns the same verdict without writing the verification status or reconciling the
trusted-time mirror. The app's path is unchanged.

**Tool inputs are Zod schemas,** because the SDK takes them. This settles nothing about the
contract question (#551) for existing IPC channels.

## Considered options

- **In-process in the desktop app, over loopback HTTP.** Reuses the live services, but the app
  must be open, and it adds a network listener, which the architecture whitepaper says Birdbrain
  does not have. It also needs authentication for that listener. Rejected for the first slice.
- **Reads plus a curated set of writes.** Rejected until the Operator question is decided. A
  write today would attest a human acted.

## Consequences

- `better-sqlite3` is built for Electron's ABI, so the server runs under the Electron binary
  with `ELECTRON_RUN_AS_NODE=1`. It cannot ship as a standalone binary like the verifier. The
  first slice runs from a source checkout's build. Launching it from an installed app is a
  follow-up.
- When the app migrates the database, the server refuses to start until it is rebuilt from the
  matching version.
- A verification run through the server does not appear as the last verification in the app.
- Every tool result goes to the model the MCP client uses. Connecting an agent hosted by a
  provider sends that provider the Case content the agent reads, including page text and
  screenshots.
- The no-listener claim in the architecture whitepaper stays true. The whitepaper now names the
  stdio server among its integration points.
