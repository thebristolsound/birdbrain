# Sharing discoverability UI brief

Date: 2026-10-27
Audience: the designer working in the "Birdbrain UI" design project. Engineering contact: the
maintainer.
Source: the maintainer's own first walk through the shipped Shared Cases slices on 2026-10-27,
before handing the build to a second tester. The brief below is the ask as sent; the bundle that
answers it is
[`docs/design-handoff/2026-10-28-share-a-case/`](../design-handoff/2026-10-28-share-a-case/).

## The problem

The Members screens from the [members UI brief](2026-09-19-shared-case-members-ui-brief.md) are
in the app, along with invite, join, sync and revoke. The first thing the maintainer hit was:
where is the share button? Birdbrain has none.

## Where sharing lives today

- The only way an Owner starts sharing is from the dashboard: open a Case card's menu, pick
  **Members**, then click **Invite** on the Members screen.
- The dashboard shows only the three most recent Cases, so an older Case has no reachable way
  to be shared at all.
- Inside an open Case there is nothing about sharing until a teammate has joined. Only then
  does a sync pill appear in the top bar, and clicking it opens Members.
- The joiner's side is fine: the New Case wizard has a "Join a shared Case" choice and the
  command palette has the same action.
- The Members screen sits behind a Case settings route with a single Members tab. The
  placeholder note about empty General and Export tabs is being removed, so treat that screen
  as just Members.

## Constraints that are fixed

- Only the Owner (the installation that first shared the Case) can invite or revoke.
- An invite is a string or a QR code, sent over a channel the people already use. It works
  once and expires in 24 hours.
- A Shared Case is designed for two to five people. Sync only runs while both apps are open.
- Sharing is unavailable on Intel Macs; the app already has copy for that state.
- Evidence rules: a Case is never shared by accident, and the Owner approves every join. Any
  one-click share keeps the approval step.

## Questions for the designer

Go wide first: options, not one answer.

1. Where sharing should be reachable from inside an open Case before anyone has joined. A
   permanent spot in the top bar or sidebar, an item in the Case menu, an empty-state nudge, or
   something else.
2. Whether "Members" is the right name for the entry when the Case is not yet shared. "Share",
   "Share this Case" or "Invite a teammate" might read better until the first member joins,
   then become Members.
3. How a shared Case should look different from one that is not, on the dashboard card and
   inside the Case, so the state is obvious at a glance.
4. A first-run moment: the first time someone opens a Case after installing this version, is
   there a light-touch way to tell them sharing exists?
5. Whether the dashboard's three-card limit should change, or whether the Case list elsewhere
   needs a Members or Share action too.

## Deliverable

Sketches or low-fidelity frames for the first pass, with a sentence on each option's tradeoff.
Then one or two picks taken to the fidelity of the Members handoff.

## References

- The earlier handoff:
  [`docs/design-handoff/2026-09-19-shared-case-members/`](../design-handoff/2026-09-19-shared-case-members/).
- That round's brief and [feasibility assessment](2026-09-19-shared-case-members-feasibility-assessment.md);
  items 19 to 25 are the navigation ones.
- The tester-facing description of the flow: the
  [tester guide](https://docs.birdbrain.cc/docs/tester-guide), "Share a case with teammates".
- The design system is generated from the code: `pnpm design-system` prints the current tokens
  and components.
