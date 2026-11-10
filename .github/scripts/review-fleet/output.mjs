import { readFileSync } from 'node:fs'

const schemas = Object.fromEntries(
  ['findings', 'rulings'].map((kind) => [
    kind,
    JSON.parse(readFileSync(new URL(`./schemas/${kind}.json`, import.meta.url), 'utf8'))
  ])
)

// Validate again at aggregation: artifacts and saved state must not rely on the model CLI
// having enforced the schema, or coerce malformed source review into completed work.
function matches(value, schema) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    if (schema.required.some((key) => !Object.hasOwn(value, key))) return false
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some((key) => !schema.properties[key])
    )
      return false
    return Object.entries(schema.properties).every(
      ([key, rule]) => !Object.hasOwn(value, key) || matches(value[key], rule)
    )
  }
  if (schema.type === 'array')
    return (
      Array.isArray(value) &&
      (schema.maxItems === undefined || value.length <= schema.maxItems) &&
      value.every((item) => matches(item, schema.items))
    )
  if (schema.type === 'integer')
    return Number.isInteger(value) && (!schema.enum || schema.enum.includes(value))
  if (typeof value !== schema.type) return false
  if (schema.enum && !schema.enum.includes(value)) return false
  if (
    schema.type === 'string' &&
    ((schema.minLength && !value.trim()) || value.length > (schema.maxLength ?? Infinity))
  )
    return false
  return true
}

export const validOutput = (kind, output) => matches(output, schemas[kind])
