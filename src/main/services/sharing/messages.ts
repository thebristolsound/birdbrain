import { decode, encode } from 'cborg'
import { z } from 'zod'
import { MAX_MHTML_SIZE } from '@shared/constants'
import type { ByteStream } from '@main/services/sharing/transport'

// The wire format of a sync session (docs/specs/2026-09-19-collaborative-
// cases-design.md, "Sync session"): CBOR through cborg 6.1.3 (ruling 1 of
// 2026-10-10 on #1512), one message per length-prefixed frame. Decoding is a
// trust boundary. Every frame a peer sends is parsed against the strict schema
// below before the session reads a field, so a malformed, oversized or
// truncated frame ends the session with a ProtocolError and never reaches the
// acceptance code. Nothing here decides what is accepted: entries, blobs and
// rows are checked by their own modules after they are decoded.

// A frame carries at most one Exhibit file, and a Capture's page archive is
// the largest file the app stores.
export const MAX_FRAME_BYTES = MAX_MHTML_SIZE + 1024 * 1024
const FRAME_HEADER_BYTES = 4
export const CHALLENGE_BYTES = 32

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

const installationIdField = z.string().min(1)
const indexField = z.number().int().nonnegative()
// A byte string. `z.custom` rather than `z.instanceof`, so the inferred type is
// the plain `Uint8Array` every producer (a file read, a Buffer) satisfies.
const bytesField = z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'expected bytes')

export const ChainHeadSchema = z
  .object({
    installationId: installationIdField,
    index: indexField,
    entryHash: z.string().min(1)
  })
  .strict()

export type ChainHead = z.infer<typeof ChainHeadSchema>

// One working-layer row as it travels: the author's installation id written
// out (locally the author's own rows carry NULL), the per-author version, the
// tombstone, the content columns, and the author's signature over the
// canonical JSON of all of that. `table` and `fields` are checked against the
// synced-table descriptors on apply, not here.
export const WireRowSchema = z
  .object({
    table: z.string().min(1),
    author: installationIdField,
    version: z.number().int().positive(),
    deletedAt: z.string().nullable(),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
    signature: z.string().min(1)
  })
  .strict()

export type WireRow = z.infer<typeof WireRowSchema>

// `hello` opens a session in both directions: the dialer's names the Case and
// carries its challenge; the listener's answers with its own challenge and
// the proof over the dialer's. The dialer's `proof` closes the exchange.
const HelloSchema = z
  .object({
    t: z.literal('hello'),
    caseId: z.string().min(1),
    installationId: installationIdField,
    challenge: bytesField.refine((b) => b.length === CHALLENGE_BYTES, {
      message: `challenge must be ${CHALLENGE_BYTES} bytes`
    }),
    proof: z.string().nullable()
  })
  .strict()

const ProofSchema = z.object({ t: z.literal('proof'), signature: z.string().min(1) }).strict()

const HeadsSchema = z.object({ t: z.literal('heads'), heads: z.array(ChainHeadSchema) }).strict()

const EntriesRequestSchema = z
  .object({
    t: z.literal('entries-request'),
    installationId: installationIdField,
    fromIndex: indexField
  })
  .strict()

const EntriesSchema = z
  .object({
    t: z.literal('entries'),
    installationId: installationIdField,
    fromIndex: indexField,
    // Raw manifest lines, exactly as the sender holds them.
    lines: z.array(z.string())
  })
  .strict()

const BlobsRequestSchema = z
  .object({ t: z.literal('blobs-request'), paths: z.array(z.string().min(1)).min(1) })
  .strict()

// One file per frame, in the order requested; `bytes` is null for a path the
// sender does not hold.
const BlobsSchema = z
  .object({ t: z.literal('blobs'), path: z.string().min(1), bytes: bytesField.nullable() })
  .strict()

const RowsRequestSchema = z
  .object({
    t: z.literal('rows-request'),
    authors: z
      .array(z.object({ installationId: installationIdField, sinceVersion: indexField }).strict())
      .min(1)
  })
  .strict()

const RowsSchema = z.object({ t: z.literal('rows'), rows: z.array(WireRowSchema) }).strict()

const ByeSchema = z.object({ t: z.literal('bye'), reason: z.string() }).strict()

export const SyncMessageSchema = z.discriminatedUnion('t', [
  HelloSchema,
  ProofSchema,
  HeadsSchema,
  EntriesRequestSchema,
  EntriesSchema,
  BlobsRequestSchema,
  BlobsSchema,
  RowsRequestSchema,
  RowsSchema,
  ByeSchema
])

export type SyncMessage = z.infer<typeof SyncMessageSchema>
export type SyncMessageOf<T extends SyncMessage['t']> = Extract<SyncMessage, { t: T }>

export function encodeMessage(message: SyncMessage): Uint8Array {
  return encode(message)
}

export function decodeMessage(bytes: Uint8Array): SyncMessage {
  let raw: unknown
  try {
    raw = decode(bytes)
  } catch (err) {
    throw new ProtocolError(`Undecodable frame: ${(err as Error).message}`)
  }
  const parsed = SyncMessageSchema.safeParse(raw)
  if (!parsed.success) {
    const t = raw !== null && typeof raw === 'object' ? (raw as { t?: unknown }).t : undefined
    throw new ProtocolError(`Malformed ${typeof t === 'string' ? t : 'unknown'} message`)
  }
  return parsed.data
}

// Writes one frame: a 4-byte big-endian length, then the CBOR payload.
export async function writeMessage(stream: ByteStream, message: SyncMessage): Promise<void> {
  const payload = encodeMessage(message)
  if (payload.length > MAX_FRAME_BYTES) {
    throw new ProtocolError(`Frame of ${payload.length} bytes exceeds ${MAX_FRAME_BYTES}`)
  }
  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.length)
  new DataView(frame.buffer).setUint32(0, payload.length)
  frame.set(payload, FRAME_HEADER_BYTES)
  await stream.write(frame)
}

// Reassembles frames from a stream that may split or join writes.
export class MessageReader {
  private buffered: Uint8Array = new Uint8Array(0)
  private ended = false

  constructor(private readonly stream: ByteStream) {}

  // The next message, or null when the stream ended between frames. A stream
  // that ends inside a frame is a ProtocolError: the peer went away mid-message.
  async next(): Promise<SyncMessage | null> {
    const header = await this.fill(FRAME_HEADER_BYTES)
    if (!header) {
      if (this.buffered.length === 0) return null
      throw new ProtocolError('Stream ended inside a frame header')
    }
    const length = new DataView(
      this.buffered.buffer,
      this.buffered.byteOffset,
      FRAME_HEADER_BYTES
    ).getUint32(0)
    if (length > MAX_FRAME_BYTES) {
      throw new ProtocolError(`Frame of ${length} bytes exceeds ${MAX_FRAME_BYTES}`)
    }
    const total = FRAME_HEADER_BYTES + length
    if (!(await this.fill(total))) throw new ProtocolError('Stream ended inside a frame')
    const payload = this.buffered.subarray(FRAME_HEADER_BYTES, total)
    const message = decodeMessage(payload)
    this.buffered = this.buffered.slice(total)
    return message
  }

  // Reads until `bytes` are buffered. False when the stream ended first.
  private async fill(bytes: number): Promise<boolean> {
    while (this.buffered.length < bytes) {
      if (this.ended) return false
      const chunk = await this.stream.read()
      if (chunk === null) {
        this.ended = true
        return false
      }
      const joined = new Uint8Array(this.buffered.length + chunk.length)
      joined.set(this.buffered)
      joined.set(chunk, this.buffered.length)
      this.buffered = joined
    }
    return true
  }
}

// Reads the next message and requires it to be of type `t`; a `bye` is
// surfaced as its own error so the session can report why the peer stopped.
export class PeerByeError extends Error {
  constructor(readonly reason: string) {
    super(`Peer ended the session: ${reason}`)
    this.name = 'PeerByeError'
  }
}

export async function expectMessage<T extends SyncMessage['t']>(
  reader: MessageReader,
  t: T
): Promise<SyncMessageOf<T>> {
  const message = await reader.next()
  if (message === null) throw new ProtocolError(`Stream ended while waiting for ${t}`)
  if (message.t === 'bye') throw new PeerByeError(message.reason)
  if (message.t !== t) throw new ProtocolError(`Expected ${t}, received ${message.t}`)
  return message as SyncMessageOf<T>
}
