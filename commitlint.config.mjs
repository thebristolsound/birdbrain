// Branch-commit shape for agent sessions (docs/plans/2026-08-29-agent-posting-controls.md).
// Run by .claude/skills/post-commit-message/scripts/check.sh before `git commit` executes.
// Branch commits vanish at squash (the repo setting is BLANK), so the body is a short "why"
// for the reviewer, not a record.

const BODY_MAX_LINES = 6

// Lines after the header, with the separating blank line and trailing blanks removed.
function bodyLines(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').slice(1)
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  return lines
}

const localRules = {
  rules: {
    'body-max-lines': ({ raw }) => {
      const n = bodyLines(raw).length
      return [n <= BODY_MAX_LINES, `body has ${n} lines; the cap is ${BODY_MAX_LINES}`]
    },
    'no-coauthor-trailer': ({ raw }) => [
      !/^co-authored-by:/im.test(raw),
      'Co-authored-by trailers are never added; remove it'
    ],
    // config-conventional's subject-case bans sentence case and the like, which still lets a
    // subject open on a digit, `#` or `_`.
    'subject-lowercase-start': ({ subject }) => [
      !subject || /^[a-z]/.test(subject),
      'subject must start with a lowercase letter'
    ],
    'no-closing-keyword': ({ raw }) => [
      !/\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s*:?\s*#\d+/i.test(raw),
      'issue-closing keywords belong on line 1 of the PR body, not in a commit'
    ]
  }
}

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [localRules],
  // commitlint skips git's generated messages by default (`Merge branch ...`, `Revert "..."`,
  // `fixup!`). A branch commit an agent writes has one shape, so nothing is skipped.
  defaultIgnores: false,
  rules: {
    'header-max-length': [2, 'always', 72],
    'scope-empty': [2, 'never'],
    'body-max-line-length': [2, 'always', 72],
    'body-max-lines': [2, 'always'],
    'no-coauthor-trailer': [2, 'always'],
    'no-closing-keyword': [2, 'always'],
    'subject-lowercase-start': [2, 'always']
  }
}
