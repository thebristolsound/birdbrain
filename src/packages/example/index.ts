// Entry point: the only file outside this package may import. lib/ is private.
import { normalizeName } from './lib/impl'

export const greet = (name: string): string => `Hello, ${normalizeName(name)}!`
