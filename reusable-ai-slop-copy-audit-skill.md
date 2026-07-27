# Reusable AI-Slop Copy Audit Skill

## Summary

Create a shared Codex skill at `/home/matt/.agents/skills/audit-ai-slop` that audits maintained user-facing application copy and current documentation for vague, inflated, unsupported, or generated-sounding language.

The skill will perform a deterministic keyword scan followed by contextual review. It will report high-confidence findings with literal rewrite options, then wait for explicit approval before editing files.

## Skill Structure

Create the skill with the skill-creator initializer and these resources:

```text
/home/matt/.agents/skills/audit-ai-slop/
  SKILL.md
  agents/openai.yaml
  scripts/scan_ai_slop.py
  references/rubric.md
  references/seed-terms.txt
```

Use the name `audit-ai-slop`. Generate `agents/openai.yaml` with a display name, concise description, and a default prompt that explicitly invokes `$audit-ai-slop`.

## Audit Scope

Default to maintained product and documentation prose:

- User-facing strings in application and extension source files.
- Root Markdown files such as `README.md`.
- Current docs, including `docs/reference`, `docs/adr`, and repository-level contributor/product docs.

Exclude by default:

- `node_modules`, build outputs, coverage, caches, lockfiles, vendored code, and generated artifacts.
- Tests and fixtures.
- Historical or planning material: `docs/archive`, `docs/plans`, `docs/specs`, and `docs/superpowers`.
- Code comments unless the user explicitly expands the scope.

Allow the invoking user to override the include/exclude paths when a repository uses a different layout.

## Deterministic Scanner

Implement `scripts/scan_ai_slop.py` using only the Python standard library.

Provide this interface:

```sh
python3 scripts/scan_ai_slop.py --root <repo-path> --format human
python3 scripts/scan_ai_slop.py --root <repo-path> --format json
```

Behavior:

- Recursively scan supported prose-bearing files: Markdown, MDX, HTML, TS/TSX, JS/JSX, JSON, YAML, and text files.
- Apply default exclusions before reading files.
- Load phrase patterns from `references/seed-terms.txt`.
- Emit each candidate with file path, line number, matched phrase, and a bounded source snippet.
- Keep output read-only and deterministic: no edits, caches, network requests, or generated reports.
- Exit successfully when no candidates are found; “no matches” is a valid audit result.

Seed terms should cover common AI-slop signals, including inflated adjectives, vague value claims, frictionless-workflow phrasing, unsupported superlatives, and AI-marketing formulations. It should not treat the mere presence of “AI” as a defect.

## Review Rubric

Write `references/rubric.md` to guide the semantic pass after the scanner runs.

Require the reviewer to distinguish:

- Literal feature descriptions from marketing abstractions.
- Verified product behavior from claims that need code or documentation support.
- Intentional domain terminology from generic jargon.
- Genuine AI functionality from phrases such as “AI-powered” or “AI-generated” that can be expressed more concretely.

Use the tone established in the README cleanup:

- Prefer direct, specific, local language.
- State what the product does, where data goes, and what users receive.
- Preserve accurate feature claims and the project’s opinionated voice.
- Avoid adding claims about automation, AI, cloud services, privacy, legal admissibility, browser support, or integrations unless confirmed in the codebase.

Classify findings as:

- `High confidence`: vague, inflated, misleading, unsupported, or clearly less direct than a factual alternative.
- Do not report borderline stylistic preferences under the default threshold.

## Skill Workflow

Document this workflow in `SKILL.md`:

1. Read repository guidance and identify the project’s product vocabulary and claims.
2. Run the deterministic scanner from the skill directory against the requested repository.
3. Inspect each candidate in its source context and search the implementation when wording makes a behavioral claim.
4. Perform a second semantic pass for non-keyword issues, prioritizing headings, onboarding, empty states, settings, marketing copy, README text, and current reference docs.
5. Report only high-confidence findings, ordered by user impact.
6. For each finding, provide:
   - File and line reference.
   - Existing wording.
   - Why it is imprecise or generated-sounding.
   - A concrete replacement that preserves verified behavior.
7. State explicitly when no high-confidence findings remain.
8. Do not edit anything during the audit.
9. When the user approves specific findings, apply only those copy edits, preserve surrounding structure and links, then show the scoped diff and run proportionate validation.

The skill should treat an approved fix pass as a separate phase, not as implied permission from the audit request.

## Birdbrain-Specific Forward Test

Validate the skill against this repository after creation:

- Confirm it reports current high-confidence candidates in:
  - `src/renderer/components/captures/AnalysisTab.tsx`
  - `src/renderer/components/dashboard/QuickStartGuide.tsx`
  - `src/renderer/components/dashboard/DashboardFooter.tsx`
  - `src/renderer/components/layout/OnboardingWizard.tsx`
  - `src/renderer/components/extension/InstallExtensionGuide.tsx`
  - `docs/reference/capture-pipeline.md`
- Confirm it excludes:
  - `pnpm-lock.yaml`
  - test files and fixtures
  - historical planning/spec directories
  - generated extension output
- Confirm the rubric preserves actual AI functionality while recommending more literal wording for AI-related UI copy.
- Run `quick_validate.py` against the finished skill directory.
- Run both human and JSON scanner output modes to confirm stable paths, line numbers, snippets, and valid JSON.

## Public Interfaces

The new reusable interface is the skill invocation and scanner CLI:

```text
$audit-ai-slop
python3 scripts/scan_ai_slop.py --root <repo-path> --format <human|json>
```

No Birdbrain application APIs, runtime behavior, schemas, or package metadata will change.

## Defaults

- Install location: shared agent skills at `/home/matt/.agents/skills`.
- Audit scope: maintained product UI copy and current product/reference documentation.
- Finding threshold: high confidence only.
- Audit output: findings with rewrite options.
- Editing: only after explicit approval of the proposed findings.
- Language: English prose, with ASCII punctuation in newly edited copy unless source formatting requires otherwise.
