# Engineering review: launched browser, Withheld from analysis mark, "not read" count

Bundle date: 2026-10-12. Answers `docs/specs/2026-10-11-launched-browser-and-investigation-ui-brief.md` (#1825).
Mock: `Launched Browser.dc.html` (canvas, pieces 1a–1z). Fill **Verdict** (Accept / Modify / Reject), **Size** (S/M/L), and **Constraint** per row.

## Surfaces

| # | Surface | Mock | Design call | Verdict | Size | Constraint |
|---|---|---|---|---|---|---|
| 1 | Found browsers in Settings | 1a | "Launched browsers" group in Settings → Capture; unconfirmed versions read "reported …, not yet confirmed"; Choose an executable… with the Snap/Flatpak note | | | |
| 2 | Start dialog | 1b, 1c, 1d, 1e | Launched from a "Launch browser" button in the Case action bar and a ⌘K action; Persona defaults to None with the throwaway note; Egress read-only; footer says start vs join; checklist while the window is hidden | | | |
| 3 | Capture Session panel | 1f, 1g, 1k, 1l, 1r | 320px right rail at 900 × 600; Pop out to a small always-on-top Birdbrain window; capture target names title, URL, Persona, window/tab; Scroll to load per Capture; Exhibit Number after progress | | | |
| 4 | Telling the browsers apart | 1h, 1i | Birdbrain side: "Launched Chrome · ‹Persona›" in the REC pill, switch source line, panel, capture target. Browser side (**feasibility, P15**): profile name "Birdbrain · ‹Persona›" plus theme colour from the one pre-launch preference. Also proposed: an in-Birdbrain notice when an `extension` Capture arrives while a launched browser is open | | | |
| 5 | Withheld from analysis mark | 1u, 1v, 1w, 1x | ⊘ + "Withheld from analysis · ‹holders›" in a dotted outline (works without colour); shortened to "Withheld" in dense tables with full name as the accessible name; no clear action on search rows | | | |
| 6 | "Not read" count + gap entry | 1y, 1z | Third count in the header, opens a breakdown headed "This run did not open these Exhibits"; gap entry carries "Show them" | | | |

## States

| # | State | Mock | Verdict | Size | Constraint |
|---|---|---|---|---|---|
| 1 | No supported browser / unrecognized / below floor | 1j | | | |
| 2 | Debugging connection does not answer | 1j | | | |
| 3 | Proxy refuses before launch | 1j | | | |
| 4 | A launched browser is already open | 1j, 1f (disabled button) | | | |
| 5 | Recording, one tab not from first request | 1f, 1k | | | |
| 6 | Private-window tab | 1f, 1k | | | |
| 7 | Capture abandoned | 1l | | | |
| 8 | Crashed tab | 1k | | | |
| 9 | Extension warning (Egress not Direct) | 1m | | | |
| 10 | Browser closed, Capture Session running | 1n | | | |
| 11 | Ended by the Egress check | 1o | | | |
| 12 | Closed before it showed (WebRTC) | 1o | | | |
| 13 | Browser left from an earlier run | 1p | | | |
| 14 | Changing the Egress during a Capture Session | 1q | | | |
| 15 | Deleting a Persona whose browser is open | 1q | | | |
| 16 | Passive capture running (_once #600 lands_) | 1s | | | |
| 17 | Port mode takeover warning (_only if built_) | 1t | | | |
| 18 | Withheld result in each placement | 1u, 1v, 1w | | | |
| 19 | Withheld result opened | 1w | | | |
| 20 | Shared Case, withheld by another member | 1x | | | |
| 21 | Non-zero "not read" count | 1y | | | |
| 22 | Gap list not-read entry | 1z | | | |

## Designer answers to the brief's questions

1. Right rail in Birdbrain's window; Pop out to an always-on-top Birdbrain window.
2. Same browser name on every Birdbrain surface; browser-side profile name + theme colour for feasibility (P15).
3. Switch shows while the extension is connected or a launched browser is open, with a source line. Turning it off confirms and closes the browser.
4. ⊘ glyph + words + holders + dotted outline. Wording matches the accepted mock's checkbox and setup row.
5. Count third, breakdown led by "This run did not open these Exhibits".
6. Struck-through shortcut with "This desktop did not confirm the shortcut…" and a pointer to the Capture button.
7. Settings → Capture → Launched browsers; "reported ‹version›, not yet confirmed".
8. Case action bar "Launch browser" + ⌘K.
9. Neutral mono chip "from first request"; the row without it says what the Capture lacks. Selectors read "matches now".
10. Yes, "Show them" opens the list of unread Exhibits.
11. Clear from the opened Exhibit and run setup only.
12. Yes, from the panel. Each change goes to the activity feed.
13. Follow the retrieval slice (Text or Links tab, highlighted); the mark and Clear my flag sit on the Exhibit header there.

## Open for engineering

- Whether "Clear my flag" on the opened Exhibit (1w) needs a confirm, since it puts the shown run out of date.
- Example browser versions in 1a are illustrative; no version floor number is shown.
