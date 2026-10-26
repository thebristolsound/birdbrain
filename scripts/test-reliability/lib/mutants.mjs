// Mutation sites on the lines a branch added. Each mutant is one small text replacement that
// changes behaviour if the line matters: a test suite that stays green under it does not
// depend on that line.
//
// The operators are deliberately few and conventional (the ones mutation tools agree on), so a
// survivor is easy to read. Types are stripped before the tests run, so a replacement only has
// to parse, not to typecheck.

import ts from 'typescript'

const BINARY_SWAPS = new Map([
  [ts.SyntaxKind.EqualsEqualsEqualsToken, '!=='],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, '==='],
  [ts.SyntaxKind.EqualsEqualsToken, '!='],
  [ts.SyntaxKind.ExclamationEqualsToken, '=='],
  [ts.SyntaxKind.LessThanToken, '<='],
  [ts.SyntaxKind.LessThanEqualsToken, '<'],
  [ts.SyntaxKind.GreaterThanToken, '>='],
  [ts.SyntaxKind.GreaterThanEqualsToken, '>'],
  [ts.SyntaxKind.AmpersandAmpersandToken, '||'],
  [ts.SyntaxKind.BarBarToken, '&&'],
  [ts.SyntaxKind.PlusToken, '-'],
  [ts.SyntaxKind.MinusToken, '+'],
  [ts.SyntaxKind.AsteriskToken, '/'],
  [ts.SyntaxKind.SlashToken, '*']
])

// Deleting a log line changes nothing a test should pin.
const LOGGING_CALLEE = /^(console|log|logger)\./

const scriptKind = (path) =>
  path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.ts') ? ts.ScriptKind.TS : undefined

const isStringish = (node) =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateExpression(node)

const callOf = (expression) => {
  const inner = ts.isAwaitExpression(expression) ? expression.expression : expression
  return ts.isCallExpression(inner) ? inner : null
}

export const findMutants = ({ path, text, lines }) => {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path))
  const lineOf = (pos) => source.getLineAndCharacterOfPosition(pos).line + 1
  const mutants = []
  const add = (node, replacement, operator) => {
    const start = node.getStart(source)
    const line = lineOf(start)
    if (!lines.has(line)) return
    mutants.push({
      path,
      line,
      start,
      end: node.getEnd(),
      original: node.getText(source),
      replacement,
      operator
    })
  }

  const visit = (node) => {
    if (ts.isBinaryExpression(node)) {
      const swap = BINARY_SWAPS.get(node.operatorToken.kind)
      const concatenation =
        node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        (isStringish(node.left) || isStringish(node.right))
      if (swap && !concatenation) add(node.operatorToken, swap, 'operator')
    } else if (
      (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) &&
      !ts.isLiteralTypeNode(node.parent)
    ) {
      add(node, node.kind === ts.SyntaxKind.TrueKeyword ? 'false' : 'true', 'boolean')
    } else if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.ExclamationToken
    ) {
      add(node, node.operand.getText(source), 'negation')
    } else if (ts.isIfStatement(node)) {
      add(node.expression, `!(${node.expression.getText(source)})`, 'condition')
    } else if (
      ts.isReturnStatement(node) &&
      node.expression &&
      node.expression.getText(source) !== 'undefined'
    ) {
      add(node.expression, 'undefined', 'return')
    } else if (ts.isExpressionStatement(node)) {
      const call = callOf(node.expression)
      if (call && !LOGGING_CALLEE.test(call.expression.getText(source))) {
        add(node, 'void 0', 'call')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return mutants
}

export const applyMutant = (text, { start, end, replacement }) =>
  text.slice(0, start) + replacement + text.slice(end)

export const describeMutant = ({ operator, original, replacement }) => {
  // One line with no backtick, so the code cannot end the inline-code span it is shown in.
  const shown = (value) => {
    const flat = value.replace(/\s+/g, ' ').replace(/`/g, "'")
    return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat
  }
  if (operator === 'call') return `deleted the call \`${shown(original)}\``
  if (operator === 'return') return `returned \`undefined\` in place of \`${shown(original)}\``
  if (operator === 'condition') return `negated the condition \`${shown(original)}\``
  return `replaced \`${shown(original)}\` with \`${shown(replacement)}\``
}

// Evenly spaced across the list, which is in file and position order, so a cap thins every
// changed region rather than probing the first file and skipping the rest.
export const selectMutants = (mutants, max) => {
  if (mutants.length <= max) return mutants
  return Array.from({ length: max }, (_, i) => mutants[Math.floor((i * mutants.length) / max)])
}
