import type { SharingErrorCode } from '@shared/types'

// A refusal the sharing commands raise (#1810). The code is the contract: the
// IPC layer converts it to an `IpcFailure` with the same code, so a screen
// branches on the code and never on the message.
export class SharingError extends Error {
  constructor(
    readonly code: SharingErrorCode,
    message?: string
  ) {
    super(message ?? code)
    this.name = 'SharingError'
  }
}
