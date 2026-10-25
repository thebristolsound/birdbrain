// The `it` and `test` calls in a test file, with their line ranges, so a test result can be
// matched to the lines a branch changed. Vitest reports each test's location as the line its
// call starts on, which falls inside exactly one site's range.

import ts from 'typescript'

const TEST_NAMES = new Set(['it', 'test'])

// `it(...)`, `it.only(...)`, `test.concurrent(...)` and the `it.each(table)(...)` form, whose
// callee is itself a call.
const rootName = (callee) => {
  let node = callee
  while (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) {
    node = node.expression
  }
  return ts.isIdentifier(node) ? node.text : null
}

export const findTestSites = ({ path, text }) => {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  const lineOf = (pos) => source.getLineAndCharacterOfPosition(pos).line + 1
  const sites = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && TEST_NAMES.has(rootName(node.expression))) {
      const [title] = node.arguments
      sites.push({
        startLine: lineOf(node.getStart(source)),
        endLine: lineOf(node.getEnd()),
        title: title && ts.isStringLiteralLike(title) ? title.text : null
      })
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return sites
}

// A site is touched when the branch added or edited any line from its call to its closing
// parenthesis. A file the branch added has every site touched.
export const touchedSites = ({ sites, status, addedLines }) =>
  status === 'A'
    ? sites
    : sites.filter(({ startLine, endLine }) => {
        for (let line = startLine; line <= endLine; line++) if (addedLines.has(line)) return true
        return false
      })

export const siteForLine = (sites, line) =>
  sites.find(({ startLine, endLine }) => line >= startLine && line <= endLine) ?? null
