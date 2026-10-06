# Shared Case members UI design brief

Date: 2026-09-19
Audience: the designer working in the "Birdbrain UI" design project. Engineering contact: the
maintainer.
Source of decisions: a grilling session with the maintainer on 2026-09-19 over a
privacy-first, peer-to-peer collaboration mode for 2–5 trusted peers. The technical design
spec is a separate document; this brief covers only what a designer needs to draw the surfaces.

## What the feature is

A Case can be shared with a small set of trusted peers. Each peer runs Birdbrain on their own
machine and keeps a full copy of the Case. Peers connect directly to each other over the
internet (no Birdbrain server holds Case data), and every Capture, Exhibit, note, and tag stays
attributed to the installation that made it. Nobody edits anyone else's history: the Case is the
union of each member's own signed record.

The maintainer's non-negotiable: joining a shared Case must take one paste and one click, with
no account, no terminal, and nothing installed beyond Birdbrain.

## Decisions the mock must honor

These are settled. Do not redesign them; design around them.

| #   | Decision                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sharing is per Case. Birdbrain has no top-level "team" concept, no organization, no accounts. Identity is the installation's existing signing key.    |
| 2   | Roles: one Owner (the Case creator) who invites and revokes; every other member writes. No read-only role in this version.                           |
| 3   | The whole Case is shared. Birdbrain has no per-Exhibit sharing.                                                                                     |
| 4   | Invite flow is one-way: the Owner generates an invite string, sends it out of band (Signal, email), the peer pastes it, the Owner approves the join. |
| 5   | An invite is single use and expires after 24 hours. The Owner must be online when the peer joins.                                                   |
| 6   | Each member has a short **Member Code** (default: initials of their operator name) the Owner assigns at approval; unique within the Case.            |
| 7   | Exhibit Numbers carry the Member Code: `NK-12`, `MB-12`. When a Case has one member the prefix is hidden in the app and shown in exports.            |
| 8   | A member is an installation, not a person. One person on two machines is two members with two codes.                                                |
| 9   | Sync is automatic whenever the app is open and a peer is reachable, plus a manual **Sync now**.                                                     |
| 10  | Notes, tags, and annotations belong to their author. Tags with the same name from different members display as one tag; hover shows who applied it. |
| 11  | Only the author can delete their own Exhibit. The Owner can mark any Exhibit **Excluded from export**; the exclusion is recorded, not hidden.        |
| 12  | Revoking a member stops syncing with them. They keep the copy they already hold. The app must say so.                                               |
| 13  | Case data is not encrypted at rest (unchanged from today; full-disk encryption is the documented prerequisite). Connections between peers are encrypted. |
| 14  | Connections are brokered through a relay when a direct connection fails. The relay sees connection metadata (which installations, when, how much), never Case content. The relay URL is a setting. |
| 15  | Staging Pool, Selectors, to-do items, and the Case's timestamp settings stay local to each machine. They do not sync.                                |
| 16  | If the Owner's machine is lost, any member can create a new Case from their own copy and become its Owner.                                          |

## Surfaces to draw

Draw each surface in the existing design language of the Birdbrain UI project. Use the theme's
semantic tokens, not raw color values.

### Members tab in Case settings

The home of the feature. Contents:

- **Your identity card**: operator name, Member Code, key fingerprint (short form, expandable), role.
- **Member list**, one row per member: name, Member Code, role, connection state, last synced
  time. Owner-only row actions: revoke.
- **Invite** button (Owner only).
- **Sync now** button and a line showing the last sync outcome.
- **Relay** setting: a URL field with a plain-language line stating what the relay can and cannot
  see (decision 14).
- **Create a new Case from my copy**: the recovery action from decision 16. Place it where a
  destructive action belongs.

Connection states a row can show: connected, syncing, offline (with last-seen time), pending
approval (Owner's view of a peer that pasted an invite), revoked.

States of the whole tab: not shared yet (single member; the tab explains what sharing does and
offers **Invite**), shared, relay unreachable, feature unavailable on this machine (see
"Platform constraint" below).

### Invite flow, Owner side

1. Owner clicks **Invite**. The app generates an invite string and shows it as copyable text and
   as a QR code. State the 24-hour expiry and single use.
2. Waiting state: "Waiting for someone to use this invite." The Owner can leave the screen; the
   invite stays valid.
3. Join request: a peer pasted the invite. Show their operator name and key fingerprint, and a
   Member Code field filled in with their initials. Validate uniqueness inline. Actions:
   **Approve**, **Decline**.
4. Result: the new member appears in the list and the first sync starts.

### Join flow, peer side

1. Entry point: a **Join a shared Case** action wherever Cases are created.
2. Paste field for the invite string. Show the operator name the invite carries, so the peer can
   confirm they have the right one.
3. Connecting state, then "Waiting for <owner name> to approve."
4. Success: the Case appears in the Case list and fills in as sync proceeds. Show progress at the
   Case level (Exhibits received of total).
5. Failure states, each with a next step: invite expired, invite already used, Owner not online,
   cannot reach the Owner or relay, declined.

### Sync state in the Case header

A compact indicator visible on every Case screen: idle, syncing, number of peers connected,
error. It must not demand attention when idle. Clicking it opens the Members tab.

### Attribution in existing surfaces

- Exhibit Numbers with a Member Code prefix in the capture list, the capture detail, the
  Overview, citations in notes, and exports (decision 7). Check how the prefixed form reads at
  the capture list's column widths.
- An author indicator on each capture row and in the capture detail. Members need to tell at a
  glance who captured what.
- Tags: one chip per name, authorship on hover (decision 10).
- Notes: authored by a member, labeled as such.
- **Excluded from export** as a visible state on an Exhibit, with who excluded it, and when.

### Revoke and exclude confirmations

Two confirmation dialogs whose copy must be honest:

- Revoke: "<name> will stop receiving updates. They keep the copy of this Case they already
  have." Actions: **Revoke**, **Cancel**.
- Exclude from export: the Exhibit stays in the Case and in every member's copy; exports list it
  as excluded rather than omitting it silently.

### Audit view entries

Wherever Manifest Entries render today, four new entry kinds appear: member added, member
revoked, merge (a sync that brought in another member's entries, with a count), and exclusion.
Each shows the acting member.

## Copy constraints

The repo's claim-discipline rules apply to every string in the mock
(`docs/agents/writing-guide.md`, "Claim discipline"):

<!-- vale Birdbrain.Assurance = NO -->
- Do not write *secure*, *end-to-end encrypted*, *tamper-proof*, or *private* without
  qualification. Say what is true: connections between peers are encrypted; Case files on disk
  are not; the relay sees who connected and when, not what was sent.
<!-- vale Birdbrain.Assurance = YES -->
- Do not imply the app verifies who a person is. A key fingerprint identifies an installation.
  Confirming that the fingerprint belongs to the person you expect is the user's out-of-band
  step; the mock may suggest it, never require it.
- A revoked member keeps what they have. Say it at revoke time, not in a help page.
- Use the project's terms: Case, Capture, Exhibit, Exhibit Number, Manifest, Operator. Proposed
  new terms for this feature, pending adoption in `CONTEXT.md`: **Shared Case**, **Member**,
  **Owner**, **Member Code**, **Invite**. Avoid *team*, *workspace*, *collaborator*, and *user*.

## Platform constraint

The peer-to-peer library ships no build for Intel Macs at present. The Members tab needs a state
for "sharing is not available on this machine," with the reason stated plainly. Engineering will
tell the designer if this changes before the mock is due.

## Questions for the designer

The designer's calls, not settled by the grilling:

1. How members are visually identified across the app: initials avatar, color, the Member Code
   itself, or a combination. The choice must survive five members and a dense capture list.
2. Where the sync indicator lives in the Case header and how it behaves when a peer goes offline
   mid-sync.
3. Whether the QR code or the copyable string is the primary form of the invite.
4. How the join flow surfaces inside the existing Case-creation entry points without adding a
   top-level route.

## Not in scope

Do not draw these; they are later phases or rejected: co-editing one note or report; a read-only
reviewer role; sharing part of a Case; forwarding Case data to Elasticsearch or another index;
encrypting Case files at rest; transferring ownership between members.

## Deliverable

A mock in the "Birdbrain UI" design project covering the seven surfaces above and the states listed
under each, delivered through the design handoff round trip described in the current bundle's
`ENGINEERING_REVIEW.md` under `docs/design-handoff/`.
