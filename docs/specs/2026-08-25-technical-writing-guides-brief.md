# Technical writing guides for enterprise software documentation

This brief reports on the current industry standards for technical writing in enterprise software documentation, verified against the primary sources that own them: the Microsoft, Google, Red Hat, MDN, Kubernetes, GitLab, and Django style material, the Diataxis framework (written Diátaxis by its author; spelled without the accent here for ASCII cleanliness), the Write the Docs guides, the ASD-STE100 standard, and ISO/IEC/IEEE 26514. It then delivers three standalone writing guides, each with a distinct tone and approach, that a team could adopt directly. Every factual claim in the findings carries a citation; the closing section lists every URL used.

## Findings

### Where the major guides agree

The corporate and open source style guides converge on a small set of rules that can be treated as the industry baseline.

- Use active voice and make the actor explicit. Google's guide states the reason plainly: in passive constructions "it's often hard for readers to figure out who's supposed to do something (such as the reader, the computer, the server, an end user, or a visitor to a web page)" (https://developers.google.com/style/voice). GitLab adds a translation argument: active voice is "easier to understand and to translate" (https://docs.gitlab.com/development/documentation/styleguide/). Both allow narrow exceptions, such as when the actor is irrelevant or when naming it would blame the user ("The file is saved" rather than "You created over 50 conflicts in the file," per the Google voice page).
- Address the reader as "you." Google's highlights page puts it first under language: "Use second person: 'you' rather than 'we'" (https://developers.google.com/style/highlights). GitLab frames the same rule as customer perspective, warning that "allow" and "enable" signal you are writing about the vendor rather than to the user (GitLab style guide, "Customer perspective").
- Use sentence-case headings. Microsoft's rule is "When in doubt, don't capitalize" with title-style capitalization explicitly ruled out (https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice). Google's highlights page says the same: "Use sentence case for document titles and section headings."
- Prefer short, plain, front-loaded prose. Microsoft's first tip is "Use bigger ideas, fewer words," and its "Get to the point fast" tip says to lead with what matters and front-load keywords for scanning (Microsoft top 10 tips page). MDN condenses the same idea into "the three Cs": clear, concise, consistent (https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide).
- Put conditions before instructions. Google lists this on its highlights page ("Put conditions before instructions, not after"), and it follows from the scanning argument every guide makes: a reader acting on step text must know the precondition before acting.
- Cut filler subjects and weak openers. Microsoft says to avoid "there is," "there are," and "there were" and to start statements with a verb (Microsoft top 10 tips page). GitLab bans the same phrases for translation reasons, along with the ambiguous pronoun "it" (GitLab style guide, "Writing for localization").
- Use the serial comma and standard American spelling. Microsoft's "Remember the last comma" tip and Google's "Use serial commas" and "Use standard American spelling and punctuation" lines match; Kubernetes and GitLab both mandate U.S. English (Kubernetes style guide; GitLab style guide).
- Format technical objects consistently: code font for code, commands, filenames, and paths; bold for UI elements; unambiguous placeholders. Google's highlights page and the Kubernetes style guide carry near-identical rules, and Kubernetes adds angle-bracket placeholders with an instruction to tell the reader what each placeholder represents (https://kubernetes.io/docs/contribute/style/style-guide/).
- Write inclusively and for a global audience. MDN gives concrete substitutions (allowlist/denylist, main/replica, placeholder for dummy) and prefers gender-neutral pronouns or pronoun-free rewrites (MDN writing style guide). Django requires singular "they" for hypothetical users (https://docs.djangoproject.com/en/5.2/internals/contributing/writing-documentation/). Both MDN and the Write the Docs style guide page flag violent or animal-cruelty idioms as confusing for non-native speakers, with Write the Docs carving out established technical terms such as the Unix "kill" signal (https://www.writethedocs.org/guide/writing/style-guides/).
- Do not market. GitLab is the bluntest source: "Do not use words like easily or simply" and no phrases like "This feature will save you time and money"; state facts and achievable goals instead (GitLab style guide, "Building trust").

### Where the guides differ

The disagreements are more instructive than the agreements, because they mark real design choices a documentation team has to make.

- Warmth versus control. Microsoft's brand voice is "warm and relaxed, crisp and clear, and ready to lend a hand" (https://learn.microsoft.com/en-us/style-guide/welcome/); it tells writers to "write like you speak" and to use contractions (top 10 tips page). At the far end of the same axis, ASD-STE100 Simplified Technical English removes almost all stylistic freedom: 53 writing rules in 9 sections plus a controlled dictionary of roughly 900 approved words, each approved with one meaning and one part of speech, alongside roughly 1200 unapproved words with suggested alternatives (https://www.asd-ste100.org/about_STE.html). STE exists because misread maintenance instructions cause accidents; friendliness is not one of its goals. Most enterprise guides sit between these poles, and GitLab's localization rules (avoid words ending in -ing, avoid "since" where "because" is meant, avoid Latin abbreviations) show that translation pressure pushes even a conversational guide toward the controlled end (GitLab style guide, "Writing for localization").
- Rules-first versus structure-first. The Microsoft, Google, and Kubernetes guides are essentially large rule catalogs: what to capitalize, what to bold, which word to pick. Diataxis argues that the prior question is structural: there are "four distinct needs, and four corresponding forms of documentation - tutorials, how-to guides, technical reference and explanation," and documentation should be organized around those needs (https://diataxis.fr/). In Diataxis, tone is downstream of document type rather than fixed globally. Django is evidence that this structure predates the framework's name: its contributing guide has long split the docs into tutorials, topic guides, reference guides, and how-to guides, with per-category writing advice such as "what matters is what the reader does, not what you explain" for tutorials and "Reference guides aren't the place for general explanation" (Django, "Writing documentation").
- Guidelines versus enforcement. Kubernetes opens its style guide with "These are guidelines, not rules. Use your best judgment" (Kubernetes style guide). GitLab takes the opposite position: its style guide is tested mechanically with Vale and `markdownlint`, and its docs are declared "the single source of truth (SSoT) for all product information" with a docs-first methodology (answer questions by linking to docs; if the answer is missing, merge it into the docs first) (GitLab style guide). Django also enforces by machine: spelling checks, code-block formatting via blacken-docs, and link checking all run in CI and must pass before docs changes merge (Django, "Writing documentation").
- Standalone guide versus layered supplement. Red Hat does not maintain a complete standalone guide. Its public supplementary style guide "overrides or supplements some guidance provided by the IBM Style guide, which is the primary source of style guidance for Red Hat product and cross-product solution documentation," and the stated lookup order is product-specific guide first, then the supplementary guide, then IBM Style (https://redhat-documentation.github.io/supplementary-style-guide/). The IBM Style guide itself sits behind a login, so this brief cites only what the Red Hat supplement states publicly. The layering pattern is itself a finding: large organizations standardize on a base guide and publish deltas.
- Formal process standards. ISO/IEC/IEEE 26514:2022 "covers the development process for designers and developers of information for users of software" and "provides requirements for the structure, information content, and format of information for users of software" (https://www.iso.org/standard/77451.html). The full text is behind a paywall; this brief relies on the ISO abstract only. Similarly, the full ASD-STE100 specification is free but distributed on request, so the STE claims in this brief come from the standard's own about page rather than the rule text. The adoption record for STE is first-party and substantial: required by the ATA 100 specification (now ATA iSpec 2200) since 1986, recommended in the S1000D specification, and required in airworthiness directives from EASA, FAA, and CAAC (ASD-STE100 about page).

### Exemplar documentation projects and what makes each one good

- Kubernetes (kubernetes/website). The style guide's signature device is the do-and-don't table: paired correct and incorrect examples for every rule, from API object capitalization (`HorizontalPodAutoscaler`, not `Horizontal pod autoscaler`) down to banning meaningless variable names like foo and bar and removing trailing spaces in code because screen readers read them aloud. Changes to the guide go through SIG Docs as a group, which gives the rules a governance path (https://kubernetes.io/docs/contribute/style/style-guide/).
- GitLab. GitLab runs the strongest publicly documented docs operating model: documentation as the single source of truth, a docs-first answering culture, topic types that force task-oriented rather than implementation-oriented writing, mechanical style enforcement with Vale, and unusually concrete localization rules including a 30 percent expansion allowance for translated UI text (https://docs.gitlab.com/development/documentation/styleguide/).
- Django. Django treats documentation exactly like code: reStructuredText sources in the repository, Sphinx builds, and CI quality gates (spelling, code-block formatting, link checking) that block merges. Its four-category organization with per-category guidance is the clearest pre-Diataxis implementation of reader-need structure in a major project (https://docs.djangoproject.com/en/5.2/internals/contributing/writing-documentation/).
- MDN Web Docs. The writing style guide is unusually good at teaching judgment rather than only rules: the three Cs, audience targeting, and a worked example showing a too-short, a too-long, and a well-calibrated introduction for the same API page. Its inclusive-language section gives ready substitutions instead of abstract principles (https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide).
- Diataxis. Diataxis is not a documentation set itself but the structural framework the field has converged on. Its home page claims adoption in "hundreds of documentation projects" and quotes practitioners from Vonage, Gatsby, and Cloudflare; the Cloudflare quote calls it the "north star for information architecture" during their docs redesign. Those are testimonials the site itself selected, so treat them as adoption evidence with that caveat (https://diataxis.fr/).
- Write the Docs. The community's guide pages function as the field's meta-reference: a definition of what a style guide is for (consistency reduces cognitive load and increases the content's authority), a curated map of the corporate, government, and open source guides, and a beginner's guide whose warnings (for example, that FAQs "become quickly outdated" and "are rarely an actual list of frequently asked questions from real users") condense community experience (https://www.writethedocs.org/guide/writing/style-guides/ and https://www.writethedocs.org/guide/writing/beginners-guide-to-docs/).
- Red Hat supplementary style guide. This guide is worth studying for its change management as much as its rules: a public changelog, issue templates with severity and priority for proposed style changes, a style council that adjudicates deviations, and recent guidance such as writing procedure titles with imperatives instead of gerunds. It also now auto-generates a Markdown edition explicitly to optimize the guide for machine and AI consumption (https://redhat-documentation.github.io/supplementary-style-guide/).

The three guides that follow are grounded in this material. Guide A distills the corporate rule-catalog tradition. Guide B builds on Diataxis and the Django/GitLab structural practice. Guide C works in the Write the Docs and MDN tradition of principles taught through examples. Each is usable on its own.

---

## Guide A: the rulebook

This is a prescriptive style guide in the corporate register. Adopt it when you need many writers to produce interchangeable prose with minimal debate. Rules use MUST, SHOULD, and AVOID. When two rules conflict, the earlier rule wins. This guide draws on the Microsoft Writing Style Guide, the Google developer documentation style guide, the Kubernetes documentation style guide, and the GitLab documentation style guide; sources are listed at the end of the guide.

### Voice and person

- You MUST write in second person. Address the reader as "you."
- You MUST use active voice and name the actor. Passive voice is permitted only when the actor is unknown, irrelevant, or would read as blame.
- You MUST write in present tense. AVOID "will" for product behavior.
- You SHOULD start instructions with a verb. AVOID openers such as "You can" when the sentence works without them.
- You MUST NOT use "there is," "there are," or "there were" as sentence openers.
- You MUST NOT use marketing language. AVOID "easily," "simply," "powerful," and any claim about how the reader will feel.
- You MUST NOT pre-announce features that have not shipped.

### Sentences and words

- You MUST keep one idea per sentence. Sentences longer than roughly 25 words SHOULD be split.
- You MUST put the condition before the instruction. Write "If the build fails, check the log," never the reverse.
- You MUST prefer the plain word: "use" over "utilize," "because" over "since" (reserve "since" for time), "about" over "approximately."
- You MUST NOT use Latin abbreviations such as `e.g.` and `i.e.`. Write "for example" and "that is."
- You MUST NOT use idioms, humor that depends on culture, or figurative violence. These fail for translated and non-native readers.
- You MUST expand an acronym on first use in a page, then use the acronym alone.
- You MUST use inclusive terminology: allowlist and denylist, main and replica, placeholder rather than dummy. Use singular "they" for a hypothetical person, or rewrite to remove the pronoun.

### Mechanics

| Rule | Do | Do not |
| --- | --- | --- |
| Headings use sentence case. | Configure the capture server | Configure The Capture Server |
| Headings take no end punctuation. | Export a case | Export a case. |
| Lists of three or more items take the serial comma. | Android, iOS, and Windows | `Android, iOS and Windows` |
| UI elements are bold. | Click **Fork**. | Click `"Fork"`. |
| Code, commands, filenames, and paths are code font. | Open the `envars.yaml` file. | Open the envars.yaml file. |
| New terms are italic on first use, then plain. | A *cluster* is a set of nodes. | A "cluster" is a set of nodes. |
| Placeholders use angle brackets, and the text defines them. | `kubectl describe pod <pod-name>`, where `<pod-name>` is the name of the pod. | `kubectl describe pod POD` with no definition. |
| Numbered lists are for sequences only. | Steps 1 through 5 of a procedure. | A numbered list of unordered options. |
| Dates are unambiguous. | August 25, 2026 | `08/25/2026` |
| Spelling is standard American English. | color, behavior | `colour, behaviour` |

### Links and images

- Link text MUST describe the destination. You MUST NOT write "click here" or "this page."
- You SHOULD link to a canonical explanation instead of restating it. Duplicated content drifts.
- Every image MUST have alt text. Screenshots SHOULD be used sparingly, because they go stale and resist translation.

### Procedures

- Each step MUST contain one action. A step MAY add one sentence of result ("The status changes to **Ready**.").
- Procedure titles MUST start with an imperative or a task noun phrase, not a gerund. Write "Create a project," not "Creating a project."
- You MUST state prerequisites before step 1, never inside the steps.
- You MUST show a command and its output in separate code blocks.

### Enforcement

- These rules SHOULD be enforced mechanically where possible (Vale, `markdownlint`, spell check, link check) and in review otherwise. A rule that is never enforced is a preference, not a rule.

Guide A draws on these sources: Microsoft Writing Style Guide top 10 tips (https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice); Google developer documentation style guide highlights and voice pages (https://developers.google.com/style/highlights, https://developers.google.com/style/voice); Kubernetes documentation style guide (https://kubernetes.io/docs/contribute/style/style-guide/); GitLab documentation style guide (https://docs.gitlab.com/development/documentation/styleguide/); Red Hat supplementary style guide for the imperative-title rule (https://redhat-documentation.github.io/supplementary-style-guide/).

---

## Guide B: structure first

This guide is built on the Diataxis framework (https://diataxis.fr/) and is for teams whose problem is not sentences but architecture: docs that exist yet fail readers because tutorials explain, references advise, and how-to guides teach. The premise is that you decide what kind of document you are writing before you write a word, and the right tone follows from that decision. Django's documentation has organized itself this way for years (https://docs.djangoproject.com/en/5.2/internals/contributing/writing-documentation/), and GitLab's topic types apply the same instinct (https://docs.gitlab.com/development/documentation/styleguide/).

### The four documents and the two questions

Every piece of documentation answers two questions about its reader. Is the reader acting or trying to understand? Is the reader studying (acquiring skill) or working (applying skill)? The four combinations yield four document types, and Diataxis insists they must not be mixed within one document (https://diataxis.fr/start-here/).

| The content informs | It serves the reader's | The document type |
| --- | --- | --- |
| action | acquisition of skill | a tutorial |
| action | application of skill | a how-to guide |
| cognition | application of skill | reference |
| cognition | acquisition of skill | explanation |

Before you write, place the document in this table. When an existing page feels wrong, the usual cause is that its content sits in two cells at once.

### Tutorials: the reader is learning

A tutorial is a lesson. Its obligation is to provide a successful learning experience, not to transfer information; the reader "will learn through what they do - not because someone has tried to teach them" (https://diataxis.fr/start-here/). Consequences for the writer:

- You take responsibility for the reader's success. Choose a path where every step visibly works, and tell the reader what they will see at each point.
- Keep explanation to the minimum that keeps the reader oriented, and link out for depth. Diataxis calls overloaded explanation the classic tutorial failure: give "the most minimal explanation" inline and link to the in-depth article for later (https://diataxis.fr/start-here/).
- Django's version of the same advice: help the reader achieve something useful "preferably as early as possible, in order to give them confidence," and remember that "what matters is what the reader does, not what you explain" (Django, "Writing documentation").
- Keep the tone patient, concrete, and encouraging; first-person plural is acceptable ("Now we run the server"). This is the one document type where warmth does real work, because a learner who feels stupid stops.

### How-to guides: the reader is working

A how-to guide serves a competent user pursuing a real task. Diataxis draws the boundary sharply: a tutorial is a lesson in medical school, a how-to guide is the clinical manual an experienced surgeon consults mid-procedure (https://diataxis.fr/tutorials-how-to/). Consequences:

- Name the goal in the title, as the user would phrase it. GitLab's topic types exist for the same reason: to keep pages "geared toward helping others, rather than documenting how a feature was implemented" (GitLab style guide).
- Assume competence. Do not re-teach concepts; link to the tutorial or explanation instead. Django: "don't hesitate to refer the reader back to the appropriate tutorial rather than repeat the same material" (Django, "Writing documentation").
- Branch where reality branches. Real tasks contain "if this, then that"; a how-to guide that admits no variation describes a demo, not a task.
- Keep the tone brisk and imperative. Every sentence either moves the task forward or gets cut.

### Reference: the reader is checking

Reference contains facts: "accurate, complete, reliable information, free of distraction and interpretation" (https://diataxis.fr/start-here/). Consequences:

- Structure mirrors the product. If a method belongs to a class in a module, the docs reflect that relationship, the way a map reflects terrain.
- Be neutral and complete. Reference "is not concerned with what the user is doing"; the same page must serve any task (https://diataxis.fr/start-here/).
- State each fact once in a predictable place and format. Consistency of shape matters more here than anywhere else, so this is where Guide A-style mechanical rules bind hardest.
- Keep the tone austere, with no opinions, no persuasion, and no steps. If you are explaining basic concepts inside reference, Django's advice applies: move that material to a topic guide (Django, "Writing documentation").

### Explanation: the reader is understanding

Explanation provides context and answers why. It "can contain opinions and take perspectives" and may approach its subject from several directions (https://diataxis.fr/start-here/). Consequences:

- Connect the topic to what the reader already knows; Django calls this providing background that "helps a newcomer connect the topic to things that they already know" (Django, "Writing documentation").
- Discuss alternatives, history, and trade-offs. This is the only quadrant where they belong.
- Keep the tone reflective and discursive, closer to an essay than a manual. It is also the only quadrant where hedged language ("generally," "one approach") is honest rather than weak.

### Working method

Do not plan a grand reorganization. The Diataxis workflow is deliberately small: look at what is in front of you, ask whether it could be improved, and make one improvement now (https://diataxis.fr/start-here/). Use the compass table when a page resists improvement; the blockage is usually a quadrant violation. Adopt a base mechanical style (any of Microsoft, Google, or your own Guide A) for spelling, formatting, and terminology, and let this guide govern structure and tone on top of it.

Guide B draws on these sources: Diataxis home, start-here, and tutorials-versus-how-to pages (https://diataxis.fr/, https://diataxis.fr/start-here/, https://diataxis.fr/tutorials-how-to/); Django "Writing documentation" (https://docs.djangoproject.com/en/5.2/internals/contributing/writing-documentation/); GitLab documentation style guide, topic types section (https://docs.gitlab.com/development/documentation/styleguide/).

---

## Guide C: Write for the reader in front of you

This is a principle-driven guide in the Write the Docs and MDN tradition, for teams that want good judgment more than uniform output: open source projects, small docs teams, developers writing their own docs. It has few rules and many examples, because the sources it draws on teach the same way. Where Guide A says MUST, this guide says "here is why, and here is what it looks like."

### Start from why anyone is reading

Nobody reads documentation for pleasure. Someone arrives with a problem, and your page either solves it or wastes their time. Write the Docs opens its beginner's guide with the humbling version of this: your own code from six months ago "looks like code that someone else wrote," and the reader you are helping includes future you (https://www.writethedocs.org/guide/writing/beginners-guide-to-docs/). So before writing, answer two questions. Who is this for: a user who wants results without internals, or a contributor who wants internals? And what should they be able to do when they finish the page? MDN calls this considering your target audience, and notes that an advanced page need not re-teach the basics (https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide).

### Talk like a person who knows the material

The register to aim for is a knowledgeable colleague at a whiteboard: conversational, direct, never showing off. Google phrases the balance as "conversational and friendly without being frivolous" (https://developers.google.com/style/highlights). Microsoft's version is "write like you speak" and read your text aloud (https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice). Some consequences:

- Say "you." The reader is a person doing something, not "the user" being described from orbit.
- Use contractions where they sound natural. "It's" and "you'll" read as human; avoiding them reads as legal copy.
- Never talk up the product. The moment docs say "simply" or "easily," the reader who is stuck feels lied to. GitLab bans those words outright and tells writers to state facts and achievable goals instead (https://docs.gitlab.com/development/documentation/styleguide/). Trust is the entire asset of documentation; spend it on nothing.
- Plain words beat impressive words. If a sentence would embarrass you spoken aloud to a colleague, rewrite it.

### Show, then tell

Examples carry more information than descriptions of examples. The MDN guidance is to use examples to clarify every parameter and edge case, and its writing guide practices what it preaches: it teaches introductions by showing a too-short one, a too-long one, and a good one for the same function (MDN writing style guide, "Provide a descriptive introduction"). Write the Docs' beginner's guide recommends that a project's front page show a small, real code example early, citing the Requests library as the model (https://www.writethedocs.org/guide/writing/beginners-guide-to-docs/). Working habits that follow:

- For anything a reader can run, show a runnable example before the prose that generalizes it.
- Make example values meaningful. Kubernetes bans `foo`, `bar`, and `baz` because they carry no context (https://kubernetes.io/docs/contribute/style/style-guide/); an example named `capture-server-port` teaches while a `foo` merely occupies space.
- When you catch yourself writing a long conceptual paragraph inside a task page, stop. Either the reader needs it now, in one sentence with a link, or they need it later, on its own page.

### Respect every reader

Your audience is global, multilingual, and diverse, and prose that ignores this quietly excludes people. The fixes are cheap:

- Use gender-neutral language. Django's rule is simply "they" for any hypothetical person (https://docs.djangoproject.com/en/5.2/internals/contributing/writing-documentation/); MDN adds that rewriting to remove the pronoun entirely is often the best version (MDN writing style guide).
- Replace loaded terms: allowlist and denylist, main and replica, placeholder for dummy (MDN writing style guide).
- Skip idioms. "Kill two birds with one stone" costs a non-native reader a dictionary trip and gains you nothing; Write the Docs suggests "accomplish two things at once," while noting that real technical terms like the Unix `kill` command are not up for replacement (https://www.writethedocs.org/guide/writing/style-guides/).
- Write alt text for every image, and prefer text to screenshots when either would do (https://developers.google.com/style/highlights).

### Keep it honest and keep it alive

Documentation is a living part of the project, not a launch artifact. Django "treat[s] our documentation like we treat our code" and runs spelling, formatting, and link checks in CI (https://docs.djangoproject.com/en/5.2/internals/contributing/writing-documentation/). Habits worth stealing at any scale:

- When someone asks a question the docs should answer, answer by improving the docs and sending the link. GitLab formalizes this as docs-first methodology (https://docs.gitlab.com/development/documentation/styleguide/).
- Resist the FAQ. Write the Docs lists its failure modes: FAQs go stale, accumulate unrelated content, and "are rarely an actual list of frequently asked questions from real users" (https://www.writethedocs.org/guide/writing/beginners-guide-to-docs/). Fold each answer into the page where a reader would look for it.
- Automate what a machine can check (spelling, links, formatting) so human review can spend itself on truth and clarity.
- Delete confidently. A wrong page is worse than a missing one, because the missing one at least sends the reader to ask.

### A one-paragraph summary to pin above your desk

Know who the reader is and what they came to do. Talk to them plainly, in the second person, without sales language. Show a working example before you generalize. Write so a tired non-native speaker succeeds. Treat the docs as part of the product: test them, prune them, and improve them every time a question reveals a gap.

Guide C draws on these sources: Write the Docs beginner's guide and style guides pages (https://www.writethedocs.org/guide/writing/beginners-guide-to-docs/, https://www.writethedocs.org/guide/writing/style-guides/); MDN writing style guide (https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide); Django "Writing documentation" (https://docs.djangoproject.com/en/5.2/internals/contributing/writing-documentation/); Google style highlights (https://developers.google.com/style/highlights); Microsoft top 10 tips (https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice); GitLab documentation style guide (https://docs.gitlab.com/development/documentation/styleguide/); Kubernetes documentation style guide (https://kubernetes.io/docs/contribute/style/style-guide/).

---

## Sources

All sources were read directly at the URLs below on 2026-08-25, except as noted.

- Microsoft Writing Style Guide, welcome page: https://learn.microsoft.com/en-us/style-guide/welcome/
- Microsoft Writing Style Guide, top 10 tips for style and voice: https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice
- Google developer documentation style guide, highlights: https://developers.google.com/style/highlights
- Google developer documentation style guide, active voice: https://developers.google.com/style/voice
- Diataxis, home: https://diataxis.fr/
- Diataxis, start here: https://diataxis.fr/start-here/
- Diataxis, the difference between a tutorial and a how-to guide: https://diataxis.fr/tutorials-how-to/
- MDN Web Docs, writing style guide: https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide
- Kubernetes documentation style guide: https://kubernetes.io/docs/contribute/style/style-guide/
- GitLab documentation style guide: https://docs.gitlab.com/development/documentation/styleguide/
- Django, writing documentation: https://docs.djangoproject.com/en/5.2/internals/contributing/writing-documentation/
- Write the Docs, style guides: https://www.writethedocs.org/guide/writing/style-guides/
- Write the Docs, a beginner's guide to writing documentation: https://www.writethedocs.org/guide/writing/beginners-guide-to-docs/
- Red Hat supplementary style guide for product documentation (introduction, hierarchy, and changelog; the underlying IBM Style guide is login-gated and was not read): https://redhat-documentation.github.io/supplementary-style-guide/
- ASD-STE100 Simplified Technical English, about page (the full specification is free on request but was not obtained; claims come from the about page only): https://www.asd-ste100.org/about_STE.html
- ISO/IEC/IEEE 26514:2022, Systems and software engineering - Design and development of information for users (abstract only; the full standard is behind a paywall): https://www.iso.org/standard/77451.html
