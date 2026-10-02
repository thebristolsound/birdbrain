import { isAbsolute, relative } from 'path'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { getStorageRoot } from '@main/services/storage'
import { defaultCaptureStore } from '@main/services/captureStore'

export const DEFAULT_PAGE_LENGTH = 20_000
const MAX_PAGE_LENGTH = 100_000
// The Claude API refuses an image over 5 MB once base64-encoded, which is
// about 3.75 MB of raw bytes. Larger files come back as a path instead.
export const MAX_IMAGE_BYTES = 3_500_000

// Every tool only reads and never reaches the network.
export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const

export const pageInput = {
  offset: z.number().int().min(0).default(0).describe('Character offset to start from'),
  length: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LENGTH)
    .default(DEFAULT_PAGE_LENGTH)
    .describe('Characters to return')
}

export function json(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

export function failure(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export function page(text: string, offset: number, length: number) {
  const slice = text.slice(offset, offset + length)
  const end = offset + slice.length
  return {
    totalLength: text.length,
    offset,
    nextOffset: end < text.length ? end : null,
    text: slice
  }
}

// Paths come from database rows, never from a tool argument, but a row is
// still not trusted to point outside the storage root.
export function storedFilePath(relPath: string): string {
  const abs = defaultCaptureStore.resolveAbsolute(relPath)
  const rel = relative(getStorageRoot(), abs)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Stored path ${relPath} is outside the storage root`)
  }
  return abs
}
