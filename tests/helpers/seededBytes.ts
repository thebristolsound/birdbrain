// Deterministic xorshift32 bytes. Unlike a counter pattern, they do not repeat at a power-of-two
// chunk size, so a test reading them in chunks sees a chunk repeated, dropped or out of place.
export function seededBytes(size: number, seed = 0): Buffer {
  const bytes = Buffer.alloc(size)
  let state = (0x9e3779b9 ^ seed) | 0 || 1
  for (let i = 0; i < size; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[i] = state & 0xff
  }
  return bytes
}
