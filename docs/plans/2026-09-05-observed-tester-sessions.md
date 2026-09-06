# Observed tester sessions - round 1

**Date:** 2026-09-05
**Status:** Planned - run once the exhibit chain has landed and a candidate build has passed the pre-ship gate. The sessions gate the public beta cut (decided 2026-09-06, [public-beta brief](../specs/2026-09-06-public-beta-brief.md))
**Owner:** Matt Donovan
**Map:** [#284](https://github.com/thebristolsound/birdbrain/issues/284) (round-1 tester readiness); ticket [#1237](https://github.com/thebristolsound/birdbrain/issues/1237)

## Why this replaces "please test it when you can"

The internal beta was never going to be large. Testers have jobs, the ask was open-ended,
and an open-ended ask to a busy person gets a polite yes and no session. Two things a beta
was meant to buy are already covered elsewhere: every tested platform installs and runs
([pre-ship gate](2026-08-15-pre-ship-validation-gate.md), section 3, now backed by the
packaged-app smoke in `release.yml`), and evidence integrity is proven by the verifier, the
known-answer fixtures, and the evidence gate, none of which a tester exercises by clicking.

What is left is the thing only a person can show: where a working investigator hesitates,
what they believe the tool has proved, and what they do when it goes wrong. One watched
half hour yields more of that than a month of unobserved use. So the ask becomes two
observed sessions of thirty minutes, scripted, with a fixed end time.

The floor from #284 still governs what counts: **Birdbrain must not silently lose, corrupt,
or mis-attest evidence.** A session finding that touches the floor is a blocker, and it
cancels the public beta cut until it is fixed and the gate is re-run. Everything
else is input to the redesign, which is what
[the sequence note](2026-08-14-round-1-then-redesign-sequence.md) says round 1 is for.

## Who, when, where

- **Two testers from the round-1 cohort**, referred to by codename only, as the
  [public-beta brief](../specs/2026-09-06-public-beta-brief.md) requires. Pick one who has
  used an evidence tool before and one who has not.
- **After the exhibit chain lands.** The capture and export flow changes under it, and a
  session run on the old flow spends the tester's one visit on screens that will not ship.
  #284 already waits on it.
- **On a CI-built candidate that has passed the gate.** No local builds, for the same reason
  the gate gives.
- **Remote, screen shared, thirty minutes, hard stop.** The tester installs beforehand
  from the tester guide so the session starts at launch, not at download.

## Facilitator rules

- **Think-aloud.** Ask the tester to say what they are looking for and what they expect to
  happen before they click. Remind them once if they go quiet.
- **Do not help for sixty seconds.** When they are stuck, wait. Where they look during
  that minute is the finding. After sixty seconds, give the smallest hint that unblocks them
  and note that a hint was needed.
- **No defending the design.** "Interesting, keep going" is the whole response to a
  complaint. Arguing costs the next finding.
- **Record, do not fix.** Nothing gets filed during the session.

## The script

Timings are targets. If a task overruns by more than its budget, give the hint and move on;
a session that never reaches export has lost its most important task.

| Step | Time | Task as read to the tester | What to watch for |
|---|---|---|---|
| 0 | 0-3 | "Open Birdbrain. Tell me what you see." | Whether the tour or the dashboard reads as a starting point. |
| 1 | 3-6 | "Start a new investigation. Name it anything." | Time to find the entry point without the tour. |
| 2 | 6-11 | "Capture this page." (Give a neutral URL: a Wikipedia article.) | Whether they find the extension, whether the app's list updating is noticed, whether the connection state is understood. |
| 3 | 11-14 | "Capture a second page." | Whether the second capture is faster; whether they check it landed. |
| 4 | 14-18 | "Open the first capture. Tell me what Birdbrain is claiming about it." | **Floor check.** What they say the hash and the timestamp prove, in their words. Any claim stronger than what the tool makes is a mis-attestation risk and goes in the report verbatim. |
| 5 | 18-21 | "Write yourself a note about it." | Whether notes are found and whether the note is attached to the capture in their mind. |
| 6 | 21-26 | "You need to hand this to someone who does not have Birdbrain. Do that." | Whether export is found, which preset they choose and why, whether they open the result and what they expect to find inside. |
| 7 | 26-28 | "Quit Birdbrain and open it again. Is your work still there?" | Whether they trust it is; whether they check. |
| 8 | 28-30 | Debrief. | The five questions below. |

The Playwright spec `e2e/round1-session.spec.ts` runs steps 1 to 7 by machine against the
built app, so the path the script walks is proven working before a person walks it. A spec
failure on the candidate cancels the session.

## Debrief questions

1. "What did the export prove, to the person receiving it?"
2. "Was there a moment you were not sure whether something had saved?"
3. "What would you have done if a capture had failed?"
4. "What did you expect to find that was not there?"
5. "Would you use this on a live case next week? What would stop you?"

## What gets recorded

One session report per tester, kept in the private tester channel and not in this
repository, since it names a person's behaviour. Per step: completed, time taken, hint
needed (yes or no), a verbatim line where they hesitated or misread. Answers to the five
questions, verbatim where possible.

From the two reports, file defects as ordinary issues by codename only. Anything touching
the floor gets the `blocker` label and a comment on #284. Everything else is triaged like
any other issue and, where it concerns the redesigned flow, cross-referenced on the
design-handoff program.

## Not in scope

- **Statistical claims.** Two sessions show where two people stumbled. They do not measure
  a rate.
- **macOS.** Unsupported in round 1 per the brief.
- **The extension install itself.** It happens before the session, from the guide. If a
  tester arrives without it working, that is the first finding and the session becomes
  an install session.
